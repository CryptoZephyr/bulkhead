// Activity: everything that happened to the account, read from the chain. No stored or example rows.
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { myAccount } from "../chain/me";
import { readHistory, creationBlock, type HistoryItem } from "../chain/history";
import { EXPLORER_TX } from "../chain/config";
import { StatusMark, type StatusKind } from "../ui/Status";
import "./activity.css";

const MARK: Record<HistoryItem["kind"], StatusKind> = {
  paid: "paid", "paid-with-phone": "phone", received: "paid", tripped: "sealed", sealed: "sealed", paused: "paused",
  tightened: "holding", "widen-queued": "phone", "widen-done": "holding", "widen-cancelled": "holding",
  evacuated: "evacuated", "phone-change": "phone", "phone-changed": "phone",
  "wall-pilot": "holding", "wall-laptop": "holding", held: "blocked", "pilot-set": "phone",
};

export function useHistory(account: Address | null) {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!account) return;
    let on = true, from: bigint | null = null;
    const load = async () => {
      try {
        from ??= await creationBlock(account);
        const h = await readHistory(account, from);
        if (on) { setItems(h); setErr(""); }
      } catch { if (on) setErr("We can't read the chain right now. Retrying."); }
    };
    void load(); const t = setInterval(() => void load(), 20_000);
    return () => { on = false; clearInterval(t); };
  }, [account]);
  return { items, err };
}

export function HistoryList({ items, limit }: { items: HistoryItem[]; limit?: number }) {
  const shown = limit ? items.slice(0, limit) : items;
  return (
    <ul className="history">
      {shown.map((h) => (
        <li key={h.txHash + h.kind + h.title} className={`plate history-row${h.attention ? " attention" : ""}`}>
          <StatusMark kind={MARK[h.kind]} word={h.title} />
          <p className="muted">{h.detail}</p>
          <a className="hash" href={EXPLORER_TX + h.txHash} target="_blank" rel="noreferrer">
            <span className="mono">{h.txHash.slice(0, 8)}…{h.txHash.slice(-6)}</span> QoreScan
          </a>
        </li>
      ))}
    </ul>
  );
}

export function ActivityScreen() {
  const account = myAccount()!.address;
  const { items, err } = useHistory(account);
  const [only, setOnly] = useState<"all" | "attention">("all");
  if (err && !items) return <p role="alert" className="flood-line">{err}</p>;
  if (!items) return <p className="muted" aria-busy="true">Reading your account's history from the chain.</p>;
  if (!items.length) return <div className="plate"><p>Nothing has happened in this account yet. Payments, deposits and anything your walls stop will show here.</p></div>;
  const list = only === "all" ? items : items.filter((i) => i.attention);
  return (
    <div className="activity">
      <fieldset className="filter">
        <legend className="visually-hidden">Show</legend>
        <label><input type="radio" name="f" checked={only === "all"} onChange={() => setOnly("all")} /> Everything</label>
        <label><input type="radio" name="f" checked={only === "attention"} onChange={() => setOnly("attention")} /> Needs attention</label>
      </fieldset>
      {list.length ? <HistoryList items={list} /> : <p className="muted">Nothing needs your attention.</p>}
    </div>
  );
}
