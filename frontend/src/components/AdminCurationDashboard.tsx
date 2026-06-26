import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, CheckCircle, XCircle, Loader2, ShieldAlert, ToggleLeft, ToggleRight, Star, ArrowUp, ArrowDown, Plus, Pencil, Check, X, Maximize2, Calendar, Box, User } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Creation, SystemStatus, Review } from "@/lib/supabase";

const MAX_GALLERY_ITEMS = 100;

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

  // Edit Name State
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState("");

  // Modal View State
  const [selectedCreation, setSelectedCreation] = useState<CreationWithReviews | null>(null);

  // Tab control: "curation" | "users"
  const [activeTab, setActiveTab] = useState<"curation" | "users">("curation");
  
  // User management state
  const [users, setUsers] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoadingUsers(true);
    setActionError(null);
    try {
      const { data, error } = await supabase.rpc("admin_get_users", {
        admin_pass: "lightning",
      });
      if (error) {
        if (error.message.includes("does not exist")) {
          setActionError("Database functions missing. Please execute the SQL migration script in your Supabase SQL Editor (check the implementation plan).");
        } else {
          setActionError(error.message);
        }
      } else {
        setUsers(data ?? []);
      }
    } catch (err: any) {
      setActionError(err?.message ?? "Failed to fetch users");
    }
    setLoadingUsers(false);
  }, []);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserEmail || !newUserPassword) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const { error } = await supabase.rpc("admin_create_user", {
        admin_pass: "lightning",
        user_email: newUserEmail.trim(),
        user_password: newUserPassword,
      });
      if (error) {
        setActionError(error.message);
      } else {
        setNewUserEmail("");
        setNewUserPassword("");
        setShowAddUserModal(false);
        await fetchUsers();
      }
    } catch (err: any) {
      setActionError(err?.message ?? "Failed to create user");
    }
    setActionLoading(false);
  };

  const handleDeleteUser = async (userId: string, email: string) => {
    const confirmDelete = window.confirm(`Are you sure you want to delete user ${email}? This will permanently remove their account.`);
    if (!confirmDelete) return;

    setActionLoading(true);
    setActionError(null);
    try {
      const { error } = await supabase.rpc("admin_delete_user", {
        admin_pass: "lightning",
        target_user_id: userId,
      });
      if (error) {
        setActionError(error.message);
      } else {
        await fetchUsers();
      }
    } catch (err: any) {
      setActionError(err?.message ?? "Failed to delete user");
    }
    setActionLoading(false);
  };

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

      const { data: allCreations } = await supabase
        .from("creations")
        .select("*, reviews(*)")
        .order("created_at", { ascending: false });
      const reviewedCreations = (allCreations ?? []).filter(
        (c) => c.reviews && c.reviews.length > 0
      );
      setCreations(reviewedCreations as CreationWithReviews[]);

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

  useEffect(() => {
    if (activeTab === "users") {
      fetchUsers();
    }
  }, [activeTab, fetchUsers]);

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

  const handleSaveName = async (id: string) => {
    if (!editNameValue.trim()) return;
    setUpdatingId(id);
    try {
      await supabase.from("creations").update({ object_label: editNameValue.trim() }).eq("id", id);
      setEditingNameId(null);
      await fetchData();
    } catch (err) {
      console.error("Error saving name:", err);
    }
    setUpdatingId(null);
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
    <div className="min-h-screen bg-tech-bg px-4 py-6 md:px-8 md:py-12">
      <h1 className="text-xl md:text-2xl lg:text-3xl font-bold font-mono text-tech-fg mb-6 flex items-center gap-3">
        <ShieldAlert className="w-6 h-6 text-primary" /> Admin Curation Dashboard
      </h1>

      {/* System Alert Banner */}
      {systemStatus?.api_token_exhausted && (
        <div className="flex items-center gap-3 mb-6 p-4 bg-red-500/15 border border-red-500/40 rounded-2xl text-red-400 animate-pulse">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <p className="text-sm md:text-base font-mono font-semibold whitespace-normal text-wrap">
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

      {/* Tab Selectors */}
      <div className="flex border-b border-white/10 mb-6 font-mono text-xs">
        <button
          onClick={() => setActiveTab("curation")}
          className={`px-4 py-2 border-b-2 font-semibold transition-all cursor-pointer ${
            activeTab === "curation"
              ? "border-primary text-primary"
              : "border-transparent text-tech-muted hover:text-tech-fg"
          }`}
        >
          Curation Dashboard
        </button>
        <button
          onClick={() => setActiveTab("users")}
          className={`px-4 py-2 border-b-2 font-semibold transition-all cursor-pointer ${
            activeTab === "users"
              ? "border-primary text-primary"
              : "border-transparent text-tech-muted hover:text-tech-fg"
          }`}
        >
          User Account Manager
        </button>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : activeTab === "curation" ? (
        <div className="flex flex-col lg:flex-row gap-8 items-start">
          {/* Main Feed Section */}
          <div className="flex-1 min-w-0 w-full">
            <h2 className="text-xs font-mono font-bold text-tech-muted uppercase tracking-widest mb-4">Reviewed Submissions Feed</h2>
            {creations.length === 0 ? (
              <div className="text-center py-20 text-tech-muted font-mono text-sm bg-white/3 border border-white/8 rounded-2xl">
                No reviewed creations yet.
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
                      <div className="flex-1 bg-black/20 flex items-center justify-center relative group">
                        {c.raw_glb_url || c.glb_model_url ? (
                          <>
                            <model-viewer
                              src={c.raw_glb_url ?? c.glb_model_url}
                              auto-rotate="true"
                              camera-controls="true"
                              loading="lazy"
                              style={{ width: "100%", height: "100%", background: "transparent" }}
                            />
                            <button
                              onClick={() => setSelectedCreation(c)}
                              className="absolute top-2 right-2 bg-black/50 hover:bg-primary/80 text-white p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-all z-10"
                              title="Open Full Viewer"
                            >
                              <Maximize2 className="w-3.5 h-3.5" />
                            </button>
                          </>
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

                    {/* Info + Actions */}
                    <div className="p-3 flex items-center justify-between gap-2 border-t border-white/5">
                      <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                        {editingNameId === c.id ? (
                          <div className="flex items-center gap-1 w-full">
                            <input
                              type="text"
                              value={editNameValue}
                              onChange={(e) => setEditNameValue(e.target.value)}
                              className="w-full bg-black/30 border border-white/10 rounded px-1.5 py-0.5 text-xs font-mono text-tech-fg focus:outline-none focus:border-primary"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleSaveName(c.id);
                                if (e.key === "Escape") setEditingNameId(null);
                              }}
                            />
                            <button onClick={() => handleSaveName(c.id)} className="text-green-400 hover:text-green-300 shrink-0">
                              <Check className="w-3 h-3" />
                            </button>
                            <button onClick={() => setEditingNameId(null)} className="text-red-400 hover:text-red-300 shrink-0">
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 w-full group">
                            <p className="text-xs font-mono font-semibold text-tech-fg truncate">{c.object_label ?? "Untitled"}</p>
                            <button 
                              onClick={() => { setEditingNameId(c.id); setEditNameValue(c.object_label || ""); }}
                              className="text-tech-muted hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                        <p className="text-[9px] text-tech-muted font-mono">{new Date(c.created_at).toLocaleString()}</p>
                      </div>
                      <button
                        onClick={() => toggleApproval(c)}
                        disabled={updatingId === c.id || !c.opt_in_for_display}
                        title={
                          !c.opt_in_for_display
                            ? "Cannot approve because user did not opt in for display"
                            : c.is_approved
                            ? "Revoke Approval"
                            : "Approve for Gallery"
                        }
                        className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-mono font-semibold transition-all ${
                          !c.opt_in_for_display
                            ? "bg-white/5 border border-white/5 text-tech-muted/40 cursor-not-allowed opacity-50"
                            : c.is_approved
                            ? "bg-green-500/15 border border-green-500/30 text-green-400 hover:bg-red-500/15 hover:border-red-500/30 hover:text-red-400 cursor-pointer"
                            : "bg-white/5 border border-white/10 text-tech-muted hover:bg-green-500/10 hover:border-green-500/30 hover:text-green-400 cursor-pointer"
                        }`}
                      >
                        {updatingId === c.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : !c.opt_in_for_display ? (
                          <><XCircle className="w-3 h-3" /> No Opt-in</>
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
                Custom layout order of items displayed in the Community Gallery (Featured) and wait page gallery. Click arrows to arrange.
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
      ) : (
        /* User Manager Tab */
        <div className="w-full flex flex-col gap-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-xs font-mono font-bold text-tech-muted uppercase tracking-widest">Signed Up Users ({users.length})</h2>
              <p className="text-[11px] text-tech-muted mt-1 font-mono">
                View all registered credentials, create new ones, or revoke account access.
              </p>
            </div>
            <button
              onClick={() => setShowAddUserModal(true)}
              className="flex items-center justify-center gap-1.5 px-4 py-2 bg-primary/15 border border-primary/30 hover:bg-primary/25 text-primary text-xs font-mono font-medium rounded-xl transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Add New User
            </button>
          </div>

          {actionError && (
            <div className="p-4 bg-red-500/15 border border-red-500/40 rounded-2xl text-red-400 text-xs font-mono">
              {actionError}
            </div>
          )}

          {/* Search/Filter */}
          <div className="w-full max-w-md">
            <input
              type="text"
              placeholder="Search users by email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-white/10 bg-black/20 text-tech-fg text-xs font-mono focus:outline-none focus:border-primary/50 transition-colors"
            />
          </div>

          {/* Users Table */}
          {loadingUsers ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-16 text-tech-muted font-mono text-sm bg-white/3 border border-white/8 rounded-2xl">
              No users registered yet.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-white/8 bg-white/3">
              <table className="w-full text-left border-collapse font-mono text-xs">
                <thead>
                  <tr className="border-b border-white/8 bg-black/10 text-tech-muted text-[10px] uppercase tracking-wider">
                    <th className="p-4">User ID</th>
                    <th className="p-4">Email</th>
                    <th className="p-4">Registered Date</th>
                    <th className="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users
                    .filter((u) => u.email.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((userItem) => (
                      <tr key={userItem.id} className="border-b border-white/5 hover:bg-white/3 transition-colors text-tech-fg">
                        <td className="p-4 text-tech-muted text-[10px] truncate max-w-[120px]" title={userItem.id}>
                          {userItem.id}
                        </td>
                        <td className="p-4 font-semibold">{userItem.email}</td>
                        <td className="p-4 text-tech-muted">
                          {new Date(userItem.created_at).toLocaleString()}
                        </td>
                        <td className="p-4 text-right">
                          <button
                            onClick={() => handleDeleteUser(userItem.id, userItem.email)}
                            disabled={actionLoading}
                            className="px-2.5 py-1.5 rounded-lg border border-red-500/20 bg-red-950/10 hover:bg-red-500/15 hover:border-red-500/30 text-red-400 text-[10px] transition-all cursor-pointer disabled:opacity-50"
                          >
                            Delete Account
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Add User Modal */}
          {showAddUserModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm">
              <form
                onSubmit={handleAddUser}
                className="bg-tech-bg border border-white/10 rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4 shadow-2xl animate-in zoom-in duration-200"
              >
                <div>
                  <h3 className="text-sm font-bold font-mono text-tech-fg uppercase tracking-wider">Register New User</h3>
                  <p className="text-[10px] text-tech-muted mt-1 font-mono">Create standard credentials in Supabase Auth.</p>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[9px] font-mono text-tech-muted uppercase tracking-widest">Email</span>
                    <input
                      type="email"
                      required
                      value={newUserEmail}
                      onChange={(e) => setNewUserEmail(e.target.value)}
                      placeholder="user@example.com"
                      className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-tech-fg text-xs font-mono focus:outline-none focus:border-primary/50 transition-colors"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <span className="text-[9px] font-mono text-tech-muted uppercase tracking-widest">Password</span>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={newUserPassword}
                      onChange={(e) => setNewUserPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-tech-fg text-xs font-mono focus:outline-none focus:border-primary/50 transition-colors"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3 mt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddUserModal(false);
                      setNewUserEmail("");
                      setNewUserPassword("");
                    }}
                    className="flex-1 py-2 text-center border border-white/10 rounded-lg text-tech-muted hover:text-tech-fg hover:bg-white/5 text-xs font-mono transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={actionLoading}
                    className="flex-1 py-2 text-center bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-xs font-mono font-semibold transition-all cursor-pointer disabled:opacity-50"
                  >
                    {actionLoading ? "Creating..." : "Create User"}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {/* Detail Modal */}
      {selectedCreation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div 
            className="absolute inset-0" 
            onClick={() => setSelectedCreation(null)} 
          />
          <div className="relative w-full max-w-5xl max-h-full bg-tech-bg border border-white/10 rounded-2xl shadow-2xl flex flex-col md:flex-row overflow-hidden animate-in zoom-in-95 duration-300">
            
            {/* Close button */}
            <button 
              onClick={() => setSelectedCreation(null)}
              className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/50 text-white hover:bg-white/20 backdrop-blur-sm transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            {/* 3D Viewer Area */}
            <div className="w-full md:w-2/3 h-[40vh] md:h-[80vh] bg-black/30 relative border-b md:border-b-0 md:border-r border-white/10">
               <model-viewer
                  src={selectedCreation.raw_glb_url ?? selectedCreation.glb_model_url}
                  auto-rotate="true"
                  camera-controls="true"
                  loading="eager"
                  style={{ width: "100%", height: "100%", background: "transparent" }}
                />
            </div>

            {/* Details & Reviews Area */}
            <div className="w-full md:w-1/3 h-[50vh] md:h-[80vh] flex flex-col bg-tech-bg overflow-y-auto">
              <div className="p-6 border-b border-white/10">
                <h2 className="text-xl font-bold text-tech-fg font-mono mb-2">
                  {selectedCreation.object_label || "Untitled Model"}
                </h2>
                <div className="flex flex-col gap-2 text-xs text-tech-muted font-mono">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 opacity-50" />
                    <span>Created on {new Date(selectedCreation.created_at || "").toLocaleDateString()}</span>
                  </div>
                  {(selectedCreation.refined_vertices || selectedCreation.raw_vertices) && (
                    <div className="flex items-center gap-2 mt-1">
                      <Box className="w-4 h-4 opacity-50" />
                      <span>{selectedCreation.refined_vertices || selectedCreation.raw_vertices} Vertices</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="p-6 flex-1">
                <h3 className="text-sm font-semibold text-white/80 font-mono tracking-wider uppercase mb-4">
                  Community Feedback
                </h3>
                
                {selectedCreation.reviews && selectedCreation.reviews.length > 0 ? (
                  <div className="flex flex-col gap-4">
                    {selectedCreation.reviews.map((review) => (
                      <div key={review.id} className="bg-white/5 p-4 rounded-xl border border-white/5">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2 text-xs font-semibold text-tech-fg">
                            <User className="w-3.5 h-3.5 opacity-50" />
                            {review.reviewer_name || "Anonymous"}
                          </div>
                          <div className="flex items-center gap-0.5 text-yellow-400">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <Star
                                key={i}
                                className={`w-3 h-3 ${
                                  i < (review.rating ?? 0) ? "fill-current" : "text-white/10"
                                }`}
                              />
                            ))}
                          </div>
                        </div>
                        {review.comment && (
                          <p className="text-xs text-tech-muted leading-relaxed mt-2 italic">
                            "{review.comment}"
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-10 opacity-50">
                    <Star className="w-8 h-8 mx-auto mb-2 opacity-20" />
                    <p className="text-xs font-mono">No reviews yet.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
