// Tells TypeScript that <model-viewer> is a valid JSX element
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
