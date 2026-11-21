// Laptop side of the Bulkhead Handshake: a QR the phone's camera opens, a check against the chain,
// then four words the owner compares on both screens before anything is saved.
import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { startHandshake, awaitPhone, type LaptopSession, type VerifiedPhone } from "../chain/handshake";
import { Qr } from "../screens/Receive";

export function HandshakePair({ onPaired }: { onPaired: (phone: Address) => void }) {
  const [s, setS] = useState<LaptopSession | null>(null);
  const [v, setV] = useState<VerifiedPhone | null>(null);
  const [err, setErr] = useState("");
  const cancelled = useRef(false);
  useEffect(() => () => { cancelled.current = true; }, []);

  async function start() {
    setErr(""); setV(null); cancelled.current = false;
    try {
      const sess = await startHandshake();
      setS(sess);
      setV(await awaitPhone(sess, () => cancelled.current));
    } catch (e) { if (!cancelled.current) setErr((e as Error).message); }
  }

  if (v) return (
    <div className="handshake" aria-live="polite">
      <p><strong>Your phone checked out on QoreChain.</strong> Its post-quantum key and encryption key match what the chain holds for {v.phoneEvm.slice(0, 8)}…{v.phoneEvm.slice(-4)}.</p>
      <p>Does your phone show these four words, in this order?</p>
      <ol className="hs-words">{v.words.map((w) => <li key={w}>{w}</li>)}</ol>
      <div className="hs-actions">
        <button type="button" className="btn btn-primary" onClick={() => onPaired(v.phoneEvm)}>Yes, they match</button>
        <button type="button" className="btn btn-secondary" onClick={() => { setV(null); setS(null); setErr("Pairing stopped. If the words were different, someone may have got in between. Start again."); }}>No, they're different</button>
      </div>
    </div>
  );

  if (s) return (
    <div className="handshake">
      <p>On your phone, open the camera and scan this. It opens Bulkhead with a one-time pairing code.</p>
      <div className="hs-qr"><Qr text={s.link} /></div>
      <p className="setup-muted">The code holds a throwaway post-quantum key. Your phone signs its answer with its own post-quantum key and encrypts it to this one, so our server only carries ciphertext. It expires in 10 minutes.</p>
      <p role="status" className="setup-muted">Waiting for your phone…</p>
      <details><summary>Can't scan? Open this link on your phone</summary><p className="mono" style={{ overflowWrap: "anywhere", fontSize: 13 }}>{s.link}</p></details>
      {err && <p role="alert" className="setup-error">{err}</p>}
    </div>
  );

  return (
    <div className="handshake">
      <p>First create the Safety key on your phone: open Bulkhead there at <span className="mono">/#/phone</span>. Then pair it here. Nothing is typed or pasted, so nothing can be swapped on the way.</p>
      {err && <p role="alert" className="setup-error">{err}</p>}
      <button type="button" className="btn btn-primary" onClick={() => void start()}>Show the pairing code</button>
    </div>
  );
}
