import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, CheckCircle, XCircle, Loader2, ShieldAlert, ToggleLeft, ToggleRight, Star, ArrowUp, ArrowDown } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Creation, SystemStatus, Review } from "@/lib/supabase";

const MAX_GALLERY_ITEMS = 5;

interface CreationWithReviews extends Creation {
  reviews?: Review[];
}

export function AdminCurationDashboard() {
  const [creations, setCreations] = useState<CreationWithReviews[]>([]);
  const [approvedCreations, setApprovedCreations] = useState<CreationWithReviews[]>([]);
  const [hasDisplayOrderColumn, setHasDisplayOrderColumn] = useState(true);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [approvedCount, setApprovedCount] = useState(0);
  const [limitWarning, setLimitWarning] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: status }, { count }] = await Promise.all([
        supabase
          .from("system_status")
          .select("*")
          .eq("id", 1)
          .single(),
        supabase
          .from("creations")
          .select("id", { count: "exact", head: true })
          .eq("is_approved", true),
      ]);
      setSystemStatus(status as SystemStatus ?? null);
      setApprovedCount(count ?? 0);

      const { data: optIns } = await supabase
        .from("creations")
        .select("*, reviews(*)")
        .eq("opt_in_for_display", true)
        .order("created_at", { ascending: false });
      setCreations((optIns as CreationWithReviews[]) ?? []);

      // Fetch approved creations with display_order check
      const approvedRes = await supabase
        .from("creations")
        .select("*, reviews(*)")
        .eq("is_approved", true)
        .eq("status", "complete")
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: false });

      if (approvedRes.error && approvedRes.error.message.includes("display_order")) {
        setHasDisplayOrderColumn(false);
        const fallbackRes = await supabase
          .from("creations")
          .select("*, reviews(*)")
          .eq("is_approved", true)
          .eq("status", "complete")
          .order("created_at", { ascending: false });
        setApprovedCreations((fallbackRes.data as CreationWithReviews[]) ?? []);
      } else {
        setHasDisplayOrderColumn(true);
        setApprovedCreations((approvedRes.data as CreationWithReviews[]) ?? []);
      }
    } catch (err) {
      console.error("Data fetch error:", err);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleApproval = async (creation: Creation) => {
    // If approving and already at limit, show warning
    if (!creation.is_approved && approvedCount >= MAX_GALLERY_ITEMS) {
      setLimitWarning(true);
      return;
    }

    setUpdatingId(creation.id);
    const newVal = !creation.is_approved;
    
    const updatePayload: any = { is_approved: newVal };
    if (hasDisplayOrderColumn) {
      updatePayload.display_order = newVal ? approvedCreations.length : 0;
    }

    await supabase
      .from("creations")
      .update(updatePayload)
      .eq("id", creation.id);

    await fetchData();
    setUpdatingId(null);
  };

  const moveItem = async (index: number, direction: "up" | "down") => {
    if (!hasDisplayOrderColumn) return;

    const newItems = [...approvedCreations];
    const targetIndex = direction === "up" ? index - 1 : index + 1;

    if (targetIndex < 0 || targetIndex >= newItems.length) return;

    const temp = newItems[index];
    newItems[index] = newItems[targetIndex];
    newItems[targetIndex] = temp;

    // Local instant update
    setApprovedCreations(newItems);

    try {
      const updates = newItems.map((item, idx) =>
        supabase
          .from("creations")
          .update({ display_order: idx })
          .eq("id", item.id)
      );
      await Promise.all(updates);
    } catch (err) {
      console.error("Error swapping display order:", err);
    }

    await fetchData();
  };

  const toggleTokenExhausted = async () => {
    if (!systemStatus) return;
    const newVal = !systemStatus.api_token_exhausted;
    await supabase
      .from("system_status")
      .update({ api_token_exhausted: newVal })
      .eq("id", 1);
    setSystemStatus({ ...systemStatus, api_token_exhausted: newVal });
  };

  return (
    <div className="min-h-screen bg-tech-bg p-8">
      <h1 className="text-2xl font-bold font-mono text-tech-fg mb-6 flex items-center gap-3">
        <ShieldAlert className="w-6 h-6 text-primary" /> Admin Curation Dashboard
      </h1>

      {/* System Alert Banner */}
      {systemStatus?.api_token_exhausted && (
        <div className="flex items-center gap-3 mb-6 p-4 bg-red-500/15 border border-red-500/40 rounded-2xl text-red-400 animate-pulse">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <p className="text-sm font-mono font-semibold">
            CRITICAL: Backend Generation API Credits Exhausted. Please Refill.
          </p>
        </div>
      )}

      {/* System Status Toggle */}
      <div className="flex items-center justify-between mb-6 p-4 bg-white/3 border border-white/8 rounded-2xl">
        <div>
          <p className="text-sm font-mono font-semibold text-tech-fg">API Token Status</p>
          <p className="text-xs text-tech-muted mt-0.5">
            {systemStatus?.api_token_exhausted ? "Credits exhausted — generation is blocked" : "Credits available — generation is live"}
          </p>
        </div>
        <button onClick={toggleTokenExhausted} className="flex items-center gap-2 text-xs font-mono text-tech-muted hover:text-tech-fg transition-colors">
          {systemStatus?.api_token_exhausted ? (
            <ToggleRight className="w-7 h-7 text-red-400" />
          ) : (
            <ToggleLeft className="w-7 h-7 text-green-400" />
          )}
        </button>
      </div>

      {/* Database Warning Notice */}
      {!hasDisplayOrderColumn && (
        <div className="flex items-start gap-3 mb-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-2xl text-yellow-400 animate-in fade-in duration-300">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="text-xs font-mono">
            <p className="font-bold uppercase tracking-wider">Database Update Required</p>
            <p className="mt-1 leading-relaxed">
              The <code className="bg-black/45 px-1 py-0.5 rounded">display_order</code> column is missing in your creations table. Gallery ordering is temporarily disabled.
            </p>
            <p className="mt-1">
              Please copy and run this query in your Supabase SQL Editor to enable reordering:
            </p>
            <pre className="bg-black/60 p-2 rounded mt-2 border border-white/5 select-all overflow-x-auto text-[10px]">
              ALTER TABLE creations ADD COLUMN IF NOT EXISTS display_order INT DEFAULT 0;
            </pre>
          </div>
        </div>
      )}

      {/* Limit Warning Overlay */}
      {limitWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-tech-bg border border-white/10 rounded-2xl p-8 max-w-sm text-center shadow-2xl">
            <AlertTriangle className="w-10 h-10 text-yellow-400 mx-auto mb-3" />
            <h3 className="text-base font-bold font-mono text-tech-fg mb-2">Gallery Limit Reached</h3>
            <p className="text-sm text-tech-muted mb-4">
              Maximum gallery limit of {MAX_GALLERY_ITEMS} reached. Please un-approve an older creation first.
            </p>
            <button
              onClick={() => setLimitWarning(false)}
              className="px-6 py-2 rounded-xl bg-primary/15 border border-primary/30 text-primary text-sm font-medium hover:bg-primary/25 transition-all"
            >
              Got It
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-8 items-start">
          {/* Main Feed Section */}
          <div className="flex-1 min-w-0 w-full">
            <h2 className="text-xs font-mono font-bold text-tech-muted uppercase tracking-widest mb-4">Opt-in Submissions Feed</h2>
            {creations.length === 0 ? (
              <div className="text-center py-20 text-tech-muted font-mono text-sm bg-white/3 border border-white/8 rounded-2xl">
                No opt-in submissions yet.
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {creations.map((c) => (
                  <div key={c.id} className="bg-white/3 border border-white/8 rounded-2xl overflow-hidden hover:border-white/15 transition-colors">
                    {/* Images */}
                    <div className="flex h-40">
                      {c.original_image_url && (
                        <img src={c.original_image_url} alt="Input" className="w-1/2 object-cover border-r border-white/8" />
                      )}
                      <div className="flex-1 bg-black/20 flex items-center justify-center">
                        {c.raw_glb_url || c.glb_model_url ? (
                          <model-viewer
                            src={c.raw_glb_url ?? c.glb_model_url}
                            auto-rotate="true"
                            camera-controls="true"
                            loading="lazy"
                            style={{ width: "100%", height: "100%", background: "transparent" }}
                          />
                        ) : (
                          <span className="text-[10px] text-tech-muted/50 font-mono">No model</span>
                        )}
                      </div>
                    </div>

                    {/* Review / Feedback Section */}
                    <div className="px-3 py-2.5 border-t border-white/5 bg-black/10 font-mono text-[10px] flex flex-col gap-1">
                      <span className="text-white/40 uppercase tracking-widest font-bold">Feedback</span>
                      {c.reviews && c.reviews.length > 0 ? (
                        <div className="flex flex-col gap-1.5 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-white font-semibold truncate max-w-[120px]">
                              {c.reviews[0].reviewer_name || "Anonymous"}
                            </span>
                            <div className="flex items-center gap-0.5 shrink-0 text-yellow-400">
                              {Array.from({ length: 5 }).map((_, i) => (
                                <Star
                                  key={i}
                                  className={`w-3 h-3 ${
                                    i < (c.reviews?.[0]?.rating ?? 0)
                                      ? "fill-current"
                                      : "text-white/10"
                                  }`}
                                />
                              ))}
                            </div>
                          </div>
                          {c.reviews[0].comment ? (
                            <p className="text-white/70 italic leading-relaxed break-words line-clamp-3">
                              "{c.reviews[0].comment}"
                            </p>
                          ) : (
                            <p className="text-white/30 italic">Rated without comment</p>
                          )}
                        </div>
                      ) : (
                        <span className="text-tech-muted italic">No feedback left yet.</span>
                      )}
                    </div>

                    {/* Info + Toggle */}
                    <div className="p-3 flex items-center justify-between gap-2 border-t border-white/5">
                      <div className="min-w-0">
                        <p className="text-xs font-mono font-semibold text-tech-fg truncate">{c.object_label ?? "Untitled"}</p>
                        <p className="text-[9px] text-tech-muted font-mono">{new Date(c.created_at).toLocaleString()}</p>
                      </div>
                      <button
                        onClick={() => toggleApproval(c)}
                        disabled={updatingId === c.id}
                        title={c.is_approved ? "Revoke Approval" : "Approve for Gallery"}
                        className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-mono font-semibold transition-all ${
                          c.is_approved
                            ? "bg-green-500/15 border border-green-500/30 text-green-400 hover:bg-red-500/15 hover:border-red-500/30 hover:text-red-400"
                            : "bg-white/5 border border-white/10 text-tech-muted hover:bg-green-500/10 hover:border-green-500/30 hover:text-green-400"
                        }`}
                      >
                        {updatingId === c.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : c.is_approved ? (
                          <><CheckCircle className="w-3 h-3" /> Approved</>
                        ) : (
                          <><XCircle className="w-3 h-3" /> Approve</>
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sidebar Gallery Order Manager */}
          <div className="w-full lg:w-[350px] shrink-0 flex flex-col gap-4">
            <div className="bg-[#0c0c0c]/45 backdrop-blur-xl border border-primary/20 rounded-2xl p-5 shadow-[0_0_35px_rgba(255,145,0,0.1),_inset_0_0_15px_rgba(255,145,0,0.02)]">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-xs font-mono font-bold text-white uppercase tracking-widest">Live Gallery Order</h2>
                <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                  approvedCount >= MAX_GALLERY_ITEMS ? "bg-red-500/15 text-red-400" : "bg-green-500/15 text-green-400"
                }`}>
                  {approvedCount} / {MAX_GALLERY_ITEMS}
                </span>
              </div>
              <p className="text-[9px] text-tech-muted leading-normal mb-4 font-mono">
                Top-to-bottom layout of items displayed in wait page gallery. Click arrows to arrange.
              </p>

              {approvedCreations.length === 0 ? (
                <p className="text-xs text-tech-muted font-mono italic text-center py-8 border border-dashed border-white/10 rounded-xl">
                  No approved creations on display. Approve some creations from the feed to see them here.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {approvedCreations.map((item, index) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 p-2 bg-white/3 border border-white/5 rounded-xl hover:border-primary/20 transition-all animate-in fade-in duration-200"
                    >
                      {/* Thumbnail */}
                      {item.original_image_url ? (
                        <img
                          src={item.original_image_url}
                          alt=""
                          className="w-10 h-10 object-cover rounded-lg border border-white/10 shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 bg-white/5 border border-white/10 rounded-lg shrink-0" />
                      )}

                      {/* Info */}
                      <div className="flex-1 min-w-0 font-mono">
                        <p className="text-[11px] font-semibold text-white truncate">
                          {item.object_label || "Untitled"}
                        </p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[8px] text-tech-muted truncate max-w-[80px]">
                            {item.reviews?.[0]?.reviewer_name || "Anonymous"}
                          </span>
                          {item.reviews?.[0]?.rating && (
                            <div className="flex items-center gap-0.5 text-yellow-400 shrink-0">
                              {Array.from({ length: item.reviews[0].rating }).map((_, i) => (
                                <Star key={i} className="w-2 h-2 fill-current" />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Reorder Buttons */}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => moveItem(index, "up")}
                          disabled={!hasDisplayOrderColumn || index === 0}
                          title="Move Up"
                          className="p-1 rounded bg-white/5 border border-white/10 text-tech-fg hover:bg-primary/20 hover:border-primary/30 disabled:opacity-30 disabled:hover:bg-white/5 disabled:hover:border-white/10 transition-colors"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => moveItem(index, "down")}
                          disabled={!hasDisplayOrderColumn || index === approvedCreations.length - 1}
                          title="Move Down"
                          className="p-1 rounded bg-white/5 border border-white/10 text-tech-fg hover:bg-primary/20 hover:border-primary/30 disabled:opacity-30 disabled:hover:bg-white/5 disabled:hover:border-white/10 transition-colors"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
