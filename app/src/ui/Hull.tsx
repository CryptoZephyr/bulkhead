// The hull row (section 6): compartments side by side, joined by seams.
import { useEffect, useRef, useState } from "react";
import { StatusMark, type StatusKind } from "./Status";

export interface CompartmentView {
  id: "everyday" | "savings" | "agent";
  name: string;
  balance: string;       // already formatted, real units
  unit: string;
  fill: number;          // 0..1 of the largest compartment
  radius: string;        // the most anyone could take now, formatted
  radiusShare: number;   // 0..1 of balance
  state: "open" | "paused" | "sealed";
  sentence: string;
  weight: number;        // relative width
}

const STATUS: Record<CompartmentView["state"], StatusKind> = { open: "holding", paused: "paused", sealed: "sealed" };

export function Compartment({ c }: { c: CompartmentView }) {
  const prev = useRef(c.state);
  const [slam, setSlam] = useState(false);
  useEffect(() => {
    if (prev.current !== "sealed" && c.state === "sealed") setSlam(true);
    prev.current = c.state;
  }, [c.state]);
  return (
    <section className="plate comp" data-state={c.state} style={{ ["--w" as string]: c.weight }} aria-label={`${c.name} compartment`}>
      <div className="comp-head"><span>{c.name}</span><StatusMark kind={STATUS[c.state]} /></div>
      <div className="comp-bal">{c.balance}<small>{c.unit}</small></div>
      <div className="fill-level" aria-hidden="true"><i style={{ ["--lvl" as string]: `${Math.round(c.fill * 100)}%` }} /></div>
      <div style={{ display: "grid", gap: 6 }}>
        <span className="label">Most anyone could take now</span>
        <strong style={{ fontSize: 22, fontWeight: 850 }}>{c.radius} {c.unit}</strong>
        <div className="radius-bar" aria-hidden="true"><b style={{ ["--r" as string]: `${Math.round(c.radiusShare * 100)}%` }} /></div>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>{c.sentence}</p>
      {slam && <span className="slam" aria-hidden="true" />}
    </section>
  );
}

export function HullRow({ compartments }: { compartments: CompartmentView[] }) {
  return <div className="hull">{compartments.map((c) => <Compartment key={c.id} c={c} />)}</div>;
}
