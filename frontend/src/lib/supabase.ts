import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. " +
      "Create a frontend/.env file with these values."
  );
}

export const supabase = createClient(supabaseUrl ?? "", supabaseAnonKey ?? "");

// ── Typed helpers ─────────────────────────────────────────────────────────────

export interface Creation {
  id: string;
  user_id: string | null;
  original_image_url: string | null;
  glb_model_url: string | null;
  raw_glb_url: string | null;
  object_label: string | null;
  raw_faces: number | null;
  raw_vertices: number | null;
  refined_faces: number | null;
  refined_vertices: number | null;
  opt_in_for_display: boolean;
  is_approved: boolean;
  status: "queued" | "processing" | "complete" | "failed";
  created_at: string;
}

export interface Review {
  id: string;
  creation_id: string;
  rating: number;
  comment: string | null;
  reviewer_name: string | null;
  user_id: string | null;
  created_at: string;
}

export interface SystemStatus {
  id: number;
  api_token_exhausted: boolean;
}
