import os
from litellm import completion
from dotenv import load_dotenv

load_dotenv()
os.environ["GROQ_API_KEY"] = os.getenv("GROQ_API_KEY")

try:
    response = completion(
        model="groq/meta-llama/llama-4-scout-17b-16e-instruct",
        messages=[{"role": "user", "content": "hello"}],
    )
    print(response.choices[0].message.content)
except Exception as e:
    print(f"Error: {e}")
