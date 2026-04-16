import { useState, useRef, useEffect } from "react";
import { Send } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface LogEntry {
  type: "system" | "user" | "ai";
  text: string;
}

const INITIAL_LOGS: LogEntry[] = [
  { type: "system", text: "> MeshRefine v2.1 initialized." },
  { type: "system", text: "> Base mesh generated (12,847 faces)." },
  { type: "system", text: "> RANSAC planes detected: 6 surfaces flattened." },
  { type: "system", text: "> Topology optimized. Ready for refinement." },
];

export function RefinementTerminal() {
  const [logs, setLogs] = useState<LogEntry[]>(INITIAL_LOGS);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const handleSend = () => {
    if (!input.trim()) return;
    const userMsg = input.trim();
    setLogs((prev) => [...prev, { type: "user", text: userMsg }]);
    setInput("");

    setTimeout(() => {
      setLogs((prev) => [
        ...prev,
        { type: "system", text: `> Processing: "${userMsg}"...` },
      ]);
    }, 500);

    setTimeout(() => {
      setLogs((prev) => [
        ...prev,
        { type: "ai", text: `✓ Edit applied. Mesh updated (${Math.floor(Math.random() * 2000 + 11000)} faces).` },
      ]);
    }, 1800);
  };

  return (
    <div className="h-full flex flex-col bg-tech-bg rounded-2xl border border-tech-border overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-tech-border flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-primary" />
        <span className="text-sm font-semibold text-card-foreground" style={{ color: "oklch(0.95 0 0)" }}>
          Refinement Terminal
        </span>
      </div>

      {/* Logs */}
      <ScrollArea className="flex-1 px-4 py-3" ref={scrollRef}>
        <div className="space-y-2 font-mono text-xs">
          {logs.map((log, i) => (
            <div
              key={i}
              className={
                log.type === "system"
                  ? "text-tech-muted"
                  : log.type === "user"
                    ? "text-secondary"
                    : "text-primary"
              }
            >
              {log.type === "user" && <span className="text-tech-fg">you: </span>}
              {log.text}
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="p-3 border-t border-tech-border">
        <div className="flex items-center gap-2 bg-tech-border/50 rounded-lg px-3 py-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Type geometric edits (e.g., 'Make the cap taller')..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-tech-muted"
            style={{ color: "oklch(0.85 0 0)" }}
          />
          <button
            onClick={handleSend}
            className="text-primary hover:text-primary/80 transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
