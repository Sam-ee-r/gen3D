import { useState } from "react";
import { Star, CheckCircle, Loader2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

interface ReviewAndDisplayFormProps {
  creationId: string;
  user: User | null;
  onClose: () => void;
  onDismiss: () => void;
}

export function ReviewAndDisplayForm({ creationId, user, onClose, onDismiss }: ReviewAndDisplayFormProps) {
  const [rating, setRating] = useState<number>(0);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [comment, setComment] = useState("");
  const [reviewerName, setReviewerName] = useState(
    user?.user_metadata?.full_name ?? ""
  );
  const [optIn, setOptIn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (rating === 0) { setError("Please select a rating."); return; }
    setLoading(true);
    setError(null);

    // Insert review
    const { error: reviewErr } = await supabase.from("reviews").insert({
      creation_id: creationId,
      rating,
      comment: comment.trim() || null,
      reviewer_name: reviewerName.trim() || null,
      user_id: user?.id ?? null,
    });

    if (reviewErr) {
      setError(reviewErr.message);
      setLoading(false);
      return;
    }

    // If opted in, update creation
    if (optIn) {
      await supabase
        .from("creations")
        .update({ opt_in_for_display: true })
        .eq("id", creationId);
    }

    setSubmitted(true);
    setLoading(false);
    setTimeout(() => {
      onClose();
    }, 1800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-sm" onClick={onDismiss}>
      <div
        className="bg-[#0c0c0c]/45 backdrop-blur-xl border border-primary/20 rounded-2xl p-6 w-full max-w-md shadow-[0_0_45px_rgba(255,145,0,0.25),_0_8px_32px_rgba(0,0,0,0.9),_inset_0_0_15px_rgba(255,145,0,0.05)] relative transition-all duration-300 scale-100 mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-start mb-5">
          <div>
            <h3 className="text-sm font-bold font-mono text-white uppercase tracking-wider">Leave Feedback</h3>
            <p className="text-[10px] text-white/60 mt-1">Let us know how your 3D generation turned out!</p>
          </div>
          <button
            onClick={onDismiss}
            className="text-white/60 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-all"
            title="Not right now"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {submitted ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center animate-in fade-in zoom-in duration-300">
            <CheckCircle className="w-12 h-12 text-green-400" />
            <p className="text-sm font-mono font-semibold text-white">Thank you for your feedback!</p>
            {optIn && (
              <p className="text-xs text-white/70">Your creation has been submitted to the curation queue.</p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Star rating */}
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-mono text-white/80 uppercase tracking-widest font-bold">Rate Your Experience</span>
              <div className="flex items-center gap-1.5">
                {[1, 2, 3, 4, 5].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onMouseEnter={() => setHoverRating(s)}
                    onMouseLeave={() => setHoverRating(0)}
                    onClick={() => setRating(s)}
                    className="transition-transform hover:scale-110 p-0.5"
                  >
                    <Star
                      className={`w-7 h-7 transition-colors ${
                        s <= (hoverRating || rating)
                          ? "fill-yellow-400 text-yellow-400"
                          : "text-white/20"
                      }`}
                    />
                  </button>
                ))}
              </div>
            </div>

            {/* Name field */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-mono text-white/80 uppercase tracking-widest font-bold">Your Name</span>
              <input
                type="text"
                value={reviewerName}
                onChange={(e) => setReviewerName(e.target.value)}
                placeholder={user ? "Edit your name…" : "Anonymous"}
                className="w-full px-3.5 py-2.5 rounded-lg bg-black/50 border border-white/15 text-white text-xs font-mono focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all placeholder:text-white/30"
              />
            </div>

            {/* Comment field */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-mono text-white/80 uppercase tracking-widest font-bold">Comment (optional)</span>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                placeholder="How was the quality? Any feedback for us?"
                className="w-full px-3.5 py-2.5 rounded-lg bg-black/50 border border-white/15 text-white text-xs font-mono focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all resize-none placeholder:text-white/30"
              />
            </div>

            {/* Opt-in checkbox */}
            <label className="flex items-start gap-3 cursor-pointer group py-1">
              <div className="relative mt-0.5">
                <input
                  type="checkbox"
                  checked={optIn}
                  onChange={(e) => setOptIn(e.target.checked)}
                  className="sr-only"
                />
                <div className={`w-4 h-4 rounded border transition-colors flex items-center justify-center ${
                  optIn ? "bg-primary border-primary" : "border-white/20 group-hover:border-primary/50"
                }`}>
                  {optIn && (
                    <svg className="w-2.5 h-2.5 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
              </div>
              <span className="text-xs text-white/80 leading-relaxed group-hover:text-white transition-colors select-none">
                Allow my creation to be featured in the{" "}
                <span className="text-primary font-bold">public gallery</span>
              </span>
            </label>

            {error && <p className="text-xs text-red-400 font-mono mt-1">{error}</p>}

            {/* Action buttons */}
            <div className="flex items-center justify-end gap-3 mt-3 pt-2 border-t border-white/5">
              <button
                type="button"
                onClick={onDismiss}
                className="px-4 py-2.5 rounded-xl border border-white/15 text-white/80 hover:text-white hover:bg-white/5 text-xs font-mono font-semibold transition-all"
              >
                Not right now
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading}
                className="flex items-center justify-center gap-2 py-2.5 px-5 rounded-xl bg-primary text-black hover:bg-primary/90 text-xs font-mono font-bold transition-all disabled:opacity-50 shadow-md shadow-primary/10"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-black" /> : null}
                Submit Review
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
