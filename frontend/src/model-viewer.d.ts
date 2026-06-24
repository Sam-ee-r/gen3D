// Tells TypeScript that <model-viewer> is a valid JSX element

export interface ModelViewerMaterial {
  name: string;
  pbrMetallicRoughness: {
    baseColorFactor: number[];
    roughnessFactor: number;
    metallicFactor: number;
    setBaseColorFactor(rgba: number[]): Promise<void>;
    setRoughnessFactor(value: number): Promise<void>;
    setMetallicFactor(value: number): Promise<void>;
  };
  emissiveFactor: number[];
  setEmissiveFactor(rgb: number[]): Promise<void>;
}

export interface ModelViewerModel {
  materials: ModelViewerMaterial[];
}

export interface ModelViewerElement extends HTMLElement {
  model: ModelViewerModel | null;
  loaded: boolean;
  materialFromPoint(clientX: number, clientY: number): ModelViewerMaterial | null;
  positionAndNormalFromPoint(clientX: number, clientY: number): {
    position: { x: number; y: number; z: number; toString(): string };
    normal: { x: number; y: number; z: number; toString(): string };
  } | null;
  exportScene(options?: { binary?: boolean }): Promise<Blob>;
  queueRender(): void;
  toDataURL(type?: string, encoderOptions?: number): string;
  // Internal Three.js scene is accessible via a Symbol property (used for raycasting).
  // We access it as (el as any)[symbol] — typed as 'any' in usage.
}

declare namespace JSX {
  interface IntrinsicElements {
    "model-viewer": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      src?: string;
      alt?: string;
      "auto-rotate"?: boolean | string;
      "camera-controls"?: boolean | string;
      "shadow-intensity"?: string;
      "environment-image"?: string;
      exposure?: string;
      style?: React.CSSProperties;
    };
  }
}
