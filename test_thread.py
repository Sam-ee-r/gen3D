import threading
from crewai import Agent, Task, Crew, LLM
import os
from dotenv import load_dotenv

load_dotenv()
def run():
    groq_llm = LLM(
        model="groq/meta-llama/llama-4-scout-17b-16e-instruct",
        api_key=os.getenv("GROQ_API_KEY")
    )

    agent = Agent(
        role='Test Agent',
        goal='Say hello',
        backstory='You say hi.',
        llm=groq_llm,
        verbose=True
    )

    task = Task(description="use basic observation to say hello", expected_output="hi", agent=agent)
    crew = Crew(agents=[agent], tasks=[task], verbose=True)
    try:
        res = crew.kickoff()
        print("Result:", res)
    except Exception as e:
        import traceback
        traceback.print_exc()

t = threading.Thread(target=run)
t.start()
t.join()
