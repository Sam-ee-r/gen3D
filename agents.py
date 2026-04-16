import os
from dotenv import load_dotenv
from crewai import Agent, LLM
from tools.tripo_tool import generate_3d_model, generate_3d_from_text
from tools.vision_tool import analyze_image

load_dotenv()

# Groq Llama 4 Scout — multimodal, handles both vision tool and agent reasoning
groq_llm = LLM(
    model="groq/meta-llama/llama-4-scout-17b-16e-instruct",
    api_key=os.getenv("GROQ_API_KEY")
)

def create_agents():
    director = Agent(
        role='Design Critic',
        goal='Use the analyze_image tool to visually inspect the image and identify the object geometry for CAD refinement.',
        backstory='Expert in reverse engineering manufactured products. You MUST use the analyze_image tool to actually see the image before drawing any conclusions.',
        tools=[analyze_image],
        llm=groq_llm,
        verbose=True,
        allow_delegation=False,
        memory=False,
        cache=False
    )

    artist = Agent(
        role='Technical 3D Artist',
        goal='Generate a 3D model from the input image using generate_3d_model.',
        backstory='You are a specialist in 3D reconstruction. You MUST call generate_3d_model with the image path to produce the most accurate mesh possible.',
        tools=[generate_3d_model],
        llm=groq_llm,
        verbose=True,
        allow_delegation=False,
        memory=False,
        cache=False
    )

    return director, artist
