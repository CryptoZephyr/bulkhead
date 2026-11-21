// Pairing relay (Bulkhead Handshake).
//   POST /api/pair { sid, kem, x25519 }        laptop opens a session with throwaway public keys
//   GET  /api/pair?sid=...                     phone reads them (and checks them against the QR)
//   POST /api/pair?sid=... { envelope }        phone's sealed reply
//   GET  /api/pair?sid=...&reply=1             laptop polls for it
import { readLatest, writeVersion } from "../server/blobjson.js";
import { MemoryPairs, startPair, laptopKeys, reply, replyOf, BadPair, type PairStore, type PairSession } from "../server/pair.js";

export const config = { runtime: "nodejs" };

class BlobPairs implements PairStore {
  async get(sid: string) { return readLatest<PairSession>(`pair/${sid}`); }
  async put(s: PairSession) { await writeVersion(`pair/${s.sid}`, s); }
}
let store: PairStore | null = null;
const theStore = () => (store ??= process.env.BLOB_READ_WRITE_TOKEN ? new BlobPairs() : new MemoryPairs());

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url), sid = url.searchParams.get("sid") ?? "";
  try {
    if (req.method === "GET" && url.searchParams.get("reply")) return Response.json({ envelope: await replyOf(theStore(), sid) });
    if (req.method === "GET") return Response.json(await laptopKeys(theStore(), sid));
    if (req.method === "POST" && sid) { const b = await req.json(); await reply(theStore(), sid, String(b.envelope ?? "")); return Response.json({ ok: true }); }
    if (req.method === "POST") { const s = await startPair(theStore(), await req.json()); return Response.json({ sid: s.sid, expiresAt: s.expiresAt }, { status: 201 }); }
    return Response.json({ error: "Not allowed." }, { status: 405 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof BadPair || e instanceof SyntaxError ? 400 : 502 });
  }
}

export const GET = handler;
export const POST = handler;
export default handler;
