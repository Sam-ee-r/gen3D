import React, { useState, useEffect, useRef, useCallback, Component, ErrorInfo, ReactNode } from "react";
import { Download, Grid3X3, AlertTriangle, Eye, Stamp, MessageSquare, Edit3, Info, Move } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MaterialEditPanel } from "./MaterialEditPanel";
import type { ActiveDecalConfig, ConfirmedDecal, DecalCallbacks } from "./MaterialEditPanel";
// No need for Three.js Raycaster — we use model-viewer's public positionAndNormalFromPoint() API
import type { ModelViewerElement, ModelViewerMaterial } from "../model-viewer.d.ts";
import "../model-viewer.d.ts";
import { useAuth } from "@/hooks/useAuth";
import { ReviewAndDisplayForm } from "./ReviewAndDisplayForm";
import { supabase } from "@/lib/supabase";

// ──────────────────────────────────────────────────────────────────────────────
// Local Error Boundary to prevent page-level crashes and credit loss
// ──────────────────────────────────────────────────────────────────────────────

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class LocalErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Material Studio error caught:", error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center p-6 bg-tech-bg/40 backdrop-blur-md rounded-2xl border border-red-500/20 text-center gap-4 h-full min-h-[300px]">
          <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-red-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-tech-fg">{this.props.fallbackTitle}</p>
            <p className="text-[10px] text-red-400 font-mono mt-1.5 max-w-xs mx-auto bg-black/40 p-2 rounded border border-white/5 whitespace-pre-wrap break-all select-all">
              {this.state.error?.message || "Unknown error"}
            </p>
          </div>
          <Button
            size="sm"
            onClick={this.handleReset}
            className="mt-2 text-xs bg-white/5 hover:bg-white/10 text-tech-fg border border-white/10"
          >
            Reset Component
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}



interface ModelViewerPanelProps {
  title: string;
  subtitle: string;
  src: string;
  refinedSrc?: string;
  filename: string;
  refinedFilename?: string;
  available: boolean;
  refinedAvailable?: boolean;
  unavailableReason?: string;
  accentColor?: string;
  stats?: { faces: string; vertices: string; type: string };
  viewerRef?: React.RefObject<ModelViewerElement | null>;
  decalMode?: boolean;
}

function ModelViewerPanel({
  title,
  subtitle,
  src,
  refinedSrc,
  filename,
  refinedFilename = "model_refined.glb",
  available,
  refinedAvailable = false,
  unavailableReason,
  accentColor = "oklch(0.7 0.2 200)",
  stats,
  viewerRef: externalRef,
  decalMode = false,
}: ModelViewerPanelProps) {
  const [wireframe, setWireframe] = useState(false);
  const [isTogglingWireframe, setIsTogglingWireframe] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
  const [transitionSnapshot, setTransitionSnapshot] = useState<string | null>(null);
  const [isFading, setIsFading] = useState(false);
  const [showMobileInfo, setShowMobileInfo] = useState(false);
  const internalRef = useRef<ModelViewerElement | null>(null);
  const viewerRef = externalRef ?? internalRef;

  // Refs for tracking original and edited mesh states
  const originalAssets = useRef<Map<string, { map: any; image: any; colorArray?: Float32Array }>>(new Map());
  const editedAssets = useRef<Map<string, { map: any; image: any; colorArray?: Float32Array }>>(new Map());

  // Clear caches when model source changes
  useEffect(() => {
    originalAssets.current.clear();
    editedAssets.current.clear();
    setIsComparing(false);
    setTransitionSnapshot(null);
    setIsFading(false);
  }, [src]);

  // Toggle camera-controls and auto-rotate when entering/leaving decal placement mode.
  // We do this imperatively because model-viewer is a web component and React
  // doesn't reliably toggle boolean attributes on custom elements.
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    if (decalMode) {
      el.removeAttribute("camera-controls");
      el.removeAttribute("auto-rotate");
    } else {
      el.setAttribute("camera-controls", "");
      el.setAttribute("auto-rotate", "");
    }
  }, [decalMode, viewerRef]);

  // Capture current canvas frame as a snapshot for cross-fade
  const captureSnapshot = useCallback(() => {
    const el = viewerRef.current;
    if (!el) return;
    try {
      const snapshot = el.toDataURL();
      setTransitionSnapshot(snapshot);
      setIsFading(false);
    } catch (e) {
      console.warn("Failed to capture snapshot:", e);
    }
  }, [viewerRef]);

  // Start fade out animation
  const startFadeOut = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setIsFading(true);
      });
    });
  }, []);

  // Backup all mesh textures/vertex colors when model loads
  const backupOriginalAssets = useCallback(() => {
    const el = viewerRef.current;
    if (!el) return;
    const symbols = Object.getOwnPropertySymbols(el);
    const sceneSymbol = symbols.find((s) => s.description === "scene");
    if (!sceneSymbol) return;
    const scene = (el as any)[sceneSymbol];
    if (!scene) return;

    scene.traverse((child: any) => {
      if (child.isMesh) {
        if (!originalAssets.current.has(child.uuid)) {
          originalAssets.current.set(child.uuid, {
            map: child.material?.map || null,
            image: child.material?.map?.image || null,
            colorArray: child.geometry?.attributes?.color
              ? new Float32Array(child.geometry.attributes.color.array)
              : undefined,
          });
        }
      }
    });
  }, [viewerRef]);

  // ── Wireframe ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;

    const applyWireframe = () => {
      const symbols = Object.getOwnPropertySymbols(el);
      const sceneSymbol = symbols.find((s) => s.description === "scene");
      if (!sceneSymbol) return;

      const scene = (el as any)[sceneSymbol];
      if (!scene) return;

      scene.traverse((child: any) => {
        if (child.isMesh && child.material) {
          const materials = Array.isArray(child.material)
            ? child.material
            : [child.material];
          materials.forEach((mat: any) => {
            mat.wireframe = wireframe;
          });
        }
      });

      if (typeof el.queueRender === "function") {
        el.queueRender();
      }
    };

    if (el.loaded) {
      applyWireframe();
      backupOriginalAssets();
    }

    const handleLoad = () => {
      setTimeout(() => {
        applyWireframe();
        backupOriginalAssets();
      }, 50);
    };

    el.addEventListener("load", handleLoad);
    return () => {
      el.removeEventListener("load", handleLoad);
    };
  }, [wireframe, src, backupOriginalAssets]);





  const toggleWireframe = () => {
    captureSnapshot();
    setIsTogglingWireframe(true);
    setTimeout(() => {
      setWireframe((prev) => !prev);
      setIsTogglingWireframe(false);
      startFadeOut();
    }, 150);
  };

  const handleCompareStart = useCallback(() => {
    const el = viewerRef.current;
    if (!el) return;

    captureSnapshot();

    const symbols = Object.getOwnPropertySymbols(el);
    const sceneSymbol = symbols.find((s) => s.description === "scene");
    if (!sceneSymbol) return;
    const scene = (el as any)[sceneSymbol];
    if (!scene) return;

    setIsComparing(true);
    editedAssets.current.clear();

    scene.traverse((child: any) => {
      if (child.isMesh) {
        if (child.userData?._isDecal || child.userData?._isGhost) {
          child.visible = false;
          return;
        }

        const backup = originalAssets.current.get(child.uuid);
        if (backup) {
          // Save current state
          editedAssets.current.set(child.uuid, {
            map: child.material?.map || null,
            image: child.material?.map?.image || null,
            colorArray: child.geometry?.attributes?.color
              ? new Float32Array(child.geometry.attributes.color.array)
              : undefined,
          });

          // Swap to original
          if (child.material?.map && backup.image) {
            child.material.map.image = backup.image;
            child.material.map.needsUpdate = true;
          }
          if (child.geometry?.attributes?.color && backup.colorArray) {
            (child.geometry.attributes.color.array as Float32Array).set(backup.colorArray);
            child.geometry.attributes.color.needsUpdate = true;
          }
        }
      }
    });

    if (typeof el.queueRender === "function") {
      el.queueRender();
    }
    startFadeOut();
  }, [viewerRef, captureSnapshot, startFadeOut]);

  const handleCompareEnd = useCallback((skipSnapshot = false) => {
    const el = viewerRef.current;
    if (!el) return;

    if (!skipSnapshot) {
      captureSnapshot();
    }

    const symbols = Object.getOwnPropertySymbols(el);
    const sceneSymbol = symbols.find((s) => s.description === "scene");
    if (!sceneSymbol) return;
    const scene = (el as any)[sceneSymbol];
    if (!scene) return;

    setIsComparing(false);

    scene.traverse((child: any) => {
      if (child.isMesh) {
        if (child.userData?._isDecal || child.userData?._isGhost) {
          child.visible = true;
          return;
        }

        const edited = editedAssets.current.get(child.uuid);
        if (edited) {
          const backup = originalAssets.current.get(child.uuid);
          // Restore edited state
          if (child.material?.map && edited.image) {
            // Only restore if the current image is still the original backup
            if (!backup || child.material.map.image === backup.image) {
              child.material.map.image = edited.image;
              child.material.map.needsUpdate = true;
            }
          }
          if (child.geometry?.attributes?.color && edited.colorArray) {
            // Check if vertex colors were modified during comparison
            const colorArray = child.geometry.attributes.color.array as Float32Array;
            let isUnmodified = true;
            if (backup?.colorArray) {
              for (let i = 0; i < colorArray.length; i++) {
                if (colorArray[i] !== backup.colorArray[i]) {
                  isUnmodified = false;
                  break;
                }
              }
            }
            if (isUnmodified) {
              (child.geometry.attributes.color.array as Float32Array).set(edited.colorArray);
              child.geometry.attributes.color.needsUpdate = true;
            }
          }
        }
      }
    });

    if (typeof el.queueRender === "function") {
      el.queueRender();
    }

    if (!skipSnapshot) {
      startFadeOut();
    }
  }, [viewerRef, captureSnapshot, startFadeOut]);

  // Reset comparing state when an edit is made
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;

    const handleModelEdited = () => {
      setIsComparing((prev) => {
        if (prev) {
          handleCompareEnd(true);
          return false;
        }
        return prev;
      });
    };

    el.addEventListener("model-edited", handleModelEdited);
    return () => {
      el.removeEventListener("model-edited", handleModelEdited);
    };
  }, [viewerRef, handleCompareEnd]);

  // Listen to the model-editing event from edit panel and trigger cross-fade
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;

    const handleModelEditing = (e: any) => {
      const snapshot = e.detail?.snapshot;
      if (snapshot) {
        setTransitionSnapshot(snapshot);
        setIsFading(false);
        startFadeOut();
      }
    };

    el.addEventListener("model-editing", handleModelEditing);
    return () => {
      el.removeEventListener("model-editing", handleModelEditing);
    };
  }, [viewerRef, startFadeOut]);

  const exportFromViewer = async (defaultFilename: string) => {
    const el = viewerRef.current;
    if (!el) return false;
    try {
      if (typeof el.exportScene === "function") {
        const blob = await el.exportScene({ binary: true });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const finalName = defaultFilename.endsWith('.glb') ? defaultFilename : defaultFilename.replace(/\.[^/.]+$/, "") + '.glb';
        a.download = finalName;
        a.click();
        URL.revokeObjectURL(url);
        return true;
      }
    } catch (e) {
      console.error("Export failed", e);
    }
    return false;
  };

  const handleDownload = async () => {
    const exported = await exportFromViewer(filename);
    if (exported) return;

    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Could not download this file.");
    }
  };

  const handleDownloadRefined = async () => {
    if (!refinedSrc) return;
    const targetFilename = refinedFilename || filename;
    
    const exported = await exportFromViewer(targetFilename);
    if (exported) return;

    try {
      const res = await fetch(refinedSrc);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = targetFilename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Could not download refined CAD file.");
    }
  };

  return (
    <div className="flex-1 min-w-0 bg-tech-bg rounded-2xl border border-tech-border flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-tech-border shrink-0">
        <div className="flex flex-col">
          <span className="font-mono text-xs text-tech-fg font-semibold">{title}</span>
          <span className="font-mono text-[10px] text-tech-muted">{subtitle}</span>
        </div>
        <div className="flex items-center gap-2">
          {available && (
            <Button
              variant="ghost"
              size="sm"
              disabled={isTogglingWireframe}
              onClick={toggleWireframe}
              className={`gap-1.5 text-xs ${
                wireframe
                  ? "text-primary bg-primary/5 border border-primary/20"
                  : "text-tech-muted hover:text-tech-fg"
              }`}
            >
              <Grid3X3 className="w-3.5 h-3.5" />
              {isTogglingWireframe ? "Processing..." : "Wireframe"}
            </Button>
          )}
          {available && (
            <Button
              variant="ghost"
              size="sm"
              onMouseEnter={() => handleCompareStart()}
              onMouseLeave={() => handleCompareEnd(false)}
              onTouchStart={() => handleCompareStart()}
              onTouchEnd={() => handleCompareEnd(false)}
              className={`gap-1.5 text-xs border select-none ${
                isComparing
                  ? "text-primary bg-primary/5 border-primary/20"
                  : "text-tech-muted hover:text-tech-fg border-transparent hover:border-white/5"
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              Compare
            </Button>
          )}
          {refinedAvailable && refinedSrc && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadRefined}
              className="gap-1.5 text-tech-muted hover:text-tech-fg border-tech-border hover:bg-white/5 text-xs"
            >
              <Download className="w-3.5 h-3.5" />
              Download Refined (CAD)
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleDownload}
            disabled={!available}
            className="gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
            Download
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 relative min-h-0">
        {available ? (
          <>
            {/* Grid floor overlay */}
            <div className="absolute inset-0 opacity-10 pointer-events-none">
              <div
                className="w-full h-full"
                style={{
                  backgroundImage: `linear-gradient(${accentColor} 1px, transparent 1px), linear-gradient(90deg, ${accentColor} 1px, transparent 1px)`,
                  backgroundSize: "40px 40px",
                }}
              />
            </div>

            {/* Floating Metadata Badges */}
            {stats && (
              <>
                {/* Mobile Info Toggle */}
                <button
                  onClick={() => setShowMobileInfo(!showMobileInfo)}
                  className="sm:hidden absolute top-4 left-4 z-20 w-8 h-8 rounded-full bg-tech-bg/80 backdrop-blur-md border border-tech-border flex items-center justify-center text-tech-muted hover:text-tech-fg shadow-lg"
                >
                  <Info className="w-4 h-4" />
                </button>

                <div className={`absolute top-14 sm:top-4 left-4 z-10 flex-col gap-2 pointer-events-none fade-in animate-in duration-500 ${showMobileInfo ? 'flex' : 'hidden sm:flex'}`}>
                  <div className="bg-tech-bg/80 backdrop-blur-md border border-tech-border rounded-lg px-3 py-2 shadow-[0_8px_30px_rgb(0,0,0,0.12)] flex flex-col gap-1.5">
                    <span className="text-[10px] text-tech-muted uppercase font-semibold tracking-wider">Mesh Metrics</span>
                    <div className="flex items-center justify-between gap-6 text-xs font-mono">
                      <span className="text-tech-fg">Faces</span>
                      <span className="text-primary font-medium">{stats.faces}</span>
                    </div>
                    <div className="flex items-center justify-between gap-6 text-xs font-mono">
                      <span className="text-tech-fg">Vertices</span>
                      <span className="text-primary font-medium">{stats.vertices}</span>
                    </div>
                  </div>
                  <div className="bg-tech-bg/80 backdrop-blur-md border border-tech-border rounded-lg px-3 py-2 shadow-[0_8px_30px_rgb(0,0,0,0.12)]">
                    <span className="text-[10px] text-tech-muted uppercase font-semibold tracking-wider block mb-1">Geometry Trace</span>
                    <span className="text-xs font-mono text-primary font-medium">{stats.type}</span>
                  </div>
                </div>
              </>
            )}



            {/* model-viewer */}
            {/* @ts-expect-error — model-viewer is a custom element registered by the CDN script */}
            <model-viewer
              ref={viewerRef}
              src={src}
              alt={title}
              camera-controls
              auto-rotate
              shadow-intensity="1"
              exposure="1"
              style={{
                width: "100%",
                height: "100%",
                background: "transparent",
                cursor: decalMode ? "crosshair" : "default",
              }}
            />
            {transitionSnapshot && (
              <img
                src={transitionSnapshot}
                alt="Transition Snapshot"
                className={`absolute inset-0 w-full h-full pointer-events-none transition-opacity duration-300 z-20 ${
                  isFading ? "opacity-0" : "opacity-100"
                }`}
                onTransitionEnd={() => {
                  setTransitionSnapshot(null);
                }}
              />
            )}
          </>
        ) : (
          /* Not available placeholder */
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6"
            style={{
              backgroundImage: `linear-gradient(oklch(0.5 0.05 200 / 0.08) 1px, transparent 1px), linear-gradient(90deg, oklch(0.5 0.05 200 / 0.08) 1px, transparent 1px)`,
              backgroundSize: "40px 40px",
            }}
          >
            <AlertTriangle className="w-8 h-8 text-yellow-500/70" />
            <div>
              <p className="text-sm font-medium text-tech-fg">Not Available</p>
              <p className="text-xs text-tech-muted mt-1 max-w-xs">
                {unavailableReason ?? "This file was not generated during the pipeline run."}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface JobStatus {
  status: string;
  model_path: string | null;
  raw_model_path: string | null;
  raw_stats?: { faces: number; vertices: number } | null;
  refined_stats?: { faces: number; vertices: number } | null;
  input_type: "image" | null;
  input_value: string | null;
}

interface ReviewStageProps {
  jobId: string;
}

export function ReviewStage({ jobId }: ReviewStageProps) {
  const { user } = useAuth();
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const viewerRef = useRef<ModelViewerElement | null>(null);
  const apiBase = import.meta.env.VITE_API_URL || "";

  // ── Review Modal State ───────────────────────────────────────────────
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [hasDismissedReview, setHasDismissedReview] = useState(false);
  const [showHighlightTip, setShowHighlightTip] = useState(false);
  const [hasReviewed, setHasReviewed] = useState(false);

  // ── Editable Object Name State ──────────────────────────────────────
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState("");

  useEffect(() => {
    if (!jobId) return;

    let active = true;
    let timer: NodeJS.Timeout;

    // Reset states
    setShowReviewModal(false);
    setHasDismissedReview(false);
    setShowHighlightTip(false);
    setHasReviewed(false);

    // Check if review already exists in Supabase
    supabase
      .from("reviews")
      .select("id")
      .eq("creation_id", jobId)
      .limit(1)
      .then(({ data, error }) => {
        if (!active) return;
        if (!error && data && data.length > 0) {
          setHasReviewed(true);
          setHasDismissedReview(true); // show the floating button
        } else {
          // Delay the popup by 5 seconds so user can see their model first
          timer = setTimeout(() => {
            if (active) setShowReviewModal(true);
          }, 5000);
        }
      });

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  const handleDismissReview = useCallback(() => {
    setShowReviewModal(false);
    setHasDismissedReview(true);
    setShowHighlightTip(true);
    setTimeout(() => {
      setShowHighlightTip(false);
    }, 5000);
  }, []);

  const handleCloseReview = useCallback(() => {
    setShowReviewModal(false);
    setHasDismissedReview(true); // Leave the feedback button visible
    setHasReviewed(true); // Mark as reviewed
  }, []);

  const handleSaveName = async () => {
    if (!tempName.trim()) return;
    const cleanName = tempName.trim();
    
    // Update local state first
    setJobStatus(prev => prev ? { ...prev, object_label: cleanName } : null);
    setIsEditingName(false);

    // Update in Supabase
    try {
      await supabase
        .from("creations")
        .update({ object_label: cleanName })
        .eq("id", jobId);
    } catch (err) {
      console.error("Error updating object label in database:", err);
    }

    // Update in-memory job status on backend so that poll returns the updated label
    try {
      await fetch(`${apiBase}/api/rename/${jobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: cleanName }),
      });
    } catch (err) {
      console.error("Error updating label in backend memory:", err);
    }
  };

  // ── Decal Studio State (lifted from MaterialEditPanel to ReviewStage) ───────
  const [activeStudioTab, setActiveStudioTab] = useState<"colorChanger" | "meshSettings" | "decalPlacer">("colorChanger");
  const [isStampingEnabled, setIsStampingEnabled] = useState(true);
  const [activeDecalConfig, setActiveDecalConfig] = useState<ActiveDecalConfig | null>(null);
  const [confirmedDecals, setConfirmedDecals] = useState<ConfirmedDecal[]>([]);
  // Ghost preview decal mesh ref
  const ghostDecalRef = useRef<any>(null);
  // rAF throttle for pointermove raycasting
  const rafPendingRef = useRef<boolean>(false);

  useEffect(() => {
    fetch(`${apiBase}/api/status/${jobId}`)
      .then((r) => r.json())
      .then((data) => setJobStatus(data))
      .catch(() => {});
  }, [jobId, apiBase]);

  const hasRaw = Boolean(jobStatus?.raw_model_path);
  const hasRefined = Boolean(jobStatus?.model_path);

  // ── Decal helpers ────────────────────────────────────────────────────

  /** Get the internal Three.js scene from model-viewer */
  const getScene = useCallback(() => {
    const el = viewerRef.current;
    if (!el) return null;
    const symbols = Object.getOwnPropertySymbols(el);
    const sym = symbols.find((s) => s.description === "scene");
    if (!sym) return null;
    return (el as any)[sym] as any;
  }, []);

  /** Hit-test using model-viewer's public positionAndNormalFromPoint() API.
   *  Returns { position: {x,y,z}, normal: {x,y,z} } or null if no surface hit. */
  const hitTestAt = useCallback((clientX: number, clientY: number) => {
    const el = viewerRef.current as any;
    if (!el) return null;
    // model-viewer v3/v4 public API
    if (typeof el.positionAndNormalFromPoint !== "function") {
      console.warn("model-viewer.positionAndNormalFromPoint not available");
      return null;
    }
    const result = el.positionAndNormalFromPoint(clientX, clientY);
    if (!result) return null;
    return result; // { position: Vector3D, normal: Vector3D }
  }, []);

  /** Build a DecalGeometry sticker mesh wrapped to the surface. */
  const buildStickerMesh = useCallback(async (
    position: { x: number; y: number; z: number },
    normal: { x: number; y: number; z: number },
    texture: any,
    scale: number,
    rotationDeg: number,
    opacity: number,
    isGhost: boolean,
  ) => {
    try {
      const {
        Mesh, MeshBasicMaterial, Vector3, Euler, Object3D, Raycaster, PlaneGeometry, DoubleSide
      } = await import("three");

      const pos = new Vector3(position.x, position.y, position.z);
      const nrm = new Vector3(normal.x, normal.y, normal.z).normalize();

      const scene = getScene();
      if (!scene) return null;

      // IMPORTANT: model-viewer's positionAndNormalFromPoint returns coordinates in MODEL space
      // (independent of its auto-scaling/centering). DecalGeometry and Raycaster need WORLD space.
      if (scene.target && scene.target.matrixWorld) {
        pos.applyMatrix4(scene.target.matrixWorld);
        nrm.transformDirection(scene.target.matrixWorld).normalize();
      }

      // We need to find the specific Mesh that was clicked.
      const rayOrigin = pos.clone().add(nrm.clone().multiplyScalar(0.01));
      const rayDirection = nrm.clone().multiplyScalar(-1);
      const raycaster = new Raycaster(rayOrigin, rayDirection);

      const meshes: any[] = [];
      scene.traverse((child: any) => {
        if (child.isMesh && !child.userData._isDecal) {
          meshes.push(child);
        }
      });

      const intersects = raycaster.intersectObjects(meshes, false);
      if (intersects.length === 0 && meshes.length === 0) return null;
      
      const targetMesh = intersects.length > 0 ? intersects[0].object : meshes[0];

      // Calculate orientation for the decal
      const dummy = new Object3D();
      dummy.position.copy(pos);
      if (Math.abs(nrm.y) > 0.99) {
        dummy.up.set(0, 0, 1);
      } else {
        dummy.up.set(0, 1, 0);
      }
      dummy.lookAt(pos.clone().add(nrm));
      dummy.rotateZ((rotationDeg * Math.PI) / 180);
      const orientation = new Euler().copy(dummy.rotation);

      // Aspect ratio from texture metadata
      const aspect = texture._aspectRatio ?? 1;
      const w = scale * 0.12;
      const h = w / aspect;

      const mat = new MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: isGhost ? Math.min(opacity, 0.5) : opacity,
        depthTest: true,
        depthWrite: false,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -10,
        polygonOffsetUnits: -10,
      });

      const depth = Math.max(w, h) * 0.1; // Reduced depth to prevent punching through meshes
      const size = new Vector3(w, h, depth);
      
      let mesh: any;

      if (isGhost) {
        // Idea A: Flat plane preview for 60fps performance while hovering
        const planeGeom = new PlaneGeometry(w, h);
        
        // Nudge slightly outward along the normal to avoid Z-fighting
        dummy.position.add(nrm.clone().multiplyScalar(0.005));
        dummy.updateMatrix();
        
        // Apply dummy's world transform
        planeGeom.applyMatrix4(dummy.matrix);
        
        // Inverse transform to local space so it tracks correctly if targetMesh is animated
        planeGeom.applyMatrix4(targetMesh.matrixWorld.clone().invert());

        mat.depthWrite = false;
        mesh = new Mesh(planeGeom, mat);
        targetMesh.add(mesh);
      } else {
        // High quality path for placed stickers: perfectly wrap the geometry
        const { DecalGeometry } = await import("three/examples/jsm/geometries/DecalGeometry.js");
        const decalGeom = new DecalGeometry(targetMesh, pos, orientation, size);
        
        // DecalGeometry is generated in world space. Inverse transform it so we can parent it directly to targetMesh.
        decalGeom.applyMatrix4(targetMesh.matrixWorld.clone().invert());

        const finalMat = mat.clone();
        if (texture.image) {
          const canvas = document.createElement("canvas");
          canvas.width = texture.image.width;
          canvas.height = texture.image.height;
          const ctx = canvas.getContext("2d");
          if (ctx) ctx.drawImage(texture.image, 0, 0);
          const { CanvasTexture } = await import("three");
          const newTex = new CanvasTexture(canvas);
          newTex.needsUpdate = true;
          finalMat.map = newTex;
        }

        mesh = new Mesh(decalGeom, finalMat);
        targetMesh.add(mesh);
      }

      mesh.userData._isDecal = true;
      mesh.userData._isGhost = isGhost;
      mesh.renderOrder = 999; // Render on top
      mesh.raycast = () => null; // Disable raycasting completely for sticker meshes
      mesh.frustumCulled = false; // Prevent model-viewer from aggressively culling it at angles
      return mesh;
    } catch (e) {
      console.warn("Sticker mesh build failed:", e);
      return null;
    }
  }, [getScene]);


  /** Dispose and remove a mesh from the scene */
  const disposeMesh = useCallback((mesh: any) => {
    if (!mesh) return;
    mesh.geometry?.dispose();
    mesh.material?.dispose();
    if (mesh.parent) mesh.parent.remove(mesh);
  }, []);

  const ghostGenerationRef = useRef<number>(0);

  // Removed legacy handleOverlayPointerMove since it's now handled by the native event listener


  /** Confirm sticker placement on click */
  const placeStickerAt = useCallback(async (clientX: number, clientY: number) => {
    if (!activeDecalConfig?.texture) return;
    
    // Hide ghost BEFORE hit test so it doesn't intercept
    if (ghostDecalRef.current) {
      ghostDecalRef.current.visible = false;
    }
    
    const result = hitTestAt(clientX, clientY);
    if (!result) return;
    const scene = getScene();
    if (!scene) return;
    
    // Fully remove ghost
    if (ghostDecalRef.current) {
      disposeMesh(ghostDecalRef.current);
      ghostDecalRef.current = null;
    }
    // Build confirmed sticker
    const mesh = await buildStickerMesh(
      result.position,
      result.normal,
      activeDecalConfig.texture,
      activeDecalConfig.scale,
      activeDecalConfig.rotation,
      activeDecalConfig.opacity,
      false,
    );
    if (!mesh) return;
    const el = viewerRef.current;
    if (el) {
      if (typeof el.queueRender === "function") el.queueRender();
      // Force WebGL redraw
      el.dispatchEvent(new CustomEvent("camera-change"));
      const orig = el.exposure;
      el.exposure = orig + 0.0001;
      setTimeout(() => { if (el.exposure === orig + 0.0001) el.exposure = orig; }, 16);
    }
    const newDecal: ConfirmedDecal = {
      id: Math.random().toString(36).slice(2),
      label: activeDecalConfig.label,
      visible: true,
      mesh,
    };
    setConfirmedDecals((prev) => [...prev, newDecal]);
  }, [activeDecalConfig, hitTestAt, getScene, buildStickerMesh, disposeMesh]);

  // Clean up ghost decal when leaving decal tab
  useEffect(() => {
    if (activeStudioTab !== "decalPlacer" && ghostDecalRef.current) {
      disposeMesh(ghostDecalRef.current);
      ghostDecalRef.current = null;
    }
  }, [activeStudioTab, disposeMesh]);

  // Native event listeners on model-viewer for "Drag to Orbit, Click to Place"
  useEffect(() => {
    const el = viewerRef.current;
    if (!el || activeStudioTab !== "decalPlacer" || !activeDecalConfig?.texture || !isStampingEnabled) {
      if (ghostDecalRef.current) {
        disposeMesh(ghostDecalRef.current);
        ghostDecalRef.current = null;
      }
      return;
    }

    let startX = 0;
    let startY = 0;
    let isDragging = false;
    let isPointerDown = false;

    const onPointerDown = (e: PointerEvent) => {
      startX = e.clientX;
      startY = e.clientY;
      isDragging = false;
      isPointerDown = true;
    };

    const onPointerMove = (e: PointerEvent) => {
      // Check if they are dragging vs just hovering
      if (isPointerDown) {
        if (Math.abs(e.clientX - startX) > 3 || Math.abs(e.clientY - startY) > 3) {
          isDragging = true;
        }
      }

      // We still update the ghost preview while moving or dragging
      if (rafPendingRef.current) return;
      const clientX = e.clientX;
      const clientY = e.clientY;
      rafPendingRef.current = true;
      requestAnimationFrame(async () => {
        rafPendingRef.current = false;
        
        // DO NOT hide the old ghost here, otherwise it flickers during the async buildStickerMesh
        const result = hitTestAt(clientX, clientY);
        const scene = getScene();
        if (!scene) return;
        
        if (!result) return;
        
        const currentGeneration = ++ghostGenerationRef.current;
        
        const mesh = await buildStickerMesh(
          result.position,
          result.normal,
          activeDecalConfig.texture,
          activeDecalConfig.scale,
          activeDecalConfig.rotation,
          activeDecalConfig.opacity,
          true,
        );
        
        if (currentGeneration !== ghostGenerationRef.current) {
          disposeMesh(mesh);
          return;
        }
        
        // NOW we can safely dispose the old ghost and swap in the new one
        if (ghostDecalRef.current) {
          disposeMesh(ghostDecalRef.current);
          ghostDecalRef.current = null;
        }

        if (mesh) {
          ghostDecalRef.current = mesh;
          const viewerEl = viewerRef.current;
          if (viewerEl) {
            if (typeof viewerEl.queueRender === "function") viewerEl.queueRender();
            viewerEl.dispatchEvent(new CustomEvent("camera-change"));
            const orig = viewerEl.exposure;
            viewerEl.exposure = orig + 0.0001;
            setTimeout(() => { if (viewerEl.exposure === orig + 0.0001) viewerEl.exposure = orig; }, 16);
          }
        }
      });
    };

    const onPointerUp = (e: PointerEvent) => {
      isPointerDown = false;
      if (!isDragging) {
        // Quick click -> Place sticker!
        placeStickerAt(e.clientX, e.clientY);
      }
      isDragging = false;
    };

    const onWheel = (e: WheelEvent) => {
      // Only rotate sticker if hovering over the model, otherwise let model-viewer zoom
      const hit = hitTestAt(e.clientX, e.clientY);
      if (hit) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        const delta = e.deltaY > 0 ? 15 : -15;
        el.dispatchEvent(new CustomEvent("decal-rotate", { detail: { delta } }));
        
        // Force an immediate re-render of the ghost sticker with the new rotation
        const cx = e.clientX;
        const cy = e.clientY;
        setTimeout(() => {
          if (viewerRef.current) {
            viewerRef.current.dispatchEvent(new PointerEvent("pointermove", { clientX: cx, clientY: cy, bubbles: true }));
          }
        }, 50);
      }
    };

    // Attach listeners. Removing passive flags to prevent Safari listener cleanup bugs
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("wheel", onWheel, { passive: false, capture: true });

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("wheel", onWheel, { capture: true });
    };
  }, [activeStudioTab, activeDecalConfig, isStampingEnabled, hitTestAt, getScene, buildStickerMesh, disposeMesh, placeStickerAt]);

  // Decal callbacks for MaterialEditPanel UI
  const decalCallbacks: DecalCallbacks = {
    onActiveConfigChange: (cfg) => setActiveDecalConfig(cfg),
    onConfirm: () => { /* placement is handled by click */ },
    onUndo: () => {
      setConfirmedDecals((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        disposeMesh(last.mesh);
        const el = viewerRef.current;
        if (el && typeof el.queueRender === "function") el.queueRender();
        return prev.slice(0, -1);
      });
    },
    onClearAll: () => {
      setConfirmedDecals((prev) => {
        prev.forEach((d) => disposeMesh(d.mesh));
        const el = viewerRef.current;
        if (el && typeof el.queueRender === "function") el.queueRender();
        return [];
      });
    },
    onToggleDecalVisibility: (id) => {
      setConfirmedDecals((prev) =>
        prev.map((d) => {
          if (d.id !== id) return d;
          if (d.mesh) d.mesh.visible = !d.visible;
          const el = viewerRef.current;
          if (el && typeof el.queueRender === "function") el.queueRender();
          return { ...d, visible: !d.visible };
        })
      );
    },
    onRemoveDecal: (id) => {
      setConfirmedDecals((prev) => {
        const target = prev.find((d) => d.id === id);
        if (target) {
          disposeMesh(target.mesh);
          const el = viewerRef.current;
          if (el && typeof el.queueRender === "function") el.queueRender();
        }
        return prev.filter((d) => d.id !== id);
      });
    },
  };

  const formatNumber = (num: number | undefined) => {
    if (num === undefined || num === null || num === 0) return "N/A";
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + "k";
    }
    return num.toString();
  };

  const rawFaces = formatNumber(jobStatus?.raw_stats?.faces);
  const rawVertices = formatNumber(jobStatus?.raw_stats?.vertices);
  const refinedFaces = formatNumber(jobStatus?.refined_stats?.faces);
  const refinedVertices = formatNumber(jobStatus?.refined_stats?.vertices);



  return (
    <div className="min-h-[calc(100vh-3rem)] pt-0 pb-4 px-4 md:px-8">
      <div className="max-w-[1800px] mx-auto h-[calc(100vh-5rem)] flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center justify-between shrink-0 mb-1">
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <h2 className="text-base md:text-lg font-bold text-foreground">Generation Complete:</h2>
              {isEditingName ? (
                <div className="flex items-center gap-1.5 mt-1 sm:mt-0">
                  <input
                    type="text"
                    value={tempName}
                    onChange={(e) => setTempName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveName();
                      else if (e.key === "Escape") setIsEditingName(false);
                    }}
                    className="bg-black/60 border border-primary/30 rounded px-2.5 py-1 text-xs text-white font-mono focus:outline-none focus:border-primary/60 w-48"
                    autoFocus
                  />
                  <Button
                    onClick={handleSaveName}
                    className="h-7 px-2.5 text-[10px] bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 font-mono"
                  >
                    Save
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setIsEditingName(false)}
                    className="h-7 px-2.5 text-[10px] text-tech-muted hover:text-white font-mono hover:bg-white/5"
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2 group">
                  <span className="text-lg font-bold text-primary font-mono select-none">
                    {jobStatus?.object_label || "Generated Model"}
                  </span>
                  <button
                    onClick={() => {
                      setTempName(jobStatus?.object_label || "Generated Model");
                      setIsEditingName(true);
                    }}
                    className="p-1 rounded hover:bg-white/5 text-tech-muted hover:text-white transition-colors"
                    title="Rename Creation"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5 font-mono mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              Pipeline finished — 3D Reconstruction verified and refined.
            </p>
          </div>
        </div>

        {/* 3-Panel Row */}
        <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">

          {/* Panel 1: Source Input */}
          <div className="flex-shrink-0 lg:w-[240px] bg-tech-bg/40 backdrop-blur-md rounded-2xl border border-tech-border flex flex-col overflow-hidden shadow-xl">
            <div className="px-4 py-3 border-b border-tech-border bg-black/10">
              <span className="font-mono text-xs text-tech-fg font-bold uppercase tracking-widest">
                Source Input
              </span>
            </div>
            <div className="flex-1 flex flex-col items-center justify-center p-6 bg-grid-pattern overflow-y-auto">
              {jobStatus?.input_type === "image" ? (
                <div className="w-full flex flex-col gap-4">
                  <div className="relative group rounded-xl overflow-hidden border border-white/5 shadow-2xl">
                    <img
                      src={`${apiBase}/api/inputs/${jobId}`}
                      alt="Original Input"
                      className="w-full h-auto object-contain max-h-[300px]"
                    />
                    <div className="absolute inset-0 bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <div className="bg-black/20 rounded-lg p-3 border border-white/5">
                    <p className="text-[10px] uppercase text-tech-muted font-bold tracking-tighter mb-1">Method</p>
                    <p className="text-xs font-mono text-primary">Image-to-Model Engine</p>
                  </div>
                </div>
              ) : (
                <div className="animate-pulse text-tech-muted text-xs font-mono italic">Loading sequence...</div>
              )}
            </div>
          </div>

          {/* Panel 2: 3D Viewer */}
          <LocalErrorBoundary fallbackTitle="3D Viewport Error">
            <div className="relative flex-1 min-w-0 min-h-[50vh] lg:min-h-0 flex flex-col">
              <ModelViewerPanel
                title="Generated 3D Model"
                subtitle="model_raw.glb • Textures & Mesh"
                src={`${apiBase}/api/download-raw/${jobId}`}
                refinedSrc={`${apiBase}/api/download/${jobId}`}
                filename={jobStatus?.object_label ? `${jobStatus.object_label.toLowerCase().replace(/\s+/g, '_')}_raw.glb` : "model_raw.glb"}
                refinedFilename={jobStatus?.object_label ? `${jobStatus.object_label.toLowerCase().replace(/\s+/g, '_')}_refined.glb` : "model_refined.glb"}
                available={hasRaw}
                refinedAvailable={hasRefined}
                accentColor="oklch(0.65 0.18 30 / 0.8)"
                stats={{ faces: rawFaces, vertices: rawVertices, type: "PBR Asset" }}
                viewerRef={viewerRef}
                decalMode={activeStudioTab === "decalPlacer" && isStampingEnabled}
              />
              {/* The blocking overlay div was removed to allow native orbit controls.
                  The logic is now handled by native pointer events on viewerRef.current. */}
              {/* Floating sticker placement toggle & badge */}
              {activeStudioTab === "decalPlacer" && activeDecalConfig?.texture && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2 animate-in fade-in duration-300">
                  {/* Mode Toggle */}
                  <div className="flex bg-black/70 backdrop-blur-md border border-white/10 rounded-full p-1 shadow-lg pointer-events-auto">
                    <button
                      onClick={() => setIsStampingEnabled(false)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-mono font-semibold transition-all ${
                        !isStampingEnabled ? "bg-primary text-primary-foreground" : "text-tech-muted hover:text-tech-fg"
                      }`}
                    >
                      <Move className="w-3.5 h-3.5" />
                      Move
                    </button>
                    <button
                      onClick={() => setIsStampingEnabled(true)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-mono font-semibold transition-all ${
                        isStampingEnabled ? "bg-primary text-primary-foreground" : "text-tech-muted hover:text-tech-fg"
                      }`}
                    >
                      <Stamp className="w-3.5 h-3.5" />
                      Stamp
                    </button>
                  </div>
                  
                  {/* Status Badge */}
                  <div className="pointer-events-none flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-sm border border-white/5">
                    <span className="text-[9px] font-mono text-white/70">
                      {isStampingEnabled ? "Click on model to place sticker" : "Drag to orbit camera"}
                    </span>
                  </div>
                </div>
              )}

              {/* Floating "Leave your feedback :D" button & tooltip */}
              {(hasDismissedReview || hasReviewed) && (
                <div className="absolute bottom-4 right-4 z-30 flex flex-col items-end gap-2 animate-in fade-in duration-300">
                  {/* Glowing/fading tooltip (only if not reviewed yet) */}
                  {showHighlightTip && !hasReviewed && (
                    <div className="animate-tooltip-glow bg-primary/10 border border-primary/30 text-primary px-3.5 py-2 rounded-xl text-[10px] font-mono font-semibold shadow-lg select-none relative after:content-[''] after:absolute after:top-full after:right-6 after:border-4 after:border-transparent after:border-t-primary/30">
                      please do consider leaving a review when you're done :)
                    </div>
                  )}
                  
                  {/* Floating button */}
                  <button
                    onClick={() => {
                      setShowReviewModal(true);
                      setShowHighlightTip(false);
                    }}
                    className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[10px] font-mono font-bold transition-all shadow-lg ${
                      showHighlightTip && !hasReviewed
                        ? "bg-primary border border-primary/50 text-primary-foreground animate-button-glow scale-105" 
                        : "bg-black/85 hover:bg-black border border-white/10 hover:border-primary/40 text-tech-fg shadow-black/50 hover:scale-105 active:scale-95"
                    }`}
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-primary" />
                    <span>Leave your feedback :D</span>
                  </button>
                </div>
              )}
            </div>
            
            {/* Modal Overlay Review Form */}
            {showReviewModal && (
              <ReviewAndDisplayForm
                creationId={jobId}
                user={user}
                onClose={handleCloseReview}
                onDismiss={handleDismissReview}
              />
            )}
          </LocalErrorBoundary>

          {/* Panel 3: Material Studio */}
          <div className="flex-shrink-0 lg:w-[300px] min-h-0">
            <LocalErrorBoundary fallbackTitle="Material Studio Error">
              <MaterialEditPanel
                viewerRef={viewerRef}
                decalCallbacks={decalCallbacks}
                confirmedDecals={confirmedDecals}
                activeDecalConfig={activeDecalConfig ?? undefined}
                onActiveDecalConfigChange={(cfg) => {
                  setActiveDecalConfig(cfg);
                  // Removed setActiveStudioTab("decalPlacer") to fix race condition tab sync bug!
                }}
                onTabChange={(tab) => setActiveStudioTab(tab)}
              />
            </LocalErrorBoundary>
          </div>


        </div>
      </div>
    </div>
  );
}
