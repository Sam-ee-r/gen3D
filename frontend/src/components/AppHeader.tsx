import { Box, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AppHeaderProps {
  onReset: () => void;
  showReset: boolean;
}

export function AppHeader({ onReset, showReset }: AppHeaderProps) {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-card/80 backdrop-blur-xl border-b border-border">
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Box className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-foreground">
            MeshRefine AI
          </span>
        </div>
        {showReset && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="text-muted-foreground hover:text-foreground gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            New Generation
          </Button>
        )}
      </div>
    </header>
  );
}
