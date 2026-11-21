// Receive: the account's address as text and a QR code, and funding from QoreX.
import { useState } from "react";
import qrcode from "qrcode-generator";
import { evmToQor } from "@qorechain/sdk";
import type { Address } from "viem";
import { myAccount } from "../chain/me";
import { TOKENS } from "../chain/config";
import { fundFromQorex, isQorexAvailable } from "../chain/qorex";
import { ActionButton } from "../ui/Button";
import "./receive.css";

const T = TOKENS.fUSD;

/** A QR code drawn as one SVG path from our own tokens (no image library). */
function Qr({ text }: { text: string }) {
  const q = qrcode(0, "M");
  q.addData(text); q.make();
  const n = q.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return (
    <svg className="qr" viewBox={`-2 -2 ${n + 4} ${n + 4}`} role="img" aria-label={`QR code for ${text}`}>
      <rect x="-2" y="-2" width={n + 4} height={n + 4} fill="#FFFFFF" />
      <path d={d} fill="#0E2A13" />
    </svg>
  );
}

function CopyLine({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-line">
      <span className="label">{label}</span>
      <span className="mono addr">{value}</span>
      <button type="button" className="btn btn-secondary" onClick={() => {
        navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => setCopied(false));
      }}>{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}

export function ReceiveScreen() {
  const address = myAccount()!.address as Address;
  const [amount, setAmount] = useState("");
  const qorex = isQorexAvailable();
  const units = /^\d+(\.\d{1,2})?$/.test(amount.trim()) ? BigInt(Math.round(Number(amount) * 10 ** T.decimals)) : null;
  return (
    <div className="receive">
      <section className="plate receive-main" aria-labelledby="addr-h">
        <h2 id="addr-h" style={{ color: "var(--on-plate)" }}>Your account's address</h2>
        <div className="receive-qr"><Qr text={address} /></div>
        <CopyLine label="For tokens on the EVM side (fUSD)" value={address} />
        <CopyLine label="For QOR on the native side" value={evmToQor(address)} />
        <p className="muted">Money that arrives here goes into Everyday first. Anything above your Savings floor is spendable within your walls.</p>
      </section>

      <section className="plate" aria-labelledby="qorex-h">
        <h2 id="qorex-h" style={{ color: "var(--on-plate)" }}>Fund from QoreX</h2>
        {qorex ? (
          <>
            <label className="field">
              <span>Amount of fUSD</span>
              <input inputMode="decimal" placeholder="50.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            {units && <p className="muted">QoreX will ask you to move {amount} fUSD into this account. No window is opened for it.</p>}
            <ActionButton run={async (step) => {
              if (!units) throw new Error("Enter an amount like 50 or 12.50.");
              await fundFromQorex(address, "fUSD", units, step);
              return "Funds on the way";
            }}>Move fUSD from QoreX</ActionButton>
          </>
        ) : (
          <p>Install the QoreX wallet in this browser to fund your account in one step. Or send fUSD to the address above from any wallet.</p>
        )}
      </section>
    </div>
  );
}
