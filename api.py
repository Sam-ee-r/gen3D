import os
import ssl
import uuid
import threading
import re
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# SSL fix for macOS
try:
    _create_unverified_https_context = ssl._create_unverified_context
except AttributeError:
    pass
else:
    ssl._create_default_https_context = _create_unverified_https_context

load_dotenv()

app = FastAPI(title="Photo-to-3D API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# In-memory job store  {job_id: {status, step, progress, model_path, error}}
# ---------------------------------------------------------------------------
jobs: dict[str, dict] = {}


def run_pipeline(job_id: str, image_path: str):
    """Run the full CrewAI pipeline in a background thread."""
    from crewai import Crew, Task, Process
    from agents import create_agents

    job = jobs[job_id]
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
                f"You have been provided multiple angles of the object: {image_paths}. "
                f"CRITICAL: You must pass this EXACT python list of strings {image_paths} "
                f"as the 'image_paths' parameter to the tool. "
                f"CRITICAL: From the Director's brief, extract the short 1-2 word object label "
                f"(e.g. 'orange powerbank') and pass it as the 'object_label' parameter to the tool. "
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
        # Find any .glb path ending in _refined.glb from the result.
        refined_match = re.search(r"(\./outputs/[^\s'\"|\]]+_refined\.glb)", result_str)
        refined_path = refined_match.group(1).strip().rstrip(".,)") if refined_match else None

        # Fallback: grab any .glb path if refined pattern not found
        if not refined_path:
            any_match = re.search(r"(\./outputs/[^\s'\"|\]]+\.glb)", result_str)
            if any_match:
                refined_path = any_match.group(1).strip().rstrip(".,)")

        if refined_path and os.path.exists(refined_path):
            # Derive the raw path from the same folder (raw.glb is always downloaded first)
            raw_path = os.path.join(os.path.dirname(refined_path), "raw.glb")
            if not os.path.exists(raw_path):
                # Try .glb variant from Tripo (e.g. raw.glb may have a different ext)
                folder = os.path.dirname(refined_path)
                candidates = [f for f in os.listdir(folder) if f.startswith("raw") and not f.endswith("_refined.glb")]
                raw_path = os.path.join(folder, candidates[0]) if candidates else None

            job.update(
                status="complete",
                step="Complete!",
                progress=100,
                model_path=refined_path,
                raw_model_path=raw_path if raw_path and os.path.exists(raw_path) else None,
            )
        else:
            job.update(status="failed", error=f"Could not find .glb paths in result: {result_str[:300]}")

    except Exception as e:
        job.update(status="failed", step="Error", error=str(e))


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.post("/api/generate-3d")
async def generate_3d(file: UploadFile = File(...)):
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
        "error": None,
    }

    thread = threading.Thread(target=run_pipeline, args=(job_id, image_path), daemon=True)
    thread.start()

    return {"job_id": job_id}


@app.get("/api/status/{job_id}")
async def get_status(job_id: str):
    """Poll the status of a running job."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return jobs[job_id]


@app.get("/api/download/{job_id}")
async def download_model(job_id: str):
    """Stream the RANSAC-refined .glb file back to the browser."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    job = jobs[job_id]
    if job["status"] != "complete" or not job["model_path"]:
        raise HTTPException(status_code=400, detail="Model not ready yet")

    model_path = job["model_path"]
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
        raise HTTPException(status_code=404, detail="Job not found")

    job = jobs[job_id]
    if job["status"] != "complete":
        raise HTTPException(status_code=400, detail="Model not ready yet")

    raw_path = job.get("raw_model_path")
    if not raw_path or not os.path.exists(raw_path):
        raise HTTPException(status_code=404, detail="Raw model file not available")

    return FileResponse(
        raw_path,
        media_type="model/gltf-binary",
        filename="model_raw.glb",
        headers={"Access-Control-Allow-Origin": "*"},
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
