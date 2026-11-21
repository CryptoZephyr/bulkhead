// Setup (docs/DESIGN_SYSTEM.md section 16.2). The hull is built on screen, one step at a time.
// Progress comes from the chain: a saved pairing with code at its account resumes at the funding step.
// The laptop key password lives only in component state and is cleared after use.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { formatUnits, parseUnits, toHex, type Address } from "viem";
import { pub, readAccount, fmt, type AccountView } from "../chain/account";
import { createEverydayKey, current, hasStoredKey, unlock } from "../chain/wallet";
import { pairing, savePairing } from "../chain/device";
import { initArgs, sendToPhone, type DeployInit } from "../chain/requests";
import { fundFromQorex, isQorexAvailable } from "../chain/qorex";
import { DEPLOYMENT, EXPLORER_TX, NATIVE, REST, TOKENS } from "../chain/config";
import factoryAbi from "../chain/abi/BulkheadFactory.json";
import { ActionButton, type Step } from "../ui/Button";
import { HullRow, type CompartmentView } from "../ui/Hull";
import { StatusMark } from "../ui/Status";
import { compartmentsFrom } from "./Hull";
import "./setup.css";

const T = TOKENS.fUSD;
const MIN_GAS_UQOR = 300_000n;            // 0.3 QOR: enough for the laptop key's windows
const PERIOD_BLOCKS = "14400";            // about a day at 6 s a block
const LOOSEN_DELAY = "600";               // about an hour at 6 s a block
const POLL_MS = 5000;
const REQUEST_POLL_MS = 3000;
const REQUEST_POLLS = 400;                // about 20 minutes
const WAITING = "Waiting for your phone. Open Bulkhead on it and hold to approve.";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const AMOUNT = /^\d{1,12}(\.\d{1,6})?$/;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const myKey = () => { try { return current(); } catch { return null; } };

/** Turns a failed chain or network call into one plain sentence. */
async function plain<T>(p: Promise<T>, message: string): Promise<T> {
  try { return await p; } catch (e) { console.warn("[setup]", message, e); throw new Error(message); }
}

/** What the user typed, as fUSD base units (6 places). Commas are allowed. */
function parseFusd(text: string, what: string): bigint {
  const s = text.trim().replace(/,/g, "");
  if (!AMOUNT.test(s)) throw new Error(`${what} needs a number with up to 6 decimals, like 12.50.`);
  return parseUnits(s, T.decimals);
}

/** Like parseFusd, but null instead of an error, for live suggestions. */
function tryParse(text: string): bigint | null {
  try { return parseFusd(text, ""); } catch { return null; }
}

function policyFrom(c: Caps) {
  const perTx = parseFusd(c.perTx, "Per payment");
  const periodCap = parseFusd(c.periodCap, "A day");
  const floor = parseFusd(c.floor, "Savings");
  if (perTx <= 0n || periodCap <= 0n) throw new Error("Per payment and a day need an amount above zero.");
  if (perTx > periodCap) throw new Error("Per payment can't be more than a day's total.");
  return { perTxCap: perTx.toString(), periodCap: periodCap.toString(), floor: floor.toString() };
}

interface Caps { perTx: string; periodCap: string; floor: string }
interface Policy { perTxCap: string; periodCap: string; floor: string }

function pendingView(id: "everyday" | "savings", name: string, sentence: string): CompartmentView {
  return { id, name, unit: T.symbol, balance: "0.00", fill: 0, radius: "0.00", radiusShare: 0, state: "open", sentence, weight: 1 };
}

function TodoPlate({ name, text }: { name: string; text: string }) {
  return (
    <section className="setup-todo" aria-label={`${name}, not built yet`}>
      <span className="setup-todo-name">{name}</span>
      <span>{text}</span>
    </section>
  );
}

function HashPlate({ hash }: { hash: string }) {
  return (
    <a className="hash setup-hash" href={`${EXPLORER_TX}${hash}`} target="_blank" rel="noreferrer">
      <span className="mono">{short(hash)}</span><span>QoreScan</span>
    </a>
  );
}

function StepCard(p: { id: string; title: string; state: "done" | "current" | "todo"; summary?: string; extra?: ReactNode; children?: ReactNode }) {
  if (p.state === "done") {
    return (
      <section className="plate setup-step is-done" aria-labelledby={p.id}>
        <h2 id={p.id}>{p.title}</h2>
        <StatusMark kind="paid" word={p.summary} />
        {p.extra}
      </section>
    );
  }
  if (p.state === "todo") {
    return <section className="setup-step is-todo" aria-labelledby={p.id}><h2 id={p.id}>{p.title}</h2></section>;
  }
  return (
    <section className="plate setup-step" aria-labelledby={p.id}>
      <h2 id={p.id}>{p.title}</h2>
      {p.children}
    </section>
  );
}

export function SetupScreen() {
  // Progress: 1 key, 2 gas, 3 phone, 4 walls, 5 account, 6 fund, 7 done.
  const [cur, setCur] = useState(1);
  const [checking, setChecking] = useState(() => !!pairing());
  const [resumeErr, setResumeErr] = useState("");
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // Step 1: laptop key
  const [keyStored] = useState(() => hasStoredKey());
  const [unlocked, setUnlocked] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");

  // Step 2: gas
  const [copied, setCopied] = useState(false);
  const [copyErr, setCopyErr] = useState("");
  const [gasErr, setGasErr] = useState("");

  // Step 3: phone
  const [phoneText, setPhoneText] = useState(() => pairing()?.phoneEvm ?? "");
  const [phone, setPhone] = useState<Address | null>(null);
  const [phoneErr, setPhoneErr] = useState("");

  // Step 4: walls
  const [spend, setSpend] = useState("");
  const [savings, setSavings] = useState("");
  const [caps, setCaps] = useState<Caps>({ perTx: "", periodCap: "", floor: "" });
  const [walls, setWalls] = useState<Policy | null>(null);
  const [wallsErr, setWallsErr] = useState("");

  // Step 5: account
  const [predicted, setPredicted] = useState<Address | null>(null);
  const [createdTx, setCreatedTx] = useState("");
  const [retry, setRetry] = useState(false);
  const [waiting, setWaiting] = useState("");

  // Step 6: fund (live account read, from step 5 on)
  const [acct, setAcct] = useState<AccountView | null>(null);
  const [liveErr, setLiveErr] = useState("");
  const [amount, setAmount] = useState("");

  const me = unlocked ? myKey() : null;
  const qorex = isQorexAvailable();

  // Resume from the chain: a paired account with code at its address starts at funding.
  useEffect(() => {
    const p = pairing();
    if (!p) return;
    let on = true;
    pub.getCode({ address: p.account })
      .then((code) => {
        if (!on) return;
        if (code && code !== "0x") { setPredicted(p.account); setPhone(p.phoneEvm); setCur(6); }
      })
      .catch(() => { if (on) setResumeErr("We can't reach QoreChain to check your hull. Refresh the page to try again."); })
      .finally(() => { if (on) setChecking(false); });
    return () => { on = false; };
  }, []);

  // Step 2: wait for gas on the laptop key
  useEffect(() => {
    const k = cur === 2 && unlocked ? myKey() : null;
    if (!k) return;
    let on = true;
    const check = async () => {
      try {
        const r = await fetch(`${REST}/cosmos/bank/v1beta1/balances/${k.cosmos}`);
        if (!r.ok) throw new Error(String(r.status));
        const j = await r.json();
        const uqor = BigInt((j.balances ?? []).find((b: { denom: string }) => b.denom === "uqor")?.amount ?? "0");
        if (!on) return;
        setGasErr("");
        if (uqor > MIN_GAS_UQOR) setCur(3);
      } catch {
        if (on) setGasErr("We can't reach QoreChain to check your gas. Trying again.");
      }
    };
    check();
    const t = setInterval(check, POLL_MS);
    return () => { on = false; clearInterval(t); };
  }, [cur, unlocked]);

  // Steps 5 to 7: read the account from the chain. Funding is done when fUSD arrives.
  useEffect(() => {
    if (!predicted || cur < 6) return;
    let on = true;
    const load = async () => {
      try {
        const a = await readAccount(predicted, T.address as Address);
        if (!on) return;
        setAcct(a);
        setLiveErr("");
        if (cur === 6 && a.asset.balance > 0n) setCur(7);
      } catch {
        if (on) setLiveErr("We can't reach QoreChain to read your balance. Trying again.");
      }
    };
    load();
    const t = setInterval(load, POLL_MS);
    return () => { on = false; clearInterval(t); };
  }, [predicted, cur]);

  // Step 1 action: unlock, or create and then unlock. The password is cleared after use.
  async function openKey(): Promise<string> {
    if (keyStored) {
      await unlock(pw);
    } else {
      if (pw !== pw2) throw new Error("The two passwords don't match.");
      await createEverydayKey(pw);
      await unlock(pw);   // createEverydayKey does not unlock the key for this session
    }
    setPw(""); setPw2("");
    setUnlocked(true);
    return "Laptop key ready";
  }

  async function copyAddress(addr: string) {
    try {
      await navigator.clipboard.writeText(addr);
      setCopied(true); setCopyErr("");
    } catch {
      setCopied(false);
      setCopyErr("Copy didn't work. Select the address and copy it instead.");
    }
  }

  // Step 2 action
  async function fundGas(step: Step): Promise<string> {
    const k = myKey();
    if (!k) throw new Error("Unlock your laptop key first.");
    await fundFromQorex(k.evm as Address, "QOR", 10n ** 18n, step);
    return "QOR is on its way";
  }

  // Step 3 action
  function savePhone(e: FormEvent) {
    e.preventDefault();
    const v = phoneText.trim();
    if (!ADDRESS.test(v)) {
      setPhoneErr("That isn't an address. It starts with 0x and has 40 more letters or numbers.");
      return;
    }
    setPhoneErr("");
    setPhone(v as Address);
    setCur(4);
  }

  // Step 4: suggestions follow the two answers; the three numbers stay editable
  function onSpend(v: string) {
    setSpend(v);
    const day = tryParse(v);
    if (day !== null) setCaps((c) => ({ ...c, perTx: formatUnits(day / 2n, T.decimals), periodCap: formatUnits(day, T.decimals) }));
  }
  function onSavings(v: string) {
    setSavings(v);
    const keep = tryParse(v);
    if (keep !== null) setCaps((c) => ({ ...c, floor: formatUnits(keep, T.decimals) }));
  }
  function saveWalls(e: FormEvent) {
    e.preventDefault();
    try {
      setWalls(policyFrom(caps));
      setWallsErr("");
      setCur(5);
    } catch (err) {
      setWallsErr(err instanceof Error ? err.message : "Check the walls.");
    }
  }

  // Step 5 action: predict the address, pair the phone, send the request, wait, then check the chain
  async function createAccount(step: Step): Promise<string> {
    const k = myKey();
    if (!k || !walls || !phone) throw new Error("Unlock your laptop key and finish the steps above first.");
    const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const init: DeployInit = {
      everyday: k.evm as Address, safety: phone, recovery: NATIVE, periodBlocks: PERIOD_BLOCKS, loosenDelay: LOOSEN_DELAY,
      assets: [T.address as Address], policies: [walls], payees: [],
    };
    const addr = (await plain(
      pub.readContract({ address: DEPLOYMENT.factory, abi: factoryAbi, functionName: "predict", args: [initArgs(init), salt] }),
      "We can't reach QoreChain to work out your account's address. Try again.",
    )) as Address;

    const saved = savePairing(addr, phone);
    const id = await plain(
      sendToPhone(REST, saved.phoneQor, { v: 1, account: addr, from: "laptop", intent: { kind: "Deploy", salt, init }, createdAt: Date.now() }),
      "Your request couldn't be sent to your phone. Check the address and try again.",
    );

    let txHash = "";
    setWaiting(WAITING);
    try {
      step("Waiting for your phone", 0.5);
      for (let i = 0; ; i++) {
        if (i >= REQUEST_POLLS) { setRetry(true); throw new Error("Your phone hasn't answered yet. Send it again when you're ready."); }
        await sleep(REQUEST_POLL_MS);
        if (!alive.current) throw new Error("Your request is still waiting for your phone. Come back here to check it.");
        const r = await plain(fetch(`/api/requests?id=${encodeURIComponent(id)}`), "We can't check your request right now. Try again in a moment.");
        if (!r.ok) throw new Error("We can't check your request right now. Try again in a moment.");
        const j = (await r.json()) as { status: string; txHash?: string };
        if (j.status === "approved") { txHash = j.txHash ?? ""; break; }
        if (j.status === "refused") { setRetry(true); throw new Error("Your phone refused this. Nothing was created."); }
        if (j.status === "expired") { setRetry(true); throw new Error("The request expired before your phone approved it. Nothing was created."); }
      }
    } finally {
      setWaiting("");
    }

    // Approval is only shown once the chain has code at the predicted address.
    step("Checking the account on chain", 0.9);
    let live = false;
    for (let i = 0; i < 6 && !live; i++) {
      if (i > 0) await sleep(2000);
      live = await pub.getCode({ address: addr }).then((c) => !!c && c !== "0x").catch(() => false);
    }
    if (!live) throw new Error("Your phone approved it, but the chain doesn't show the account yet. Reload this page in a minute to check.");
    setPredicted(addr);
    setCreatedTx(txHash);
    setRetry(false);
    return "Account created";
  }

  // Step 6 action: the exact amount is shown before QoreX opens
  async function fundAccount(step: Step): Promise<string> {
    if (!predicted) throw new Error("Create your account first.");
    const amt = parseFusd(amount, "The amount");
    if (amt <= 0n) throw new Error("Enter an amount above zero.");
    await fundFromQorex(predicted, "fUSD", amt, step);
    return "Funds on the way";
  }

  const amountPreview = tryParse(amount);
  const built = { everyday: cur >= 2, savings: cur >= 4 };
  const live = cur >= 6 && acct ? compartmentsFrom(acct) : null;
  const st = (n: number): "done" | "current" | "todo" => (cur > n ? "done" : cur === n ? "current" : "todo");

  return (
    <div className="setup">
      {checking && <p role="status" className="setup-muted">Checking what's already on chain.</p>}
      {resumeErr && <p role="alert" className="setup-error">{resumeErr}</p>}

      {!checking && (
        <>
          <div className="setup-hull" role="group" aria-label="Your hull so far">
            {live ? <HullRow compartments={live} /> : (
              <>
                {built.everyday
                  ? <HullRow compartments={[pendingView("everyday", "Everyday", "Built. It fills when money comes in from QoreX.")]} />
                  : <TodoPlate name="Everyday" text="Built when you create your laptop key." />}
                {built.savings
                  ? <HullRow compartments={[pendingView("savings", "Savings", "Built. Money here leaves only with your phone.")]} />
                  : <TodoPlate name="Savings" text="Built when you pair your phone." />}
              </>
            )}
          </div>
          {liveErr && <p role="alert" className="setup-error">{liveErr}</p>}

          <div className="setup-steps">
            <StepCard id="setup-key" title="Create your laptop key" state={st(1)} summary="Laptop key ready">
              {!unlocked ? (
                <>
                  <p>{keyStored
                    ? "Enter the password for your laptop key. It opens the key in this browser."
                    : "Choose a password of at least 10 characters. It encrypts your laptop key in this browser. Bulkhead never stores the password."}</p>
                  <div className="setup-fields">
                    <label className="setup-field">
                      <span>Password</span>
                      <input className="setup-input" type="password" autoComplete={keyStored ? "current-password" : "new-password"}
                        value={pw} onChange={(e) => setPw(e.target.value)} />
                    </label>
                    {!keyStored && (
                      <label className="setup-field">
                        <span>Type it again</span>
                        <input className="setup-input" type="password" autoComplete="new-password"
                          value={pw2} onChange={(e) => setPw2(e.target.value)} />
                      </label>
                    )}
                  </div>
                  <ActionButton run={openKey}>{keyStored ? "Unlock my laptop key" : "Create my laptop key"}</ActionButton>
                </>
              ) : (
                <>
                  <dl className="setup-facts">
                    <dt>EVM address</dt><dd className="mono">{me?.evm}</dd>
                    <dt>Cosmos address</dt><dd className="mono">{me?.cosmos}</dd>
                  </dl>
                  <button type="button" className="btn btn-primary" onClick={() => setCur(2)}>Continue</button>
                </>
              )}
            </StepCard>

            <StepCard id="setup-gas" title="Get gas for your laptop key" state={st(2)} summary="Gas ready">
              <p>Your laptop key pays its own transaction fees in QOR. A little is enough.</p>
              {me && (
                <div className="setup-addr">
                  <span className="setup-muted">Gas address (qor1)</span>
                  <span className="mono setup-addr-text">{me.cosmos}</span>
                  <button type="button" className="btn btn-secondary btn-small" onClick={() => copyAddress(me.cosmos)}>
                    {copied ? "Copied" : "Copy address"}
                  </button>
                  {copyErr && <p role="alert" className="setup-error">{copyErr}</p>}
                </div>
              )}
              {qorex ? (
                <>
                  <p className="setup-muted">QoreX will ask you to send 1 QOR to your laptop key.</p>
                  <ActionButton run={fundGas}>Send 1 QOR from QoreX</ActionButton>
                </>
              ) : (
                <p>Install QoreX to send QOR from your own wallet, or send QOR to this address from another wallet.</p>
              )}
              {gasErr && <p role="alert" className="setup-error">{gasErr}</p>}
              <p role="status" aria-live="polite" className="setup-muted">Waiting for QOR to arrive. This checks every 5 seconds.</p>
            </StepCard>

            <StepCard id="setup-phone" title="Pair your phone" state={st(3)} summary={phone ? `Phone paired at ${short(phone)}` : "Phone paired"}>
              <p>Open Bulkhead on your phone at <span className="mono">/#/phone</span>, create its Safety key, then type its address here.</p>
              <form className="setup-form" onSubmit={savePhone} noValidate>
                <label className="setup-field">
                  <span>Your phone's address</span>
                  <input className="setup-input mono" value={phoneText} onChange={(e) => setPhoneText(e.target.value)}
                    placeholder="0x" autoComplete="off" spellCheck={false}
                    aria-invalid={!!phoneErr} aria-describedby="setup-phone-hint" />
                </label>
                <p id="setup-phone-hint" className="setup-muted">It starts with 0x and has 40 more letters or numbers.</p>
                {phoneErr && <p role="alert" className="setup-error">{phoneErr}</p>}
                <button type="submit" className="btn btn-primary">Use this phone</button>
              </form>
            </StepCard>

            <StepCard id="setup-walls" title="Set your walls" state={st(4)} summary="Walls set">
              <form className="setup-form" onSubmit={saveWalls}>
                <fieldset className="setup-group">
                  <legend>Your money in plain words</legend>
                  <label className="setup-field">
                    <span>How much do you spend in a normal day?</span>
                    <span className="setup-unit">
                      <input className="setup-input" inputMode="decimal" value={spend} onChange={(e) => onSpend(e.target.value)} />
                      <b>fUSD</b>
                    </span>
                  </label>
                  <label className="setup-field">
                    <span>How much do you want to keep in Savings?</span>
                    <span className="setup-unit">
                      <input className="setup-input" inputMode="decimal" value={savings} onChange={(e) => onSavings(e.target.value)} />
                      <b>fUSD</b>
                    </span>
                  </label>
                </fieldset>
                <fieldset className="setup-group setup-walls">
                  <legend>Suggested walls</legend>
                  <p>Up to{" "}
                    <input className="setup-inline" inputMode="decimal" aria-label="Most in one payment, fUSD" value={caps.perTx}
                      onChange={(e) => setCaps({ ...caps, perTx: e.target.value })} />{" "}
                    fUSD in one payment.</p>
                  <p>Up to{" "}
                    <input className="setup-inline" inputMode="decimal" aria-label="Most in about a day, fUSD" value={caps.periodCap}
                      onChange={(e) => setCaps({ ...caps, periodCap: e.target.value })} />{" "}
                    fUSD in about a day.</p>
                  <p>Keep{" "}
                    <input className="setup-inline" inputMode="decimal" aria-label="Kept in Savings, fUSD" value={caps.floor}
                      onChange={(e) => setCaps({ ...caps, floor: e.target.value })} />{" "}
                    fUSD in Savings. It leaves only with your phone.</p>
                  <p className="setup-muted">We suggest these from your answers. Change any of them. Tightening is instant. Widening takes about an hour and needs your phone.</p>
                </fieldset>
                {wallsErr && <p role="alert" className="setup-error">{wallsErr}</p>}
                <button type="submit" className="btn btn-primary">Set these walls</button>
              </form>
            </StepCard>

            <StepCard id="setup-account" title="Create your account" state={st(5)} summary="Account created"
              extra={createdTx ? <HashPlate hash={createdTx} /> : undefined}>
              <p>Your phone checks this request and asks you to approve it. Nothing moves yet.</p>
              <p className="setup-muted">Everyday is guarded by your laptop key. Savings is guarded by your phone.</p>
              <ActionButton run={createAccount} onDone={() => setCur(6)}>
                {waiting ? "Waiting for your phone" : retry ? "Send again" : "Send to my phone"}
              </ActionButton>
              <p role="status" aria-live="polite" className="setup-muted">{waiting}</p>
              <p className="setup-note">Next, create a recovery account from Account settings. If you're ever hacked, everything goes there.</p>
            </StepCard>

            <StepCard id="setup-fund" title="Fill it from QoreX" state={st(6)} summary="Funded from QoreX">
              <p>{predicted ? <>Your account is <span className="mono">{short(predicted)}</span>.</> : null} Fill it with fUSD from QoreX.</p>
              {qorex ? (
                <>
                  <label className="setup-field">
                    <span>How much fUSD do you want to move?</span>
                    <span className="setup-unit">
                      <input className="setup-input" inputMode="decimal" placeholder="50.00" value={amount}
                        onChange={(e) => setAmount(e.target.value)} />
                      <b>fUSD</b>
                    </span>
                  </label>
                  {amountPreview !== null && amountPreview > 0n && (
                    <p className="setup-muted">QoreX will ask you to send {fmt(amountPreview, T.decimals, T.places)} fUSD to your Bulkhead account.</p>
                  )}
                  <ActionButton run={fundAccount}>Move fUSD from QoreX</ActionButton>
                </>
              ) : (
                <>
                  <p>Install QoreX to fund your account. Your fUSD arrives with no window opened.</p>
                  <p><a href="#/hull">Skip for now and fund it later</a></p>
                </>
              )}
              <p role="status" aria-live="polite" className="setup-muted">
                {acct ? `Your account holds ${fmt(acct.asset.balance, T.decimals, T.places)} fUSD. Waiting for funds.` : "Reading your account from the chain."}
              </p>
            </StepCard>

            <StepCard id="setup-done" title={cur === 7 ? "Your hull is built" : "Your hull is ready"} state={cur === 7 ? "current" : "todo"}>
              <p>Your walls are set. Only your phone can widen them.</p>
              <a className="btn btn-primary" href="#/hull">Go to your hull</a>
            </StepCard>
          </div>
        </>
      )}
    </div>
  );
}
