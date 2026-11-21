// Custom status marks (section 10): 16px grid, 2px strokes, square ends, always with a word.
export type StatusKind = "holding" | "sealed" | "paused" | "phone" | "paid" | "blocked" | "evacuated";

const WORD: Record<StatusKind, string> = {
  holding: "Holding", sealed: "Sealed", paused: "Paused", phone: "Waiting for your phone",
  paid: "Paid", blocked: "Blocked by the chain", evacuated: "Evacuated",
};

function Glyph({ kind }: { kind: StatusKind }) {
  const s = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "square" as const };
  switch (kind) {
    case "holding": return <><rect x="2" y="2" width="12" height="12" {...s} /><path d="M8 2v12" {...s} /></>;
    case "sealed": return <><rect x="1" y="1" width="14" height="14" fill="var(--lime)" /><path d="M1 11 11 1M5 15 15 5" stroke="#0E2A13" strokeWidth="2" /></>;
    case "paused": return <><path d="M5 2v12M11 2v12" {...s} /></>;
    case "phone": return <><rect x="4" y="1" width="8" height="14" {...s} /><path d="M7 12h2" {...s} /></>;
    case "paid": return <path d="M2.5 8.5l3.5 3.5 7.5-8" {...s} />;
    case "blocked": return <><path d="M2 8h8" {...s} /><path d="M12 2v12" {...s} /></>;
    case "evacuated": return <><path d="M2 8h11M10 5l3 3-3 3" {...s} /><path d="M7 2v3M7 11v3" {...s} /></>;
  }
}

export function StatusMark({ kind, word }: { kind: StatusKind; word?: string }) {
  return (
    <span className="status">
      <svg viewBox="0 0 16 16" aria-hidden="true"><Glyph kind={kind} /></svg>
      {word ?? WORD[kind]}
    </span>
  );
}
