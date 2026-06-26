import { useState, useRef, useEffect } from "react";
import { Upload, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";

interface InputStageProps {
  onGenerate: (jobId: string) => void;
}

export function InputStage({ onGenerate }: InputStageProps) {
  const { user } = useAuth();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Warm up backend when this component mounts
  useEffect(() => {
    const apiBase = import.meta.env.VITE_API_URL || "";
    fetch(`${apiBase}/api/health`)
      .then((res) => {
        if (!res.ok) console.warn("Backend warmup ping failed");
        else console.log("Backend warmed up successfully");
      })
      .catch((err) => console.warn("Failed to warm up backend on load:", err));
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setError(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setError(null);
  };

  const handleGenerate = async () => {
    setError(null);

    if (!selectedFile) {
      setError("Please select an image first.");
      return;
    }
    setIsLoading(true);

    const sendRequest = async (retriesLeft: number): Promise<any> => {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("preprocess", "false");
      if (user) {
        formData.append("user_id", user.id);
      }
      const apiBase = import.meta.env.VITE_API_URL || "";
      const res = await fetch(`${apiBase}/api/generate-3d`, { method: "POST", body: formData });
      
      if (!res.ok) {
        // If it is a 502 Bad Gateway or 504 Gateway Timeout, retry after a short delay
        if ((res.status === 502 || res.status === 504) && retriesLeft > 0) {
          console.warn(`Gateway error ${res.status} encountered. Retrying in 2 seconds...`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
          return sendRequest(retriesLeft - 1);
        }
        throw new Error(`Server error: ${res.status}`);
      }
      return res.json();
    };

    try {
      const { job_id } = await sendRequest(2); // Retry up to 2 times
      onGenerate(job_id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to start generation.");
      setIsLoading(false);
    }
  };


  return (
    <div className="min-h-[calc(100vh-3rem)] flex flex-col items-center justify-center px-4 py-6 md:px-8 md:py-12">
      <div className="max-w-2xl w-full text-center mb-10">
        <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-foreground leading-tight font-mono">
          Turn any object image
          <br />
          into a <span className="text-primary">3D model.</span>
        </h1>
        <p className="mt-4 text-muted-foreground text-sm font-mono">
          Upload a picture of your chosen object, and we'll handle the rest!
        </p>
      </div>

      <Card className="max-w-xl w-full p-6 overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.5)] bg-card/60 backdrop-blur-xl border border-white/10 flex flex-col gap-5">
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          className="group relative border-2 border-dashed border-border rounded-xl p-10 text-center hover:border-primary transition-all duration-500 cursor-pointer overflow-hidden backdrop-blur-sm"
        >
          {/* Glowing hover background */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
          {previewUrl ? (
            <div className="relative z-10 animate-in fade-in zoom-in duration-300">
              <img
                src={previewUrl}
                alt="Preview"
                className="mx-auto max-h-48 rounded-lg object-contain mb-3 shadow-lg"
              />
              <div className="absolute inset-0 ring-1 ring-inset ring-black/10 rounded-lg"></div>
            </div>
          ) : (
            <div className="relative z-10 flex flex-col items-center">
              <div className="w-16 h-16 rounded-2xl bg-tech-bg border border-tech-border flex items-center justify-center mb-4 shadow-lg group-hover:shadow-[0_0_30px_rgba(var(--primary-rgb),0.2)] transition-shadow duration-500">
                <Upload className="w-8 h-8 text-primary group-hover:-translate-y-1 group-hover:scale-110 transition-transform duration-500" />
              </div>
            </div>
          )}
          <p className="relative z-10 text-sm font-semibold text-foreground group-hover:text-primary transition-colors duration-300">
            {selectedFile ? selectedFile.name : "Drop your structural image here"}
          </p>
          <p className="relative z-10 text-xs text-muted-foreground mt-1.5 font-mono">
            Supports PNG, JPG (Max 10MB)
          </p>
        </div>

        {/* Error */}
        {error && (
          <p className="text-xs text-red-500 font-mono">{error}</p>
        )}

        {/* Generate Button */}
        <Button
          onClick={handleGenerate}
          disabled={isLoading}
          className="w-full h-12 text-base font-semibold gap-2 bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-60 font-mono"
        >
          {isLoading ? "Uploading..." : "Generate Mesh"}
          <ArrowRight className="w-4 h-4" />
        </Button>
      </Card>
    </div>
  );
}
