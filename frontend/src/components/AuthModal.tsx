import { useState } from "react";
import { Mail, Lock, Eye, EyeOff, Chrome, Loader2, CheckCircle, ArrowRight } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface AuthModalProps {
  onClose: () => void;
}

export function AuthModal({ onClose }: AuthModalProps) {
  const { signInWithGoogle, signUpWithEmail, signInWithEmail } = useAuth();
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState<"google" | "submit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleGoogle = async () => {
    setLoading("google");
    setError(null);
    setSuccess(null);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      setError(err.message || "Failed to sign in with Google");
      setLoading(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Please fill in all fields.");
      return;
    }

    if (mode === "signUp" && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading("submit");
    setError(null);
    setSuccess(null);

    if (mode === "signUp") {
      const { data, error: err } = await signUpWithEmail(email, password);
      if (err) {
        setError(err.message);
        setLoading(null);
      } else {
        if (data?.session) {
          setSuccess("Account created successfully!");
          setTimeout(() => {
            onClose();
          }, 1500);
        } else {
          setSuccess("Account created! Please check your email to verify your account.");
          setLoading(null);
        }
      }
    } else {
      const { error: err } = await signInWithEmail(email, password);
      if (err) {
        setError(err.message);
        setLoading(null);
      } else {
        setSuccess("Signed in successfully!");
        setTimeout(() => {
          onClose();
        }, 1000);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-tech-bg border border-white/10 rounded-2xl p-8 w-full max-w-sm shadow-2xl shadow-black/50 transition-all duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-1">
          <h2 className="text-lg font-bold text-tech-fg font-mono">
            {mode === "signIn" ? "Sign In" : "Create Account"}
          </h2>
          <button
            onClick={() => {
              setMode(mode === "signIn" ? "signUp" : "signIn");
              setError(null);
              setSuccess(null);
            }}
            className="text-xs text-primary hover:underline font-mono"
          >
            {mode === "signIn" ? "Need an account?" : "Already registered?"}
          </button>
        </div>
        <p className="text-xs text-tech-muted mb-6">
          {mode === "signIn" ? "Welcome back. Log in to your account." : "Sign up to track and save your 3D creations."}
        </p>

        {success ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle className="w-12 h-12 text-green-400 animate-pulse" />
            <p className="text-sm text-tech-fg font-mono text-center">{success}</p>
            {loading === null && (
              <button
                onClick={onClose}
                className="mt-4 px-4 py-1.5 rounded-lg border border-white/10 text-xs text-tech-fg hover:bg-white/5 transition-colors font-mono"
              >
                Close
              </button>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Google OAuth Option */}
            <button
              type="button"
              onClick={handleGoogle}
              disabled={!!loading}
              className="flex items-center justify-center gap-2.5 w-full py-2.5 px-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-tech-fg text-sm font-medium transition-all disabled:opacity-50"
            >
              {loading === "google" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Chrome className="w-4 h-4" />
              )}
              Continue with Google
            </button>

            <div className="flex items-center gap-2 my-1">
              <div className="flex-1 h-px bg-white/8" />
              <span className="text-[10px] text-tech-muted font-mono uppercase tracking-widest">or</span>
              <div className="flex-1 h-px bg-white/8" />
            </div>

            {/* Email Input */}
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-tech-muted font-mono font-bold">Email Address</label>
              <div className="relative">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-black/30 border border-white/10 text-tech-fg text-sm font-mono focus:outline-none focus:border-primary/50 transition-colors placeholder:text-tech-muted/30"
                />
                <Mail className="absolute left-3 top-2.5 w-4 h-4 text-tech-muted/50" />
              </div>
            </div>

            {/* Password Input */}
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-tech-muted font-mono font-bold">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-10 py-2 rounded-lg bg-black/30 border border-white/10 text-tech-fg text-sm font-mono focus:outline-none focus:border-primary/50 transition-colors placeholder:text-tech-muted/30"
                />
                <Lock className="absolute left-3 top-2.5 w-4 h-4 text-tech-muted/50" />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-tech-muted/50 hover:text-tech-fg transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Confirm Password (Sign Up only) */}
            {mode === "signUp" && (
              <div className="space-y-1 animate-fadeIn">
                <label className="text-[10px] uppercase tracking-wider text-tech-muted font-mono font-bold">Confirm Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-9 pr-10 py-2 rounded-lg bg-black/30 border border-white/10 text-tech-fg text-sm font-mono focus:outline-none focus:border-primary/50 transition-colors placeholder:text-tech-muted/30"
                  />
                  <Lock className="absolute left-3 top-2.5 w-4 h-4 text-tech-muted/50" />
                </div>
              </div>
            )}

            {error && <p className="text-xs text-red-400 text-center font-mono mt-1">{error}</p>}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={!!loading}
              className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-xl bg-primary/15 border border-primary/30 hover:bg-primary/25 text-primary text-sm font-mono font-medium transition-all disabled:opacity-50"
            >
              {loading === "submit" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <span>{mode === "signIn" ? "Sign In" : "Register"}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
