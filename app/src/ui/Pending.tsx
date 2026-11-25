// Changes the phone approved that wait on chain for the account's delay. Anyone may finish them when
// due, through the relayer, so neither device needs gas. Cancelled ones stay visible for a day.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { readPending, finishPending, type Pending } from "../chain/pending";
import { ActionButton } from "./Button";

const DAY = 24 * 60 * 60 * 1000;
const RETRY = 30_000;

export function PendingPlate({ account, onDone }: { account: Address; onDone?: () => void }) {
  const [items, setItems] = useState<Pending[] | null>(null);
  const [failed, setFailed] = useState(false);
  const tried = useRef<Set<string>>(new Set());
  // Held in a ref so a parent passing a new callback each render doesn't restart the lookup.
  const done = useRef(onDone);
  done.current = onDone;

  const load = useCallback(async () => {
    try {
      const { items: got } = await readPending(account);
      setItems(got); setFailed(false);
      // Finish due items once per page load; the button stays as the fallback.
      const due = got.find((p) => p.state === "ready" && !tried.current.has(p.id));
      if (due) {
        tried.current.add(due.id);
        try { await finishPending(account, due); done.current?.(); await load(); } catch { /* the button is still there */ }
      }
    } catch { setFailed(true); }
  }, [account]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), RETRY);
    return () => clearInterval(t);
  }, [load]);

  const shown = (items ?? []).filter((p) => p.state !== "cancelled" || (p.cancelledAt ?? Date.now()) > Date.now() - DAY);
  if (!failed && items && shown.length === 0) return null;
  return (
    <section className="plate agent-add" aria-label="Changes waiting" aria-busy={!items && !failed}>
      <h2 style={{ color: "var(--on-plate)" }}>Changes waiting</h2>
      {failed && <p className="reason" role="alert">Couldn't check waiting changes. Retrying.</p>}
      {!failed && !items && <p className="muted">Checking changes waiting on your phone's approval…</p>}
      {!failed && shown.length > 0 && (
        <ul className="decisions">
          {shown.map((p) => (
            <li key={p.id} className="decision">
              {p.state === "waiting" && <p className="reason">{p.name}: approved by your phone. Ready in about {p.minutesLeft} minutes.</p>}
              {p.state === "ready" && (
                <>
                  <p className="reason">{p.name}: approved by your phone. Ready now.</p>
                  <ActionButton kind="primary" run={async (step) => { step("Finishing on QoreChain", 0.6); await finishPending(account, p); await load(); done.current?.(); return "Done"; }}>Finish it</ActionButton>
                </>
              )}
              {p.state === "cancelled" && <p className="reason">{p.name}: cancelled. {p.reason}. Ask your phone again if you still want it.</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
