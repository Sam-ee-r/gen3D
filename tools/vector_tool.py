import cv2
import numpy as np
import os
from crewai.tools import tool

@tool("convert_to_vector")
def convert_to_vector(image_path: str):
    """
    Creates a 2D vector-style branding asset from an image.
    This provides a secondary 2D output alongside the 3D model.
    """
    if not os.path.exists(image_path):
        return f"Error: {image_path} not found."

    img = cv2.imread(image_path)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # Use adaptive thresholding for a 'sketch' or 'logo' look
    edges = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
                                  cv2.THRESH_BINARY, 11, 2)
    
    output_path = "./outputs/branding_vector.png"
    cv2.imwrite(output_path, edges)
    
    return f"2D Branding Asset generated at {output_path}. (Primary 3D models are also in /outputs)"