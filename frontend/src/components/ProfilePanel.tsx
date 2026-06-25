import { useState, useEffect, useCallback } from "react";
import { X, LogOut, User, Clock, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import type { Creation } from "@/lib/supabase";

interface ProfilePanelProps {
  onClose: () => void;
  onSelectCreation?: (jobId: string) => void;
  onSignInClick?: () => void;
}

export function ProfilePanel({ onClose, onSelectCreation, onSignInClick }: ProfilePanelProps) {
  const { user, signOut } = useAuth();
  const [history, setHistory] = useState<Creation[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const fetchHistory = useCallback(async () => {
    if (!user) return;
    setLoadingHistory(true);
    const { data } = await supabase
      .from("creations")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5);
    setHistory((data as Creation[]) ?? []);
    setLoadingHistory(false);
  }, [user]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const handleSignOut = async () => {
    await signOut();
    onClose();
  };

  const avatarUrl = user?.user_metadata?.avatar_url;
  const displayName = user?.user_metadata?.full_name ?? user?.email ?? "User";

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-80 bg-tech-bg border-l border-white/10 shadow-2xl shadow-black/60 flex flex-col animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/8">
          <span className="text-sm font-mono font-semibold text-tech-fg">Account</span>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/8 text-tech-muted hover:text-tech-fg transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {user ? (
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Profile info */}
            <div className="p-4 border-b border-white/8 flex items-center gap-3">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Avatar" className="w-10 h-10 rounded-full border border-white/15 object-cover" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center">
                  <User className="w-5 h-5 text-primary" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-tech-fg truncate">{displayName}</p>
                <p className="text-[10px] text-tech-muted font-mono truncate">{user.email}</p>
              </div>
            </div>

            {/* History */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="w-3 h-3 text-tech-muted" />
                <span className="text-[9px] font-mono text-tech-muted uppercase tracking-widest">Recent Creations (Last 5)</span>
              </div>

              {loadingHistory ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                </div>
              ) : history.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
                  <p className="text-xs text-tech-muted font-mono">No creations yet.</p>
                  <p className="text-[10px] text-tech-muted/60">Generate your first 3D model to see it here.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {history.map((creation) => {
                    const isClickable = creation.status === "complete";
                    return (
                      <div
                        key={creation.id}
                        onClick={() => {
                          if (isClickable && onSelectCreation) {
                            onSelectCreation(creation.id);
                          }
                        }}
                        className={`rounded-xl bg-white/3 border p-3 flex items-center gap-3 transition-colors ${
                          isClickable
                            ? "border-white/8 hover:bg-white/10 hover:border-primary/40 cursor-pointer"
                            : "border-white/5 opacity-55"
                        }`}
                        title={isClickable ? "Click to open and edit this creation" : undefined}
                      >
                        {creation.original_image_url ? (
                          <img src={creation.original_image_url} alt="Input" className="w-12 h-12 rounded-lg object-cover border border-white/10 shrink-0" />
                        ) : (
                          <div className="w-12 h-12 rounded-lg bg-white/5 border border-white/10 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-mono font-medium text-tech-fg truncate">{creation.object_label ?? "Creation"}</p>
                          <p className="text-[9px] text-tech-muted font-mono">{new Date(creation.created_at).toLocaleDateString()}</p>
                          <span className={`text-[8px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded-full mt-1 inline-block ${
                            creation.status === "complete" ? "bg-green-500/15 text-green-400" :
                            creation.status === "failed" ? "bg-red-500/15 text-red-400" :
                            "bg-yellow-500/15 text-yellow-400"
                          }`}>
                            {creation.status}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Sign out */}
            <div className="p-4 border-t border-white/8">
              <button
                onClick={handleSignOut}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-white/10 bg-white/3 hover:bg-red-500/10 hover:border-red-500/30 text-tech-muted hover:text-red-400 text-sm font-mono transition-all"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-6 gap-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <User className="w-8 h-8 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-tech-fg mb-1">Save Your Creations</p>
              <p className="text-xs text-tech-muted leading-relaxed">Sign in to keep your generation history and access your models anytime.</p>
            </div>
            <button
              onClick={() => onSignInClick?.()}
              className="w-full py-2.5 rounded-xl bg-primary/15 border border-primary/30 hover:bg-primary/25 text-primary text-sm font-medium transition-all"
            >
              Sign In
            </button>
            <button onClick={onClose} className="text-xs text-tech-muted hover:text-tech-fg transition-colors">
              Continue as Guest
            </button>
          </div>
        )}
      </div>
    </>
  );
}
