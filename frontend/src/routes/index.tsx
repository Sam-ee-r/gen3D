import { useState, useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { AppHeader } from "@/components/AppHeader";
import { InputStage } from "@/components/InputStage";
import { ProcessingStage } from "@/components/ProcessingStage";
import { ReviewStage } from "@/components/ReviewStage";

export const Route = createFileRoute("/")(({
  component: Index,
  head: () => ({
    meta: [
      { title: "MeshRefine AI — Generate Production-Ready 3D Models" },
      { name: "description", content: "AI-powered 3D model generation and refinement workflow. Upload, generate, and refine meshes interactively." },
      { property: "og:title", content: "MeshRefine AI — Generate Production-Ready 3D Models" },
      { property: "og:description", content: "AI-powered 3D model generation and refinement workflow." },
    ],
  }),
}));

type AppStage = "input" | "processing" | "review";

function Index() {
  const [stage, setStage] = useState<AppStage>("input");
  const [jobId, setJobId] = useState<string | null>(null);

  const handleGenerate = useCallback((id: string) => {
    setJobId(id);
    setStage("processing");
  }, []);

  const handleProcessingComplete = useCallback(() => setStage("review"), []);

  const handleReset = useCallback(() => {
    setJobId(null);
    setStage("input");
  }, []);

  return (
    <div className="min-h-screen">
      <AppHeader onReset={handleReset} showReset={stage !== "input"} />
      <main className="pt-12">
        <AnimatePresence mode="wait">
          {stage === "input" && (
            <motion.div
              key="input"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
            >
              <InputStage onGenerate={handleGenerate} />
            </motion.div>
          )}
          {stage === "processing" && jobId && (
            <motion.div
              key="processing"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.02 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
            >
              <ProcessingStage jobId={jobId} onComplete={handleProcessingComplete} />
            </motion.div>
          )}
          {stage === "review" && jobId && (
            <motion.div
              key="review"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            >
              <ReviewStage jobId={jobId} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
