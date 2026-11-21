// The locked mark. The SVG text is imported from the locked file, never retyped.
// src/brand/bulkhead-mark.svg must keep SHA-256 7c81a304...6c68 (checked in test/mark.test.mjs).
import markSvg from "../brand/bulkhead-mark.svg?raw";

const PATH = /d="([^"]+)"/.exec(markSvg)![1];

export function Mark({ size = 24, title }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 70 70" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <path fill="currentColor" fillRule="evenodd" d={PATH} />
    </svg>
  );
}

export function Lockup({ size = 28 }: { size?: number }) {
  return (
    <span className="lockup" style={{ display: "inline-flex", alignItems: "center", gap: size * 0.4, fontWeight: 850, fontStretch: "120%", fontSize: size * 0.72, color: "inherit" }}>
      <Mark size={size} />
      Bulkhead
    </span>
  );
}
