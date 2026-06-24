import os
import subprocess
import json
import time
from datetime import datetime
import open3d as o3d
import numpy as np
from PIL import Image
from rembg import remove as rembg_remove
from crewai.tools import tool
from dotenv import load_dotenv

load_dotenv()


def preprocess_image(image_path: str, output_path: str = "./outputs/preprocessed_input.png") -> str:
    """
    Prepares an input photo for Tripo AI by stripping the background natively.
    CRITICAL: We keep the exact dimensions and positioning of the original image
    so that Tripo's neural network can correctly infer perspective and focal length.
    """
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    print(f"🖼  Pre-processing image (preserving perspective): {image_path}")

    # Remove background with rembg
    with open(image_path, "rb") as f:
        raw_bytes = f.read()
    
    cleaned_bytes = rembg_remove(raw_bytes)

    # Save exactly as it is outputted by the background remover
    with open(output_path, "wb") as f:
        f.write(cleaned_bytes)

    print(f"   ✅ Preprocessed image saved without perspective distortion: {output_path}")
    return output_path

def _curl(method, url, headers=None, files=None, json_data=None, output_file=None):
    """
    Execute an HTTP request via curl subprocess.
    curl is used instead of requests because Python's SSL on macOS
    produces SSLEOFError against api.tripo3d.ai, while curl works fine.
    """
    cmd = ['curl', '-s', '-k', '-L', '-X', method, '--max-time', '120']  # -L follows redirects

    if headers:
        for key, value in headers.items():
            cmd += ['-H', f'{key}: {value}']

    if files:
        for field, file_path in files.items():
            cmd += ['-F', f'{field}=@{file_path}']

    if json_data:
        cmd += ['-H', 'Content-Type: application/json']
        cmd += ['-d', json.dumps(json_data)]

    if output_file:
        cmd += ['-o', output_file]

    cmd.append(url)

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"curl failed (exit {result.returncode}): {result.stderr or result.stdout or 'no output'}")

    if output_file:
        return None
    if result.stdout:
        try:
            parsed = json.loads(result.stdout)
            # Surface API-level errors clearly
            if isinstance(parsed, dict) and parsed.get("code") and parsed.get("code") != 0:
                raise RuntimeError(f"API error {parsed.get('code')}: {parsed.get('message', result.stdout[:200])}")
            return parsed
        except json.JSONDecodeError:
            raise RuntimeError(f"Non-JSON response: {result.stdout[:300]}")
    return {}


def smart_refine_geometry(file_path, refinement_type: str = "Design"):
    """
    Applies adaptive mesh refinement pipelines based on the refinement type.
    - Mechanical: Sharp planes via aggressive RANSAC, minimal smoothing to preserve edges.
    - Design: Hybrid approach with moderate RANSAC and medium Taubin smoothing for curves.
    - Organic: No RANSAC plane snapping, using Laplacian smoothing for clean organic surfaces.
    """
    if not os.path.exists(file_path):
        return file_path

    # Load the mesh (Open3D supports .obj and .glb)
    mesh = o3d.io.read_triangle_mesh(file_path)
    if not mesh.has_vertices():
        return file_path

    refinement_type = refinement_type.strip().capitalize()
    print(f"🛠  Applying {refinement_type} Refinement Pipeline...")

    if refinement_type == "Mechanical":
        # 1. Aggressive Plane Detection & Snapping (RANSAC)
        # Snap flat areas strictly to mathematical planes
        for _ in range(5):
            try:
                plane_model, inliers = mesh.segment_plane(distance_threshold=0.008,
                                                         ransac_n=3,
                                                         num_iterations=1500)

                if len(inliers) > 300:
                    vertices = np.asarray(mesh.vertices)
                    origin = -plane_model[3] * plane_model[:3]
                    normal = plane_model[:3]
                    for idx in inliers:
                        v = vertices[idx]
                        dist = np.dot(v - origin, normal)
                        vertices[idx] = v - dist * normal
                    mesh.vertices = o3d.utility.Vector3dVector(vertices)
            except Exception:
                break
        
        # 2. Light Taubin Smoothing (cleans high-frequency noise but preserves sharp edges/corners)
        mesh = mesh.filter_smooth_taubin(number_of_iterations=8)

    elif refinement_type == "Organic":
        # 1. No RANSAC plane snapping for organic biological surfaces
        # 2. Laplacian smoothing (excellent for characters, soft meshes, biological shapes)
        mesh = mesh.filter_smooth_laplacian(number_of_iterations=10)

    else: # "Design" (default/hybrid style for smooth consumer products)
        # 1. Moderate Plane Snapping (only large structural planes)
        for _ in range(2):
            try:
                plane_model, inliers = mesh.segment_plane(distance_threshold=0.012,
                                                         ransac_n=3,
                                                         num_iterations=1000)

                if len(inliers) > 800:
                    vertices = np.asarray(mesh.vertices)
                    origin = -plane_model[3] * plane_model[:3]
                    normal = plane_model[:3]
                    for idx in inliers:
                        v = vertices[idx]
                        dist = np.dot(v - origin, normal)
                        vertices[idx] = v - dist * normal
                    mesh.vertices = o3d.utility.Vector3dVector(vertices)
            except Exception:
                break

        # 2. Strong Taubin Smoothing (removes AI surface noise but preserves organic volume curves)
        mesh = mesh.filter_smooth_taubin(number_of_iterations=20)

    mesh.compute_vertex_normals()

    # Determine output path while preserving original format (.glb or .obj)
    base, ext = os.path.splitext(file_path)
    refined_path = f"{base}_refined{ext}"

    o3d.io.write_triangle_mesh(refined_path, mesh)

    # Copy materials and textures from the original GLB to the refined GLB
    if ext.lower() == ".glb":
        try:
            import trimesh
            raw_trimesh = trimesh.load(file_path, force='mesh')
            refined_trimesh = trimesh.load(refined_path, force='mesh')
            refined_trimesh.visual = raw_trimesh.visual
            refined_trimesh.export(refined_path)
            print("   ✅ Successfully preserved original texture on refined GLB.")
        except Exception as e:
            print(f"   ⚠️ Failed to copy texture visual map: {e}")

    return refined_path


def make_named_folder(base_dir: str, label: str) -> tuple:
    """
    Creates a numbered, human-readable folder inside base_dir.
    Sanitizes 'label' into snake_case and auto-increments a counter
    so each new run gets a unique directory:
      base_dir/orange_powerbank_1/
      base_dir/orange_powerbank_2/  etc.
    Returns (folder_path, counter_number) so both inputs/ and outputs/
    can be given the same counter for a matching pair.
    """
    import re
    base = re.sub(r"[^a-z0-9]+", "_", label.strip().lower()).strip("_") or "object"
    counter = 1
    while True:
        folder = os.path.join(base_dir, f"{base}_{counter}")
        if not os.path.exists(folder):
            os.makedirs(folder, exist_ok=True)
            return folder, counter
        counter += 1


def _poll_task_status(task_id: str, headers: dict, task_name: str = "3D Model") -> str:
    """Polls a specific Tripo task until it succeeds, returning the model URL."""
    print(f"🔄 Polling {task_name} (Task ID: {task_id})...")
    max_attempts = 120  # increased to 10 minutes because Refinement is heavy
    
    for attempt in range(max_attempts):
        try:
            status_url = f"https://api.tripo3d.ai/v2/openapi/task/{task_id}"
            status_resp = _curl("GET", status_url, headers=headers)
            status = status_resp["data"]["status"]

            if status == "success":
                output = status_resp["data"].get("output", {})
                print(f"   ✅ {task_name} succeeded.")
                # We prioritize the pbr_model (High-res texture mesh) over the base model
                model_url = (
                    output.get("pbr_model") or
                    output.get("model") or
                    output.get("rendered_image") or
                    next(iter(output.values()), None)
                )
                if not model_url:
                    raise Exception(f"Task succeeded but no model URL found in {output}")
                return model_url
            elif status == "failed":
                raise Exception(f"{task_name} failed on Tripo servers.")

            print(f"   Attempt {attempt + 1}/{max_attempts} — status: {status}")
            time.sleep(5)
        except Exception as e:
            if "failed" in str(e).lower() or "no model url" in str(e).lower():
                raise e
            print(f"   Polling API error: {str(e)}. Retrying...")
            time.sleep(5)

    raise Exception(f"Timed out waiting for {task_name}.")


def _download_model_directly(task_id: str, headers: dict, folder_name: str, refinement_type: str = "Design") -> str:
    """
    Waits for the V3.1 model generation to finish and downloads it.
    Applies adaptive geometric refinement.
    """
    try:
        final_model_url = _poll_task_status(task_id, headers, "V3.1 Generation")
    except Exception as e:
        return f"Generation error: {str(e)}"

    output_dir = os.path.join("./outputs", folder_name)
    os.makedirs(output_dir, exist_ok=True)
    print(f"\n📁 Output folder: {output_dir}")

    ext = os.path.splitext(final_model_url.split("?")[0])[-1] or ".glb"
    raw_file_path = os.path.join(output_dir, f"raw{ext}")

    try:
        _curl("GET", final_model_url, output_file=raw_file_path)
    except Exception as e:
        return f"File download error: {str(e)}"

    print(f"✨ Applying Smart {refinement_type} Refinement to V3.1 Mesh...")
    final_path = smart_refine_geometry(raw_file_path, refinement_type)
    return f"Success: Raw model saved at {raw_file_path} | Refined model saved at {final_path}"


@tool("generate_3d_model")
def generate_3d_model(image_paths: list, object_label: str = "object", preprocess: bool = False, refinement_type: str = "Design"):
    """
    Generates a 3D model from a local image file using Tripo AI (image_to_model).
    Applies local background removal and centering before uploading if preprocess is True.
    Input: list of local image file paths — only the first image is used.
    Optional object_label: short 1-2 word name (e.g. 'orange powerbank').
      Used to create matching, numbered inputs/ and outputs/ folders.
    Optional preprocess: boolean flag to enable or disable background removal.
    Optional refinement_type: the type of geometry refinement to run: 'Mechanical', 'Design', or 'Organic'.
    Returns the path to the refined 3D mesh file.
    """
    import shutil

    api_key = os.getenv("TRIPO_API_KEY")
    if not api_key:
        return "Error: TRIPO_API_KEY not found in environment."

    headers = {"Authorization": f"Bearer {api_key}"}
    primary_image = image_paths[0]

    # ------------------------------------------------------------------
    # Step 1: Create a named, numbered input folder FIRST so the counter
    # is reserved. The matching output folder will use the same name.
    # ------------------------------------------------------------------
    input_folder, counter = make_named_folder("./inputs", object_label)
    import re
    base_label = re.sub(r"[^a-z0-9]+", "_", object_label.strip().lower()).strip("_") or "object"
    folder_name = f"{base_label}_{counter}"   # e.g. "orange_powerbank_2"
    print(f"📂 Input folder: {input_folder}")

    # Copy the original upload into the input folder
    orig_ext = os.path.splitext(primary_image)[1] or ".jpg"
    original_dest = os.path.join(input_folder, f"original{orig_ext}")
    shutil.copy2(primary_image, original_dest)

    # ------------------------------------------------------------------
    # Step 2: Pre-process the image — save result inside the input folder
    # ------------------------------------------------------------------
    preprocessed_dest = os.path.join(input_folder, "preprocessed.png")
    try:
        if preprocess:
            preprocessed_path = preprocess_image(primary_image, preprocessed_dest)
        else:
            print("   ℹ️  Preprocessing (background removal) disabled by user request.")
            preprocessed_path = primary_image
    except Exception as e:
        print(f"   ⚠️  Pre-processing failed ({e}), falling back to original image.")
        preprocessed_path = primary_image

    # ------------------------------------------------------------------
    # Step 3: Upload the preprocessed image to get an image_token
    # ------------------------------------------------------------------
    upload_url = "https://api.tripo3d.ai/v2/openapi/upload"
    try:
        resp = _curl("POST", upload_url, headers=headers, files={"file": preprocessed_path})
        image_token = resp["data"]["image_token"]
    except Exception as e:
        return f"Upload error: {str(e)}"

    # ------------------------------------------------------------------
    # Step 4: Single-image task — no extra flags
    # ------------------------------------------------------------------
    task_url = "https://api.tripo3d.ai/v2/openapi/task"
    task_payload = {
        "type": "image_to_model",
        "file": {"type": "png", "file_token": image_token},
        "model_version": "v3.1-20260211",        # Upgraded to high-fidelity V3.1 model
        "texture_alignment": "original_image",   # Forces texture to perfectly match the photo view
        "enable_image_autofix": True,
        "face_limit": 100000                     # Requested higher face count
    }

    try:
        task_resp = _curl("POST", task_url, headers=headers, json_data=task_payload)
        if "data" not in task_resp:
            return f"Tripo API Error: {task_resp.get('message', 'Unknown error')} (Code: {task_resp.get('code')})"
        task_id = task_resp["data"]["task_id"]
    except Exception as e:
        return f"Task creation error: {str(e)}"

    # Launch Single-Pass V3.1 pipeline with adaptive refinement
    return _download_model_directly(task_id, headers, folder_name, refinement_type)

