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
    Prepares an input photo for Tripo AI by:
    1. Removing the background with rembg.
    2. Auto-cropping to the object's bounding box.
    3. Centering it on a square 1024x1024 transparent canvas with 10% padding.
    Saves the result to output_path and returns that path.
    """
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    print(f"🖼  Pre-processing image: {image_path}")

    # Step 1: Remove background
    with open(image_path, "rb") as f:
        raw_bytes = f.read()
    cleaned_bytes = rembg_remove(raw_bytes)

    import io
    fg = Image.open(io.BytesIO(cleaned_bytes)).convert("RGBA")

    # Step 2: Crop to bounding box of non-transparent pixels
    bbox = fg.getbbox()  # (left, upper, right, lower)
    if bbox:
        fg = fg.crop(bbox)
    else:
        print("   ⚠️  rembg returned a fully transparent image — using original.")
        fg = Image.open(image_path).convert("RGBA")

    # Step 3: Fit into a 1024x1024 canvas with 10% padding
    canvas_size = 1024
    padding = int(canvas_size * 0.10)
    max_dim = canvas_size - 2 * padding

    fg.thumbnail((max_dim, max_dim), Image.LANCZOS)

    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    paste_x = (canvas_size - fg.width) // 2
    paste_y = (canvas_size - fg.height) // 2
    canvas.paste(fg, (paste_x, paste_y), fg)

    canvas.save(output_path, "PNG")
    print(f"   ✅ Preprocessed image saved: {output_path} ({fg.width}×{fg.height} object on {canvas_size}×{canvas_size} canvas)")
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


def smart_refine_geometry(file_path):
    """
    Uses RANSAC to detect geometric primitives (planes/cylinders)
    and flattens only the areas intended to be 'Hard Surface'.
    """
    if not os.path.exists(file_path):
        return file_path

    # Load the mesh (Open3D supports .obj and .glb)
    mesh = o3d.io.read_triangle_mesh(file_path)
    if not mesh.has_vertices():
        return file_path

    # 1. Plane Detection (RANSAC)
    # Finds flat areas like the bottle top and gold ring
    for _ in range(3):
        try:
            plane_model, inliers = mesh.segment_plane(distance_threshold=0.01,
                                                     ransac_n=3,
                                                     num_iterations=1000)

            if len(inliers) > 500:
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

    # 2. Taubin Smoothing
    mesh = mesh.filter_smooth_taubin(number_of_iterations=20)
    mesh.compute_vertex_normals()

    # Determine output path while preserving original format (.glb or .obj)
    base, ext = os.path.splitext(file_path)
    refined_path = f"{base}_refined{ext}"

    o3d.io.write_triangle_mesh(refined_path, mesh)
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


def _poll_and_download(task_id: str, headers: dict, folder_name: str = "object_1") -> str:
    """Polls Tripo until the task completes, then downloads and refines the mesh."""
    print(f"🔄 Processing 3D Model (Task ID: {task_id})...")
    max_attempts = 60
    model_url = None

    for attempt in range(max_attempts):
        try:
            status_url = f"https://api.tripo3d.ai/v2/openapi/task/{task_id}"
            status_resp = _curl("GET", status_url, headers=headers)
            status = status_resp["data"]["status"]

            if status == "success":
                output = status_resp["data"].get("output", {})
                print(f"   ✅ Task succeeded. Output keys: {list(output.keys())}")
                model_url = (
                    output.get("model") or
                    output.get("pbr_model") or
                    output.get("rendered_image") or
                    next(iter(output.values()), None)
                )
                if not model_url:
                    return f"Error: Task succeeded but no model URL found. Output: {output}"
                break
            elif status == "failed":
                return "Tripo AI generation failed."

            print(f"   Attempt {attempt + 1}/{max_attempts} — status: {status}")
            time.sleep(5)
        except Exception as e:
            print(f"   Polling error: {str(e)}. Retrying...")
            time.sleep(5)

    if not model_url:
        return "Error: Timed out waiting for Tripo AI."

    # Use the pre-computed folder_name so inputs/ and outputs/ always match
    output_dir = os.path.join("./outputs", folder_name)
    os.makedirs(output_dir, exist_ok=True)
    print(f"📁 Output folder: {output_dir}")

    ext = os.path.splitext(model_url.split("?")[0])[-1] or ".glb"
    raw_file_path = os.path.join(output_dir, f"raw{ext}")

    try:
        _curl("GET", model_url, output_file=raw_file_path)
    except Exception as e:
        return f"Download error: {str(e)}"

    print("✨ Applying Smart CAD Refinement...")
    final_path = smart_refine_geometry(raw_file_path)
    return f"Success: Raw model saved at {raw_file_path} | Refined model saved at {final_path}"


@tool("generate_3d_model")
def generate_3d_model(image_paths: list, description: str = None, object_label: str = "object"):
    """
    Generates a 3D model from a local image file using Tripo AI (image_to_model).
    Applies local background removal and centering before uploading.
    Input: list of local image file paths — only the first image is used.
    Optional object_label: short 1-2 word name (e.g. 'orange powerbank').
      Used to create matching, numbered inputs/ and outputs/ folders.
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
        preprocessed_path = preprocess_image(primary_image, preprocessed_dest)
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
        "enable_image_autofix": True
    }

    try:
        task_resp = _curl("POST", task_url, headers=headers, json_data=task_payload)
        if "data" not in task_resp:
            return f"Tripo API Error: {task_resp.get('message', 'Unknown error')} (Code: {task_resp.get('code')})"
        task_id = task_resp["data"]["task_id"]
    except Exception as e:
        return f"Task creation error: {str(e)}"

    # Pass the exact folder_name so outputs/ folder matches inputs/ folder
    return _poll_and_download(task_id, headers, folder_name=folder_name)


@tool("generate_3d_from_text")
def generate_3d_from_text(description: str):
    """
    USE THIS TOOL to generate a 3D model from the geometric text description
    produced by the analyze_image tool. Sends the description as a concise text
    prompt to Tripo AI (text_to_model) and returns the path to the refined 3D mesh.
    Input: the full geometric description string from the Director agent.
    """
    api_key = os.getenv("TRIPO_API_KEY")
    if not api_key:
        return "Error: TRIPO_API_KEY not found in environment."

    # Tripo's text_to_model has a ~500 char prompt limit.
    # Strip markdown symbols and compress to a clean, concise prompt.
    import re
    clean = re.sub(r"[#*`\-]+", "", description)
    clean = re.sub(r"\n+", " ", clean).strip()
    clean = re.sub(r"\s{2,}", " ", clean)
    prompt = clean[:500]

    # Extract a short label from the first sentence for the folder name
    # e.g. "A cyan blue star-shaped hair clip." → "cyan-blue-star-shaped-hair-clip"
    first_sentence = re.split(r"[.\n]", clean)[0].strip()
    slug = re.sub(r"[^a-z0-9]+", "-", first_sentence.lower())[:40].strip("-")
    label = slug if slug else "object"

    print(f"📝 Sending prompt to Tripo ({len(prompt)} chars): {prompt[:80]}...")
    print(f"📁 Will save as: {label}")

    headers = {"Authorization": f"Bearer {api_key}"}
    task_url = "https://api.tripo3d.ai/v2/openapi/task"
    task_payload = {
        "type": "text_to_model",
        "prompt": prompt
    }
    try:
        task_resp = _curl("POST", task_url, headers=headers, json_data=task_payload)
        if "data" not in task_resp:
            return f"Tripo API Error: {task_resp.get('message', 'Unknown error')} (Code: {task_resp.get('code')})"
        task_id = task_resp["data"]["task_id"]
    except Exception as e:
        return f"Task creation error: {str(e)}"

    return _poll_and_download(task_id, headers, label=label)