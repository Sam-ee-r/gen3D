-- 1. Create Tables
CREATE TABLE IF NOT EXISTS creations (
    id UUID PRIMARY KEY,
    user_id UUID,
    original_image_url TEXT,
    glb_model_url TEXT,
    raw_glb_url TEXT,
    object_label TEXT,
    raw_faces INT,
    raw_vertices INT,
    refined_faces INT,
    refined_vertices INT,
    opt_in_for_display BOOLEAN DEFAULT false,
    is_approved BOOLEAN DEFAULT false,
    status TEXT DEFAULT 'queued',
    display_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creation_id UUID REFERENCES creations(id) ON DELETE CASCADE,
    rating INT CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    reviewer_name TEXT,
    user_id UUID,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS system_status (
    id INT PRIMARY KEY DEFAULT 1,
    api_token_exhausted BOOLEAN DEFAULT false,
    CONSTRAINT single_row CHECK (id = 1)
);

INSERT INTO system_status (id) VALUES (1) ON CONFLICT DO NOTHING;

-- 2. Create Storage Buckets
INSERT INTO storage.buckets (id, name, public) VALUES ('inputs', 'inputs', true) ON CONFLICT DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('models', 'models', true) ON CONFLICT DO NOTHING;

-- 3. Configure RLS (Row Level Security)
-- Enable RLS and add explicit permissive policies to ensure the anon client can read/write
ALTER TABLE creations ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_status ENABLE ROW LEVEL SECURITY;

-- Creations policies
DROP POLICY IF EXISTS "Allow public read" ON creations;
DROP POLICY IF EXISTS "Allow public insert" ON creations;
DROP POLICY IF EXISTS "Allow public update" ON creations;
CREATE POLICY "Allow public read" ON creations FOR SELECT USING (true);
CREATE POLICY "Allow public insert" ON creations FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update" ON creations FOR UPDATE USING (true);

-- Reviews policies
DROP POLICY IF EXISTS "Allow public read" ON reviews;
DROP POLICY IF EXISTS "Allow public insert" ON reviews;
DROP POLICY IF EXISTS "Allow public update" ON reviews;
CREATE POLICY "Allow public read" ON reviews FOR SELECT USING (true);
CREATE POLICY "Allow public insert" ON reviews FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update" ON reviews FOR UPDATE USING (true);

-- System status policies
DROP POLICY IF EXISTS "Allow public read" ON system_status;
DROP POLICY IF EXISTS "Allow public write" ON system_status;
CREATE POLICY "Allow public read" ON system_status FOR SELECT USING (true);
CREATE POLICY "Allow public write" ON system_status FOR ALL USING (true);

-- Storage RLS: Allow public access to read and write (since we are using the anon key in the backend)
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
CREATE POLICY "Public Access" ON storage.objects FOR ALL USING ( bucket_id IN ('inputs', 'models') );

