import { useState, useRef } from "react";
import { Upload, Camera, Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type InputTab = "upload" | "camera" | "text";

interface InputStageProps {
  onGenerate: (jobId: string) => void;
}

export function InputStage({ onGenerate }: InputStageProps) {
  const [activeTab, setActiveTab] = useState<InputTab>("upload");
  const [prompt, setPrompt] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tabs: { id: InputTab; label: string; icon: React.ReactNode }[] = [
    { id: "upload", label: "Upload Image", icon: <Upload className="w-4 h-4" /> },
    { id: "camera", label: "Use Camera", icon: <Camera className="w-4 h-4" /> },
    { id: "text", label: "Text to 3D", icon: <Sparkles className="w-4 h-4" /> },
  ];

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

    if (activeTab === "upload" || activeTab === "camera") {
      if (!selectedFile) {
        setError("Please select or capture an image first.");
        return;
      }
      setIsLoading(true);
      try {
        const formData = new FormData();
        formData.append("file", selectedFile);
        const res = await fetch("/api/generate-3d", { method: "POST", body: formData });
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        const { job_id } = await res.json();
        onGenerate(job_id);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to start generation.");
        setIsLoading(false);
      }
    } else {
      // text-to-3D: not yet wired to backend — placeholder
      alert("Text-to-3D coming soon! Use the Upload tab for now.");
    }
  };

  return (
    <div className="min-h-[calc(100vh-3rem)] flex flex-col items-center justify-center px-6">
      <div className="max-w-2xl w-full text-center mb-10">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground leading-tight">
          Generate Production-Ready
          <br />
          <span className="text-primary">3D Models.</span>
        </h1>
        <p className="mt-4 text-muted-foreground text-lg">
          Upload an image, capture from camera, or describe what you need.
        </p>
      </div>

      <Card className="max-w-xl w-full p-0 overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.5)] bg-card/60 backdrop-blur-xl border border-white/10">
        {/* Tabs */}
        <div className="flex border-b border-border/50">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-medium transition-all duration-300 ${
                activeTab === tab.id
                  ? "text-primary border-b-2 border-primary bg-primary/5 shadow-[inset_0_-2px_10px_rgba(96,23,180,0.03)]"
                  : "text-muted-foreground hover:text-foreground hover:bg-black/5"
              }`}
            >
              <div className={activeTab === tab.id ? "scale-110 transition-transform duration-300" : ""}>
                {tab.icon}
              </div>
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === "upload" && (
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
          )}

          {activeTab === "camera" && (
            <div className="border-2 border-dashed border-border rounded-xl p-12 text-center">
              <Camera className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                id="camera-input"
                onChange={handleFileChange}
              />
              <Button variant="outline" className="mt-2" onClick={() => document.getElementById("camera-input")?.click()}>
                {selectedFile ? `✓ ${selectedFile.name}` : "Open Camera"}
              </Button>
              <p className="text-xs text-muted-foreground mt-3">
                Capture a reference photo for mesh generation
              </p>
            </div>
          )}

          {activeTab === "text" && (
            <div className="space-y-4">
              <Input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder='Describe your 3D model (e.g., "A geometric coffee mug with a hexagonal handle")'
                className="h-12 text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Be specific about geometry, proportions, and surface details for best results.
              </p>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <p className="px-6 pb-2 text-xs text-red-500">{error}</p>
        )}

        {/* Generate Button */}
        <div className="px-6 pb-6">
          <Button
            onClick={handleGenerate}
            disabled={isLoading}
            className="w-full h-12 text-base font-semibold gap-2 bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-60"
          >
            {isLoading ? "Uploading..." : "Generate Mesh"}
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </Card>
    </div>
  );
}
