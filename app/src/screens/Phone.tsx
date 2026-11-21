// Phone safety view (docs/DESIGN_SYSTEM.md section 16.8). Phone first, centred at 440px on desktop.
// Approvals are not signed here yet. `signer` throws NOT_WIRED until the phone signer (ML-DSA-87 with the SDK)
// is connected, so this screen never shows an approval that did not happen.
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Address } from "viem";
import { pub, readAccount, fmt, type AccountView } from "../chain/account";
import accountAbi from "../chain/abi/BulkheadAccount.json";
import { DEPLOYMENT, EXPLORER_TX, NATIVE, TOKENS } from "../chain/config";
import { NOT_WIRED, actions } from "../chain/actions";
import { ActionButton } from "../ui/Button";
import { Mark } from "../ui/Mark";
import { NetworkReadout } from "../ui/Shell";
import { HullRow } from "../ui/Hull";
import { StatusMark } from "../ui/Status";
import { compartmentsFrom } from "./Hull";
import "./phone.css";

export interface PhoneSigner {
  approve(requestId: string): Promise<{ txHash: string }>;
  refuseAndSeal(requestId: string): Promise<void>;
}

// Placeholder until the phone signer is wired. It throws, so the UI shows the failure instead of an approval.
const signer: PhoneSigner = {
  approve: async (_requestId) => { throw new Error(NOT_WIRED); },
  refuseAndSeal: async (_requestId) => { throw new Error(NOT_WIRED); },
};

const ACCOUNT = DEPLOYMENT.demoAccount as Address;
const ZERO = "0x0000000000000000000000000000000000000000";
const T = TOKENS.fUSD;
const SHORT_ACCOUNT = `${ACCOUNT.slice(0, 6)}…${ACCOUNT.slice(-4)}`;

/** Example data only. It is labelled "Example request" on screen. */
const DEMO_REQUEST = {
  id: "demo",
  kind: "Raise Everyday's daily cap",
  now: 15000000n,
  after: 80000000n,
  blocks: 20,
  askedBy: "Your laptop",
  ttlMs: 10 * 60 * 1000,
  decoded: `the transaction raises periodCap on ${SHORT_ACCOUNT}. Nothing else.`,
};

function useDemoAccount() {
  const [acct, setAcct] = useState<AccountView | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let on = true;
    const load = () => readAccount(ACCOUNT, T.address as Address)
      .then((a) => { if (on) { setAcct(a); setErr(""); } })
      .catch(() => { if (on) setErr("We can't reach QoreChain right now. Your walls hold on chain without us."); });
    load();
    const t = setInterval(load, 5000);
    return () => { on = false; clearInterval(t); };
  }, []);
  return { acct, err };
}

type Recovery = { status: "loading" } | { status: "none" } | { status: "error" } | { status: "set"; address: Address };

function useRecovery(): Recovery {
  const [r, setR] = useState<Recovery>({ status: "loading" });
  useEffect(() => {
    let on = true;
    const c = { address: ACCOUNT, abi: accountAbi } as const;
    pub.readContract({ ...c, functionName: "recovery" })
      .then((a) => { if (on) setR(a === ZERO ? { status: "none" } : { status: "set", address: a as Address }); })
      .catch(() => { if (on) setR({ status: "error" }); });
    return () => { on = false; };
  }, []);
  return r;
}

function recoveryLabel(r: Recovery): string {
  switch (r.status) {
    case "loading": return "Checking the chain…";
    case "none": return "Not set yet";
    case "error": return "Can't read it right now";
    case "set": return r.address;
  }
}

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Two-step break-glass sheet: the recovery address first, then the final button. */
function BreakGlass({ recovery }: { recovery: Recovery }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const address = recovery.status === "set" ? recovery.address : null;
  const close = () => dlg.current?.close();
  return (
    <>
      <button type="button" className="plate entry" aria-haspopup="dialog"
        onClick={() => { setStep(1); dlg.current?.showModal(); }}>
        <strong>Send everything to my recovery account</strong>
        <span className="muted">Break-glass. You'll see the recovery address before anything is sent.</span>
      </button>
      <dialog ref={dlg} className="sheet" aria-labelledby="bg-title">
        {step === 1 ? (
          <div className="sheet-body">
            <span className="label">Step 1 of 2</span>
            <h2 id="bg-title">Your recovery account</h2>
            <p className={address ? "mono addr" : "addr"}>{recoveryLabel(recovery)}</p>
            <p className="muted">Everything in every compartment goes to this address. Nothing else is sent.</p>
            {!address && <p className="muted">Set a recovery account in Account first. Until then nothing can be sent here.</p>}
            <div className="sheet-actions">
              <button type="button" className="btn btn-secondary" onClick={close}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={!address} onClick={() => setStep(2)}>Next</button>
            </div>
          </div>
        ) : (
          <div className="sheet-body">
            <span className="label">Step 2 of 2</span>
            <h2 id="bg-title">Send everything now?</h2>
            <p className="muted">This sends the money in Everyday and Savings to your recovery account, at once. Use it only if you think your laptop key is in someone else's hands.</p>
            <ActionButton block onDone={close}
              run={(step) => actions.breakGlass(ACCOUNT, [T.address as Address, NATIVE], step).then(() => "Sent to your recovery account")}>
              Send everything to my recovery account
            </ActionButton>
            <div className="sheet-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setStep(1)}>Back</button>
              <button type="button" className="btn btn-secondary" onClick={close}>Cancel</button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}

function AtRest() {
  const { acct, err } = useDemoAccount();
  const recovery = useRecovery();
  return (
    <>
      <section aria-label="Your hull">
        <div className="mini" aria-busy={!acct}>
          {acct ? <HullRow compartments={compartmentsFrom(acct)} /> : <div className="plate skeleton" />}
        </div>
        {err && !acct && <p role="alert" className="flood-line">{err}</p>}
      </section>
      <section className="rest" aria-labelledby="rest-h">
        <h2 id="rest-h">Nothing to approve.</h2>
        <p className="muted">Your phone signs only when a change is waiting for it.</p>
      </section>
      <BreakGlass recovery={recovery} />
    </>
  );
}

/** A request on the phone. Approval needs a full one-second hold, or a confirm sheet from the keyboard. */
function Approval({ req, mismatch }: { req: typeof DEMO_REQUEST; mismatch: boolean }) {
  const [expiresAt] = useState(() => Date.now() + req.ttlMs);
  const now = useNow();
  const left = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const expired = left === 0;
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;

  const [holding, setHolding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [approveErr, setApproveErr] = useState("");
  const [refuseErr, setRefuseErr] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  const holdTimer = useRef<number | null>(null);
  const confirm = useRef<HTMLDialogElement>(null);

  useEffect(() => () => { if (holdTimer.current !== null) window.clearTimeout(holdTimer.current); }, []);

  async function approve() {
    setBusy(true); setApproveErr("");
    try {
      const r = await signer.approve(req.id);
      setSent(r.txHash);
    } catch (e) {
      setApproveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function refuse() {
    setBusy(true); setRefuseErr("");
    try {
      await signer.refuseAndSeal(req.id);
      setRefused(true);
    } catch (e) {
      setRefuseErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function startHold(e: ReactPointerEvent<HTMLButtonElement>) {
    if (busy || e.button !== 0) return;
    setApproveErr(""); setHolding(true);
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null;
      setHolding(false);
      void approve();
    }, 1000);
  }

  function endHold() {
    setHolding(false);
    if (holdTimer.current !== null) { window.clearTimeout(holdTimer.current); holdTimer.current = null; }
  }

  // Enter or Space gives a click with detail 0. Those open the confirm sheet instead of the hold.
  function keyboardOpen(e: MouseEvent<HTMLButtonElement>) {
    if (e.detail !== 0) return;
    if (!confirm.current?.open) confirm.current?.showModal();
  }

  const canApprove = !mismatch && !expired && !sent && !refused;
  const canRefuse = !sent && !refused;

  return (
    <section className="req" aria-labelledby="req-title">
      <div className="req-meta">
        <span className="chip">Example request</span>
        <StatusMark kind="phone" />
      </div>

      {mismatch && (
        <p role="alert" className="flood-line">This request doesn't match what your laptop asked for. Don't approve it.</p>
      )}

      <h2 id="req-title">{req.kind}</h2>

      <div className="pair">
        <div className="plate pl">
          <span className="label">Now</span>
          <span className="pl-num">{fmt(req.now, T.decimals, T.places)}</span>
          <span className="pl-unit">{T.symbol} a day</span>
        </div>
        <div className="plate pl">
          <span className="label">After</span>
          <span className="pl-num">{fmt(req.after, T.decimals, T.places)}</span>
          <span className="pl-unit">{T.symbol} a day</span>
        </div>
      </div>

      <dl className="facts">
        <div><dt>Takes effect</dt><dd>{req.blocks} blocks after approval</dd></div>
        <div><dt>Asked by</dt><dd>{req.askedBy}</dd></div>
        <div>
          <dt>Expires</dt>
          <dd role="timer">{expired ? "Expired. Ask again from your laptop." : `in ${clock}`}</dd>
        </div>
      </dl>

      <p className="decoded">
        <StatusMark kind="paid" word="Checked:" />
        <span className="mono">{req.decoded}</span>
      </p>

      {canApprove && (
        <div className="hold-wrap">
          <div className="hold" data-holding={holding}>
            <svg className="ring" viewBox="0 0 120 120" aria-hidden="true">
              <circle className="ring-track" cx="60" cy="60" r="56" />
              <circle className="ring-fill" cx="60" cy="60" r="56" />
            </svg>
            <button type="button" className="hold-btn" aria-label="Approve. Hold for one second."
              aria-describedby="hold-hint" aria-busy={busy} disabled={busy}
              onPointerDown={startHold} onPointerUp={endHold} onPointerLeave={endHold} onPointerCancel={endHold}
              onContextMenu={(e) => e.preventDefault()} onClick={keyboardOpen}>
              <svg viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square">
                <rect x="14" y="4" width="20" height="40" />
                <path d="M21 37h6" />
              </svg>
            </button>
          </div>
          <p id="hold-hint" className="muted hold-hint">Hold for 1 second to approve. Or press Enter to confirm in a sheet.</p>
          <p role="alert" className="err">{approveErr ? `Not approved. ${approveErr}` : ""}</p>
          <dialog ref={confirm} className="sheet" aria-labelledby="confirm-title">
            <div className="sheet-body">
              <span className="label">Example request</span>
              <h2 id="confirm-title">Approve this on your phone?</h2>
              <p className="muted">{req.kind}: from {fmt(req.now, T.decimals, T.places)} to {fmt(req.after, T.decimals, T.places)} {T.symbol} a day. It takes effect {req.blocks} blocks after approval.</p>
              <div className="sheet-actions">
                <button type="button" className="btn btn-secondary" onClick={() => confirm.current?.close()}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={() => { confirm.current?.close(); void approve(); }}>Approve</button>
              </div>
            </div>
          </dialog>
        </div>
      )}

      {sent && (
        <div className="sent">
          <p role="status">Sent to the chain. Waiting for it to confirm.</p>
          <a className="hash-link" href={`${EXPLORER_TX}${sent}`} target="_blank" rel="noreferrer">
            <span className="hash mono">{`${sent.slice(0, 8)}…${sent.slice(-6)}`}</span>QoreScan
          </a>
        </div>
      )}

      {refused && <StatusMark kind="sealed" word="Refused. Everyday is sealed." />}

      {canRefuse && (
        <div className="refuse">
          <button type="button" className="btn btn-secondary" aria-busy={busy} disabled={busy} onClick={() => void refuse()}>
            I didn't ask for this
          </button>
          <p className="muted">Refuses this request and seals the compartment it changes.</p>
          <p role="alert" className="err">{refuseErr ? `Not refused. ${refuseErr}` : ""}</p>
        </div>
      )}
    </section>
  );
}

function RequestView({ id, mismatch }: { id: string; mismatch: boolean }) {
  if (id !== DEMO_REQUEST.id) {
    return (
      <section className="plate" aria-labelledby="none-h">
        <h2 id="none-h">No request with that id</h2>
        <p className="muted">It may have expired. Ask again from your laptop.</p>
      </section>
    );
  }
  return <Approval req={DEMO_REQUEST} mismatch={mismatch} />;
}

export function PhoneScreen() {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  const query = new URLSearchParams(hash.split("?")[1] ?? "");
  const req = query.get("req");
  const mismatch = query.get("mismatch") === "1";
  return (
    <main className="phone">
      <header className="plate ph">
        <span className="ph-mark"><Mark size={28} /></span>
        <h1>Safety key</h1>
        <NetworkReadout />
      </header>
      {req !== null ? <RequestView id={req} mismatch={mismatch} /> : <AtRest />}
    </main>
  );
}
