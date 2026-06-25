import { useState, useEffect, useRef } from "react";
import { Progress } from "@/components/ui/progress";
import { WaitStateGallery } from "@/components/WaitStateGallery";

// Rotating fake log messages for ambiance
const FAKE_LOGS = [
  "[SYS] Initialization sequence started...",
  "[GPU] Allocating vertex buffer memory...",
  "[AI] Running CLIP feature extraction on input...",
  "[AI] Vision analysis complete — object identified",
  "[MESH] Generating point cloud from depth estimation...",
  "[MESH] Triangulating surface mesh...",
  "[AI] Requesting base model from generation API...",
  "[MESH] Applying Poisson surface reconstruction...",
  "[RANSAC] Running iterative closest point alignment...",
  "[RANSAC] Snapping geometry to canonical form...",
  "[REFINE] Smoothing sharp edges...",
  "[REFINE] Optimizing UV unwrap...",
  "[REFINE] Applying metallic/roughness pass...",
  "[GPU] Baking ambient occlusion...",
  "[MESH] Reducing polygon count for LOD...",
  "[SYS] Packaging GLB container...",
  "[SYS] Running integrity check on output mesh...",
];

interface ProcessingStageProps {
  jobId: string;
  onComplete: () => void;
}

export function ProcessingStage({ jobId, onComplete }: ProcessingStageProps) {
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState("Initializing...");
  const [logs, setLogs] = useState<string[]>([FAKE_LOGS[0]]);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const logIndexRef = useRef(1);

  // Auto-scroll logs locally inside the box without scrolling the browser page
  useEffect(() => {
    const container = logsContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    // Slow-advancing fake progress
    const ticker = setInterval(() => {
      setProgress((p) => {
        if (p >= 95) return p;
        const rate = p < 50 ? 0.4 : 0.15;
        return Math.min(p + rate, 95);
      });
    }, 300);

    // Append a new fake log line every ~4 seconds
    const logTimer = setInterval(() => {
      const idx = logIndexRef.current % FAKE_LOGS.length;
      const timestamp = new Date().toISOString().substring(11, 19);
      setLogs((prev) => [...prev.slice(-12), `[${timestamp}] ${FAKE_LOGS[idx]}`]);
      logIndexRef.current += 1;
    }, 3800);

    // Poll real status
    const poller = setInterval(async () => {
      try {
        const res = await fetch(`/api/status/${jobId}`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.step) setStep(data.step);
        if (data.progress) setProgress((p) => Math.max(p, data.progress));

        if (data.status === "complete") {
          clearInterval(ticker);
          clearInterval(poller);
          clearInterval(logTimer);
          setProgress(100);
          setStep("Complete!");
          setLogs((prev) => [...prev, `[SYS] Generation complete — loading editor...`]);
          setTimeout(onComplete, 800);
        } else if (data.status === "failed") {
          clearInterval(ticker);
          clearInterval(poller);
          clearInterval(logTimer);
          setStep(`Error: ${data.error ?? "Unknown failure"}`);
          setLogs((prev) => [...prev, `[FAIL] ${data.error ?? "Pipeline failed"}`]);
        }
      } catch {
        // network hiccup — keep polling
      }
    }, 4000);

    return () => {
      clearInterval(ticker);
      clearInterval(poller);
      clearInterval(logTimer);
    };
  }, [jobId, onComplete]);

  return (
    <div className="min-h-[calc(100vh-3rem)] flex flex-col items-center px-4 py-6 md:px-8 md:py-10 gap-8">
      {/* Progress bar at top */}
      <div className="w-full max-w-4xl space-y-2">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs font-mono font-medium text-primary animate-pulse">{step}</p>
          <p className="text-xs text-muted-foreground font-mono">{Math.round(progress)}%</p>
        </div>
        <Progress
          value={progress}
          className="h-1.5 bg-muted/50 [&>div]:bg-primary overflow-hidden shadow-[0_0_12px_rgba(var(--primary-rgb),0.3)]"
        />
      </div>

      {/* Terminal log */}
      <div
        ref={logsContainerRef}
        className="w-full max-w-4xl bg-tech-bg border border-tech-border rounded-xl p-4 h-32 overflow-y-auto font-mono text-xs text-tech-muted shadow-inner backdrop-blur-md shrink-0"
      >
        {logs.map((log, i) => (
          <div
            key={i}
            className={`mb-1 ${
              log.includes("[FAIL]")
                ? "text-red-400"
                : log.includes("[SYS]")
                ? "text-primary/80"
                : log.includes("complete") || log.includes("Complete")
                ? "text-green-400"
                : ""
            }`}
          >
            {log}
          </div>
        ))}
        <div className="animate-pulse inline-block w-2 h-3 bg-primary ml-1 align-middle opacity-70" />
      </div>

      {/* Waiting note */}
      <div className="w-full max-w-4xl text-center -mb-2">
        <span className="text-xs font-mono text-white font-bold block mb-1">
          While you wait...
        </span>
        <span className="text-[10px] font-mono text-tech-muted block max-w-xl mx-auto leading-relaxed">
          Check out these community creations while we compile your 3D model. Generation typically takes 2-3 minutes, so please be patient!
        </span>
      </div>

      {/* Gallery centerpiece */}
      <div className="w-full max-w-4xl">
        <WaitStateGallery />
      </div>
    </div>
  );
}
