
import os
import sys

# Mocking the environment
os.environ["TRIPO_API_KEY"] = "mock_key"

# Add the tools directory to the path so we can import tripo_tool
sys.path.append(os.path.join(os.getcwd(), "tools"))

from tripo_tool import generate_3d_model

def test_logic():
    print("--- Testing Design Object Logic ---")
    # This description contains keywords for the 'Design' mode
    design_brief = "The object is a high-end AirPods Pro case with smooth ergonomic curves and glossy white plastic."
    # We don't actually want to call the API, so we just want to see the print output
    # before the API call fails or we can mock _curl.
    # For a quick check, I'll just check the print statements in the console output.
    try:
        generate_3d_model("./inputs/input.jpg", description=design_brief)
    except Exception as e:
        # Expected to fail on real API call, but we want to see the 'Tuning' log
        pass

if __name__ == "__main__":
    test_logic()
