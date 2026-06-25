import { useState, useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { AppHeader } from "@/components/AppHeader";
import { InputStage } from "@/components/InputStage";
import { ProcessingStage } from "@/components/ProcessingStage";
import { ReviewStage } from "@/components/ReviewStage";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Polyfy — Convert Photos to 3D Models" },
      { name: "description", content: "Convert any 2D photo into a customizable textured 3D polygon model instantly using Polyfy's AI pipeline." },
      { property: "og:title", content: "Polyfy — Convert Photos to 3D Models" },
      { property: "og:description", content: "Convert any 2D photo into a customizable textured 3D polygon model instantly using Polyfy's AI pipeline." },
    ],
  }),
});

type AppStage = "input" | "processing" | "review";

function Index() {
  const { user } = useAuth();
  const [stage, setStage] = useState<AppStage>("input");
  const [jobId, setJobId] = useState<string | null>(null);

  const handleGenerate = useCallback((id: string) => {
    setJobId(id);
    setStage("processing");
  }, []);

  const handleProcessingComplete = useCallback(() => setStage("review"), []);

  const handleSelectCreation = useCallback((id: string) => {
    setJobId(id);
    setStage("review");
  }, []);

  const handleReset = useCallback(() => {
    setJobId(null);
    setStage("input");
  }, []);

  return (
    <div className="min-h-screen">
      <AppHeader
        onReset={handleReset}
        showReset={stage !== "input"}
        onSelectCreation={handleSelectCreation}
      />
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
