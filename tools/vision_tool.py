import os
import base64
import json
import requests
import urllib3
from crewai.tools import tool
from dotenv import load_dotenv

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
load_dotenv()

@tool("analyze_image")
def analyze_image(image_path: str):
    """
    Analyzes an image using Groq's Llama 4 Scout vision model (multimodal).
    Use this tool to visually inspect any image and get a geometric description
    of the object it contains — including shape, surfaces, edges, and material.
    Input: local image file path (e.g., './input.jpg').
    Output: a detailed geometric and structural description of the object.
    """
    if not os.path.exists(image_path):
        return f"Error: Image not found at '{image_path}'"

    # Encode image to base64
    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("utf-8")

    # Detect mime type
    ext = os.path.splitext(image_path)[-1].lower()
    mime = {".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".png": "image/png", ".webp": "image/webp"}.get(ext, "image/jpeg")

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        return "Error: GROQ_API_KEY not found in environment."

    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": "meta-llama/llama-4-scout-17b-16e-instruct",
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime};base64,{b64}"}
                    },
                    {
                        "type": "text",
                        "text": (
                            "You are a 3D artist preparing a detailed brief to recreate this object in 3D. "
                            "Look very carefully at the image and describe ALL of the following:\n"
                            "1) WHAT the object is (be specific — e.g. 'star-shaped hair clip', not just 'hair clip').\n"
                            "2) EXACT SHAPE — describe its silhouette and form precisely (e.g. 'five-pointed star', 'cylindrical with tapered top', 'flat oval').\n"
                            "3) COLOR — state the exact colors visible (e.g. 'cyan blue', 'matte black with gold trim'). Do not skip this.\n"
                            "4) SIZE & PROPORTIONS — relative dimensions (e.g. 'wider than tall', 'thin and flat').\n"
                            "5) SURFACE & MATERIAL — smooth/rough, plastic/metal/fabric, shiny/matte, any texture or pattern.\n"
                            "6) DISTINCTIVE FEATURES — any cutouts, protrusions, hinges, decorations, or markings.\n"
                            "7) CAD TYPE — state whether 'Hard-Surface' or 'Organic' 3D modelling is most appropriate.\n"
                            "Be as specific and visual as possible. Avoid vague terms."
                        )
                    }
                ]
            }
        ],
        "max_tokens": 1024
    }

    try:
        response = requests.post(url, headers=headers, json=payload, verify=False)
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]
    except requests.exceptions.RequestException as e:
        return f"Groq vision API error: {str(e)}"
    except (KeyError, IndexError) as e:
        return f"Error parsing Groq response: {str(e)}"
