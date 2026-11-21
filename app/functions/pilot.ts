// Pilot API for one Bulkhead account.
//   GET  /api/pilot?account=0x...          -> settings, recent changes, the chain view and what the pilot would do now
//   POST /api/pilot { account, at, change, signature }   (laptop key, like /api/bills)
//        change: { kind: "settings", tzOffsetMin, quietStart, quietEnd, restPerTx, restPeriod, dayPerTx, dayPeriod }
//              | { kind: "request", amount?, untilLocal?, text? }   ("about 200 until 18:00")
//   POST /api/pilot?tick=1 { account }    -> bring the chain in line with the schedule (anyone may ask; it only follows the owner's schedule)
//   GET  /api/pilot?cron=1                 -> the same for every account
// Every level comes from server/pilot.ts. The model only reads free text into { amount, untilLocal }.
import Anthropic from "@anthropic-ai/sdk";
import { verifyMessage, type Address, type Hex } from "viem";
import accountAbi from "../src/chain/abi/BulkheadAccount.json" with { type: "json" };
import { pub } from "../server/relayer.js";
import { plan, planRequest, sameAsChain, validate, isQuiet, DEFAULTS, BadPilot, type PilotSettings, type LiveTarget } from "../server/pilot.js";
import { readChain, applyTarget, pilotKey, type ChainView } from "../server/pilotChain.js";

export const config = { runtime: "nodejs", maxDuration: 60 };

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const fmt = (n: bigint) => (Number(n) / 1e6).toFixed(2);

interface LogEntry { at: number; kind: "schedule" | "request" | "refused" | "settings"; reason: string; txHash?: string; blastRadius?: string; target?: Record<string, string> }
interface Book { account: string; settings: Record<string, string | number> | null; log: LogEntry[] }

// Storage: Vercel Blob in production, memory locally.
const mem = new Map<string, Book>();
const hasBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;
async function getBook(a: string): Promise<Book> {
  a = a.toLowerCase();
  if (!hasBlob()) return structuredClone(mem.get(a) ?? { account: a, settings: null, log: [] });
  const { list } = await import("@vercel/blob");
  const { blobs } = await list({ prefix: `pilot/${a}.json` });
  return blobs[0] ? (await fetch(`${blobs[0].url}?v=${Date.now()}`, { cache: "no-store" })).json() : { account: a, settings: null, log: [] };
}
async function putBook(b: Book) {
  if (!hasBlob()) { mem.set(b.account, structuredClone(b)); return; }
  const { put } = await import("@vercel/blob");
  await put(`pilot/${b.account}.json`, JSON.stringify(b), { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 0 });
}
const log = (b: Book, e: Omit<LogEntry, "at">) => { b.log.unshift({ ...e, at: Date.now() }); b.log = b.log.slice(0, 60); };

const toSettings = (r: Record<string, string | number>): PilotSettings => ({
  tzOffsetMin: Number(r.tzOffsetMin), quietStart: String(r.quietStart), quietEnd: String(r.quietEnd),
  restPerTx: BigInt(r.restPerTx), restPeriod: BigInt(r.restPeriod), dayPerTx: BigInt(r.dayPerTx), dayPeriod: BigInt(r.dayPeriod),
});
const fromSettings = (s: PilotSettings) => ({ ...s, restPerTx: String(s.restPerTx), restPeriod: String(s.restPeriod), dayPerTx: String(s.dayPerTx), dayPeriod: String(s.dayPeriod) });
const targetJson = (t: LiveTarget) => ({ perTx: String(t.perTx), period: String(t.period), until: String(t.until), restPerTx: String(t.restPerTx), restPeriod: String(t.restPeriod) });
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
  const r = await applyTarget(book.account as Address, t, me);
  log(book, { kind, reason: t.reason, txHash: r.txHash, blastRadius: fmt(r.blastRadius), target: targetJson(t) });
  return r;
}

async function tick(account: string, now = Date.now(), known?: Book) {
  const book = known ?? await getBook(account);
  if (!book.settings) return { book, changed: false, reason: "No schedule yet." };
  const chain = await readChain(account as Address);
  if (chain.sealed) return { book, changed: false, reason: "The account is sealed. Nothing to do." };
  const t = plan(toSettings(book.settings), chain.ceiling, now, chain.block, chain.periodBlocks);
  // A raise the owner asked for is still running and is at least as open as the schedule: leave it.
  if (chain.live.until > chain.block && chain.live.perTx >= t.perTx && !isQuiet(toSettings(book.settings), now)) return { book, changed: false, reason: "Your own raise is still open." };
  const r = await apply(book, chain, t, "schedule");
  if (r) await putBook(book);
  return { book, changed: !!r, reason: t.reason };
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
      const { list } = await import("@vercel/blob");
      const { blobs } = await list({ prefix: "pilot/" });
      let changed = 0;
      for (const b of blobs) { try { if ((await tick(b.pathname.slice(6, -5))).changed) changed++; } catch { /* next account */ } }
      return Response.json({ accounts: blobs.length, changed });
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
        settings: book.settings ?? fromSettings(s as PilotSettings), saved: !!book.settings, quietNow: isQuiet(s as PilotSettings, Date.now()), preview, chain: chainJson(chain), log: book.log });
    }
    if (req.method !== "POST") return Response.json({ error: "Not allowed." }, { status: 405 });
    const body = (await req.json()) as { account?: string; at?: number; change?: { kind?: string; [k: string]: unknown }; signature?: Hex };
    const account = (body.account ?? "").toLowerCase();
    if (!ADDR.test(account)) throw new BadPilot("account must be a 0x address.");

    if (url.searchParams.get("tick")) { const r = await tick(account); return Response.json({ changed: r.changed, reason: r.reason, log: r.book.log }); }

    if (!body.change || typeof body.at !== "number") throw new BadPilot("Send account, at, change and signature.");
    if (Math.abs(Date.now() - body.at) > 5 * 60_000) throw new BadPilot("This change is too old. Try again.");
    const laptop = (await pub.readContract({ address: account as Address, abi: accountAbi, functionName: "everyday" })) as Address;
    if (!(await verifyMessage({ address: laptop, message: pilotMessage(account, body.change, body.at), signature: body.signature ?? "0x" }).catch(() => false)))
      return Response.json({ error: "This change wasn't signed by the account's laptop key." }, { status: 401 });

    const book = await getBook(account);
    const chain = await readChain(account as Address);
    const c = body.change;
    if (c.kind === "settings") {
      const s = toSettings(c as Record<string, string | number>);
      validate(s, chain.ceiling);
      book.settings = fromSettings(s);
      log(book, { kind: "settings", reason: `Quiet hours ${s.quietStart} to ${s.quietEnd}. Night wall ${fmt(s.restPerTx)} per payment, daytime wall ${fmt(s.dayPerTx)}.` });
      await putBook(book);
      // Act on the settings just saved, not on a re-read copy (storage reads can lag a write).
      const r = chain.pilot !== "0x0000000000000000000000000000000000000000" ? await tick(account, Date.now(), book).catch((e) => ({ changed: false, reason: (e as Error).message })) : { changed: false, reason: "Add the pilot on your phone to start." };
      return Response.json({ ok: true, changed: r.changed, reason: r.reason, log: book.log });
    }
    if (c.kind === "request") {
      if (!book.settings) throw new BadPilot("Set your quiet hours first.");
      const s = toSettings(book.settings);
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
