import os
import ssl
import uuid
import threading
import re
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import httpx
from supabase import create_client, Client, ClientOptions

# SSL fix for macOS
try:
    _create_unverified_https_context = ssl._create_unverified_context
except AttributeError:
    pass
else:
    ssl._create_default_https_context = _create_unverified_https_context

load_dotenv()

supabase_url: str = os.environ.get("SUPABASE_URL")
supabase_key: str = os.environ.get("SUPABASE_ANON_KEY")
if supabase_url and supabase_key:
    # Disable HTTP/2 to prevent httpx ConnectionTerminated protocol errors on idle timeout reuse
    options = ClientOptions(httpx_client=httpx.Client(http2=False))
    supabase: Client = create_client(supabase_url, supabase_key, options=options)
else:
    supabase = None


app = FastAPI(title="Photo-to-3D API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "http://localhost:8081",
        "http://127.0.0.1:8081",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# In-memory job store  {job_id: {status, step, progress, model_path, error}}
# ---------------------------------------------------------------------------
jobs: dict[str, dict] = {}


def run_pipeline(job_id: str, image_path: str, preprocess: bool = False):
    """Run the full CrewAI pipeline in a background thread."""
    from crewai import Crew, Task, Process
    from agents import create_agents

    job = jobs[job_id]
    job["input_type"] = "image"
    job["input_value"] = image_path
    try:
        job.update(status="processing", step="Vision Analysis...", progress=8)

        director, artist = create_agents()

        analyze_task = Task(
            description=(
                f"Use the 'analyze_image' tool on '{image_path}' to visually inspect the object. "
                "Based on what the tool returns, identify the object's primary geometry — "
                "its shape, surfaces, and edges. Then determine if 'Mechanical', 'Design', or 'Organic' "
                "refinement is most appropriate. "
                "Also identify a SHORT 1-2 word label for the object suitable for a folder name "
                "(e.g. 'orange powerbank', 'airpods', 'water bottle', 'coffee mug'). "
                "Include this label clearly in your output."
            ),
            expected_output=(
                "A technical brief identifying the object, specifying if "
                "'Mechanical', 'Design', or 'Organic' refinement is needed, "
                "and a short 1-2 word object label (e.g. 'orange powerbank')."
            ),
            agent=director,
        )

        job.update(step="Generating Base Mesh...", progress=30)

        reconstruct_task = Task(
            description=(
                f"The Director has analyzed the object. Now use 'generate_3d_model'. "
                f"You have been provided the input image: {image_path}. "
                f"CRITICAL: You must pass this EXACT python list of strings ['{image_path}'] "
                f"as the 'image_paths' parameter to the tool. "
                f"CRITICAL: From the Director's brief, extract the short 1-2 word object label "
                f"(e.g. 'orange powerbank') and pass it as the 'object_label' parameter to the tool. "
                f"CRITICAL: Pass the boolean value {preprocess} as the 'preprocess' parameter to the tool. "
                f"CRITICAL: From the Director's brief, extract the recommended refinement type ('Mechanical', 'Design', or 'Organic') and pass it as the 'refinement_type' parameter to the tool. "
                "Return the file path of the resulting refined 3D mesh."
            ),
            expected_output="The string path to the generated 3D file, or a clear error message if the tool fails.",
            agent=artist,
            context=[analyze_task],
        )

        crew = Crew(
            agents=[director, artist],
            tasks=[analyze_task, reconstruct_task],
            process=Process.sequential,
            verbose=True,
        )

        job.update(step="Applying RANSAC Snapping...", progress=60)
        result = crew.kickoff(inputs={"file_path": image_path})
        result_str = str(result)

        job.update(step="Finalizing Geometry...", progress=90)

        # The agent returns only the refined path in its final answer.
        # Find any .glb path ending in _refined.glb from the result. Allow spaces just in case.
        refined_match = re.search(r"(\./outputs/[^'\"|\]]+_refined\.glb)", result_str)
        refined_path = refined_match.group(1).strip().rstrip(".,)") if refined_match else None

        if not refined_path or not os.path.exists(refined_path):
            any_match = re.search(r"(\./outputs/[^'\"|\]]+\.glb)", result_str)
            if any_match:
                refined_path = any_match.group(1).strip().rstrip(".,)")

        # FOOLPROOF FALLBACK: if the AI hallucinates entirely, just grab the most recently updated folder in outputs/
        if not refined_path or not os.path.exists(refined_path):
            try:
                base_dir = "./outputs"
                all_folders = [os.path.join(base_dir, d) for d in os.listdir(base_dir) if os.path.isdir(os.path.join(base_dir, d))]
                if all_folders:
                    latest_folder = max(all_folders, key=os.path.getmtime)
                    possible_path = os.path.join(latest_folder, "raw_refined.glb")
                    if os.path.exists(possible_path):
                        refined_path = possible_path
            except Exception:
                pass

        if refined_path and os.path.exists(refined_path):
            # Derive the raw path from the same folder (raw.glb is always downloaded first)
            raw_path = os.path.join(os.path.dirname(refined_path), "raw.glb")
            if not raw_path or not os.path.exists(raw_path):
                # Try .glb variant from Tripo (e.g. raw.glb may have a different ext)
                folder = os.path.dirname(refined_path)
                candidates = [f for f in os.listdir(folder) if f.startswith("raw") and not f.endswith("_refined.glb")]
                raw_path = os.path.join(folder, candidates[0]) if candidates else None

            # Calculate actual face and vertex counts
            raw_stats = {"faces": 0, "vertices": 0}
            if raw_path and os.path.exists(raw_path):
                try:
                    import trimesh
                    raw_mesh = trimesh.load(raw_path, force='mesh')
                    raw_stats = {"faces": len(raw_mesh.faces), "vertices": len(raw_mesh.vertices)}
                except Exception as e:
                    print(f"Error calculating raw stats: {e}")

            refined_stats = {"faces": 0, "vertices": 0}
            if refined_path and os.path.exists(refined_path):
                try:
                    import trimesh
                    refined_mesh = trimesh.load(refined_path, force='mesh')
                    refined_stats = {"faces": len(refined_mesh.faces), "vertices": len(refined_mesh.vertices)}
                except Exception as e:
                    print(f"Error calculating refined stats: {e}")

            # Extract the object label from the director's output if available
            object_label = "Generated Model"
            try:
                brief = str(analyze_task.output.raw)
                from litellm import completion
                resp = completion(
                    model="groq/meta-llama/llama-4-scout-17b-16e-instruct",
                    messages=[
                        {
                            "role": "system",
                            "content": "You are a helper that extracts a 1-2 word descriptive label for an object from a text brief. Output only the label and nothing else (e.g. 'orange powerbank', 'laptop'). Keep it short and in lowercase.",
                        },
                        {"role": "user", "content": f"Extract the object label from this brief:\n{brief}"},
                    ],
                    temperature=0.0,
                    max_tokens=10,
                )
                label_candidate = resp.choices[0].message.content.strip().replace("'", "").replace('"', '').strip()
                if label_candidate and len(label_candidate) < 40 and not label_candidate.lower().startswith("here is"):
                    object_label = label_candidate.title()
            except Exception as e:
                print(f"Error extracting object label via LLM: {e}")
                try:
                    match = re.search(
                        r"(?:object\s+)?label\s*:\s*['\"#]?([a-zA-Z0-9\s_-]{2,30})",
                        brief,
                        re.IGNORECASE,
                    )
                    if match:
                        object_label = match.group(1).strip().title()
                except Exception:
                    pass

            job.update(
                status="complete",
                step="Complete!",
                progress=100,
                model_path=refined_path,
                raw_model_path=raw_path if raw_path and os.path.exists(raw_path) else None,
                raw_stats=raw_stats,
                refined_stats=refined_stats,
                object_label=object_label,
            )

            # Upload to Supabase and update creations row
            if supabase:
                try:
                    
                    with open(image_path, "rb") as f:
                        supabase.storage.from_("inputs").upload(
                            path=f"{job_id}.jpg",
                            file=f.read(),
                            file_options={"content-type": "image/jpeg"}
                        )
                    input_url = supabase.storage.from_("inputs").get_public_url(f"{job_id}.jpg")

                    with open(refined_path, "rb") as f:
                        supabase.storage.from_("models").upload(
                            path=f"{job_id}_refined.glb",
                            file=f.read(),
                            file_options={"content-type": "model/gltf-binary"}
                        )
                    refined_url = supabase.storage.from_("models").get_public_url(f"{job_id}_refined.glb")

                    raw_url = None
                    if raw_path and os.path.exists(raw_path):
                        with open(raw_path, "rb") as f:
                            supabase.storage.from_("models").upload(
                                path=f"{job_id}_raw.glb",
                                file=f.read(),
                                file_options={"content-type": "model/gltf-binary"}
                            )
                        raw_url = supabase.storage.from_("models").get_public_url(f"{job_id}_raw.glb")

                    supabase.table("creations").update({
                        "original_image_url": input_url,
                        "glb_model_url": refined_url,
                        "raw_glb_url": raw_url,
                        "raw_faces": raw_stats["faces"],
                        "raw_vertices": raw_stats["vertices"],
                        "refined_faces": refined_stats["faces"],
                        "refined_vertices": refined_stats["vertices"],
                        "object_label": object_label,
                        "status": "complete"
                    }).eq("id", job_id).execute()
                except Exception as e:
                    print(f"Supabase update error: {e}")

        else:
            job.update(status="failed", error=f"Could not find .glb paths in result: {result_str[:300]}")
            if supabase:
                supabase.table("creations").update({"status": "failed"}).eq("id", job_id).execute()

    except Exception as e:
        job.update(status="failed", step="Error", error=str(e))
        if supabase:
            try:
                supabase.table("creations").update({"status": "failed"}).eq("id", job_id).execute()
            except Exception:
                pass





# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.post("/api/generate-3d")
async def generate_3d(file: UploadFile = File(...), preprocess: bool = Form(False), user_id: str = Form(None)):
    """Accept an image upload, start the pipeline, return a job_id."""
    job_id = str(uuid.uuid4())

    os.makedirs("inputs", exist_ok=True)
    image_path = f"./inputs/{job_id}.jpg"
    with open(image_path, "wb") as f:
        f.write(await file.read())

    jobs[job_id] = {
        "status": "queued",
        "step": "Queued...",
        "progress": 0,
        "model_path": None,
        "raw_model_path": None,
        "raw_stats": None,
        "refined_stats": None,
        "input_type": None,
        "input_value": None,
        "error": None,
        "object_label": None,
    }

    if supabase:
        try:
            insert_data = {
                "id": job_id,
                "status": "queued"
            }
            if user_id:
                insert_data["user_id"] = user_id
                
            supabase.table("creations").insert(insert_data).execute()
        except Exception as e:
            print(f"Supabase insert error: {e}")

    thread = threading.Thread(target=run_pipeline, args=(job_id, image_path, preprocess), daemon=True)
    thread.start()

    return {"job_id": job_id}





@app.get("/api/inputs/{job_id}")
async def get_input_image(job_id: str):
    """Serve the original input image for a job."""
    image_path = f"./inputs/{job_id}.jpg"
    if not os.path.exists(image_path):
        # Check if it's in a subfolder (named folder system)
        # However, the original upload is always stored at ./inputs/{job_id}.jpg by /api/generate-3d
        raise HTTPException(status_code=404, detail="Input image not found")
    
    return FileResponse(image_path)


@app.get("/api/status/{job_id}")
async def get_status(job_id: str):
    """Poll the status of a running job, falling back to Supabase if not in-memory."""
    if job_id not in jobs:
        if supabase:
            try:
                res = supabase.table("creations").select("*").eq("id", job_id).execute()
                if res.data and len(res.data) > 0:
                    row = res.data[0]
                    jobs[job_id] = {
                        "status": row.get("status", "complete"),
                        "step": "Complete!" if row.get("status") == "complete" else "Failed",
                        "progress": 100 if row.get("status") == "complete" else 0,
                        "model_path": row.get("glb_model_url"),
                        "raw_model_path": row.get("raw_glb_url"),
                        "raw_stats": {
                            "faces": row.get("raw_faces") or 0,
                            "vertices": row.get("raw_vertices") or 0,
                        },
                        "refined_stats": {
                            "faces": row.get("refined_faces") or 0,
                            "vertices": row.get("refined_vertices") or 0,
                        },
                        "input_type": "image" if row.get("original_image_url") else None,
                        "input_value": row.get("original_image_url"),
                        "error": None,
                        "object_label": row.get("object_label"),
                    }
                else:
                    raise HTTPException(status_code=404, detail="Job not found")
            except Exception as e:
                print(f"Error loading job from Supabase: {e}")
                raise HTTPException(status_code=404, detail="Job not found")
        else:
            raise HTTPException(status_code=404, detail="Job not found")
    return jobs[job_id]


@app.get("/api/download/{job_id}")
async def download_model(job_id: str):
    """Stream the RANSAC-refined .glb file back to the browser."""
    if job_id not in jobs:
        if supabase:
            try:
                res = supabase.table("creations").select("*").eq("id", job_id).execute()
                if res.data and len(res.data) > 0:
                    row = res.data[0]
                    model_path = row.get("glb_model_url")
                    if model_path:
                        return RedirectResponse(url=model_path)
            except Exception:
                pass
        raise HTTPException(status_code=404, detail="Job not found")

    job = jobs[job_id]
    if job["status"] != "complete" or not job["model_path"]:
        raise HTTPException(status_code=400, detail="Model not ready yet")

    model_path = job["model_path"]
    if model_path.startswith("http://") or model_path.startswith("https://"):
        return RedirectResponse(url=model_path)

    if not os.path.exists(model_path):
        raise HTTPException(status_code=404, detail="Model file missing on disk")

    return FileResponse(
        model_path,
        media_type="model/gltf-binary",
        filename="model_refined.glb",
        headers={"Access-Control-Allow-Origin": "*"},
    )


@app.get("/api/download-raw/{job_id}")
async def download_raw_model(job_id: str):
    """Stream the original colored raw .glb file back to the browser."""
    if job_id not in jobs:
        if supabase:
            try:
                res = supabase.table("creations").select("*").eq("id", job_id).execute()
                if res.data and len(res.data) > 0:
                    row = res.data[0]
                    raw_path = row.get("raw_glb_url")
                    if raw_path:
                        return RedirectResponse(url=raw_path)
            except Exception:
                pass
        raise HTTPException(status_code=404, detail="Job not found")

    job = jobs[job_id]
    if job["status"] != "complete":
        raise HTTPException(status_code=400, detail="Model not ready yet")

    raw_path = job.get("raw_model_path")
    if not raw_path:
        raise HTTPException(status_code=404, detail="Raw model file not available")

    if raw_path.startswith("http://") or raw_path.startswith("https://"):
        return RedirectResponse(url=raw_path)

    if not os.path.exists(raw_path):
        raise HTTPException(status_code=404, detail="Raw model file not available")

    return FileResponse(
        raw_path,
        media_type="model/gltf-binary",
        filename="model_raw.glb",
        headers={"Access-Control-Allow-Origin": "*"},
    )


@app.post("/api/rename/{job_id}")
async def rename_job(job_id: str, payload: dict):
    """Rename the object label in-memory for a job."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    name = payload.get("name")
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    jobs[job_id]["object_label"] = name.strip()
    return {"status": "success"}


@app.get("/api/health")
async def health_check():
    """Health check endpoint to warm up the backend and monitor status."""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

