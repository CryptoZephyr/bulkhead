// Pilot (#/pilot): the agent that keeps your blast radius as small as your day needs.
//   1. Add the pilot: your phone signs it, then the account's widening delay runs.
//   2. Set your quiet hours and your night and daytime walls (never above what your phone signed).
//   3. Ask for more when you need it. Inside quiet hours the pilot refuses: a stolen laptop could be asking.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { parseUnits, type Address } from "viem";
import { myAccount } from "../chain/me";
import { fmt } from "../chain/account";
import { TOKENS, EXPLORER_TX } from "../chain/config";
import { actions } from "../chain/actions";
import { getPilot, changePilot, tickPilot, type PilotView, type PilotSettingsJson } from "../chain/pilot";
import { readPending, finishPending, minutesUntil, type Pending } from "../chain/pending";
import { isUnlocked } from "../chain/wallet";
import { ActionButton } from "../ui/Button";
import { UnlockPlate } from "../ui/Unlock";
import { ExposureChart } from "../ui/ExposureChart";
import "./agent.css";

const T = TOKENS.fUSD;
const myAddr = (): Address => myAccount()!.address;
const money = (base: string | bigint) => fmt(BigInt(base), T.decimals, T.places);
const toBase = (s: string, what: string) => { try { return String(parseUnits(s.trim() || "x", T.decimals)); } catch { throw new Error(`Enter ${what} like 0.50.`); } };

export function usePilot() {
  const [v, setV] = useState<PilotView | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => getPilot(myAddr()).then((x) => { setV(x); setErr(""); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 20_000); return () => clearInterval(t); }, [load]);
  return { v, err, load };
}

export function PilotScreen() {
  const { v, err, load } = usePilot();
  const [, setTick] = useState(0);
  const unlocked = isUnlocked();
  // Opening the app is a good moment to bring the walls in line with the schedule.
  useEffect(() => { if (v?.added && v.saved) void tickPilot(myAddr()).then((r) => { if (r.changed) void load(); }).catch(() => {}); }, [v?.added, v?.saved, load]);

  return (
    <div className="agent-grid">
      <section className="plate agent-how" aria-label="What the pilot does">
        <ol>
          <li><strong>It keeps your wall low when you don't need it.</strong> In your quiet hours a stolen laptop can take only your night wall.</li>
          <li><strong>It opens the wall when your day starts</strong>, never above the walls your phone signed. The opening closes by itself on chain at the start of your quiet hours, even if our server is down.</li>
          <li><strong>A hijacked pilot changes nothing for the worse.</strong> The most it can do is open the wall to the level your phone already signed. Your laptop can only lower the wall; only the pilot can raise it.</li>
        </ol>
      </section>

      {err && <p role="alert">{err}</p>}
      {!v && !err && <p className="muted" aria-busy="true">Reading the pilot…</p>}

      {v && (
        <section className="plate agent-balance" aria-label="Right now">
          <span className="label">Most anyone could take right now</span>
          <span className="big-number agent-number">{money(v.chain.blastRadius)} <small>{T.symbol}</small></span>
          <p className="muted">Your phone-signed walls: {money(v.chain.ceiling.perTx)} per payment, {money(v.chain.ceiling.period)} a day. {v.added ? (v.quietNow ? "It's your quiet hours." : "It's your daytime.") : "The pilot isn't added yet, so the full walls are open all day."}</p>
          <ExposureChart s={v.settings} ceilingPerTx={BigInt(v.chain.ceiling.perTx)} />
        </section>
      )}

      {v && !v.added && <AddPilot v={v} />}
      <PendingPlate onDone={() => void load()} />

      {!unlocked && <UnlockPlate why="Changing the pilot's schedule or asking for more is signed by your laptop key." onUnlocked={() => setTick((n) => n + 1)} />}
      {v && unlocked && <Schedule v={v} onDone={() => void load()} />}
      {v && unlocked && v.added && <AskForMore onDone={() => void load()} />}

      {v && (
        <section className="agent-decisions" aria-labelledby="pilot-log-h">
          <h2 id="pilot-log-h">What the pilot did</h2>
          {v.log.length === 0 && <p className="muted">Nothing yet. Every change it makes shows here with its reason and transaction.</p>}
          <ul className="decisions">
            {v.log.slice(0, 15).map((l) => (
              <li key={l.at} className="plate decision">
                <p className="reason">{l.reason}</p>
                <p className="muted" style={{ fontSize: 14, margin: 0 }}>
                  {new Date(l.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                  {l.blastRadius && <> · most anyone could take: {l.blastRadius} {T.symbol}</>}
                  {l.txHash && <> · <a href={EXPLORER_TX + l.txHash} target="_blank" rel="noreferrer">See the transaction</a></>}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function AddPilot({ v }: { v: PilotView }) {
  if (!v.pilotAddress) return <p className="plate">The pilot isn't configured on this server.</p>;
  return (
    <section className="plate agent-add">
      <h2 style={{ color: "var(--on-plate)" }}>Add the pilot</h2>
      <p>Your phone approves it. After that the account's usual widening delay runs, then the pilot can start keeping your walls low.</p>
      <ActionButton kind="primary" run={async (step) => {
        await actions.requestWiden(myAddr(), { kind: "AddPilot", pilot: v.pilotAddress as Address }, step);
        return "Sent to your phone";
      }}>Add the pilot from my phone</ActionButton>
    </section>
  );
}

/** Widenings the phone approved, waiting for the delay. Anyone may finish them when due. */
export function PendingPlate({ onDone }: { onDone?: () => void }) {
  const [list, setList] = useState<Pending[] | null>(null);
  const load = useCallback(() => readPending(myAddr()).then(setList).catch(() => setList([])), []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 30_000); return () => clearInterval(t); }, [load]);
  const live = (list ?? []).filter((p) => !p.cancelled);
  if (live.length === 0) return null;
  return (
    <section className="plate agent-add" aria-label="Changes waiting">
      <h2 style={{ color: "var(--on-plate)" }}>Waiting for the delay</h2>
      <ul className="decisions">
        {live.map((p) => {
          const m = minutesUntil(p);
          return (
            <li key={p.id} className="decision">
              <p className="reason">{p.name}: approved by your phone. {m > 0 ? `Ready in about ${m} minutes.` : "Ready now."}</p>
              {m === 0 && <ActionButton kind="primary" run={async (step) => { step("Finishing on QoreChain", 0.6); await finishPending(myAddr(), p); await load(); onDone?.(); return "Done"; }}>Finish it</ActionButton>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Schedule({ v, onDone }: { v: PilotView; onDone: () => void }) {
  const s = v.settings;
  const [quietStart, setQS] = useState(s.quietStart), [quietEnd, setQE] = useState(s.quietEnd);
  const [rest, setRest] = useState(money(s.restPerTx)), [restDay, setRestDay] = useState(money(s.restPeriod));
  const [day, setDay] = useState(money(s.dayPerTx)), [dayDay, setDayDay] = useState(money(s.dayPeriod));
  const [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  async function go(e: FormEvent) {
    e.preventDefault(); setMsg(""); setBusy(true);
    try {
      const change: { kind: string } & PilotSettingsJson = { kind: "settings", tzOffsetMin: -new Date().getTimezoneOffset(), quietStart, quietEnd,
        restPerTx: toBase(rest, "the night wall"), restPeriod: toBase(restDay, "the night daily wall"), dayPerTx: toBase(day, "the daytime wall"), dayPeriod: toBase(dayDay, "the daytime daily wall") };
      const r = await changePilot(myAddr(), change);
      setMsg(r.changed ? `Saved, and the pilot updated your walls. ${r.reason}` : `Saved. ${r.reason}`);
      onDone();
    } catch (x) { setMsg((x as Error).message); } finally { setBusy(false); }
  }
  return (
    <form className="plate agent-add" onSubmit={go}>
      <h2 style={{ color: "var(--on-plate)" }}>Your hours and walls</h2>
      <div className="agent-add-row">
        <div className="field"><label htmlFor="q-start">Quiet from</label><input id="q-start" className="field-input" type="time" value={quietStart} onChange={(e) => setQS(e.target.value)} /></div>
        <div className="field"><label htmlFor="q-end">Quiet until</label><input id="q-end" className="field-input" type="time" value={quietEnd} onChange={(e) => setQE(e.target.value)} /></div>
      </div>
      <div className="agent-add-row">
        <div className="field"><label htmlFor="w-rest">Night: per payment</label><input id="w-rest" className="field-input" inputMode="decimal" value={rest} onChange={(e) => setRest(e.target.value)} /></div>
        <div className="field"><label htmlFor="w-restd">Night: per day</label><input id="w-restd" className="field-input" inputMode="decimal" value={restDay} onChange={(e) => setRestDay(e.target.value)} /></div>
      </div>
      <div className="agent-add-row">
        <div className="field"><label htmlFor="w-day">Daytime: per payment</label><input id="w-day" className="field-input" inputMode="decimal" value={day} onChange={(e) => setDay(e.target.value)} /></div>
        <div className="field"><label htmlFor="w-dayd">Daytime: per day</label><input id="w-dayd" className="field-input" inputMode="decimal" value={dayDay} onChange={(e) => setDayDay(e.target.value)} /></div>
      </div>
      <p className="muted" style={{ fontSize: 14, margin: 0 }}>Your phone signed {money(v.chain.ceiling.perTx)} per payment and {money(v.chain.ceiling.period)} a day. The pilot can't go above that.</p>
      {msg && <p role="status">{msg}</p>}
      <button className="btn btn-primary" type="submit" disabled={busy} style={{ justifySelf: "start" }}>{busy ? "Saving…" : "Save"}</button>
    </form>
  );
}

function AskForMore({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  return (
    <section className="plate agent-add" aria-labelledby="ask-h">
      <h2 id="ask-h" style={{ color: "var(--on-plate)" }}>Need more right now?</h2>
      <div className="field"><label htmlFor="ask">Tell the pilot</label>
        <input id="ask" className="field-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="About 12 until 18:00, I'm going shopping" maxLength={300} /></div>
      <p className="muted" style={{ fontSize: 14, margin: 0 }}>The model only reads the amount and the time. Code checks them against your walls and your quiet hours.</p>
      {msg && <p role="status">{msg}</p>}
      <ActionButton kind="primary" run={async (step) => {
        if (!text.trim()) throw new Error("Say how much and until when.");
        step("Asking the pilot", 0.5);
        const r = await changePilot(myAddr(), { kind: "request", text });
        setMsg(`${r.read ? `Read as ${r.read.amount} ${T.symbol} until ${r.read.untilLocal}. ` : ""}${r.reason}`);
        onDone();
        if (!r.ok) throw new Error("The pilot said no. See why above.");
        return "Opened";
      }}>Ask the pilot</ActionButton>
    </section>
  );
}
