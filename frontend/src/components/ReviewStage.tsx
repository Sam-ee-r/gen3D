import { useState, useEffect } from "react";
import { Download, Grid3X3, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import "../model-viewer.d.ts";

interface ModelViewerPanelProps {
  title: string;
  subtitle: string;
  src: string;
  filename: string;
  available: boolean;
  unavailableReason?: string;
  accentColor?: string;
  stats?: { faces: string; vertices: string; type: string };
}

function ModelViewerPanel({
  title,
  subtitle,
  src,
  filename,
  available,
  unavailableReason,
  accentColor = "oklch(0.7 0.2 200)",
  stats,
}: ModelViewerPanelProps) {
  const [wireframe, setWireframe] = useState(false);

  const handleDownload = async () => {
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Could not download this file.");
    }
  };

  return (
    <div className="flex-1 min-w-0 bg-tech-bg rounded-2xl border border-tech-border flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-tech-border shrink-0">
        <div className="flex flex-col">
          <span className="font-mono text-xs text-tech-fg font-semibold">{title}</span>
          <span className="font-mono text-[10px] text-tech-muted">{subtitle}</span>
        </div>
        <div className="flex items-center gap-2">
          {available && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setWireframe(!wireframe)}
              className={`gap-1.5 text-xs ${
                wireframe ? "text-primary" : "text-tech-muted hover:text-tech-fg"
              }`}
            >
              <Grid3X3 className="w-3.5 h-3.5" />
              Wireframe
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleDownload}
            disabled={!available}
            className="gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
            Download
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 relative min-h-0">
        {available ? (
          <>
            {/* Grid floor overlay */}
            <div className="absolute inset-0 opacity-10 pointer-events-none">
              <div
                className="w-full h-full"
                style={{
                  backgroundImage: `linear-gradient(${accentColor} 1px, transparent 1px), linear-gradient(90deg, ${accentColor} 1px, transparent 1px)`,
                  backgroundSize: "40px 40px",
                }}
              />
            </div>

            {/* Floating Metadata Badges */}
            {stats && (
              <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 pointer-events-none fade-in animate-in duration-500">
                <div className="bg-tech-bg/80 backdrop-blur-md border border-tech-border rounded-lg px-3 py-2 shadow-[0_8px_30px_rgb(0,0,0,0.12)] flex flex-col gap-1.5">
                  <span className="text-[10px] text-tech-muted uppercase font-semibold tracking-wider">Mesh Metrics</span>
                  <div className="flex items-center justify-between gap-6 text-xs font-mono">
                    <span className="text-tech-fg">Faces</span>
                    <span className="text-primary font-medium">{stats.faces}</span>
                  </div>
                  <div className="flex items-center justify-between gap-6 text-xs font-mono">
                    <span className="text-tech-fg">Vertices</span>
                    <span className="text-primary font-medium">{stats.vertices}</span>
                  </div>
                </div>
                <div className="bg-tech-bg/80 backdrop-blur-md border border-tech-border rounded-lg px-3 py-2 shadow-[0_8px_30px_rgb(0,0,0,0.12)]">
                  <span className="text-[10px] text-tech-muted uppercase font-semibold tracking-wider block mb-1">Geometry Trace</span>
                  <span className="text-xs font-mono text-primary font-medium">{stats.type}</span>
                </div>
              </div>
            )}

            {/* @ts-expect-error — model-viewer is a custom element registered by the CDN script */}
            <model-viewer
              src={src}
              alt={title}
              auto-rotate
              camera-controls
              shadow-intensity="1"
              exposure="1"
              style={{
                width: "100%",
                height: "100%",
                background: "transparent",
                "--mv-wireframe-color": wireframe ? accentColor : "transparent",
              }}
            />
          </>
        ) : (
          /* Not available placeholder */
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6"
            style={{
              backgroundImage: `linear-gradient(oklch(0.5 0.05 200 / 0.08) 1px, transparent 1px), linear-gradient(90deg, oklch(0.5 0.05 200 / 0.08) 1px, transparent 1px)`,
              backgroundSize: "40px 40px",
            }}
          >
            <AlertTriangle className="w-8 h-8 text-yellow-500/70" />
            <div>
              <p className="text-sm font-medium text-tech-fg">Not Available</p>
              <p className="text-xs text-tech-muted mt-1 max-w-xs">
                {unavailableReason ?? "This file was not generated during the pipeline run."}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface JobStatus {
  status: string;
  model_path: string | null;
  raw_model_path: string | null;
}

interface ReviewStageProps {
  jobId: string;
}

export function ReviewStage({ jobId }: ReviewStageProps) {
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);

  useEffect(() => {
    fetch(`/api/status/${jobId}`)
      .then((r) => r.json())
      .then((data) => setJobStatus(data))
      .catch(() => {});
  }, [jobId]);

  const hasRaw = Boolean(jobStatus?.raw_model_path);
  const hasRefined = Boolean(jobStatus?.model_path);

  return (
    <div className="min-h-[calc(100vh-3rem)] pt-14 pb-4 px-6">
      <div className="max-w-7xl mx-auto h-[calc(100vh-7.5rem)] flex flex-col gap-2">
        {/* Header */}
        <div className="flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Generation Complete</h2>
            <p className="text-xs text-muted-foreground">
              Two versions of your model — original colored mesh and RANSAC-refined geometry
            </p>
          </div>
        </div>

        {/* Dual viewer row */}
        <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
          <ModelViewerPanel
            title="Raw Colored Model"
            subtitle="model_raw.glb • Original Tripo AI output"
            src={`/api/download-raw/${jobId}`}
            filename="model_raw.glb"
            available={hasRaw}
            unavailableReason="The raw colored model wasn't saved during this run. Try generating again — the Tripo upload may have timed out."
            accentColor="oklch(0.65 0.18 30 / 0.8)"
            stats={{ faces: "24.5k", vertices: "12.2k", type: "Organic / Unoptimized" }}
          />
          <ModelViewerPanel
            title="Refined Geometry"
            subtitle="model_refined.glb • RANSAC + Taubin smoothed"
            src={`/api/download/${jobId}`}
            filename="model_refined.glb"
            available={hasRefined}
            unavailableReason="The refined model was not produced by this run."
            accentColor="oklch(0.70 0.20 200 / 0.8)"
            stats={{ faces: "8.2k", vertices: "4.1k", type: "Hard-Surface planar / Decimated" }}
          />
        </div>
      </div>
    </div>
  );
}
