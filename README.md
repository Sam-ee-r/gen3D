# 🧊 Photo-to-3D Pipeline

An AI-powered multi-agent pipeline that takes a photo of any object and generates a refined 3D mesh from it — automatically.

Built with **CrewAI**, **Groq (Llama 4 Scout)**, **Tripo3D**, and **Open3D**.

---

## 🚀 How It Works

```
inputs/input.jpg
      │
      ▼
┌─────────────────────────────────┐
│  Agent 1: Design Critic         │
│  • Calls analyze_image tool     │
│  • Uses Llama 4 Scout vision    │
│  • Returns geometric brief:     │
│    shape, color, material,      │
│    CAD type recommendation      │
└─────────────┬───────────────────┘
              │ context
              ▼
┌─────────────────────────────────┐
│  Agent 2: Technical 3D Artist   │
│  • Calls generate_3d_model      │
│  • Uploads image to Tripo AI    │
│  • Polls until mesh is ready    │
│  • Runs smart_refine_geometry   │
└─────────────┬───────────────────┘
              │
              ▼
outputs/<timestamp>_<object-name>/
├── raw.glb            ← original Tripo mesh
└── raw_refined.glb    ← RANSAC-refined mesh
```

---

## 📋 Requirements

- Python 3.10+
- A **Groq API key** (free) → [console.groq.com](https://console.groq.com)
- A **Tripo3D API key** (credits required) → [platform.tripo3d.ai](https://platform.tripo3d.ai)

---

## ⚙️ Setup

### 1. Install dependencies

```bash
pip install crewai open3d python-dotenv requests urllib3
```

### 2. Configure API keys

Create a `.env` file in the project root:

```env
GROQ_API_KEY=your_groq_key_here
TRIPO_API_KEY=your_tripo_key_here
```

### 3. Add your input image

Drop your image into the `inputs/` folder and name it `input.jpg`:

```bash
cp /path/to/your/photo.jpg inputs/input.jpg
```

### 4. Run the pipeline

```bash
python3 main.py
```

---

## 📁 Project Structure

```
.
├── inputs/                  ← Place your input images here
│   └── input.jpg
├── outputs/                 ← Generated 3D models (auto-created)
│   └── 2026-04-16_11-39_star-shaped-hair-clip/
│       ├── raw.glb
│       └── raw_refined.glb
├── tools/
│   ├── vision_tool.py       ← analyze_image (Groq Llama 4 Scout vision)
│   ├── tripo_tool.py        ← generate_3d_model + smart_refine_geometry
│   └── vector_tool.py       ← convert_to_vector (OpenCV edge tracing)
├── agents.py                ← Director & Artist agent definitions
├── main.py                  ← Entry point, task definitions, crew assembly
└── .env                     ← API keys (not committed)
```

---

## 🤖 Agents

### Design Critic (Director)
- **LLM:** Groq `llama-4-scout-17b-16e-instruct`
- **Tool:** `analyze_image` — sends the photo to Llama 4 Scout's vision API and returns a detailed description: object type, exact shape, color, material, proportions, distinctive features, and CAD type recommendation.

### Technical 3D Artist
- **LLM:** Groq `llama-4-scout-17b-16e-instruct`
- **Tool:** `generate_3d_model` — uploads the image to the Tripo3D API (`image_to_model`), polls until the mesh is complete, downloads it, then runs `smart_refine_geometry` to clean up AI mesh artifacts.

---

## 🔧 Smart Geometry Refinement

After downloading from Tripo, the mesh is automatically refined using Open3D:

1. **RANSAC Plane Detection** — finds flat surfaces (tops, rings, shelves) and snaps their vertices to a perfect mathematical plane, removing wobble.
2. **Taubin Smoothing** — removes high-frequency AI grain noise without shrinking the mesh.

Output is saved as `raw_refined.glb` alongside the original `raw.glb`.

---

## 💾 Output Naming

Each run creates its own timestamped folder so previous outputs are never overwritten:

```
outputs/2026-04-16_11-39_translucent-star-shaped-hair-clip/
```

The object name slug is auto-generated from the first sentence of the vision analysis.

---

## ⚠️ Notes

- **Tripo3D credits** are consumed per generation. Check your balance at [platform.tripo3d.ai](https://platform.tripo3d.ai).
- For best 3D results, use a **well-lit photo on a plain background** with the object centered and fully visible.
- The macOS SSL issue with `api.tripo3d.ai` is worked around using `curl` subprocesses internally.
