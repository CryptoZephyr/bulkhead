// Approval queue API.
//   POST /api/requests           { account, phone, envelope }   -> the queued request (laptop or agent)
//   GET  /api/requests?phone=qor1 -> requests waiting for that phone
//   GET  /api/requests?id=...     -> one request (the laptop polls it)
//   POST /api/requests?id=...     { status, txHash }              -> the phone settles it
import { submit, waitingFor, get, settle, BadRequest, FileStore, MemoryStore, type Store } from "../server/queue.ts";

export const config = { runtime: "nodejs" };

let store: Store | null = null;
export function useStore(s: Store) { store = s; }
function theStore(): Store {
  store ??= process.env.QUEUE_FILE ? new FileStore(process.env.QUEUE_FILE) : new MemoryStore();
  return store;
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const id = url.searchParams.get("id"), phone = url.searchParams.get("phone");
  try {
    if (req.method === "GET" && id) { const r = get(theStore(), id); return r ? Response.json(r) : Response.json({ error: "Not found." }, { status: 404 }); }
    if (req.method === "GET" && phone) return Response.json(waitingFor(theStore(), phone));
    if (req.method === "POST" && id) { settle(theStore(), id, await req.json()); return Response.json(get(theStore(), id)); }
    if (req.method === "POST") return Response.json(submit(theStore(), await req.json()), { status: 201 });
    return Response.json({ error: "Not allowed." }, { status: 405 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof BadRequest || e instanceof SyntaxError ? 400 : 500 });
  }
}
