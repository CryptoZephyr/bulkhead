// Contracts and proof (#/proof), docs/DESIGN_SYSTEM.md section 16.10. Addresses from the chain config and the deployment record.
import { useRef, useState } from "react";
import { DEPLOYMENT } from "../chain/config";
import { REPLAY_STEPS } from "../data/replay";
import { TxPlate, OUTCOME_KIND } from "./Replay";
import { StatusMark } from "../ui/Status";
import "./proof.css";

interface Addr {
  name: string;
  address: string;
  note: string;
  superseded?: boolean;
}

const ADDRESSES: Addr[] = [
  { name: "BulkheadFactory (current)", address: DEPLOYMENT.factory, note: "Deploys a Bulkhead account only with a proven ML-DSA-87 signature from the phone." },
  { name: "Bulkhead account, live parity", address: "0x7C66b7D53EB9F4692000d3578eAd5a1385e359Be", note: "Deployed by the factory with a real signature. Native QOR runs on 21 November." },
  { name: "Bulkhead account, demo (fUSD)", address: DEPLOYMENT.demoAccount, note: "The demo account with an fUSD policy, read live on the Hull and Landing screens." },
  { name: "BulkheadFactory (superseded)", address: "0x72d28d81edbd8109689620fc73a843d41990b843", note: "Kept for the record. Replaced before the refilling allowance and sentinel fixes.", superseded: true },
];

function AddressRow({ a }: { a: Addr }) {
  const [state, setState] = useState<"idle" | "copied" | "selected">("idle");
  const ref = useRef<HTMLElement>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(a.address);
      setState("copied");
    } catch {
      // Clipboard refused (no permission or no secure context): select the text so the user can copy it.
      const el = ref.current;
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      setState("selected");
    }
  }

  return (
    <li className="plate addr-row" data-superseded={a.superseded ? "true" : undefined}>
      <div className="addr-head">
        <h3>{a.name}</h3>
        {a.superseded && <span className="label">Superseded</span>}
      </div>
      <p className="muted addr-note">{a.note}</p>
      <code className="addr mono" ref={ref}>{a.address}</code>
      <div className="addr-actions">
        <button type="button" className="btn btn-secondary btn-small" onClick={copy} aria-describedby={`copy-${a.address}`}>
          {state === "copied" ? "Copied" : "Copy"}
        </button>
        <span className="tx-pending" aria-label="Address link">Address link coming</span>
      </div>
      <p id={`copy-${a.address}`} className="copy-msg muted" aria-live="polite">
        {state === "copied" && "Address copied."}
        {state === "selected" && "Copy isn't available here. The address is selected, press Ctrl+C or Cmd+C."}
      </p>
    </li>
  );
}

export function ProofScreen() {
  const proofs = REPLAY_STEPS.flatMap((s) => s.results);
  return (
    <div className="proof">
      <div className="plate proof-net">
        <p className="label">Network</p>
        <p className="proof-net-name">QoreChain testnet</p>
        <p className="muted">Chain ID 9800 (EVM). Chain name qorechain-diana. Test funds only.</p>
      </div>

      <section aria-labelledby="addr-h">
        <h2 id="addr-h">Addresses</h2>
        <ul className="addr-list">
          {ADDRESSES.map((a) => <AddressRow key={a.address} a={a} />)}
        </ul>
      </section>

      <section aria-labelledby="proof-h">
        <h2 id="proof-h">Proof transactions</h2>
        <p className="muted">Every result the replay shows, with its link once the transaction hash is recorded.</p>
        <ul className="proof-list">
          {proofs.map((r) => (
            <li key={r.what} className="plate proof-row">
              <StatusMark kind={OUTCOME_KIND[r.outcome]} />
              <span className="proof-what">{r.what}</span>
              <span className="muted proof-detail">
                {r.detail}{r.gas !== undefined && <> Gas {r.gas.toLocaleString("en-GB")}.</>}
              </span>
              <TxPlate hash={r.hash} label={r.what} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
