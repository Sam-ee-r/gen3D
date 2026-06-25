import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ShieldAlert, Lock, Eye, EyeOff } from "lucide-react";
import { AdminCurationDashboard } from "@/components/AdminCurationDashboard";

export const Route = createFileRoute("/admin")({
  component: AdminPage,
  head: () => ({
    meta: [{ title: "Admin — MeshRefine AI" }],
  }),
});

const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD ?? "admin";
const SESSION_KEY = "meshrefine_admin_unlocked";

function AdminPage() {
  const [unlocked, setUnlocked] = useState(
    () => sessionStorage.getItem(SESSION_KEY) === "true"
  );
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(false);

  const handleUnlock = () => {
    if (password === ADMIN_PASSWORD) {
      sessionStorage.setItem(SESSION_KEY, "true");
      setUnlocked(true);
    } else {
      setError(true);
      setPassword("");
      setTimeout(() => setError(false), 2000);
    }
  };

  if (unlocked) return <AdminCurationDashboard />;

  return (
    <div className="min-h-screen flex items-center justify-center bg-tech-bg px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
            <ShieldAlert className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-xl font-bold font-mono text-tech-fg">Admin Access</h1>
          <p className="text-xs text-tech-muted mt-1">Restricted area. Enter your password to continue.</p>
        </div>

        <div className="flex flex-col gap-3">
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
              placeholder="Enter admin password"
              className={`w-full px-4 py-3 pr-10 rounded-xl border font-mono text-sm bg-black/30 text-tech-fg focus:outline-none transition-colors ${
                error
                  ? "border-red-500/50 text-red-400 animate-pulse"
                  : "border-white/10 focus:border-primary/50"
              }`}
            />
            <button
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-tech-muted hover:text-tech-fg transition-colors"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {error && (
            <p className="text-xs text-red-400 font-mono text-center animate-in fade-in duration-200">
              Incorrect password.
            </p>
          )}

          <button
            onClick={handleUnlock}
            className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-primary/15 border border-primary/30 hover:bg-primary/25 text-primary font-mono font-medium text-sm transition-all"
          >
            <Lock className="w-4 h-4" />
            Unlock Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
