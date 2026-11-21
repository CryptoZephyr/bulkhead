// Phone safety view (docs/DESIGN_SYSTEM.md section 16.8). Phone first, centred at 440px on desktop.
// Flow: create or unlock the Safety key on this phone, show its address for pairing, make sure the
// phone's account is funded and registered, then show the requests waiting for it. Every number and
// sentence on a request comes from describe() on the chain, never from the request text itself.
import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Address } from "viem";
import { pub, readAccount, type AccountView } from "../chain/account";
import accountAbi from "../chain/abi/BulkheadAccount.json";
import { EXPLORER_TX, NATIVE, TOKENS } from "../chain/config";
import {
  hasSafetyKey, createSafetyKey, unlockSafetyKey, currentSafety, phoneReadiness, registerPhoneKeys, type SafetyKey,
} from "../chain/device";
import {
  approveQueued, describe, openRequest, signIntent, targetOf, type Intent, type RequestBody,
} from "../chain/requests";
import { ActionButton, type Step } from "../ui/Button";
import { Mark } from "../ui/Mark";
import { NetworkReadout } from "../ui/Shell";
import { HullRow } from "../ui/Hull";
import { StatusMark } from "../ui/Status";
import { compartmentsFrom } from "./Hull";
import "./phone.css";

const ZERO = "0x0000000000000000000000000000000000000000";
const T = TOKENS.fUSD;
const KNOWN_KEY = "bh-phone-account";
const ADDR = /^0x[0-9a-fA-F]{40}$/;

/** The request as the queue returns it (api/requests.ts GET). */
interface Waiting { id: string; account: string; phone: string; envelope: string; createdAt: number; expiresAt: number; status: string }
type Decoded = Awaited<ReturnType<typeof describe>>;
type Outcome = { id: string; kind: "approved"; txHash: string } | { id: string; kind: "refused" };

/** The Bulkhead account this phone last guarded, remembered as a public address only (per-viewer convenience). */
function readKnownAccount(): Address | null {
  try {
    const v = localStorage.getItem(KNOWN_KEY);
    return v && ADDR.test(v) ? (v as Address) : null;
  } catch { return null; }
}
function rememberAccount(a: Address) {
  try { localStorage.setItem(KNOWN_KEY, a); } catch { /* private window: nothing to remember */ }
}

/** Groups an address in fours for reading: 0x1c54 8456 DE86 ... */
function groupFours(s: string): string[] {
  return s.match(/.{1,4}/g) ?? [s];
}

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function useAccount(account: Address | null) {
  const [acct, setAcct] = useState<AccountView | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!account) { setAcct(null); return; }
    let on = true;
    const load = () => readAccount(account, T.address as Address)
      .then((a) => { if (on) { setAcct(a); setErr(""); } })
      .catch(() => { if (on) setErr("We can't reach QoreChain right now. Your walls hold on chain without us."); });
    load();
    const t = setInterval(load, 5000);
    return () => { on = false; clearInterval(t); };
  }, [account]);
  return { acct, err };
}

type Recovery = { status: "unknown" } | { status: "loading" } | { status: "none" } | { status: "error" } | { status: "set"; address: Address };

function useRecovery(account: Address | null): Recovery {
  const [r, setR] = useState<Recovery>({ status: "unknown" });
  useEffect(() => {
    if (!account) { setR({ status: "unknown" }); return; }
    let on = true;
    setR({ status: "loading" });
    pub.readContract({ address: account, abi: accountAbi, functionName: "recovery" })
      .then((a) => { if (on) setR(a === ZERO ? { status: "none" } : { status: "set", address: a as Address }); })
      .catch(() => { if (on) setR({ status: "error" }); });
    return () => { on = false; };
  }, [account]);
  return r;
}

function recoveryLabel(r: Recovery): string {
  switch (r.status) {
    case "unknown": return "Not known yet";
    case "loading": return "Checking the chain…";
    case "none": return "Not set yet";
    case "error": return "Can't read it right now";
    case "set": return r.address;
  }
}

/** Sends a Safety-key-signed intent through the relayer and returns the tx hash once the chain accepts it. */
async function sendSigned(k: SafetyKey, account: Address, intent: Intent, step: Step): Promise<string> {
  step("Signing with your post-quantum key", 0.35);
  const data = await signIntent(k.account, account, intent);
  step("Sending to QoreChain", 0.6);
  const r = await fetch("/api/relay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to: targetOf(account, intent), data }) });
  const j = await r.json();
  if (!r.ok || j.status !== "success") throw new Error(j.error ?? "The chain refused it. Nothing changed.");
  step("Done", 1);
  return j.txHash as string;
}

/** An address in mono, in fours, with a Copy button. Falls back to selecting the text if the clipboard is refused. */
function CopyAddress({ value, label, grouped = true }: { value: string; label: string; grouped?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [note, setNote] = useState("");

  function select() {
    const el = ref.current;
    if (!el) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    setNote("Selected. Press Ctrl+C to copy.");
  }

  // writeText is called straight from the click, so browsers allow it.
  function copy() {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(
        () => setNote("Copied."),
        () => select(),
      );
    } else {
      select();
    }
  }

  return (
    <div className="copy-row">
      <span ref={ref} className="mono addr-text" aria-label={label}>
        {grouped ? groupFours(value).map((g, i) => <Fragment key={i}><span className="grp">{g}</span>{" "}</Fragment>) : value}
      </span>
      <button type="button" className="btn btn-secondary copy-btn" onClick={copy}>Copy</button>
      <p className="muted copy-note" role="status">{note}</p>
    </div>
  );
}

/** Two-step break-glass sheet: the recovery address first, then the final button. */
function BreakGlass({ account, safety }: { account: Address | null; safety: SafetyKey }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const recovery = useRecovery(account);
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
              <button type="button" className="btn btn-primary" disabled={!address || !account} onClick={() => setStep(2)}>Next</button>
            </div>
          </div>
        ) : (
          <div className="sheet-body">
            <span className="label">Step 2 of 2</span>
            <h2 id="bg-title">Send everything now?</h2>
            <p className="muted">This sends the money in Everyday and Savings to your recovery account, at once. Use it only if you think your laptop key is in someone else's hands.</p>
            {account ? (
              <ActionButton block onDone={close}
                run={(s) => sendSigned(safety, account, { kind: "BreakGlass", assets: [T.address as Address, NATIVE] }, s)
                  .then(() => "Sent to your recovery account")}>
                Send everything to my recovery account
              </ActionButton>
            ) : (
              <p className="muted" role="status">Open a request from your laptop first so this phone knows which account it guards.</p>
            )}
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

/** Nothing waiting: the hull in miniature (once this phone knows its account) and "Nothing to approve." */
function AtRest({ account, safety }: { account: Address | null; safety: SafetyKey }) {
  const { acct, err } = useAccount(account);
  return (
    <>
      <section aria-label="Your hull">
        {account ? (
          <div className="mini" aria-busy={!acct}>
            {acct ? <HullRow compartments={compartmentsFrom(acct)} /> : <div className="plate skeleton" />}
          </div>
        ) : (
          <p className="muted">Your hull shows here once your laptop has sent this phone a request.</p>
        )}
        {err && !acct && <p role="alert" className="flood-line">{err}</p>}
      </section>
      <section className="rest" aria-labelledby="rest-h">
        <h2 id="rest-h">Nothing to approve.</h2>
        <p className="muted">Your phone signs only when a change is waiting for it.</p>
      </section>
      <BreakGlass account={account} safety={safety} />
    </>
  );
}

/** One waiting request. It is opened and checked before anything is shown; approval needs a full one-second hold. */
function Incoming({ req, safety, onAccount, onOutcome }: {
  req: Waiting; safety: SafetyKey; onAccount: (a: Address) => void; onOutcome: (o: Outcome) => void;
}) {
  const [d, setD] = useState<{ s: "checking" } | { s: "bad" } | { s: "mismatch" } | { s: "error" } | { s: "ok"; body: RequestBody; view: Decoded }>({ s: "checking" });
  const now = useNow();
  const left = Math.max(0, Math.ceil((req.expiresAt - now) / 1000));
  const expired = left === 0;
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;

  const [holding, setHolding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<{ label: string; p: number }>({ label: "", p: 0 });
  const [approveErr, setApproveErr] = useState("");
  const [refuseErr, setRefuseErr] = useState("");
  const holdTimer = useRef<number | null>(null);
  const confirm = useRef<HTMLDialogElement>(null);

  useEffect(() => () => { if (holdTimer.current !== null) window.clearTimeout(holdTimer.current); }, []);

  // Open the envelope with this phone's keys. A failure means it was not sealed to this phone, or was altered.
  useEffect(() => {
    let on = true;
    let body: RequestBody;
    try {
      body = openRequest(req.envelope, safety.mnemonic);
    } catch {
      setD({ s: "bad" });
      return;
    }
    if (body.account.toLowerCase() !== req.account.toLowerCase()) {
      setD({ s: "mismatch" });
      return;
    }
    describe(body.account, body.intent)
      .then((view) => {
        if (!on) return;
        onAccount(body.account);
        setD({ s: "ok", body, view });
      })
      .catch(() => { if (on) setD({ s: "error" }); });
    return () => { on = false; };
    // onAccount is a stable state setter wrapper from the parent; the request itself is what matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req.id, req.envelope, req.account, safety]);

  const view = d.s === "ok" ? d.view : null;
  const verified = d.s === "ok";

  async function approve() {
    if (d.s !== "ok") return;
    setBusy(true); setApproveErr("");
    try {
      const txHash = await approveQueued({ id: req.id, account: req.account as Address, envelope: req.envelope }, safety.account, safety.mnemonic, (label, p) => setStep({ label, p }));
      onOutcome({ id: req.id, kind: "approved", txHash });
    } catch (e) {
      setApproveErr(e instanceof Error ? e.message : String(e));
      setStep({ label: "", p: 0 });
      setBusy(false);
    }
  }

  async function refuse() {
    setBusy(true); setRefuseErr("");
    try {
      const r = await fetch(`/api/requests?id=${encodeURIComponent(req.id)}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "refused" }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "The queue didn't take it.");
      onOutcome({ id: req.id, kind: "refused" });
    } catch (e) {
      setRefuseErr(`Not refused. ${e instanceof Error ? e.message : String(e)}`);
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

  const canApprove = verified && !expired && !busy;
  const title = d.s === "ok" ? d.view.title : d.s === "checking" ? "Checking this request" : "This request can't be checked";

  return (
    <section className="req" aria-labelledby="req-title">
      <div className="req-meta">
        <StatusMark kind="phone" />
      </div>

      {(d.s === "bad" || d.s === "mismatch") && (
        <p role="alert" className="flood-line">This request doesn't match what your laptop asked for. Don't approve it.</p>
      )}
      {d.s === "error" && (
        <p role="alert" className="flood-line">We can't check this request on the chain right now. Refuse it, or ask again from your laptop.</p>
      )}

      <h2 id="req-title">{title}</h2>

      {view && (
        <>
          {(view.now || view.after) && (
            <div className="pair">
              {view.now && (
                <div className="plate pl">
                  <span className="label">Now</span>
                  <span className="pl-text">{view.now}</span>
                </div>
              )}
              {view.after && (
                <div className="plate pl">
                  <span className="label">After</span>
                  <span className="pl-text">{view.after}</span>
                </div>
              )}
            </div>
          )}

          {view.delayed && <p className="muted takes">Takes effect about 20 blocks after you approve</p>}

          <dl className="facts">
            <div><dt>Asked by</dt><dd>{d.s === "ok" && d.body.from === "agent" ? "Your bill agent" : "Your laptop"}</dd></div>
            <div>
              <dt>Expires</dt>
              <dd role="timer">{expired ? "Expired. Ask again from your laptop." : `in ${clock}`}</dd>
            </div>
          </dl>

          <p className="decoded">
            <StatusMark kind="paid" word="Checked:" />
            <span className="mono">{view.check}</span>
          </p>
        </>
      )}

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
              <span className="label">Approve on your phone</span>
              <h2 id="confirm-title">Approve this on your phone?</h2>
              {view && (
                <p className="muted">
                  {view.title}.{view.now ? ` Now: ${view.now}.` : ""}{view.after ? ` After: ${view.after}.` : ""}
                  {view.delayed ? " Takes effect about 20 blocks after approval." : ""}
                </p>
              )}
              <div className="sheet-actions">
                <button type="button" className="btn btn-secondary" onClick={() => confirm.current?.close()}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={() => { confirm.current?.close(); void approve(); }}>Approve</button>
              </div>
            </div>
          </dialog>
        </div>
      )}

      {busy && (
        <div className="step" role="status" aria-live="polite">
          <span>{step.label || "Starting"}</span>
          <span className="step-track" aria-hidden="true"><b style={{ width: `${step.p * 100}%` }} /></span>
        </div>
      )}

      <div className="refuse">
        <button type="button" className="btn btn-secondary" aria-busy={busy} disabled={busy} onClick={() => void refuse()}>
          I didn't ask for this
        </button>
        <p className="muted">Refuses this request. Nothing changes.</p>
        <p role="alert" className="err">{refuseErr}</p>
      </div>
    </section>
  );
}

/** What happened to a request the phone settled. Stays until the next request arrives or it is dismissed. */
function OutcomeCard({ outcome, onDismiss }: { outcome: Outcome; onDismiss: () => void }) {
  return (
    <section className="rest" aria-label="Last request">
      {outcome.kind === "approved" ? (
        <>
          <StatusMark kind="paid" word="Approved." />
          <p role="status">The chain accepted it.</p>
          <a className="hash-link" href={`${EXPLORER_TX}${outcome.txHash}`} target="_blank" rel="noreferrer">
            <span className="hash mono">{`${outcome.txHash.slice(0, 8)}…${outcome.txHash.slice(-6)}`}</span>QoreScan
          </a>
        </>
      ) : (
        <p role="status" className="refused">Refused. Nothing changed. Seal the account from your laptop now: it's one tap.</p>
      )}
      <button type="button" className="btn btn-secondary dismiss" onClick={onDismiss}>Back to your hull</button>
    </section>
  );
}

/** Polls the approval queue for this phone every 4 s. */
function useInbox(cosmos: string) {
  const [list, setList] = useState<Waiting[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let on = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/requests?phone=${encodeURIComponent(cosmos)}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "queue");
        if (on) { setList(j as Waiting[]); setErr(""); }
      } catch {
        if (on) setErr("We can't reach the approval queue right now. Requests will show when it's back.");
      }
    };
    void load();
    const t = setInterval(load, 4000);
    return () => { on = false; clearInterval(t); };
  }, [cosmos]);
  return { list, err };
}

type Readiness = { funded: boolean; pqProven: boolean; kemRegistered: boolean };

/** Re-checks this phone's account every 10 s. */
function useReadiness(k: SafetyKey) {
  const [r, setR] = useState<Readiness | null>(null);
  const [err, setErr] = useState(false);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let on = true;
    const load = () => phoneReadiness(k.account)
      .then((v) => { if (on) { setR(v); setErr(false); } })
      .catch(() => { if (on) setErr(true); });
    void load();
    const t = setInterval(load, 10_000);
    return () => { on = false; clearInterval(t); };
  }, [k, tick]);
  return { r, err, refresh };
}

/** The unlocked phone: its address, its readiness, then the queue. */
function Unlocked({ safety }: { safety: SafetyKey }) {
  const { r: ready, err: readyErr, refresh } = useReadiness(safety);
  const isReady = !!ready && ready.funded && ready.pqProven && ready.kemRegistered;
  const [known, setKnown] = useState<Address | null>(() => readKnownAccount());
  const onAccount = useCallback((a: Address) => { rememberAccount(a); setKnown(a); }, []);
  const { list, err: inboxErr } = useInbox(safety.account.cosmos);
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const pending = (list ?? []).filter((q) => !done.has(q.id));
  const first = pending[0];

  function settle(o: Outcome) {
    setDone((s) => new Set(s).add(o.id));
    setOutcome(o);
  }

  return (
    <>
      <section className="plate addr-plate" aria-labelledby="addr-h">
        <span className="label" id="addr-h">This phone's address</span>
        <CopyAddress value={safety.account.evm} label="This phone's address" />
        <p>Enter this address on your laptop to pair.</p>
      </section>

      {!isReady && (
        <section className="plate ready-plate" aria-labelledby="ready-h" aria-busy={!ready && !readyErr}>
          {readyErr && !ready && (
            <p role="alert" className="flood-line">We can't check this phone's account right now. Trying again.</p>
          )}
          {!ready && !readyErr && <p className="muted">Checking this phone's account…</p>}
          {ready && !ready.funded && (
            <>
              <h2 id="ready-h">This phone's account needs a little QOR for gas</h2>
              <p className="muted">Send QOR to this address on QoreChain:</p>
              <CopyAddress value={safety.account.cosmos} label="Gas address (qor1)" grouped={false} />
            </>
          )}
          {ready && ready.funded && !(ready.pqProven && ready.kemRegistered) && (
            <>
              <h2 id="ready-h">Register this phone's keys</h2>
              <p className="muted">Two one-time registrations on QoreChain, so laptops can seal requests to this phone.</p>
              <ActionButton block onDone={refresh}
                run={(step) => registerPhoneKeys(safety, step).then(() => "Keys registered")}>
                Register this phone's keys
              </ActionButton>
            </>
          )}
        </section>
      )}

      {isReady && (
        first ? (
          <Incoming key={first.id} req={first} safety={safety} onAccount={onAccount} onOutcome={settle} />
        ) : outcome ? (
          <OutcomeCard outcome={outcome} onDismiss={() => setOutcome(null)} />
        ) : (
          <>
            {inboxErr && <p role="alert" className="flood-line">{inboxErr}</p>}
            <AtRest account={known} safety={safety} />
          </>
        )
      )}
    </>
  );
}

/** No key yet: create one. The password is only used to encrypt the key and is never stored. */
function CreateKey({ onCreated }: { onCreated: () => void }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  return (
    <section className="plate setup-plate" aria-labelledby="create-h">
      <h2 id="create-h">Create your Safety key</h2>
      <p className="muted">This phone holds the key that approves changes to your account. The password encrypts it on this phone only. Bulkhead never sees it, and it can't be recovered if you lose it.</p>
      <label className="field">
        <span>Password</span>
        <input type="password" autoComplete="new-password" minLength={10} value={pw} onChange={(e) => setPw(e.target.value)} />
      </label>
      <label className="field">
        <span>Confirm password</span>
        <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
      </label>
      <p className="muted hint">At least 10 characters.</p>
      <ActionButton block onDone={onCreated}
        run={async () => {
          if (pw.length < 10) throw new Error("Use a password of at least 10 characters.");
          if (pw !== pw2) throw new Error("The two passwords don't match.");
          await createSafetyKey(pw);
          return "Safety key created";
        }}>
        Create your Safety key
      </ActionButton>
    </section>
  );
}

/** Key on this phone but locked: unlock it. The password is kept only for this call. */
function UnlockKey({ onUnlocked }: { onUnlocked: () => void }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr("");
    try {
      await unlockSafetyKey(pw);
      setPw("");
      onUnlocked();
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
      setBusy(false);
    }
  }
  return (
    <section className="plate setup-plate" aria-labelledby="unlock-h">
      <h2 id="unlock-h">Unlock your Safety key</h2>
      <p className="muted">Enter the password for the Safety key on this phone.</p>
      <form onSubmit={submit} className="unlock">
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-primary block" aria-busy={busy} disabled={busy || pw.length === 0}>
          Unlock
        </button>
        <p role="alert" className="err">{err}</p>
      </form>
    </section>
  );
}

export function PhoneScreen() {
  const [phase, setPhase] = useState<"loading" | "none" | "locked" | "open">("loading");
  const [safety, setSafety] = useState<SafetyKey | null>(null);

  useEffect(() => {
    setPhase(hasSafetyKey() ? "locked" : "none");
  }, []);

  function opened() {
    setSafety(currentSafety());
    setPhase("open");
  }

  return (
    <main className="phone">
      <header className="plate ph">
        <span className="ph-mark"><Mark size={28} /></span>
        <h1>Safety key</h1>
        <NetworkReadout />
      </header>
      {phase === "none" && <CreateKey onCreated={opened} />}
      {phase === "locked" && <UnlockKey onUnlocked={opened} />}
      {phase === "open" && safety && <Unlocked safety={safety} />}
    </main>
  );
}
