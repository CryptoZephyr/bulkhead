// Approval queue API.
//   POST /api/requests           { account, phone, envelope }   -> the queued request (laptop or agent)
//   GET  /api/requests?phone=qor1 -> requests waiting for that phone
//   GET  /api/requests?id=...     -> one request (the laptop polls it)
//   POST /api/requests?id=...     { status: "approved", txHash }   -> checked on chain: a successful tx to the account (or factory)
//   POST /api/requests?id=...     { status: "refused", nonce, deadline, phoneSig } -> the phone's signature over refuseDigest
//   An approval without a transaction (a pilot change) is recorded only by functions/pilot.ts, never by a client.
import { submit, waitingFor, get, settle, liveProofs, BadRequest, defaultStore, type Store, type Proofs } from "../server/queue.js";

export const config = { runtime: "nodejs" };

let store: Store | null = null;
let proofs: Proofs | null = null;
export function useStore(s: Store, p?: Proofs) { store = s; proofs = p ?? null; }
/** The store functions/pilot.ts settles pilot approvals in. */
export function requestStore(): Store { return theStore(); }
function theStore(): Store {
  store ??= defaultStore();
  return store;
}

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const id = url.searchParams.get("id"), phone = url.searchParams.get("phone");
  try {
    if (req.method === "GET" && id) { const r = await get(theStore(), id); return r ? Response.json(r) : Response.json({ error: "Not found." }, { status: 404 }); }
    if (req.method === "GET" && phone) return Response.json(await waitingFor(theStore(), phone));
    if (req.method === "POST" && id) { await settle(theStore(), id, await req.json(), proofs ?? liveProofs()); return Response.json(await get(theStore(), id)); }
    if (req.method === "POST") return Response.json(await submit(theStore(), await req.json()), { status: 201 });
    return Response.json({ error: "Not allowed." }, { status: 405 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof BadRequest || e instanceof SyntaxError ? 400 : 500 });
  }
}

// Vercel calls the method exports.
export const GET = handler;
export const POST = handler;
export default handler;
