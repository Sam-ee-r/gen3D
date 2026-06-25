from tools.tripo_tool import generate_3d_model
print("Testing Direct API Call...")
result = generate_3d_model.func(["./inputs/0e705eec-be4b-4ec0-924c-fcb57481e574.jpg"], "airpods_case")
print("RESULT OF FUNCTION:", result)
