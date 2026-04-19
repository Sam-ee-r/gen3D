"""
geometry_engine.py
==================
Standalone geometric refinement pipeline for raw AI-generated meshes.

Pipeline Summary:
  1. Load the raw .glb mesh using trimesh (handles the GLTF/GLB format
     correctly, preserving scene graphs and multiple sub-meshes).
  2. Convert the combined mesh into an Open3D TriangleMesh for processing.
  3. Apply Taubin Smoothing to remove high-frequency "lumpy" noise while
     preserving the overall volume (unlike Laplacian smoothing which shrinks).
  4. Sample a dense Point Cloud from the smoothed mesh, then use RANSAC
     Plane Segmentation to detect the largest dominant flat face.
  5. Snap the vertices nearest to that mathematical plane exactly onto it,
     producing a perfectly flat, CAD-like surface.
  6. Export the refined, clean mesh as a .glb file.
"""

import os
import sys
import numpy as np
import open3d as o3d
import trimesh


# ---------------------------------------------------------------------------
# Core Refinement Function
# ---------------------------------------------------------------------------

def refine_mesh(input_path: str, output_path: str) -> str:
    """
    Loads a raw AI-generated .glb mesh, applies geometric refinement
    (Taubin smoothing + RANSAC plane snapping), and saves the result.

    Parameters
    ----------
    input_path  : str — Path to the raw input .glb file.
    output_path : str — Path to save the refined .glb file.

    Returns
    -------
    str — The output_path on success, or an error string on failure.
    """

    # -----------------------------------------------------------------------
    # STEP 1: LOAD WITH TRIMESH
    # -----------------------------------------------------------------------
    # We use trimesh to load the .glb file because it understands the GLTF
    # scene graph format (a .glb can contain multiple meshes, materials, and
    # textures stored as a binary bundle). trimesh.load() reassembles them
    # into a single coherent geometry via scene.dump(concatenate=True).
    # -----------------------------------------------------------------------
    print(f"\n📂 Loading mesh from: {input_path}")
    if not os.path.exists(input_path):
        return f"Error: Input file not found at '{input_path}'"

    scene = trimesh.load(input_path, force="scene")

    # Flatten all sub-meshes in the scene into a single unified mesh.
    # This is necessary because AI generators often output objects as
    # multiple separate geometry nodes inside one GLTF file.
    if isinstance(scene, trimesh.Scene):
        # to_geometry() replaces the deprecated dump(concatenate=True)
        # It merges all sub-meshes in the GLTF scene graph into a single mesh.
        combined = scene.to_geometry()
    else:
        combined = scene  # Already a single mesh

    print(f"   ✅ Loaded: {len(combined.vertices)} vertices, {len(combined.faces)} faces")

    # -----------------------------------------------------------------------
    # STEP 2: CONVERT TO OPEN3D
    # -----------------------------------------------------------------------
    # Open3D has superior geometry processing algorithms (RANSAC, Taubin,
    # point cloud sampling) compared to trimesh. We transfer the vertex and
    # face data directly via numpy arrays.
    # -----------------------------------------------------------------------
    print("🔄 Converting to Open3D TriangleMesh...")
    o3d_mesh = o3d.geometry.TriangleMesh()
    o3d_mesh.vertices = o3d.utility.Vector3dVector(np.array(combined.vertices, dtype=np.float64))
    o3d_mesh.triangles = o3d.utility.Vector3iVector(np.array(combined.faces, dtype=np.int32))
    o3d_mesh.compute_vertex_normals()

    # -----------------------------------------------------------------------
    # STEP 3: TAUBIN SMOOTHING
    # -----------------------------------------------------------------------
    # WHY TAUBIN AND NOT LAPLACIAN?
    # Standard Laplacian smoothing works by moving each vertex toward the
    # average position of its neighbours. The problem is that this process
    # is not volume-conservative: it causes the mesh to "shrink" over time,
    # pulling corners inward and losing the object's true shape.
    #
    # Taubin Smoothing (Gabriel Taubin, 1995) alternates between two passes
    # per iteration with carefully chosen λ (positive, "shrink") and μ
    # (negative, "inflate") parameters such that |μ| > |λ|. The "inflate"
    # pass exactly counteracts the shrinkage of the "shrink" pass, so the
    # mesh volume and overall shape are preserved while high-frequency noise
    # (the "lumpiness") is attenuated — acting like a low-pass frequency
    # filter on the geometry.
    #
    # MATHEMATICAL INTUITION:
    # Think of the mesh like a bumpy audio signal. Taubin smoothing is the
    # geometric equivalent of a low-pass filter: it lets the broad, low-
    # frequency "shape" pass through unchanged while suppressing the tiny,
    # high-frequency "lumps" added by the AI generation process.
    # -----------------------------------------------------------------------
    TAUBIN_ITERATIONS = 25
    print(f"🌊 Applying Taubin Smoothing ({TAUBIN_ITERATIONS} iterations)...")
    print("   λ/μ filter: removes high-frequency noise while preserving mesh volume.")

    smoothed_mesh = o3d_mesh.filter_smooth_taubin(number_of_iterations=TAUBIN_ITERATIONS)
    smoothed_mesh.compute_vertex_normals()
    print("   ✅ Taubin smoothing complete.")

    # -----------------------------------------------------------------------
    # STEP 4: RANSAC DOMINANT PLANE DETECTION
    # -----------------------------------------------------------------------
    # WHY DO WE NEED RANSAC?
    # After smoothing, the large flat faces of a hard-surface object (e.g.,
    # the front and back panels of a power bank) are much flatter, but they
    # are still not mathematically perfect planes — they have very small
    # residual deviations from planarity.
    #
    # For a CAD-quality result, we want these faces to be PERFECTLY flat:
    # every vertex on the front face should lie on the exact same plane.
    #
    # HOW RANSAC FINDS THE PLANE:
    # RANSAC (Random Sample Consensus) is a robust statistical algorithm that
    # finds the best-fitting mathematical model even when the data has noise
    # and "outliers" (points that don't belong to the model).
    #
    # For our mesh:
    #   1. Randomly pick 3 vertices from the point cloud (3 points uniquely
    #      define a plane in 3D space: ax + by + cz + d = 0).
    #   2. Count how many OTHER vertices are within `distance_threshold` of
    #      this candidate plane — these are the "inliers".
    #   3. Repeat this thousands of times (num_iterations).
    #   4. The plane with the MOST inliers wins — that is the dominant plane.
    #
    # This is robust because even if most of the point cloud is curved
    # (the sides and edges), the largest flat face (the power bank's front
    # panel) will dominate and be reliably detected.
    #
    # STEP 4a: Sample a dense Point Cloud from the mesh surface.
    # We need a point cloud (not vertices alone) because AI meshes can have
    # very uneven vertex density — some areas are triangle-dense and some are
    # sparse. Sampling uniformly from the surface area removes this bias.
    # -----------------------------------------------------------------------
    POINT_CLOUD_SAMPLES = 50_000
    RANSAC_N = 3                 # Minimum points to define a plane
    RANSAC_ITERATIONS = 2000     # Higher = more likely to find the true plane
    DISTANCE_THRESHOLD = 0.005   # Max distance (in mesh units) to count as "inlier"
    SNAP_THRESHOLD = 0.008       # Max distance for a mesh vertex to be snapped

    print(f"\n🔍 Sampling {POINT_CLOUD_SAMPLES:,} points for RANSAC plane detection...")
    pcd = smoothed_mesh.sample_points_uniformly(number_of_points=POINT_CLOUD_SAMPLES)

    print(f"   Running RANSAC ({RANSAC_ITERATIONS} iterations, threshold={DISTANCE_THRESHOLD})...")
    plane_model, inliers = pcd.segment_plane(
        distance_threshold=DISTANCE_THRESHOLD,
        ransac_n=RANSAC_N,
        num_iterations=RANSAC_ITERATIONS
    )

    # plane_model = [a, b, c, d] where the plane equation is: ax + by + cz + d = 0
    # The normal vector of the plane is (a, b, c) — it points perpendicular to the surface.
    a, b, c, d = plane_model
    plane_normal = np.array([a, b, c])
    print(f"   ✅ Dominant plane found: {len(inliers):,} inlier points")
    print(f"   Plane equation: {a:.4f}x + {b:.4f}y + {c:.4f}z + {d:.4f} = 0")

    # -----------------------------------------------------------------------
    # STEP 5: PROJECT NEAR-PLANE VERTICES ONTO THE PERFECT PLANE
    # -----------------------------------------------------------------------
    # Now we snap the wobbly mesh vertices that are close to this plane onto
    # it exactly, using vector projection mathematics.
    #
    # MATHEMATICAL REASONING (Orthogonal Projection):
    # Given a point P (a vertex) and a plane defined by normal N and scalar d,
    # the SIGNED distance from P to the plane is:
    #
    #   dist = dot(N, P) + d
    #
    # The point P' lying exactly on the plane (the "projection" of P) is:
    #
    #   P' = P - dist * N
    #
    # This moves P along the direction perpendicular to the plane by exactly
    # the distance needed to land ON the plane. If |dist| < SNAP_THRESHOLD,
    # we classify this vertex as "wobbly but supposed to be flat" and snap it.
    # -----------------------------------------------------------------------
    print(f"\n📐 Snapping near-plane vertices onto the mathematical plane (threshold={SNAP_THRESHOLD})...")

    vertices = np.asarray(smoothed_mesh.vertices)
    snapped_count = 0

    for i, vertex in enumerate(vertices):
        # Compute signed distance from this vertex to the detected plane
        # Formula: dist = a*x + b*y + c*z + d  (the plane equation evaluated at this point)
        signed_distance = np.dot(plane_normal, vertex) + d

        # If the vertex is close enough to the plane, project it exactly onto it
        if abs(signed_distance) < SNAP_THRESHOLD:
            # Move the vertex along the plane's normal by the signed distance
            # This places it exactly on the plane surface (dist becomes 0)
            vertices[i] = vertex - signed_distance * plane_normal
            snapped_count += 1

    # Write the modified vertex positions back into the Open3D mesh
    smoothed_mesh.vertices = o3d.utility.Vector3dVector(vertices)
    smoothed_mesh.compute_vertex_normals()
    print(f"   ✅ Snapped {snapped_count:,} vertices onto the dominant plane.")

    # -----------------------------------------------------------------------
    # STEP 6: EXPORT THE REFINED MESH
    # -----------------------------------------------------------------------
    # We use Open3D's built-in writer. Open3D can write .glb directly.
    # The output directory is created if it doesn't already exist.
    # -----------------------------------------------------------------------
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    print(f"\n💾 Saving refined mesh to: {output_path}")
    success = o3d.io.write_triangle_mesh(output_path, smoothed_mesh)

    if success:
        size_kb = os.path.getsize(output_path) / 1024
        print(f"   ✅ Saved successfully ({size_kb:.1f} KB)")
        print(f"\n🎉 Refinement complete!")
        print(f"   Input : {input_path}")
        print(f"   Output: {output_path}")
        print(f"   Vertices: {len(vertices):,}  |  Faces: {len(np.asarray(smoothed_mesh.triangles)):,}")
        return output_path
    else:
        return f"Error: Open3D failed to write mesh to '{output_path}'"


# ---------------------------------------------------------------------------
# Standalone Test Entry Point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # Allow optional command-line arguments:
    #   python geometry_engine.py [input.glb] [output.glb]
    # Defaults to the raw model and a standard output path.

    if len(sys.argv) == 3:
        _input  = sys.argv[1]
        _output = sys.argv[2]
    elif len(sys.argv) == 2:
        _input  = sys.argv[1]
        _output = "./outputs/refined_model.glb"
    else:
        # Default: look for the latest raw.glb in outputs/
        _input  = "./outputs/model-1ce75449-5d50-422f-af96-3c215cdfbc63/raw.glb"
        _output = "./outputs/refined_model.glb"

    result = refine_mesh(_input, _output)
    if result.startswith("Error"):
        print(f"\n❌ {result}")
        sys.exit(1)
