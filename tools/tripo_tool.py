import os
import subprocess
import json
import time
from datetime import datetime
import open3d as o3d
import numpy as np
from crewai.tools import tool
from dotenv import load_dotenv

load_dotenv()

def _curl(method, url, headers=None, files=None, json_data=None, output_file=None):
    """
    Execute an HTTP request via curl subprocess.
    curl is used instead of requests because Python's SSL on macOS
    produces SSLEOFError against api.tripo3d.ai, while curl works fine.
    """
    cmd = ['curl', '-s', '-k', '-L', '-X', method]  # -L follows redirects

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
        raise RuntimeError(f"curl failed: {result.stderr}")

    if output_file:
        return None
    if result.stdout:
        try:
            return json.loads(result.stdout)
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


@tool("generate_3d_model")
def generate_3d_model(image_path: str):
    """
    USE THIS TOOL FIRST. Generates a 3D model from a local image path.
    Input must be a string representing the path (e.g., './input.jpg').
    This tool will return the path to the REFINED 3D mesh.
    """
    api_key = os.getenv("TRIPO_API_KEY")
    if not api_key:
        return "Error: TRIPO_API_KEY not found in environment."

    headers = {"Authorization": f"Bearer {api_key}"}

    # 1. Upload the image via curl (bypasses Python SSL issues on macOS)
    upload_url = "https://api.tripo3d.ai/v2/openapi/upload"
    try:
        resp = _curl("POST", upload_url, headers=headers, files={"file": image_path})
        image_token = resp["data"]["image_token"]
    except Exception as e:
        return f"Upload error: {str(e)}"

    # 2. Task Creation (v2 payload format)
    task_url = "https://api.tripo3d.ai/v2/openapi/task"
    task_payload = {
        "type": "image_to_model",
        "file": {
            "type": "jpg",
            "file_token": image_token
        }
    }
    try:
        task_resp = _curl("POST", task_url, headers=headers, json_data=task_payload)
        
        # Check if the API returned an explicit error (like insufficient credits)
        if "data" not in task_resp:
            return f"Tripo API Error: {task_resp.get('message', 'Unknown error')} (Code: {task_resp.get('code')})"
            
        task_id = task_resp["data"]["task_id"]
    except Exception as e:
        return f"Task creation error: {str(e)}"

def _poll_and_download(task_id: str, headers: dict, label: str = "model") -> str:
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

    # Build a human-readable folder: timestamp + object label
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M")
    folder_name = f"{timestamp}_{label}"
    output_dir = os.path.join("./outputs", folder_name)
    os.makedirs(output_dir, exist_ok=True)
    ext = os.path.splitext(model_url.split("?")[0])[-1] or ".glb"
    raw_file_path = os.path.join(output_dir, f"raw{ext}")

    try:
        _curl("GET", model_url, output_file=raw_file_path)
    except Exception as e:
        return f"Download error: {str(e)}"

    print("✨ Applying Smart CAD Refinement...")
    final_path = smart_refine_geometry(raw_file_path)
    return f"Success: Refined model saved at {final_path}"


@tool("generate_3d_model")
def generate_3d_model(image_path: str):
    """
    Generates a 3D model directly from a local image file using Tripo AI (image_to_model).
    Input: local image file path (e.g., './input.jpg').
    Returns the path to the refined 3D mesh file.
    """
    api_key = os.getenv("TRIPO_API_KEY")
    if not api_key:
        return "Error: TRIPO_API_KEY not found in environment."

    headers = {"Authorization": f"Bearer {api_key}"}

    # Upload the image
    upload_url = "https://api.tripo3d.ai/v2/openapi/upload"
    try:
        resp = _curl("POST", upload_url, headers=headers, files={"file": image_path})
        image_token = resp["data"]["image_token"]
    except Exception as e:
        return f"Upload error: {str(e)}"

    # Create task
    task_url = "https://api.tripo3d.ai/v2/openapi/task"
    task_payload = {
        "type": "image_to_model",
        "file": {"type": "jpg", "file_token": image_token}
    }
    try:
        task_resp = _curl("POST", task_url, headers=headers, json_data=task_payload)
        if "data" not in task_resp:
            return f"Tripo API Error: {task_resp.get('message', 'Unknown error')} (Code: {task_resp.get('code')})"
        task_id = task_resp["data"]["task_id"]
    except Exception as e:
        return f"Task creation error: {str(e)}"

    return _poll_and_download(task_id, headers, label="image-model")


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