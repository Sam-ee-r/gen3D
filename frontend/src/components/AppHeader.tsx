import { useState, useRef, useEffect } from "react";
import { Box, RotateCcw, User, ChevronDown, Linkedin, Github, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { ProfilePanel } from "@/components/ProfilePanel";

interface AppHeaderProps {
  onReset: () => void;
  showReset: boolean;
  onSelectCreation?: (jobId: string) => void;
}

export function AppHeader({ onReset, showReset, onSelectCreation }: AppHeaderProps) {
  const { user } = useAuth();
  const [showProfile, setShowProfile] = useState(false);
  const [showDeveloperDropdown, setShowDeveloperDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDeveloperDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 bg-background/60 backdrop-blur-xl border-b border-white/5 shadow-[0_4px_30px_rgba(0,0,0,0.5)] font-mono">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-12 flex items-center justify-between">
          {/* Logo Brand */}
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Box className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="text-base sm:text-lg font-semibold tracking-tight text-foreground font-display">
              MeshRefine AI
            </span>
          </div>

          {/* Right Navigation controls */}
          <div className="flex items-center gap-2 sm:gap-4">
            {/* About the Developer Dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setShowDeveloperDropdown(!showDeveloperDropdown)}
                className="flex items-center gap-1 px-2 py-1.5 sm:px-2.5 rounded-lg border border-transparent hover:border-white/5 hover:bg-white/5 text-xs text-muted-foreground hover:text-foreground transition-all duration-200"
              >
                <Info className="w-4 h-4 sm:hidden" />
                <span className="hidden sm:inline">About Developer</span>
                <ChevronDown className={`w-3.5 h-3.5 hidden sm:block transition-transform duration-200 ${showDeveloperDropdown ? "rotate-180" : ""}`} />
              </button>

              {showDeveloperDropdown && (
                <div className="absolute right-0 mt-2 w-72 bg-[#0c0c0c]/95 backdrop-blur-xl border border-white/10 rounded-xl p-1.5 shadow-2xl z-50 flex flex-col gap-0.5 animate-in fade-in slide-in-from-top-1 duration-200">
                  <span className="text-[9px] text-white/40 uppercase tracking-widest px-2.5 py-2 font-bold block border-b border-white/5 mb-1">
                    Sameer Rajani
                  </span>
                  
                  <div className="px-2.5 py-2 text-[10px] text-white/70 leading-relaxed border-b border-white/5 font-mono mb-1.5 select-none">
                    Sameer here! Just a CS major entering his final year. As a video editor (arguably professional!), I've always had a passion for 3D design but never quite got around to learning it. So, I decided to merge my degree with that creative itch and build this tool. Use with care!
                  </div>
                  
                  <a
                    href="https://www.linkedin.com/in/sameer-rajani"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setShowDeveloperDropdown(false)}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs text-white/80 hover:text-white hover:bg-white/5 transition-colors"
                  >
                    <Linkedin className="w-3.5 h-3.5 text-primary" />
                    <span>LinkedIn Profile</span>
                  </a>

                  <a
                    href="https://github.com/Sam-ee-r"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setShowDeveloperDropdown(false)}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs text-white/80 hover:text-white hover:bg-white/5 transition-colors"
                  >
                    <Github className="w-3.5 h-3.5 text-primary" />
                    <span>GitHub Profile</span>
                  </a>
                </div>
              )}
            </div>

            {showReset && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onReset}
                className="text-muted-foreground hover:text-foreground gap-1.5 text-xs px-2 sm:px-3"
              >
                <RotateCcw className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                <span className="hidden sm:inline">New Generation</span>
              </Button>
            )}

            {/* Profile / Account button */}
            <button
              onClick={() => setShowProfile(true)}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/3 hover:bg-white/8 hover:border-white/20 transition-all"
              title={user ? `Signed in as ${user.email}` : "Sign in"}
            >
              {user?.user_metadata?.avatar_url ? (
                <img
                  src={user.user_metadata.avatar_url}
                  alt="Avatar"
                  className="w-5 h-5 rounded-full object-cover"
                />
              ) : (
                <User className="w-4 h-4 text-tech-muted" />
              )}
              {user ? (
                <span className="text-xs text-tech-fg hidden sm:block max-w-24 truncate">
                  {user.user_metadata?.full_name ?? user.email}
                </span>
              ) : (
                <span className="text-xs text-tech-muted hidden sm:block">Sign In</span>
              )}
            </button>
          </div>
        </div>
      </header>

      {showProfile && (
        <ProfilePanel
          onClose={() => setShowProfile(false)}
          onSelectCreation={(id) => {
            onSelectCreation?.(id);
            setShowProfile(false);
          }}
        />
      )}
    </>
  );
}
