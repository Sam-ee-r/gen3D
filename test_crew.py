import os
from crewai import Agent, Task, Crew, LLM
from dotenv import load_dotenv

load_dotenv()
groq_llm = LLM(
    model="groq/meta-llama/llama-4-scout-17b-16e-instruct",
    api_key=os.getenv("GROQ_API_KEY")
)

agent = Agent(
    role='Test Agent',
    goal='Say hi',
    backstory='You say hi.',
    llm=groq_llm,
    verbose=True
)

task = Task(description="say hello", expected_output="hi", agent=agent)
crew = Crew(agents=[agent], tasks=[task], verbose=True)
res = crew.kickoff()
print("Result:", res)
