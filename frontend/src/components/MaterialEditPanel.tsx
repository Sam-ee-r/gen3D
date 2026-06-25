import { useState, useCallback, useEffect, useRef } from "react";
import {
  Pipette,
  RotateCcw,
  Download,
  Layers,
  ChevronRight,
  Sparkles,
  Paintbrush,
  Sliders,
  Eye,
  EyeOff,
  Trash2,
  Plus,
  Minus,
  Stamp,
  Type,
  Image as ImageIcon,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ModelViewerMaterial, ModelViewerElement } from "../model-viewer.d.ts";

// ──────────────────────────────────────────────────────────────────────────────
// Types & Interfaces
// ──────────────────────────────────────────────────────────────────────────────

export interface PickResult {
  material: ModelViewerMaterial | null;
  threeMesh: any | null;
  color: [number, number, number]; // [r, g, b] (0-255)
  hexColor: string; // "#rrggbb"
  uv: [number, number] | null;
  hasTexture: boolean;
  hasVertexColor: boolean;
}

export interface ColorSwapLayer {
  id: string;
  meshUuid: string;
  targetColor: [number, number, number];
  hexTargetColor: string;
  replacementColor: string;
  tolerance: number;
  preserveShading: boolean;
  visible: boolean;
}

export interface MaterialEdit {
  color: string; // hex
  roughness: number;
  metallic: number;
  emissive: string;
  emissiveOn: boolean;
}

interface OriginalValues {
  color: [number, number, number, number];
  roughness: number;
  metallic: number;
  emissive: [number, number, number];
}

// ── Decal / Sticker Types ────────────────────────────────────────────────────

// Removed DecalMode as only text stickers are supported

export interface ActiveDecalConfig {
  texture: any | null; // THREE.Texture (kept as any to avoid importing Three here)
  scale: number;
  rotation: number;
  opacity: number;
  label: string;
}

export interface ConfirmedDecal {
  id: string;
  label: string;
  visible: boolean;
  mesh: any | null; // THREE.Mesh reference for cleanup
}

export interface DecalCallbacks {
  onActiveConfigChange: (cfg: ActiveDecalConfig) => void;
  onConfirm: () => void;
  onUndo: () => void;
  onClearAll: () => void;
  onToggleDecalVisibility: (id: string) => void;
  onRemoveDecal: (id: string) => void;
}


// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function rgbaToHex(rgba: number[]): string {
  const r = Math.round((rgba[0] ?? 0) * 255)
    .toString(16)
    .padStart(2, "0");
  const g = Math.round((rgba[1] ?? 0) * 255)
    .toString(16)
    .padStart(2, "0");
  const b = Math.round((rgba[2] ?? 0) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${r}${g}${b}`;
}

function hexToRgba(hex: string, alpha = 1): [number, number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b, alpha];
}

function hexToRgb(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgba(hex);
  return [r, g, b];
}

const copyCanvas = (src: HTMLCanvasElement): HTMLCanvasElement => {
  const dest = document.createElement("canvas");
  dest.width = src.width;
  dest.height = src.height;
  const ctx = dest.getContext("2d");
  if (ctx) {
    ctx.drawImage(src, 0, 0);
  }
  return dest;
};

// ──────────────────────────────────────────────────────────────────────────────
// Core Image Manipulation Functions
// ──────────────────────────────────────────────────────────────────────────────

function replaceColorInCanvas(
  sourceCanvas: HTMLCanvasElement,
  targetCanvas: HTMLCanvasElement,
  targetColorRgb: [number, number, number],
  replacementColorRgb: [number, number, number],
  tolerance: number,
  preserveShading: boolean
) {
  const sCtx = sourceCanvas.getContext("2d");
  const tCtx = targetCanvas.getContext("2d");
  if (!sCtx || !tCtx) return;

  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const imgData = sCtx.getImageData(0, 0, width, height);
  const data = imgData.data;

  const [tr, tg, tb] = targetColorRgb;
  const [rr, rg, rb] = replacementColorRgb;
  const tolSq = tolerance * tolerance;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    if (a < 10) continue; // Skip fully transparent areas

    const dr = r - tr;
    const dg = g - tg;
    const db = b - tb;
    const distSq = dr * dr + dg * dg + db * db;

    if (distSq <= tolSq) {
      if (preserveShading) {
        // Luminosity-based shading preservation
        const targetLum = (tr * 0.299 + tg * 0.587 + tb * 0.114) || 1;
        const pixelLum = (r * 0.299 + g * 0.587 + b * 0.114);
        const ratio = pixelLum / targetLum;
        const clampedRatio = Math.max(0.2, Math.min(2.5, ratio));

        data[i] = Math.min(255, Math.round(rr * clampedRatio));
        data[i + 1] = Math.min(255, Math.round(rg * clampedRatio));
        data[i + 2] = Math.min(255, Math.round(rb * clampedRatio));
      } else {
        data[i] = rr;
        data[i + 1] = rg;
        data[i + 2] = rb;
      }
    } else {
      // Keep original from source canvas
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
  }

  tCtx.putImageData(imgData, 0, 0);
}

function replaceColorInVertices(
  sourceColors: Float32Array,
  targetArray: Float32Array,
  targetColorRgb: [number, number, number],
  replacementColorRgb: [number, number, number],
  tolerance: number,
  preserveShading: boolean
) {
  const [tr, tg, tb] = targetColorRgb;
  const [rr, rg, rb] = replacementColorRgb;
  const tolSq = tolerance * tolerance;

  for (let i = 0; i < sourceColors.length; i += 3) {
    const r = Math.round(sourceColors[i] * 255);
    const g = Math.round(sourceColors[i + 1] * 255);
    const b = Math.round(sourceColors[i + 2] * 255);

    const dr = r - tr;
    const dg = g - tg;
    const db = b - tb;
    const distSq = dr * dr + dg * dg + db * db;

    if (distSq <= tolSq) {
      if (preserveShading) {
        const targetLum = (tr * 0.299 + tg * 0.587 + tb * 0.114) || 1;
        const pixelLum = (r * 0.299 + g * 0.587 + b * 0.114);
        const ratio = pixelLum / targetLum;
        const clampedRatio = Math.max(0.2, Math.min(2.5, ratio));

        targetArray[i] = Math.min(1.0, (rr * clampedRatio) / 255);
        targetArray[i + 1] = Math.min(1.0, (rg * clampedRatio) / 255);
        targetArray[i + 2] = Math.min(1.0, (rb * clampedRatio) / 255);
      } else {
        targetArray[i] = rr / 255;
        targetArray[i + 1] = rg / 255;
        targetArray[i + 2] = rb / 255;
      }
    } else {
      // Keep original from source array
      targetArray[i] = sourceColors[i];
      targetArray[i + 1] = sourceColors[i + 1];
      targetArray[i + 2] = sourceColors[i + 2];
    }
  }
}

// ── Sticker Presets ─────────────────────────────────────────────────────────
// SVG data-URIs for built-in sticker presets
const STICKER_PRESETS = [
  {
    label: "Star",
    emoji: "⭐",
    svg: `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><polygon points='50,5 61,35 95,35 68,57 79,91 50,70 21,91 32,57 5,35 39,35' fill='%23FFD700' stroke='%23FFA500' stroke-width='2'/></svg>`,
  },
  {
    label: "Circuit",
    emoji: "⚡",
    svg: `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect x='10' y='45' width='80' height='10' fill='%2300FFD1' rx='3'/><rect x='45' y='10' width='10' height='80' fill='%2300FFD1' rx='3'/><circle cx='50' cy='50' r='12' fill='%23001a14' stroke='%2300FFD1' stroke-width='3'/><circle cx='50' cy='50' r='4' fill='%2300FFD1'/><circle cx='25' cy='50' r='5' fill='%2300FFD1'/><circle cx='75' cy='50' r='5' fill='%2300FFD1'/><circle cx='50' cy='25' r='5' fill='%2300FFD1'/><circle cx='50' cy='75' r='5' fill='%2300FFD1'/></svg>`,
  },
  {
    label: "Shield",
    emoji: "🛡️",
    svg: `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><path d='M50 5 L90 20 L90 55 Q90 80 50 95 Q10 80 10 55 L10 20 Z' fill='%234F46E5' stroke='%237C3AED' stroke-width='2'/><path d='M50 20 L78 32 L78 53 Q78 70 50 80 Q22 70 22 53 L22 32 Z' fill='%236D28D9' opacity='0.5'/><text x='50' y='58' text-anchor='middle' font-size='30' fill='white'>✓</text></svg>`,
  },
  {
    label: "Flame",
    emoji: "🔥",
    svg: `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><path d='M50 5 C50 5 75 30 70 55 C65 70 80 65 75 80 C70 95 30 95 25 80 C20 65 35 70 30 55 C25 30 50 5 50 5 Z' fill='%23FF4500'/><path d='M50 25 C50 25 65 45 62 60 C60 70 68 67 65 75 C62 83 38 83 35 75 C32 67 40 70 38 60 C35 45 50 25 50 25 Z' fill='%23FF8C00'/><path d='M50 45 C50 45 58 57 56 65 C54 72 46 72 44 65 C42 57 50 45 50 45 Z' fill='%23FFD700'/></svg>`,
  },
] as const;

// ── Available text fonts ──────────────────────────────────────────────────────
const TEXT_FONTS = [
  { label: "Inter",       value: "Inter, sans-serif" },
  { label: "Orbitron",    value: "Orbitron, sans-serif" },
  { label: "Pacifico",    value: "Pacifico, cursive" },
  { label: "Bebas Neue",  value: "'Bebas Neue', sans-serif" },
  { label: "Space Mono",  value: "'Space Mono', monospace" },
] as const;

// ── PBR Material Presets ─────────────────────────────────────────────────────
const PRESETS = [
  { label: "Glossy Plastic", icon: "💎", metallic: 0.0, roughness: 0.08, emissive: false },
  { label: "Matte Rubber",   icon: "⚫", metallic: 0.0, roughness: 0.92, emissive: false },
  { label: "Chrome",         icon: "🪞", metallic: 1.0, roughness: 0.04, emissive: false },
  { label: "Brushed Metal",  icon: "🔩", metallic: 0.9, roughness: 0.42, emissive: false },
  { label: "Glow",           icon: "✨", metallic: 0.0, roughness: 0.5,  emissive: true  },
] as const;


// ──────────────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────────────

function StudioSlider({
  label,
  leftLabel,
  rightLabel,
  value,
  onChange,
  accentColor,
  min = 0,
  max = 1,
  step = 0.01,
}: {
  label: string;
  leftLabel: string;
  rightLabel: string;
  value: number;
  onChange: (v: number) => void;
  accentColor: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  const stepDecimalPlaces = step.toString().split(".")[1]?.length || 0;

  const handleDecrement = () => {
    const nextVal = Math.max(min, value - step);
    onChange(parseFloat(nextVal.toFixed(stepDecimalPlaces)));
  };

  const handleIncrement = () => {
    const nextVal = Math.min(max, value + step);
    onChange(parseFloat(nextVal.toFixed(stepDecimalPlaces)));
  };

  return (
    <div className="flex flex-col gap-1.5 animate-in fade-in duration-300">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-tech-muted uppercase tracking-widest">{label}</span>
        <span className="text-[10px] font-mono text-tech-fg tabular-nums">{value}</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleDecrement}
          className="studio-stepper-btn cursor-pointer select-none"
          title="Decrease"
        >
          <Minus className="w-2.5 h-2.5" />
        </button>
        
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          style={{ "--progress": `${pct}%`, "--accent": accentColor } as React.CSSProperties}
          className="studio-slider flex-1 h-5 bg-transparent appearance-none cursor-pointer outline-none"
        />
        
        <button
          type="button"
          onClick={handleIncrement}
          className="studio-stepper-btn cursor-pointer select-none"
          title="Increase"
        >
          <Plus className="w-2.5 h-2.5" />
        </button>
      </div>
      <div className="flex items-center justify-between text-[9px] font-mono text-tech-muted/60 px-7">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Main Component
// ──────────────────────────────────────────────────────────────────────────────

interface MaterialEditPanelProps {
  viewerRef: React.RefObject<ModelViewerElement | null>;
  // Decal callbacks provided by ReviewStage for 3D scene operations
  decalCallbacks?: DecalCallbacks;
  confirmedDecals?: ConfirmedDecal[];
  activeDecalConfig?: ActiveDecalConfig;
  onActiveDecalConfigChange?: (cfg: ActiveDecalConfig) => void;
  onTabChange?: (tab: "colorChanger" | "meshSettings" | "decalPlacer") => void;
}

export function MaterialEditPanel({
  viewerRef,
  decalCallbacks,
  confirmedDecals = [],
  activeDecalConfig,
  onActiveDecalConfigChange,
  onTabChange,
}: MaterialEditPanelProps) {
  // Tabs: "colorChanger" | "meshSettings" | "decalPlacer"
  const [activeStudioTab, setActiveStudioTabRaw] = useState<"colorChanger" | "meshSettings" | "decalPlacer">("colorChanger");
  const setActiveStudioTab = useCallback((tab: "colorChanger" | "meshSettings" | "decalPlacer") => {
    setActiveStudioTabRaw(tab);
    onTabChange?.(tab);
  }, [onTabChange]);

  // Selection states (for Tab 2: Mesh Settings)
  const [selectedMaterial, setSelectedMaterial] = useState<ModelViewerMaterial | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [originals, setOriginals] = useState<OriginalValues | null>(null);
  const [pbrEdits, setPbrEdits] = useState<MaterialEdit>({
    color: "#cccccc",
    roughness: 0.5,
    metallic: 0.0,
    emissive: "#000000",
    emissiveOn: false,
  });

  // Concept 1: The Recipe Stack color layers state
  const [layers, setLayers] = useState<ColorSwapLayer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [pickingColorForLayerId, setPickingColorForLayerId] = useState<string | null>(null);

  // Text sticker mode
  const [textContent, setTextContent] = useState<string>("HELLO");
  const [textFont, setTextFont] = useState<string>(TEXT_FONTS[0].value);
  const [textColor, setTextColor] = useState<string>("#ffffff");
  // Image sticker mode
  const [stickerMode, setStickerMode] = useState<"text" | "image">("text");
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [uploadedImageFile, setUploadedImageFile] = useState<File | null>(null);
  // Shared transform
  const [decalScale, setDecalScale] = useState<number>(1.0);
  const [decalRotation, setDecalRotation] = useState<number>(0);
  const [decalOpacity, setDecalOpacity] = useState<number>(1.0);
  // Canvas for text-to-texture
  const textCanvasRef = useRef<HTMLCanvasElement>(null);
  // THREE.Texture ref for the currently active decal texture
  const activeTextureRef = useRef<any>(null);

  // Original mesh asset backups (stored only once per mesh uuid)
  const meshBackups = useRef<Map<string, { type: "texture" | "vertex"; imageData?: HTMLCanvasElement; vertexColors?: Float32Array }>>(new Map());
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Sync tab state with parent
  const handleTabChange = useCallback((tab: "colorChanger" | "meshSettings" | "decalPlacer") => {
    setActiveStudioTab(tab);
    onTabChange?.(tab);
  }, [onTabChange]);

  const dispatchModelEdited = useCallback(() => {
    const el = viewerRef.current;
    if (el) {
      el.dispatchEvent(new CustomEvent("model-edited"));
    }
  }, [viewerRef]);

  const captureAndNotify = useCallback(() => {
    const el = viewerRef.current;
    if (!el) return;
    try {
      const snapshot = el.toDataURL();
      el.dispatchEvent(new CustomEvent("model-editing", { detail: { snapshot } }));
    } catch (e) {
      console.warn("Failed to capture transition snapshot:", e);
    }
  }, [viewerRef]);

  // ── Decal helpers ──────────────────────────────────────────────────────────

  /** Notify ReviewStage of the current active decal configuration (texture + transforms). */
  const notifyDecalConfig = useCallback((texture: any, label: string, scale?: number, rotation?: number, opacity?: number) => {
    const cfg: ActiveDecalConfig = {
      texture,
      scale: scale ?? decalScale,
      rotation: rotation ?? decalRotation,
      opacity: opacity ?? decalOpacity,
      label,
    };
    activeTextureRef.current = texture;
    onActiveDecalConfigChange?.(cfg);
  }, [decalScale, decalRotation, decalOpacity, onActiveDecalConfigChange]);

  /** Render the current text sticker to the hidden canvas and create/update its CanvasTexture. */
  const renderTextToTexture = useCallback(() => {
    const canvas = textCanvasRef.current;
    if (!canvas) return;
    const W = 1024;
    const H = 512;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Clear with fully transparent background
    ctx.clearRect(0, 0, W, H);
    // Draw text
    let fontSize = 160; // Locked to high-res for maximum quality; scaling handled by decalScale
    ctx.font = `bold ${fontSize}px ${textFont}`;
    
    // Scale down if text is too wide
    const metrics = ctx.measureText(textContent || " ");
    if (metrics.width > W - 80) {
      fontSize = Math.floor((W - 80) / metrics.width * fontSize);
      ctx.font = `bold ${fontSize}px ${textFont}`;
    }
    
    ctx.fillStyle = textColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(textContent || " ", W / 2, H / 2);

    // Create or update the THREE.CanvasTexture
    // Always create a new texture so WebGL buffer resizes correctly when switching between image and text modes
    import("three").then(({ CanvasTexture }) => {
      const tex = new CanvasTexture(canvas);
      (tex as any)._isCanvasTexture = true;
      (tex as any)._aspectRatio = W / H;
      notifyDecalConfig(tex, textContent || "Text", decalScale, decalRotation, decalOpacity);
    }).catch(() => {});
  }, [textContent, textFont, textColor, notifyDecalConfig, decalScale, decalRotation, decalOpacity]);

  /** Render the uploaded image to the hidden canvas and create/update its CanvasTexture. */
  const processImageToTexture = useCallback((imageUrl: string) => {
    const canvas = textCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      const maxDim = 256;
      let W = img.width;
      let H = img.height;
      
      if (W > maxDim || H > maxDim) {
        if (W > H) {
          H = Math.floor((H / W) * maxDim);
          W = maxDim;
        } else {
          W = Math.floor((W / H) * maxDim);
          H = maxDim;
        }
      }

      canvas.width = W;
      canvas.height = H;
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(img, 0, 0, W, H);

      import("three").then(({ CanvasTexture }) => {
        const tex = new CanvasTexture(canvas);
        (tex as any)._isCanvasTexture = true;
        (tex as any)._aspectRatio = W / H;
        notifyDecalConfig(tex, uploadedImageFile?.name || "Image", decalScale, decalRotation, decalOpacity);
      }).catch(() => {});
    };
    img.src = imageUrl;
  }, [notifyDecalConfig, decalScale, decalRotation, decalOpacity, uploadedImageFile]);

  // Re-render texture whenever inputs or modes change
  useEffect(() => {
    if (activeStudioTab === "decalPlacer") {
      if (stickerMode === "text") {
        renderTextToTexture();
      } else if (stickerMode === "image" && uploadedImage) {
        processImageToTexture(uploadedImage);
      }
    }
  }, [textContent, textFont, textColor, activeStudioTab, stickerMode, uploadedImage, renderTextToTexture, processImageToTexture]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Validate file type
    if (!["image/jpeg", "image/png"].includes(file.type)) {
      alert("Only PNG and JPEG images are supported.");
      return;
    }
    
    // Validate file size (10MB limit)
    if (file.size > 10 * 1024 * 1024) {
      alert("Image size exceeds 10MB limit.");
      return;
    }
    
    // If there was a previous image, revoke its URL to avoid memory leaks
    if (uploadedImage) {
      URL.revokeObjectURL(uploadedImage);
    }

    const url = URL.createObjectURL(file);
    setUploadedImageFile(file);
    setUploadedImage(url);
  }, [uploadedImage]);

  // Notify transform changes immediately so preview updates
  useEffect(() => {
    if (activeTextureRef.current && onActiveDecalConfigChange) {
      notifyDecalConfig(activeTextureRef.current, textContent || "Text", decalScale, decalRotation, decalOpacity);
    }
  }, [decalScale, decalRotation, decalOpacity]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen to custom decal-rotate events from ReviewStage for mouse wheel rotation
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    const onRotate = (e: any) => {
      setDecalRotation((prev) => {
        let next = prev + e.detail.delta;
        if (next > 180) next -= 360;
        if (next < -180) next += 360;
        return next;
      });
    };
    el.addEventListener("decal-rotate", onRotate);
    return () => el.removeEventListener("decal-rotate", onRotate);
  }, [viewerRef]);
  
  // Custom 3D eyedropper color picker listener
  useEffect(() => {
    const el = viewerRef.current;
    if (!el || !pickingColorForLayerId) return;

    // Change cursor to crosshair
    const originalCursor = el.style.cursor;
    el.style.cursor = "crosshair";

    let isDragging = false;
    let startX = 0;
    let startY = 0;

    const onPointerDown = (e: PointerEvent) => {
      isDragging = false;
      startX = e.clientX;
      startY = e.clientY;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (Math.abs(e.clientX - startX) > 5 || Math.abs(e.clientY - startY) > 5) {
        isDragging = true;
      }
    };

    const onPointerUp = async (e: PointerEvent) => {
      // If the user was dragging/orbiting the camera, don't trigger color picking
      if (isDragging) return;

      const clientX = e.clientX;
      const clientY = e.clientY;

      if (typeof el.positionAndNormalFromPoint !== "function") return;
      const hit = el.positionAndNormalFromPoint(clientX, clientY);
      if (!hit) return;

      const { position, normal } = hit;

      try {
        const { Vector3, Raycaster } = await import("three");
        
        const symbols = Object.getOwnPropertySymbols(el);
        const sceneSymbol = symbols.find((s) => s.description === "scene");
        if (!sceneSymbol) return;
        const scene = (el as any)[sceneSymbol];
        if (!scene) return;

        const pos = new Vector3(position.x, position.y, position.z);
        const nrm = new Vector3(normal.x, normal.y, normal.z).normalize();

        // Transform model coordinates to world coordinates
        if (scene.target && scene.target.matrixWorld) {
          pos.applyMatrix4(scene.target.matrixWorld);
          nrm.transformDirection(scene.target.matrixWorld).normalize();
        }

        // Raycast to find the exact clicked mesh and face
        const rayOrigin = pos.clone().add(nrm.clone().multiplyScalar(0.01));
        const rayDirection = nrm.clone().multiplyScalar(-1);
        const raycaster = new Raycaster(rayOrigin, rayDirection);

        const meshes: any[] = [];
        scene.traverse((child: any) => {
          if (child.isMesh && child.visible) {
            meshes.push(child);
          }
        });

        const intersects = raycaster.intersectObjects(meshes, true);
        if (intersects.length === 0) return;

        const intersect = intersects[0];
        const clickedMesh = intersect.object;
        const uuid = clickedMesh.uuid;

        // Auto-initialize backup if not already present
        if (!meshBackups.current.has(uuid)) {
          const child = clickedMesh as any;
          if (child.material?.map?.image) {
            const img = child.material.map.image;
            const isAllowed = img && (
              img instanceof HTMLImageElement ||
              img instanceof HTMLCanvasElement ||
              (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap) ||
              (typeof OffscreenCanvas !== "undefined" && img instanceof OffscreenCanvas)
            );
            if (isAllowed) {
              const canvas = document.createElement("canvas");
              canvas.width = img.width || 1024;
              canvas.height = img.height || 1024;
              const ctx = canvas.getContext("2d");
              if (ctx) {
                ctx.drawImage(img, 0, 0);
                meshBackups.current.set(uuid, {
                  type: "texture",
                  imageData: canvas,
                });
              }
            }
          } else if (child.geometry?.attributes?.color) {
            const colorAttr = child.geometry.attributes.color;
            meshBackups.current.set(uuid, {
              type: "vertex",
              vertexColors: new Float32Array(colorAttr.array),
            });
          }
        }

        const backup = meshBackups.current.get(uuid);
        if (!backup) return;

        let r = 255, g = 255, b = 255;
        if (backup.type === "texture" && backup.imageData && intersect.uv) {
          const uv = intersect.uv;
          const x = Math.floor(uv.x * backup.imageData.width);
          const y = Math.floor((1 - uv.y) * backup.imageData.height); // Flip Y coordinate

          const ctx = backup.imageData.getContext("2d");
          if (ctx) {
            const pixel = ctx.getImageData(
              Math.max(0, Math.min(backup.imageData.width - 1, x)),
              Math.max(0, Math.min(backup.imageData.height - 1, y)),
              1,
              1
            ).data;
            r = pixel[0];
            g = pixel[1];
            b = pixel[2];
          }
        } else if (backup.type === "vertex" && backup.vertexColors && intersect.face) {
          const geom = (clickedMesh as any).geometry;
          const colorAttr = geom.attributes.color;
          if (colorAttr) {
            const face = intersect.face;
            r = Math.round(colorAttr.getX(face.a) * 255);
            g = Math.round(colorAttr.getY(face.a) * 255);
            b = Math.round(colorAttr.getZ(face.a) * 255);
          }
        }

        // Convert RGB to HEX
        const toHex = (c: number) => Math.round(c).toString(16).padStart(2, "0");
        const hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();

        // Update the active swap layer
        setLayers((prev) => {
          const next = prev.map((l) =>
            l.id === pickingColorForLayerId
              ? { ...l, hexTargetColor: hex, targetColor: [r, g, b] as [number, number, number] }
              : l
          );
          compileLayers(next);
          return next;
        });

        // Done picking
        setPickingColorForLayerId(null);
      } catch (err) {
        console.error("Eyedropper color picking failed:", err);
      }
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);

    return () => {
      el.style.cursor = originalCursor;
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
    };
  }, [viewerRef, pickingColorForLayerId, compileLayers]);


  // ── Load all materials list from current model ──────────────────────────────
  const getAllMaterials = useCallback((): ModelViewerMaterial[] => {
    const el = viewerRef.current;
    if (!el?.model) return [];
    return Array.from(el.model.materials);
  }, [viewerRef]);

  // ── Select a material (PBR mode) ────────────────────────────────────────────
  const selectMaterial = useCallback(
    (mat: ModelViewerMaterial, index: number) => {
      const pbr = mat.pbrMetallicRoughness;
      const baseColor = pbr.baseColorFactor ?? [0.8, 0.8, 0.8, 1];
      const emissive = mat.emissiveFactor ?? [0, 0, 0];

      setOriginals({
        color: [baseColor[0], baseColor[1], baseColor[2], baseColor[3] ?? 1],
        roughness: pbr.roughnessFactor ?? 0.5,
        metallic: pbr.metallicFactor ?? 0.0,
        emissive: [emissive[0], emissive[1], emissive[2]],
      });

      setPbrEdits({
        color: rgbaToHex(baseColor),
        roughness: pbr.roughnessFactor ?? 0.5,
        metallic: pbr.metallicFactor ?? 0.0,
        emissive: rgbaToHex([emissive[0], emissive[1], emissive[2], 1]),
        emissiveOn: (emissive[0] + emissive[1] + emissive[2]) > 0.01,
      });

      setSelectedMaterial(mat);
      setSelectedIndex(index);
    },
    []
  );

  // ── Sequential layers compilation pipeline ──────────────────────────────────
  const compileLayers = useCallback(
    (layersList: ColorSwapLayer[]) => {
      captureAndNotify();
      const el = viewerRef.current;
      if (!el) return;
      const symbols = Object.getOwnPropertySymbols(el);
      const sceneSymbol = symbols.find((s) => s.description === "scene");
      if (!sceneSymbol) return;
      const scene = (el as any)[sceneSymbol];
      if (!scene) return;

      // Special case: if stack is fully cleared, restore all backups directly
      if (layersList.length === 0) {
        scene.traverse((child: any) => {
          if (child.isMesh) {
            const backup = meshBackups.current.get(child.uuid);
            if (backup) {
              if (backup.type === "texture" && backup.imageData && child.material?.map) {
                child.material.map.image = backup.imageData;
                child.material.map.needsUpdate = true;
              } else if (backup.type === "vertex" && backup.vertexColors && child.geometry?.attributes?.color) {
                const colorAttr = child.geometry.attributes.color;
                (colorAttr.array as Float32Array).set(backup.vertexColors);
                colorAttr.needsUpdate = true;
              }
            }
          }
        });
        if (typeof el.queueRender === "function") {
          el.queueRender();
        }
        dispatchModelEdited();
        return;
      }

      // Sequential list of visible swaps
      const activeLayers = layersList.filter((l) => l.visible);

      scene.traverse((child: any) => {
        if (child.isMesh) {
          // Initialize backup once per mesh dynamically if not present
          if (!meshBackups.current.has(child.uuid)) {
            if (child.material?.map?.image) {
              const img = child.material.map.image;
              const isAllowed = img && (
                img instanceof HTMLImageElement ||
                img instanceof HTMLCanvasElement ||
                (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) ||
                (typeof OffscreenCanvas !== 'undefined' && img instanceof OffscreenCanvas)
              );
              if (isAllowed) {
                const canvas = document.createElement("canvas");
                canvas.width = img.width || 1024;
                canvas.height = img.height || 1024;
                const ctx = canvas.getContext("2d");
                if (ctx) {
                  ctx.drawImage(img, 0, 0);
                  meshBackups.current.set(child.uuid, {
                    type: "texture",
                    imageData: canvas,
                  });
                }
              }
            } else if (child.geometry?.attributes?.color) {
              const colorAttr = child.geometry.attributes.color;
              meshBackups.current.set(child.uuid, {
                type: "vertex",
                vertexColors: new Float32Array(colorAttr.array),
              });
            }
          }

          const backup = meshBackups.current.get(child.uuid);
          if (!backup) return;

          if (backup.type === "texture" && backup.imageData) {
            const map = child.material?.map;
            if (!map) return;

            // Start buffers
            const tempCanvas = document.createElement("canvas");
            tempCanvas.width = backup.imageData.width;
            tempCanvas.height = backup.imageData.height;
            const tempCtx = tempCanvas.getContext("2d");
            if (tempCtx) tempCtx.drawImage(backup.imageData, 0, 0);

            const targetCanvas = document.createElement("canvas");
            targetCanvas.width = backup.imageData.width;
            targetCanvas.height = backup.imageData.height;
            const targetCtx = targetCanvas.getContext("2d");
            if (targetCtx) targetCtx.drawImage(backup.imageData, 0, 0);

            let currentSrcCanvas = tempCanvas;
            let currentDestCanvas = targetCanvas;

            activeLayers.forEach((layer) => {
              const replacementRgb = hexToRgb(layer.replacementColor).map((c) =>
                Math.round(c * 255)
              ) as [number, number, number];

              replaceColorInCanvas(
                currentSrcCanvas,
                currentDestCanvas,
                layer.targetColor,
                replacementRgb,
                layer.tolerance,
                layer.preserveShading
              );

              // Swap buffers for the next layer swap
              const swap = currentSrcCanvas;
              currentSrcCanvas = currentDestCanvas;
              currentDestCanvas = swap;
            });

            // The last calculated result holds the compiled canvas
            const finalCanvas = currentSrcCanvas;
            map.image = finalCanvas;
            map.needsUpdate = true;
          } else if (backup.type === "vertex" && backup.vertexColors && child.geometry?.attributes?.color) {
            const colorAttr = child.geometry.attributes.color;
            const workingArray = new Float32Array(backup.vertexColors);

            activeLayers.forEach((layer) => {
              const replacementRgb = hexToRgb(layer.replacementColor).map((c) =>
                Math.round(c * 255)
              ) as [number, number, number];

              replaceColorInVertices(
                workingArray,
                colorAttr.array as Float32Array,
                layer.targetColor,
                replacementRgb,
                layer.tolerance,
                layer.preserveShading
              );

              workingArray.set(colorAttr.array as Float32Array);
            });

            if (activeLayers.length === 0) {
              (colorAttr.array as Float32Array).set(backup.vertexColors);
            }
            colorAttr.needsUpdate = true;
          }
        }
      });

      if (typeof el.queueRender === "function") {
        el.queueRender();
      }
      dispatchModelEdited();
    },
    [viewerRef, dispatchModelEdited, captureAndNotify]
  );



  // ── Layers mutation hooks ──────────────────────────────────────────────────
  const updateLayerProperty = useCallback(
    (layerId: string, property: keyof ColorSwapLayer, value: any) => {
      setLayers((prev) => {
        const next = prev.map((l) => (l.id === layerId ? { ...l, [property]: value } : l));
        compileLayers(next);
        return next;
      });
    },
    [compileLayers]
  );

  const toggleLayerVisibility = useCallback(
    (layerId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setLayers((prev) => {
        const next = prev.map((l) => (l.id === layerId ? { ...l, visible: !l.visible } : l));
        compileLayers(next);
        return next;
      });
    },
    [compileLayers]
  );

  const deleteLayer = useCallback(
    (layerId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setLayers((prev) => {
        const next = prev.filter((l) => l.id !== layerId);
        compileLayers(next);
        return next;
      });
      setActiveLayerId((prev) => (prev === layerId ? null : prev));
    },
    [compileLayers]
  );

  const resetStack = useCallback(() => {
    setLayers([]);
    setActiveLayerId(null);
    compileLayers([]);
  }, [compileLayers]);

  const addNewLayer = useCallback(() => {
    const newLayerId = Math.random().toString(36).substring(2, 9);
    const newLayer: ColorSwapLayer = {
      id: newLayerId,
      meshUuid: "",
      targetColor: [255, 255, 255],
      hexTargetColor: "#ffffff",
      replacementColor: "#ffffff",
      tolerance: 30,
      preserveShading: true,
      visible: true,
    };

    setLayers((prev) => {
      const next = [...prev, newLayer];
      compileLayers(next);
      return next;
    });
    setActiveLayerId(newLayerId);
  }, [compileLayers]);

  // ── Material PBR Properties Controls (Mesh Settings Tab) ──────────────────────
  const applyColor = useCallback(
    (hex: string) => {
      if (!selectedMaterial) return;
      captureAndNotify();
      const rgba = hexToRgba(hex, 1.0);
      selectedMaterial.pbrMetallicRoughness.setBaseColorFactor(rgba);
      setPbrEdits((prev) => ({ ...prev, color: hex }));
      dispatchModelEdited();
    },
    [selectedMaterial, dispatchModelEdited, captureAndNotify]
  );

  const applyRoughness = useCallback(
    (value: number) => {
      if (!selectedMaterial) return;
      captureAndNotify();
      selectedMaterial.pbrMetallicRoughness.setRoughnessFactor(value);
      setPbrEdits((prev) => ({ ...prev, roughness: value }));
      dispatchModelEdited();
    },
    [selectedMaterial, dispatchModelEdited, captureAndNotify]
  );

  const applyMetallic = useCallback(
    (value: number) => {
      if (!selectedMaterial) return;
      captureAndNotify();
      selectedMaterial.pbrMetallicRoughness.setMetallicFactor(value);
      setPbrEdits((prev) => ({ ...prev, metallic: value }));
      dispatchModelEdited();
    },
    [selectedMaterial, dispatchModelEdited, captureAndNotify]
  );

  const applyEmissive = useCallback(
    (hex: string, on: boolean) => {
      if (!selectedMaterial) return;
      captureAndNotify();
      const rgb = on ? hexToRgb(hex) : ([0, 0, 0] as [number, number, number]);
      selectedMaterial.setEmissiveFactor(rgb);
      setPbrEdits((prev) => ({ ...prev, emissive: hex, emissiveOn: on }));
      dispatchModelEdited();
    },
    [selectedMaterial, dispatchModelEdited, captureAndNotify]
  );

  const applyPreset = useCallback(
    (preset: (typeof PRESETS)[number]) => {
      if (!selectedMaterial) return;
      captureAndNotify();
      selectedMaterial.pbrMetallicRoughness.setMetallicFactor(preset.metallic);
      selectedMaterial.pbrMetallicRoughness.setRoughnessFactor(preset.roughness);
      const emissiveOn = preset.emissive;
      const emissiveHex = pbrEdits.emissive;
      const rgb = emissiveOn ? hexToRgb(emissiveHex) : ([0, 0, 0] as [number, number, number]);
      selectedMaterial.setEmissiveFactor(rgb);
      setPbrEdits((prev) => ({
        ...prev,
        metallic: preset.metallic,
        roughness: preset.roughness,
        emissiveOn,
      }));
      dispatchModelEdited();
    },
    [selectedMaterial, pbrEdits.emissive, dispatchModelEdited, captureAndNotify]
  );

  const resetMaterial = useCallback(() => {
    if (!selectedMaterial || !originals) return;
    captureAndNotify();
    selectedMaterial.pbrMetallicRoughness.setBaseColorFactor([...originals.color]);
    selectedMaterial.pbrMetallicRoughness.setRoughnessFactor(originals.roughness);
    selectedMaterial.pbrMetallicRoughness.setMetallicFactor(originals.metallic);
    selectedMaterial.setEmissiveFactor([...originals.emissive]);
    setPbrEdits({
      color: rgbaToHex([...originals.color]),
      roughness: originals.roughness,
      metallic: originals.metallic,
      emissive: rgbaToHex([...originals.emissive, 1]),
      emissiveOn: (originals.emissive[0] + originals.emissive[1] + originals.emissive[2]) > 0.01,
    });
    dispatchModelEdited();
  }, [selectedMaterial, originals, dispatchModelEdited, captureAndNotify]);

  // ── Export modified GLB ─────────────────────────────────────────────────────
  const exportEdited = useCallback(async () => {
    const el = viewerRef.current;
    if (!el) return;
    setIsExporting(true);
    try {
      const blob = await el.exportScene({ binary: true });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "model_edited.glb";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Export failed. Please try again.");
    } finally {
      setIsExporting(false);
    }
  }, [viewerRef]);

  const allMaterials = getAllMaterials();

  return (
    <div className="flex flex-col h-full bg-tech-bg/40 backdrop-blur-md rounded-2xl border border-tech-border overflow-hidden shadow-xl">
      {/* Header */}
      <div className="px-4 py-3 border-b border-tech-border bg-black/10 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-3.5 h-3.5 text-primary" />
            <span className="font-mono text-xs text-tech-fg font-bold uppercase tracking-widest">
              Material Studio
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Reset Stack */}
            {layers.length > 0 && activeStudioTab === "colorChanger" && (
              <button
                onClick={resetStack}
                title="Wipe color recipe stack"
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-mono font-semibold uppercase tracking-wider bg-red-950/20 text-red-400 border border-red-500/20 hover:bg-red-950/40 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-2.5 h-2.5" />
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tab Switcher */}
      <div className="flex border-b border-tech-border shrink-0 bg-black/5">
        <button
          onClick={() => handleTabChange("colorChanger")}
          className={`flex-1 py-2 text-[10px] font-mono font-semibold uppercase tracking-wider flex items-center justify-center gap-1.5 border-b-2 transition-all cursor-pointer ${
            activeStudioTab === "colorChanger"
              ? "border-primary text-primary bg-primary/5"
              : "border-transparent text-tech-muted hover:text-tech-fg"
          }`}
        >
          <Paintbrush className="w-3 h-3" />
          Color Changer
        </button>
        <button
          onClick={() => {
            handleTabChange("decalPlacer");
            // Ensure texture is initialized
            setTimeout(() => renderTextToTexture(), 100);
          }}
          className={`flex-1 py-2 text-[10px] font-mono font-semibold uppercase tracking-wider flex items-center justify-center gap-1.5 border-b-2 transition-all cursor-pointer ${
            activeStudioTab === "decalPlacer"
              ? "border-primary text-primary bg-primary/5"
              : "border-transparent text-tech-muted hover:text-tech-fg"
          }`}
        >
          <Stamp className="w-3 h-3" />
          Stickers
        </button>
      </div>

      {/* Hidden offscreen canvas for text rendering. Kept outside tab conditions so it doesn't unmount and break the CanvasTexture reference. */}
      <canvas ref={textCanvasRef} style={{ display: "none" }} />

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto scrollbar-thin flex flex-col min-h-0 bg-black/5">
        
        {/* ──────── TAB 3: DECAL STUDIO ──────── */}
        {activeStudioTab === "decalPlacer" && (
          <div className="flex flex-col gap-0 h-full">

            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">

              {/* Mode Toggle */}
              <div className="flex items-center gap-1 p-1 rounded-xl bg-black/20 border border-white/5">
                <button
                  onClick={() => setStickerMode("text")}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider rounded-lg transition-all ${
                    stickerMode === "text"
                      ? "bg-primary/20 text-primary shadow-sm"
                      : "text-tech-muted hover:text-tech-fg"
                  }`}
                >
                  <Type className="w-3 h-3" /> Text
                </button>
                <button
                  onClick={() => setStickerMode("image")}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider rounded-lg transition-all ${
                    stickerMode === "image"
                      ? "bg-primary/20 text-primary shadow-sm"
                      : "text-tech-muted hover:text-tech-fg"
                  }`}
                >
                  <ImageIcon className="w-3 h-3" /> Image
                </button>
              </div>

              {/* ── TEXT MODE ──────────────────────────────────── */}
              {stickerMode === "text" && (
              <div className="flex flex-col gap-3 animate-in fade-in duration-200">
                  {/* Text input */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[9px] font-mono text-tech-muted uppercase tracking-widest">Text</span>
                    <input
                      type="text"
                      value={textContent}
                      maxLength={24}
                      onChange={(e) => setTextContent(e.target.value)}
                      placeholder="Your text..."
                      className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-tech-fg text-xs font-mono focus:outline-none focus:border-primary/50 transition-colors"
                    />
                  </div>

                  {/* Font selector */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[9px] font-mono text-tech-muted uppercase tracking-widest">Font</span>
                    <div className="grid grid-cols-1 gap-1">
                      {TEXT_FONTS.map((f) => (
                        <button
                          key={f.value}
                          onClick={() => setTextFont(f.value)}
                          className={`px-2.5 py-1.5 rounded-lg text-left text-[11px] transition-all cursor-pointer ${
                            textFont === f.value
                              ? "bg-primary/15 border border-primary/40 text-primary"
                              : "bg-white/3 border border-white/8 text-tech-muted hover:text-tech-fg hover:border-white/20"
                          }`}
                          style={{ fontFamily: f.value }}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Color */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[9px] font-mono text-tech-muted uppercase tracking-widest">Color</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={textColor}
                        onChange={(e) => setTextColor(e.target.value)}
                        className="color-picker-input w-8 h-8 rounded-md cursor-pointer border border-white/15 hover:border-primary/40 transition-colors"
                      />
                      <span className="text-[9px] font-mono text-tech-muted">{textColor}</span>
                    </div>
                  </div>

                  {/* Live preview */}
                  <div className="rounded-xl bg-black/30 border border-white/10 overflow-hidden flex items-center justify-center h-14">
                    <span
                      className="px-3 text-center truncate max-w-full"
                      style={{
                        fontFamily: textFont,
                        color: textColor,
                        fontSize: `28px`,
                        fontWeight: "bold",
                      }}
                    >
                      {textContent || "Your text here"}
                    </span>
                  </div>
                </div>
              )}

              {/* ── IMAGE MODE ─────────────────────────────────── */}
              {stickerMode === "image" && (
                <div className="flex flex-col gap-3 animate-in fade-in duration-200">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[9px] font-mono text-tech-muted uppercase tracking-widest">Upload Image</span>
                    <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-white/10 rounded-xl cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-colors relative overflow-hidden group">
                      <div className="flex flex-col items-center justify-center pt-5 pb-6">
                        <ImageIcon className="w-6 h-6 mb-2 text-tech-muted group-hover:text-primary transition-colors" />
                        <p className="mb-1 text-[10px] text-tech-muted font-mono"><span className="font-semibold text-tech-fg group-hover:text-primary">Click to upload</span></p>
                        <p className="text-[8px] text-tech-muted/70 font-mono">PNG or JPG (Max 10MB)</p>
                      </div>
                      <input type="file" className="hidden" accept="image/png, image/jpeg, image/jpg" onChange={handleFileUpload} />
                      {uploadedImage && (
                        <div className="absolute inset-0 bg-black/80 flex items-center justify-center p-2 backdrop-blur-sm transition-opacity">
                          <img src={uploadedImage} alt="Uploaded" className="max-h-full max-w-full object-contain rounded drop-shadow-lg border border-white/10" />
                          <div className="absolute top-2 right-2 bg-black/60 p-1 rounded backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity">
                            <span className="text-[8px] text-white font-mono uppercase tracking-widest">Change</span>
                          </div>
                        </div>
                      )}
                    </label>
                  </div>
                </div>
              )}

              {/* ── SHARED: Transform Controls ──────────────── */}
              <div className="flex flex-col gap-2.5 pt-1 border-t border-white/5">
                  <span className="text-[9px] font-mono text-tech-muted uppercase tracking-widest">Transform</span>
                  <StudioSlider
                    label="Scale"
                    leftLabel="0.1×"
                    rightLabel="3×"
                    min={0.1} max={3.0} step={0.05}
                    value={decalScale}
                    onChange={(v) => setDecalScale(v)}
                    accentColor="oklch(0.65 0.18 260)"
                  />
                  <StudioSlider
                    label="Rotation"
                    leftLabel="-180°"
                    rightLabel="180°"
                    min={-180} max={180} step={1}
                    value={decalRotation}
                    onChange={(v) => setDecalRotation(v)}
                    accentColor="oklch(0.65 0.18 30)"
                  />
                  <StudioSlider
                    label="Opacity"
                    leftLabel="0%"
                    rightLabel="100%"
                    min={0} max={1} step={0.01}
                    value={decalOpacity}
                    onChange={(v) => setDecalOpacity(v)}
                    accentColor="oklch(0.65 0.18 140)"
                  />
                </div>
              {/* ── Confirmed Decals list ────────────────────── */}
              {confirmedDecals.length > 0 && (
                <div className="flex flex-col gap-1.5 pt-1 border-t border-white/5">
                  <span className="text-[9px] font-mono text-tech-muted uppercase tracking-widest">Placed Stickers ({confirmedDecals.length})</span>
                  <div className="flex flex-col gap-1">
                    {confirmedDecals.map((d) => (
                      <div
                        key={d.id}
                        className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border transition-all ${
                          d.visible ? "bg-white/5 border-white/10" : "bg-black/20 border-white/5 opacity-50"
                        }`}
                      >
                        <span className="text-[10px] font-mono text-tech-fg truncate max-w-[120px]">{d.label}</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => decalCallbacks?.onToggleDecalVisibility(d.id)}
                            className="text-tech-muted hover:text-tech-fg transition-colors cursor-pointer p-0.5"
                            title={d.visible ? "Hide" : "Show"}
                          >
                            {d.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                          </button>
                          <button
                            onClick={() => decalCallbacks?.onRemoveDecal(d.id)}
                            className="text-tech-muted hover:text-red-400 transition-colors cursor-pointer p-0.5"
                            title="Remove"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Actions ─────────────────────────────────── */}
              <div className="flex items-center gap-2 pt-1 border-t border-white/5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => decalCallbacks?.onUndo()}
                  disabled={confirmedDecals.length === 0}
                  className="flex-1 gap-1.5 text-xs text-tech-muted hover:text-tech-fg border border-white/8 hover:border-white/20 disabled:opacity-30"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                  Undo
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => decalCallbacks?.onClearAll()}
                  disabled={confirmedDecals.length === 0}
                  className="flex-1 gap-1.5 text-xs text-red-400 hover:text-red-300 border border-red-500/20 hover:border-red-500/40 hover:bg-red-950/20 disabled:opacity-30"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear All
                </Button>
              </div>

            </div>
          </div>
        )}

        {activeStudioTab === "colorChanger" && (
          <div className="flex-1 flex flex-col p-4 gap-3">
            {pickingColorForLayerId && (
              <div className="lg:hidden flex items-center gap-2 p-2.5 rounded-lg bg-primary/10 border border-primary/20 text-primary animate-in fade-in duration-300 text-[10px] font-mono mb-2">
                <Pipette className="w-4 h-4 flex-shrink-0 animate-bounce" />
                <div className="flex-1 leading-normal">
                  Click on the 3D model in the viewport to sample the target color.
                </div>
                <button
                  type="button"
                  onClick={() => setPickingColorForLayerId(null)}
                  className="px-2 py-0.5 rounded bg-primary/20 hover:bg-primary/30 text-[9px] uppercase font-semibold text-primary transition-all cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            )}
            
            {layers.length > 0 ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between text-[9px] font-mono text-tech-muted uppercase tracking-wider px-1">
                  <span>Recipe Swap Stack ({layers.length})</span>
                  <span>Drag or click to focus</span>
                </div>

                <div className="flex flex-col gap-2.5">
                  {layers.map((layer, index) => {
                    const isActive = layer.id === activeLayerId;
                    const isVisible = layer.visible;

                    return (
                      <div
                        key={layer.id}
                        onClick={() => setActiveLayerId(layer.id)}
                        className={`group relative rounded-xl border flex flex-col transition-all duration-200 overflow-hidden cursor-pointer ${
                          isActive
                            ? "bg-tech-bg/85 border-primary shadow-[0_4px_16px_oklch(0.7_0.2_200/0.08)] scale-[1.01]"
                            : "bg-tech-bg/30 hover:bg-tech-bg/50 border-tech-border/60 hover:border-tech-border"
                        } ${!isVisible && "opacity-50"}`}
                      >
                        {/* Card Header */}
                        <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 bg-black/10">
                          <span className="font-mono text-[9px] text-tech-muted uppercase tracking-wider">
                            Swap #{index + 1}
                          </span>
                          <div className="flex items-center gap-2">
                            {/* Toggle visibility */}
                            <button
                              onClick={(e) => toggleLayerVisibility(layer.id, e)}
                              className="text-tech-muted hover:text-tech-fg transition-colors p-0.5 cursor-pointer"
                              title={isVisible ? "Hide this swap" : "Show this swap"}
                            >
                              {isVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                            </button>
                            {/* Delete layer */}
                            <button
                              onClick={(e) => deleteLayer(layer.id, e)}
                              className="text-tech-muted hover:text-red-400 transition-colors p-0.5 cursor-pointer"
                              title="Delete swap layer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Card Body */}
                        <div className="p-3 flex flex-col gap-3.5">
                          {/* Swatches compare row */}
                          <div className="flex items-center gap-3">
                            {/* Target Color Selector */}
                            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="color"
                                value={layer.hexTargetColor}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveLayerId(layer.id);
                                }}
                                onChange={(e) => {
                                  const hex = e.target.value;
                                  const rgb = hexToRgb(hex).map((c) => Math.round(c * 255)) as [number, number, number];
                                  setLayers((prev) => {
                                    const next = prev.map((l) =>
                                      l.id === layer.id
                                        ? { ...l, hexTargetColor: hex, targetColor: rgb }
                                        : l
                                    );
                                    compileLayers(next);
                                    return next;
                                  });
                                }}
                                className="color-picker-input w-8 h-8 rounded-md cursor-pointer border border-white/15 hover:border-primary/40 transition-colors"
                                title="Select target color to change from"
                              />
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPickingColorForLayerId(
                                    pickingColorForLayerId === layer.id ? null : layer.id
                                  );
                                }}
                                className={`lg:hidden w-8 h-8 flex items-center justify-center rounded-md border transition-all cursor-pointer ${
                                  pickingColorForLayerId === layer.id
                                    ? "bg-primary border-primary text-primary-foreground animate-pulse"
                                    : "bg-white/5 border-white/10 hover:border-primary/40 hover:bg-white/10 text-tech-muted hover:text-tech-fg"
                                }`}
                                title="Pick color from 3D model (Eyedropper)"
                              >
                                <Pipette className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            <ChevronRight className="w-3.5 h-3.5 text-tech-muted" />
                            
                            {/* Replacement Color */}
                            {isActive ? (
                              <div className="flex items-center gap-2 animate-in fade-in duration-200">
                                <input
                                  type="color"
                                  value={layer.replacementColor}
                                  onChange={(e) => updateLayerProperty(layer.id, "replacementColor", e.target.value)}
                                  className="color-picker-input w-8 h-8 rounded-md cursor-pointer border border-white/15 hover:border-primary/40 transition-colors"
                                />
                                <span className="font-mono text-[10px] text-tech-fg uppercase">
                                  {layer.replacementColor}
                                </span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-8 h-8 rounded-md border border-white/15 animate-in fade-in"
                                  style={{ backgroundColor: layer.replacementColor }}
                                />
                                <span className="font-mono text-[10px] text-tech-muted uppercase">
                                  {layer.replacementColor}
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Expanded Controls */}
                          {isActive && (
                            <div className="flex flex-col gap-3.5 mt-1 animate-in slide-in-from-top-1 duration-150">
                              <div className="h-px bg-white/5" />
                              
                              {/* Tolerance */}
                              <StudioSlider
                                label="Tolerance"
                                leftLabel="Exact"
                                rightLabel="Range"
                                min={1}
                                max={120}
                                step={1}
                                value={layer.tolerance}
                                onChange={(v) => updateLayerProperty(layer.id, "tolerance", v)}
                                accentColor="oklch(0.65 0.18 140)"
                              />

                              {/* Preserve Shading */}
                              <div className="flex items-center justify-between bg-white/3 px-2.5 py-1.5 rounded-lg border border-white/5">
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-[10px] font-mono text-tech-fg font-semibold">Preserve Shading</span>
                                  <span className="text-[8px] font-mono text-tech-muted leading-none">
                                    Natural highlights and shading
                                  </span>
                                </div>
                                <button
                                  onClick={() => updateLayerProperty(layer.id, "preserveShading", !layer.preserveShading)}
                                  className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors duration-200 cursor-pointer ${
                                    layer.preserveShading ? "bg-primary" : "bg-white/20"
                                  }`}
                                >
                                  <span
                                    className={`inline-block h-3 w-3 rounded-full bg-white shadow-sm transform transition-transform duration-200 ${
                                      layer.preserveShading ? "translate-x-3.5" : "translate-x-0.5"
                                    }`}
                                  />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Add Swap Helper button */}
                <Button
                  variant="ghost"
                  onClick={addNewLayer}
                  className="w-full mt-2 gap-1.5 py-4 border border-dashed border-white/10 hover:border-primary/40 text-tech-muted hover:text-tech-fg text-xs rounded-xl"
                >
                  <Plus className="w-4 h-4 text-primary" />
                  Add Color Swap
                </Button>
              </div>
            ) : (
              /* Empty state color changer */
              <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 py-16 text-center my-auto">
                <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center animate-glow-pulse">
                  <Paintbrush className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-tech-fg mb-1">Texturing Recipe Stack</p>
                  <p className="text-[11px] text-tech-muted leading-relaxed max-w-[200px] mx-auto">
                    Click <span className="text-primary font-mono font-bold">Add Color Swap</span> below to add a swap layer, then choose your target and replacement colors.
                  </p>
                  <Button
                    size="sm"
                    onClick={addNewLayer}
                    className="mt-4 gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Color Swap
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}



      </div>

      {/* Footer — Export */}
      <div className="shrink-0 px-4 py-3 border-t border-tech-border bg-black/10">
        <Button
          size="sm"
          onClick={exportEdited}
          disabled={isExporting}
          className="w-full gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs disabled:opacity-40"
        >
          <Download className="w-3.5 h-3.5" />
          {isExporting ? "Exporting…" : "Download Edited GLB"}
        </Button>
        <p className="text-[9px] text-tech-muted/50 font-mono text-center mt-1.5">
          Bakes all changes • No credits used
        </p>
      </div>
    </div>
  );
}