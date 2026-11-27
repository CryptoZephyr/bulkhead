// Pilot API for one Bulkhead account.
//   GET  /api/pilot?account=0x...          -> settings, recent changes, the chain view and what the pilot would do now
//   POST /api/pilot { account, at, change, signature }   (laptop key, like /api/bills)
//        change: { kind: "settings", tzOffsetMin, quietStart, quietEnd, restPerTx, restPeriod, dayPerTx, dayPeriod }
//              | { kind: "request", amount?, untilLocal?, text? }   ("about 200 until 18:00")
//        A settings change that loosens the schedule is not applied: it waits in pendingSettings for the phone.
//   POST /api/pilot { account, change: { kind: "approve-settings", settings, nonce, deadline, phoneSig } }
//        (no laptop signature: the phone's ML-DSA-87 signature over pilotScheduleDigest, checked on chain)
//   POST /api/pilot { account, change: { kind: "approve-reopen", nonce, deadline, phoneSig } }
//        (phone only: reopens a wall the tripwire closed; the digest, pilotReopenDigest, is bound to that trip's time)
//   Both phone approvals may carry requestId: once the signature checks out, the server marks that queued request approved.
//   Laptop-signed changes are single-use: the same signature is refused a second time (server/replay.ts).
//   POST /api/pilot?tick=1 { account }    -> run the tripwire, then bring the chain in line with the schedule
//        (anyone may ask; it only follows the owner's schedule and tripwire)
//   Tripwire: each tick reads the account's Spent and HeldByPilot events since lastCheckedBlock. If tripwire()
//   trips, the pilot sets every live wall to zero and stays there: no schedule raise, no request, and laptop
//   settings stay tighten-only, until the phone signs approve-reopen.
//   GET  /api/pilot?info=1                 -> { pilotAddress } of the configured pilot key (or null), no account needed
//   GET  /api/pilot?cron=1                 -> the same for every account
// Every level comes from server/pilot.ts. The model only reads free text into { amount, untilLocal }.
import Anthropic from "@anthropic-ai/sdk";
import { verifyMessage, type Address, type Hex } from "viem";
import accountAbi from "../src/chain/abi/BulkheadAccount.json" with { type: "json" };
import { pub } from "../server/relayer.js";
import { plan, planRequest, sameAsChain, validate, isQuiet, isTightening, tripwire, CLOSED, BURST_MS, DEFAULTS, BadPilot, type PilotSettings, type LiveTarget, type TripEvent } from "../server/pilot.js";
import { readLatest, writeVersion, folders, hasStore, setOnce } from "../server/blobjson.js";
import { firstUse, REPLAYED } from "../server/replay.js";
import { settle, liveProofs } from "../server/queue.js";
import { requestStore } from "./requests.js";
import { phoneSignedSchedule, phoneSignedReopen } from "../server/phoneSig.js";
import { canonicalSettings, PILOT_SCHEDULE_MAX_AHEAD_MS, type PilotSettingsJson } from "../src/chain/pilotSchedule.js";
import { readChain, applyTarget, pilotKey, readTripEvents, type ChainView } from "../server/pilotChain.js";

export const config = { runtime: "nodejs", maxDuration: 60 };

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const fmt = (n: bigint) => (Number(n) / 1e6).toFixed(2);

interface LogEntry { at: number; kind: "schedule" | "request" | "refused" | "settings" | "tripwire" | "reopen"; reason: string; txHash?: string; blastRadius?: string; target?: Record<string, string> }
interface Book {
  account: string; settings: Record<string, string | number> | null; log: LogEntry[];
  /** A looser schedule the laptop proposed, waiting for the phone. */
  pendingSettings?: { settings: PilotSettingsJson; at: number } | null;
  /** Phone approval nonces already used (the last 50). */
  usedNonces?: string[];
  /** Set when the tripwire closed the wall. Only the phone clears it (approve-reopen). */
  tripped?: { at: number; reason: string } | null;
  /** Last block the tripwire has read (decimal string). */
  lastCheckedBlock?: string;
  /** Recent laptop payments, kept so a burst that straddles two checks is still seen. */
  recentSpends?: { at: number; block: string }[];
}

/** First run: how far back the tripwire looks. Later runs read from lastCheckedBlock, at most MAX_LOOKBACK blocks. */
const FIRST_LOOKBACK = 1_000n;
const MAX_LOOKBACK = 50_000n;
/** Save the book for the tripwire's progress alone at most this often (in blocks), to spare storage writes. */
const SAVE_EVERY = 2_000n;
/** ?cron=1 answers within this, inside the function's 60 s limit and the workflow's 50 s timeout. */
const CRON_BUDGET_MS = 40_000;

// Storage: Vercel Blob in production, memory locally.
const mem = new Map<string, Book>();
const hasBlob = hasStore;
async function getBook(a: string): Promise<Book> {
  a = a.toLowerCase();
  if (!hasBlob()) return structuredClone(mem.get(a) ?? { account: a, settings: null, log: [] });
  return (await readLatest<Book>(`pilot/${a}`)) ?? { account: a, settings: null, log: [] };
}
async function putBook(b: Book) {
  if (!hasBlob()) { mem.set(b.account, structuredClone(b)); return; }
  await writeVersion(`pilot/${b.account}`, b);
}
const log = (b: Book, e: Omit<LogEntry, "at">) => { b.log.unshift({ ...e, at: Date.now() }); b.log = b.log.slice(0, 60); };

const toSettings = (r: Record<string, string | number>): PilotSettings => ({
  tzOffsetMin: Number(r.tzOffsetMin), quietStart: String(r.quietStart), quietEnd: String(r.quietEnd),
  restPerTx: BigInt(r.restPerTx), restPeriod: BigInt(r.restPeriod), dayPerTx: BigInt(r.dayPerTx), dayPeriod: BigInt(r.dayPeriod),
});
const fromSettings = (s: PilotSettings) => ({ ...s, restPerTx: String(s.restPerTx), restPeriod: String(s.restPeriod), dayPerTx: String(s.dayPerTx), dayPeriod: String(s.dayPeriod) });
const targetJson = (t: LiveTarget) => ({ perTx: String(t.perTx), period: String(t.period), until: String(t.until), restPerTx: String(t.restPerTx), restPeriod: String(t.restPeriod) });
const describeSettings = (s: PilotSettings) => `Quiet hours ${s.quietStart} to ${s.quietEnd}. Night wall ${fmt(s.restPerTx)} per payment, daytime wall ${fmt(s.dayPerTx)}.`;
const chainJson = (c: ChainView) => JSON.parse(JSON.stringify(c, (_k, v) => (typeof v === "bigint" ? String(v) : v)));

export const pilotMessage = (account: string, change: object, at: number) => `Bulkhead pilot change\naccount: ${account.toLowerCase()}\nat: ${at}\n${JSON.stringify(change)}`;

async function key() {
  const m = process.env.PILOT_MNEMONIC ?? process.env.AGENT_OWNER_MNEMONIC;
  if (!m) throw new BadPilot("The pilot isn't configured on this server.");
  return pilotKey(m, Number(process.env.PILOT_INDEX ?? 7));
}

/** Applies a target if the chain doesn't already hold it. Refuses politely if this key isn't the account's pilot. */
async function apply(book: Book, chain: ChainView, t: LiveTarget, kind: LogEntry["kind"]) {
  const me = await key();
  if (chain.pilot.toLowerCase() !== (me.evm as string).toLowerCase()) throw new BadPilot("This account hasn't added the pilot yet. Approve \"Add the pilot\" on your phone first.");
  if (chain.liveOn && sameAsChain(t, chain.live, chain.block)) return null;
  const r = await serial(() => applyTarget(book.account as Address, t, me));
  log(book, { kind, reason: t.reason, txHash: r.txHash, blastRadius: fmt(r.blastRadius), target: targetJson(t) });
  return r;
}

// The pilot key's transactions go one at a time (its window and nonce are shared across accounts).
let chainLock: Promise<unknown> = Promise.resolve();
function serial<T>(f: () => Promise<T>): Promise<T> {
  const p = chainLock.then(f, f);
  chainLock = p.catch(() => undefined);
  return p;
}

/**
 * Reads the account's Spent and HeldByPilot events since the last check and runs the tripwire.
 * Sets book.tripped when it trips. Returns whether the book changed and whether this is a new trip.
 */
async function watch(book: Book, chain: ChainView, s: PilotSettings | null, now: number): Promise<{ dirty: boolean; fresh: boolean }> {
  const last = book.lastCheckedBlock ? BigInt(book.lastCheckedBlock) : null;
  const to = chain.block;
  let from = last === null ? to - FIRST_LOOKBACK : last + 1n;
  if (to - from > MAX_LOOKBACK) from = to - MAX_LOOKBACK;
  if (from < 0n) from = 0n;
  if (from > to) return { dirty: false, fresh: false };
  const events = await readTripEvents(book.account as Address, from, to);
  book.lastCheckedBlock = String(to);
  const cutoff = now - BURST_MS;
  const carried: TripEvent[] = (book.recentSpends ?? []).filter((e) => e.at >= cutoff).map((e) => ({ kind: "Spent", at: e.at, block: BigInt(e.block), amount: 0n, withApproval: false }));
  const laptop = events.filter((e) => e.kind === "Spent" && !e.withApproval && e.at >= cutoff);
  book.recentSpends = [...carried, ...laptop].map((e) => ({ at: e.at, block: String(e.block) })).slice(-20);
  let fresh = false;
  if (!book.tripped) {
    // Block times can run a little ahead of this server's clock: never drop an event for that.
    const r = tripwire([...carried, ...events], Math.max(now, ...events.map((e) => e.at)), s);
    if (r.tripped) { book.tripped = { at: now, reason: r.reason }; book.recentSpends = []; fresh = true; }
  }
  return { dirty: fresh || events.length > 0 || last === null || to - last >= SAVE_EVERY, fresh };
}

async function tick(account: string, now = Date.now(), known?: Book) {
  const book = known ?? await getBook(account);
  const chain = await readChain(account as Address);
  if (chain.sealed) return { book, changed: false, reason: "The account is sealed. Nothing to do." };
  const s = book.settings ? toSettings(book.settings) : null;
  const w = await watch(book, chain, s, now);

  if (book.tripped) {
    // Tripped: the only thing the pilot does is hold the wall at zero until the phone reopens it.
    if (w.fresh) await putBook(book);   // record the trip before anything that could fail
    const t: LiveTarget = { ...CLOSED, reason: w.fresh ? book.tripped.reason : "The tripwire is still set. The wall stays closed until your phone reopens it." };
    let r: Awaited<ReturnType<typeof apply>> = null;
    try { r = await apply(book, chain, t, "tripwire"); }
    catch (e) { if (w.fresh) log(book, { kind: "tripwire", reason: `${book.tripped.reason} The pilot couldn't close it on chain: ${(e as Error).message}` }); await putBook(book); throw e; }
    if (w.fresh && !r) log(book, { kind: "tripwire", reason: `${book.tripped.reason} It was already closed.` });
    if (r || w.fresh || w.dirty) await putBook(book);
    return { book, changed: !!r, reason: book.tripped.reason };
  }

  if (!s) { if (w.dirty) await putBook(book); return { book, changed: false, reason: "No schedule yet." }; }
  const t = plan(s, chain.ceiling, now, chain.block, chain.periodBlocks);
  // A raise the owner asked for is still running and is at least as open as the schedule: leave it.
  if (chain.live.until > chain.block && chain.live.perTx >= t.perTx && !isQuiet(s, now)) { if (w.dirty) await putBook(book); return { book, changed: false, reason: "Your own raise is still open." }; }
  const r = await apply(book, chain, t, "schedule");
  if (r || w.dirty) await putBook(book);
  return { book, changed: !!r, reason: t.reason };
}

/** The phone reopens a wall the tripwire closed. Same rules as approve-settings; the digest is bound to this trip. */
async function approveReopen(account: string, c: { [k: string]: unknown }) {
  let nonce: bigint, deadline: bigint;
  try { nonce = BigInt(String(c.nonce)); deadline = BigInt(String(c.deadline)); } catch { throw new BadPilot("nonce and deadline must be whole numbers."); }
  const nowS = BigInt(Math.floor(Date.now() / 1000));
  if (deadline < nowS) throw new BadPilot("This approval has expired. Approve it again on your phone.");
  if (deadline > nowS + BigInt(PILOT_SCHEDULE_MAX_AHEAD_MS / 1000)) throw new BadPilot("This approval's deadline is too far ahead.");
  const book = await getBook(account);
  if (!book.tripped) throw new BadPilot("The wall isn't closed by the tripwire. Nothing to reopen.");
  if ((book.usedNonces ?? []).includes(nonce.toString())) throw new BadPilot("This approval was already used.");
  if (!(await phoneSignedReopen(account as Address, book.tripped.at, nonce, deadline, String(c.phoneSig ?? "0x") as Hex)))
    return Response.json({ error: "This approval wasn't signed by the account's phone for this trip." }, { status: 401 });

  const chain = await readChain(account as Address);
  book.tripped = null;
  book.recentSpends = [];
  // Attempts made while the wall was closed were already answered by the trip: start watching from now.
  book.lastCheckedBlock = String(chain.block);
  book.usedNonces = [...(book.usedNonces ?? []), nonce.toString()].slice(-50);
  log(book, { kind: "reopen", reason: "Reopened on your phone" });
  await putBook(book);
  await settleQueued(account, c.requestId);
  const r = await tickAfterSave(account, chain, book);
  return Response.json({ ok: true, changed: r.changed, reason: r.reason, log: book.log });
}

/**
 * The phone's approval was checked above, so the server marks its queued request approved (no transaction).
 * Clients can't do this themselves. Best effort: the approval already took effect.
 */
async function settleQueued(account: string, requestId: unknown) {
  if (typeof requestId !== "string" || !requestId || requestId.length > 100) return;
  await settle(requestStore(), requestId, { status: "approved", offchain: true }, liveProofs(), Date.now(), { account }).catch(() => undefined);
}

// Act on the settings just saved, not on a re-read copy (storage reads can lag a write).
const tickAfterSave = (account: string, chain: ChainView, book: Book) =>
  chain.pilot !== "0x0000000000000000000000000000000000000000"
    ? tick(account, Date.now(), book).catch((e) => ({ changed: false, reason: (e as Error).message }))
    : Promise.resolve({ changed: false, reason: "Add the pilot on your phone to start." });

/**
 * The phone approves a looser schedule the laptop proposed. No laptop signature: the phone's ML-DSA-87
 * signature over pilotScheduleDigest is checked against the account's on-chain Safety key. The settings
 * must be exactly the ones waiting, so the phone only ever approves what the laptop proposed.
 */
async function approveSettings(account: string, c: { [k: string]: unknown }) {
  const settings = c.settings as PilotSettingsJson | undefined;
  if (!settings || typeof settings !== "object") throw new BadPilot("Send the settings the phone approved.");
  let nonce: bigint, deadline: bigint;
  try { nonce = BigInt(String(c.nonce)); deadline = BigInt(String(c.deadline)); } catch { throw new BadPilot("nonce and deadline must be whole numbers."); }
  const nowS = BigInt(Math.floor(Date.now() / 1000));
  if (deadline < nowS) throw new BadPilot("This approval has expired. Approve it again on your phone.");
  if (deadline > nowS + BigInt(PILOT_SCHEDULE_MAX_AHEAD_MS / 1000)) throw new BadPilot("This approval's deadline is too far ahead.");
  const book = await getBook(account);
  if (!book.pendingSettings) throw new BadPilot("No schedule change is waiting for your phone.");
  let canon: string;
  try { canon = canonicalSettings(settings); } catch { throw new BadPilot("The settings don't look right."); }
  if (canon !== canonicalSettings(book.pendingSettings.settings)) throw new BadPilot("This isn't the schedule your laptop proposed. Nothing changed.");
  if ((book.usedNonces ?? []).includes(nonce.toString())) throw new BadPilot("This approval was already used.");
  if (!(await phoneSignedSchedule(account as Address, settings, nonce, deadline, String(c.phoneSig ?? "0x") as Hex)))
    return Response.json({ error: "This approval wasn't signed by the account's phone." }, { status: 401 });

  const chain = await readChain(account as Address);
  const s = toSettings(book.pendingSettings.settings as unknown as Record<string, string | number>);
  validate(s, chain.ceiling);
  book.settings = fromSettings(s);
  book.pendingSettings = null;
  book.usedNonces = [...(book.usedNonces ?? []), nonce.toString()].slice(-50);
  log(book, { kind: "settings", reason: `Approved on your phone: ${describeSettings(s)}` });
  await putBook(book);
  await settleQueued(account, c.requestId);
  const r = await tickAfterSave(account, chain, book);
  return Response.json({ ok: true, changed: r.changed, reason: r.reason, log: book.log });
}

/** "about 200 until 6pm" -> { amount, untilLocal }. The model reads; planRequest decides. */
async function readRequest(text: string): Promise<{ amount: string; untilLocal: string }> {
  if (!process.env.SERV_API_KEY) throw new BadPilot("Type an amount and a time instead.");
  const client = new Anthropic({ baseURL: "https://inference-api.openserv.ai", apiKey: null, authToken: process.env.SERV_API_KEY });
  const res = await client.messages.create({
    model: "claude-haiku-5-5", max_tokens: 200, tool_choice: { type: "tool", name: "room" },
    system: "Read how much money the owner says they need and until what local time. Report only what they wrote. You never decide anything.",
    tools: [{ name: "room", description: "The amount and end time the owner asked for.", input_schema: { type: "object", properties: { amount: { type: "string", description: "Decimal amount, e.g. 200 or 12.50" }, untilLocal: { type: "string", description: "24h local time HH:MM, e.g. 18:00" } }, required: ["amount", "untilLocal"], additionalProperties: false } }],
    messages: [{ role: "user", content: `<request>${text.slice(0, 300)}</request>` }],
  });
  const c = res.content.find((b) => b.type === "tool_use");
  if (!c || c.type !== "tool_use") throw new BadPilot("Couldn't read that. Type an amount and a time.");
  return c.input as { amount: string; untilLocal: string };
}

/** Local "HH:MM" today (or tomorrow if already past) to a timestamp. */
function localToMs(hhmm: string, tz: number, now: number) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim());
  if (!m) throw new BadPilot("The end time must look like 18:00.");
  const dayStart = Math.floor((now + tz * 60000) / 86400000) * 86400000 - tz * 60000;
  let t = dayStart + (Number(m[1]) * 60 + Number(m[2])) * 60000;
  if (t <= now) t += 86400000;
  return t;
}

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  try {
    if (req.method === "GET" && url.searchParams.get("cron")) {
      if (!hasBlob()) return Response.json({ ran: 0 });
      const accounts = await folders("pilot");
      // Every account is read in parallel; the pilot's own transactions queue one at a time (serial()).
      // Answer within CRON_BUDGET_MS so the 60 s function limit and the caller's timeout hold: anything
      // unfinished is picked up by the next run, and a trip is saved before its transaction is sent.
      let changed = 0, tripped = 0, failed = 0, done = 0;
      const all = Promise.all(accounts.map((a) => tick(a).then((r) => { done++; if (r.changed) changed++; if (r.book.tripped) tripped++; }, () => { done++; failed++; })));
      await Promise.race([all, new Promise((s) => setTimeout(s, CRON_BUDGET_MS))]);
      return Response.json({ accounts: accounts.length, done, changed, tripped, failed });
    }
    if (req.method === "GET" && url.searchParams.get("info")) {
      const me = await key().catch(() => null);
      return Response.json({ pilotAddress: me?.evm ?? null });
    }
    if (req.method === "GET") {
      const account = url.searchParams.get("account") ?? "";
      if (!ADDR.test(account)) throw new BadPilot("account must be a 0x address.");
      const [book, chain] = await Promise.all([getBook(account), readChain(account as Address)]);
      const me = await key().catch(() => null);
      const s = book.settings ? toSettings(book.settings) : { tzOffsetMin: 0, ...DEFAULTS(chain.ceiling) };
      let preview: unknown = null;
      try { preview = targetJson(plan(s, chain.ceiling, Date.now(), chain.block, chain.periodBlocks)); } catch { /* settings no longer fit */ }
      return Response.json({ account: book.account, pilotAddress: me?.evm ?? null, added: !!me && chain.pilot.toLowerCase() === (me.evm as string).toLowerCase(),
        settings: book.settings ?? fromSettings(s as PilotSettings), saved: !!book.settings, quietNow: isQuiet(s as PilotSettings, Date.now()), preview, pendingSettings: book.pendingSettings ?? null, tripped: book.tripped ?? null, chain: chainJson(chain), log: book.log });
    }
    if (req.method !== "POST") return Response.json({ error: "Not allowed." }, { status: 405 });
    const body = (await req.json()) as { account?: string; at?: number; change?: { kind?: string; [k: string]: unknown }; signature?: Hex };
    const account = (body.account ?? "").toLowerCase();
    if (!ADDR.test(account)) throw new BadPilot("account must be a 0x address.");

    if (url.searchParams.get("tick")) { const r = await tick(account); return Response.json({ changed: r.changed, reason: r.reason, log: r.book.log }); }

    if (body.change?.kind === "approve-settings") return await approveSettings(account, body.change);
    if (body.change?.kind === "approve-reopen") return await approveReopen(account, body.change);

    if (!body.change || typeof body.at !== "number") throw new BadPilot("Send account, at, change and signature.");
    if (Math.abs(Date.now() - body.at) > 5 * 60_000) throw new BadPilot("This change is too old. Try again.");
    const laptop = (await pub.readContract({ address: account as Address, abi: accountAbi, functionName: "everyday" })) as Address;
    if (!(await verifyMessage({ address: laptop, message: pilotMessage(account, body.change, body.at), signature: body.signature ?? "0x" }).catch(() => false)))
      return Response.json({ error: "This change wasn't signed by the account's laptop key." }, { status: 401 });
    // No store (local runs): no replay guard.
    if (hasStore() && !(await firstUse(body.signature!, setOnce))) throw new BadPilot(REPLAYED);

    const book = await getBook(account);
    const chain = await readChain(account as Address);
    const c = body.change;
    if (c.kind === "settings") {
      const s = toSettings(c as Record<string, string | number>);
      validate(s, chain.ceiling);
      // The laptop key alone may only make the schedule stricter. Anything looser waits for the phone.
      if (!isTightening(book.settings ? toSettings(book.settings) : null, s)) {
        book.pendingSettings = { settings: fromSettings(s) as PilotSettingsJson, at: Date.now() };
        await putBook(book);
        return Response.json({ ok: false, needsPhone: true, reason: "Loosening your schedule needs your phone. Approve it there.", pendingSettings: book.pendingSettings });
      }
      book.settings = fromSettings(s);
      // A stricter save replaces whatever was waiting: the phone can't approve a schedule the laptop moved away from.
      book.pendingSettings = null;
      log(book, { kind: "settings", reason: describeSettings(s) });
      await putBook(book);
      const r = await tickAfterSave(account, chain, book);
      return Response.json({ ok: true, changed: r.changed, reason: r.reason, log: book.log });
    }
    if (c.kind === "request") {
      if (!book.settings) throw new BadPilot("Set your quiet hours first.");
      const s = toSettings(book.settings);
      // Look for trouble before opening anything, so a request can't race the next scheduled check.
      const w = await watch(book, chain, s, Date.now());
      if (w.fresh && book.tripped) { log(book, { kind: "tripwire", reason: book.tripped.reason }); await putBook(book); await tick(account, Date.now(), book).catch(() => undefined); }
      // After a trip the pilot never raises on the laptop's word. Only the phone reopens the wall.
      if (book.tripped) {
        const reason = `The pilot closed your wall after this: ${book.tripped.reason} Reopen it on your phone.`;
        log(book, { kind: "refused", reason }); await putBook(book);
        return Response.json({ ok: false, reason, tripped: book.tripped, log: book.log });
      }
      const x = typeof c.text === "string" && c.text.trim() ? await readRequest(c.text) : { amount: String(c.amount ?? ""), untilLocal: String(c.untilLocal ?? "") };
      if (!/^\d+(\.\d{1,6})?$/.test(x.amount.trim())) throw new BadPilot("The amount must be a number like 200 or 12.50.");
      const amount = BigInt(Math.round(Number(x.amount) * 1e6));
      const now = Date.now();
      const d = planRequest(s, chain.ceiling, { amount, untilMs: localToMs(x.untilLocal, s.tzOffsetMin, now) }, now, chain.block, chain.periodBlocks);
      if (!d.ok) { log(book, { kind: "refused", reason: d.reason }); await putBook(book); return Response.json({ ok: false, reason: d.reason, read: x, log: book.log }); }
      const r = await apply(book, chain, d.target, "request");
      await putBook(book);
      return Response.json({ ok: true, reason: d.target.reason, read: x, txHash: r?.txHash, log: book.log });
    }
    throw new BadPilot("Unknown change.");
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof BadPilot || e instanceof SyntaxError ? 400 : 502 });
  }
}

export const GET = handler;
export const POST = handler;
export default handler;
