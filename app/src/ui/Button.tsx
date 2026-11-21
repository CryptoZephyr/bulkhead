// Reactive button (sections 7 and 8). It turns into a progress bar with the real step,
// shows success in place, or shakes and explains the failure under it.
import { useState, type ReactNode } from "react";

export type Step = (label: string, progress: number) => void;

export function ActionButton(props: {
  kind?: "primary" | "secondary";
  icon?: ReactNode;
  children: ReactNode;
  /** Runs the action. Call step() with the real chain step. Return the success label. Throw an Error with a plain reason. */
  run: (step: Step) => Promise<string>;
  onDone?: () => void;
  block?: boolean;
}) {
  const [state, setState] = useState<"idle" | "busy" | "ok" | "fail">("idle");
  const [label, setLabel] = useState<ReactNode>(props.children);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

  async function go() {
    if (state === "busy") return;
    setError(""); setState("busy");
    try {
      const done = await props.run((l, p) => { setLabel(l); setProgress(p); });
      setProgress(0); setState("ok"); setLabel(done);
      setTimeout(() => { setState("idle"); setLabel(props.children); props.onDone?.(); }, 1500);
    } catch (e) {
      setProgress(0); setState("fail"); setLabel(props.children);
      setError(e instanceof Error ? e.message : String(e));
      setTimeout(() => setState("idle"), 400);
    }
  }

  return (
    <div style={{ display: props.block ? "block" : "inline-block" }}>
      <button type="button" onClick={go} aria-busy={state === "busy"} data-state={state}
        className={`btn btn-${props.kind ?? "primary"}${props.block ? " btn-block-phone" : ""}`}>
        <span className="fill" style={{ width: `${progress * 100}%` }} />
        {state === "ok" ? (
          <svg viewBox="0 0 24 24" aria-hidden="true"><path className="tick" d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        ) : props.icon}
        <span>{label}</span>
      </button>
      <p className="btn-error" role="alert">{error}</p>
    </div>
  );
}
