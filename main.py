import os
import ssl
from dotenv import load_dotenv
from crewai import Crew, Task, Process
from agents import create_agents
import base64

# 1. SSL Fix for macOS
try:
    _create_unverified_https_context = ssl._create_unverified_context
except AttributeError:
    pass
else:
    ssl._create_default_https_context = _create_unverified_https_context

load_dotenv()

# 2. Initialize the Team
director, artist = create_agents()

# 3. Define the Sequential Tasks
analyze_task = Task(
    description=(
        "Use the 'analyze_image' tool on './inputs/input.jpg' to visually inspect the object. "
        "Based on what the tool returns, identify the object's primary geometry — "
        "its shape, surfaces, and edges. Then determine if 'Hard-Surface' or 'Organic' "
        "CAD refinement is most appropriate."
    ),
    expected_output="A technical brief identifying the object and specifying if 'Hard-Surface' or 'Organic' refinement is needed, based on actual visual analysis.",
    agent=director
)

reconstruct_task = Task(
    description=(
        "The Director has analyzed the object. Now use 'generate_3d_model' with "
        "the image path './inputs/input.jpg' to generate the most accurate 3D reconstruction "
        "directly from the photo. Return the file path of the resulting refined 3D mesh."
    ),
    expected_output="The string path to the generated 3D file (e.g., './outputs/.../raw_refined.glb').",
    agent=artist,
    context=[analyze_task]
)



# 4. Assemble the Crew
design_crew = Crew(
    agents=[director, artist],
    tasks=[analyze_task, reconstruct_task],
    process=Process.sequential,
    verbose=True
)

if __name__ == "__main__":
    if not os.path.exists("./inputs/input.jpg"):
        print("❌ Error: './inputs/input.jpg' not found. Please place your input image in the inputs/ folder.")
        exit(1)

    if not os.path.exists("./outputs"):
        os.makedirs("./outputs")

    print("🚀 Starting the Full 3D Pipeline...")
    result = design_crew.kickoff(inputs={'file_path': './input.jpg'})
    print("\n✅ PROJECT COMPLETE")
    print(result)