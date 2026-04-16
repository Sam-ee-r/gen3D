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
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col items-center justify-center px-6">
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

      <Card className="max-w-xl w-full p-0 overflow-hidden shadow-xl border-border/60">
        {/* Tabs */}
        <div className="flex border-b border-border">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "text-primary border-b-2 border-primary bg-primary/5"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.icon}
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
              className="border-2 border-dashed border-border rounded-xl p-10 text-center hover:border-primary/50 transition-colors cursor-pointer"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Preview"
                  className="mx-auto max-h-40 rounded-lg object-contain mb-3"
                />
              ) : (
                <Upload className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
              )}
              <p className="text-sm font-medium text-foreground">
                {selectedFile ? selectedFile.name : "Drop your image here or click to browse"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">PNG, JPG up to 10MB</p>
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
