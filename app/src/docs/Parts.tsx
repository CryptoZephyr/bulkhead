import type { ReactNode } from "react";

/** A plate: one idea, one block. */
export const Plate = ({ title, children, tone }: { title?: string; children: ReactNode; tone?: "dark" | "alarm" }) => (
  <section className={`docs-plate ${tone ?? ""}`}>
    {title && <h2>{title}</h2>}
    {children}
  </section>
);

/** Technical detail for readers who want it. Collapsed by default. */
export const UnderTheHood = ({ children }: { children: ReactNode }) => (
  <details className="docs-hatch">
    <summary>Under the hood</summary>
    <div>{children}</div>
  </details>
);

/** A row of compartments, drawn like the hull row: name, what it holds, its wall. */
export const Compartments = ({ items }: { items: { name: string; holds: string; wall: string; flooded?: boolean }[] }) => (
  <div className="docs-hullrow" role="list">
    {items.map((c) => (
      <div key={c.name} role="listitem" className={`docs-cell ${c.flooded ? "flooded" : ""}`}>
        <strong>{c.name}</strong>
        <span>{c.holds}</span>
        <span className="docs-cell-wall">{c.wall}</span>
      </div>
    ))}
  </div>
);

/** Can and can't, side by side. */
export const CanCant = ({ can, cant }: { can: ReactNode[]; cant: ReactNode[] }) => (
  <div className="docs-cancant">
    <div><span className="docs-chip">Can</span><ul>{can.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
    <div><span className="docs-chip no">Can't</span><ul>{cant.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
  </div>
);

export const Tx = ({ hash, label }: { hash: string; label: string }) => (
  <a className="docs-tx mono" href={`/api/tx?h=${hash}`} target="_blank" rel="noreferrer">{label}</a>
);

