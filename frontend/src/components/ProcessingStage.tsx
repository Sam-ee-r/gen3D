import { useState, useEffect, useRef } from "react";
import { Progress } from "@/components/ui/progress";

const FALLBACK_STEPS = [
  "Vision Analysis...",
  "Generating Base Mesh...",
  "Applying RANSAC Snapping...",
  "Optimizing Topology...",
  "Finalizing Geometry...",
];

interface ProcessingStageProps {
  jobId: string;
  onComplete: () => void;
}

export function ProcessingStage({ jobId, onComplete }: ProcessingStageProps) {
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState(FALLBACK_STEPS[0]);
  const [logs, setLogs] = useState<string[]>([
    "[SYS] Initialization Sequence Started...",
    `> ${FALLBACK_STEPS[0]}`,
  ]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the terminal to the bottom
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Append new steps to the log
  useEffect(() => {
    if (!step.startsWith("Error:")) {
      setLogs((prev) => {
        const lastLog = prev[prev.length - 1];
        if (lastLog === `> ${step}`) return prev;
        return [...prev, `[${new Date().toISOString().substring(11, 19)}] Process active`, `> ${step}`];
      });
    } else {
      setLogs((prev) => [...prev, `[FAIL] ${step}`]);
    }
  }, [step]);

  useEffect(() => {
    // Slow-advancing fake progress that approaches 95% but never reaches it
    // until the backend confirms completion.
    const ticker = setInterval(() => {
      setProgress((p) => {
        if (p >= 95) return p;                    // hold at 95 until backend responds
        const rate = p < 50 ? 0.4 : 0.15;        // fast start, slow finish
        return Math.min(p + rate, 95);
      });
    }, 300);

    // Poll the real status every 4 seconds
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
          setProgress(100);
          setStep("Complete!");
          setTimeout(onComplete, 600);
        } else if (data.status === "failed") {
          clearInterval(ticker);
          clearInterval(poller);
          setStep(`Error: ${data.error ?? "Unknown failure"}`);
        }
      } catch {
        // network hiccup — keep polling
      }
    }, 4000);

    return () => {
      clearInterval(ticker);
      clearInterval(poller);
    };
  }, [jobId, onComplete]);

  return (
    <div className="min-h-[calc(100vh-3rem)] flex flex-col items-center justify-center px-6">
      {/* Wireframe cube */}
      <div className="relative mb-12">
        <div className="w-28 h-28 animate-glow-pulse rounded-2xl flex items-center justify-center">
          <div
            className="w-20 h-20 border-2 border-primary rounded-lg animate-spin-slow"
            style={{ transformStyle: "preserve-3d" }}
          />
        </div>
      </div>

      <div className="max-w-md w-full space-y-6">
        <Progress value={progress} className="h-2 bg-muted/50 [&>div]:bg-primary overflow-hidden shadow-[0_0_15px_rgba(var(--primary-rgb),0.3)]" />
        
        {/* Animated Terminal Log */}
        <div className="bg-tech-bg border border-tech-border rounded-xl p-4 h-36 overflow-y-auto font-mono text-xs text-tech-muted shadow-inner backdrop-blur-md">
          {logs.map((log, i) => (
            <div key={i} className={`mb-1.5 ${log.startsWith("[FAIL]") ? "text-red-400" : log.startsWith(">") ? "text-tech-fg" : ""}`}>
              {log}
            </div>
          ))}
          <div className="animate-pulse inline-block w-2 h-3.5 bg-primary ml-1 align-middle opacity-80" />
          <div ref={logsEndRef} />
        </div>

        <div className="text-center space-y-2">
          <p className="text-sm font-mono font-medium text-primary animate-pulse">{step}</p>
          <p className="text-xs text-muted-foreground">{Math.round(progress)}% complete</p>
        </div>
      </div>
    </div>
  );
}
