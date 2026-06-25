import { useState, useEffect } from "react";
import { Loader2, Star } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Creation, Review } from "@/lib/supabase";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
        src?: string; "auto-rotate"?: boolean | string; "camera-controls"?: boolean | string;
        loading?: string; style?: React.CSSProperties;
      }, HTMLElement>;
    }
  }
}

interface CreationWithReviews extends Creation {
  reviews?: Review[];
}

export function WaitStateGallery() {
  const [creations, setCreations] = useState<CreationWithReviews[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("creations")
      .select("*, reviews(*)")
      .eq("is_approved", true)
      .eq("status", "complete")
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(5)
      .then(({ data, error }) => {
        if (error && error.message.includes("display_order")) {
          // Fallback to ordering by created_at if display_order column doesn't exist yet
          supabase
            .from("creations")
            .select("*, reviews(*)")
            .eq("is_approved", true)
            .eq("status", "complete")
            .order("created_at", { ascending: false })
            .limit(5)
            .then(({ data: fallbackData }) => {
              setCreations((fallbackData as CreationWithReviews[]) ?? []);
              setLoading(false);
            });
        } else {
          setCreations((data as CreationWithReviews[]) ?? []);
          setLoading(false);
        }
      });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="w-6 h-6 animate-spin text-primary/50" />
      </div>
    );
  }

  if (creations.length === 0) return null;

  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="flex flex-col gap-4">
        {creations.map((c) => (
          <div
            key={c.id}
            className="flex flex-col md:flex-row bg-white/3 border border-white/8 rounded-2xl overflow-hidden hover:border-primary/20 transition-colors"
          >
            {/* 1. Input image (Left) */}
            {c.original_image_url && (
              <div className="w-full md:w-36 shrink-0 bg-black/30 flex items-center justify-center border-b md:border-b-0 md:border-r border-white/8">
                <img
                  src={c.original_image_url}
                  alt="Input"
                  className="w-full h-48 md:h-full object-cover md:max-h-full"
                />
              </div>
            )}

            {/* 2. 3D model viewer (Middle) */}
            <div className="w-full h-64 md:flex-1 md:h-auto md:min-h-[180px] bg-black/10 relative">
              {c.raw_glb_url || c.glb_model_url ? (
                <model-viewer
                  src={c.raw_glb_url ?? c.glb_model_url}
                  auto-rotate="true"
                  camera-controls="true"
                  loading="lazy"
                  style={{ width: "100%", height: "100%", background: "transparent" }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-tech-muted/50 font-mono">
                  Model not available
                </div>
              )}

              {/* Label overlay */}
              {c.object_label && (
                <div className="absolute bottom-2 left-2 bg-black/60 backdrop-blur-sm px-2 py-1 rounded-lg">
                  <span className="text-[10px] font-mono text-tech-muted">{c.object_label}</span>
                </div>
              )}
            </div>

            {/* 3. Review / Feedback Panel (Right) */}
            <div className="w-full md:w-64 shrink-0 p-4 border-t md:border-t-0 md:border-l border-white/8 bg-black/20 flex flex-col gap-2 font-mono">
              <span className="text-[9px] text-white/40 uppercase tracking-widest font-bold block">Feedback</span>
              {c.reviews && c.reviews.length > 0 ? (
                <div className="flex flex-col gap-1.5 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-white text-xs font-semibold truncate max-w-[120px]">
                      {c.reviews[0].reviewer_name || "Anonymous"}
                    </span>
                    <div className="flex items-center gap-0.5 shrink-0 text-yellow-400">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          className={`w-3.5 h-3.5 ${
                            i < (c.reviews?.[0]?.rating ?? 0)
                              ? "fill-current"
                              : "text-white/10"
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                  {c.reviews[0].comment ? (
                    <p className="text-white/70 italic text-[11px] leading-relaxed break-words line-clamp-4">
                      "{c.reviews[0].comment}"
                    </p>
                  ) : (
                    <p className="text-white/30 italic text-[10px]">Rated without comment</p>
                  )}
                </div>
              ) : (
                <span className="text-tech-muted italic text-[11px] mt-1">No feedback left yet.</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
