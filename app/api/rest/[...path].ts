// Gateway: the public QoreChain REST API sends no CORS headers (measured), so the browser
// calls this instead. It forwards reads, and accepts exactly one write: broadcasting a
// transaction that was already signed in the browser. It cannot alter what it carries.
export const config = { runtime: "edge" };
export const runtime = "edge";

const UPSTREAM = "https://api-testnet.qore.host";
const BROADCAST = "/cosmos/tx/v1beta1/txs";
const ALLOWED_READ = /^\/(cosmos|qorechain|cosmwasm|ibc)\//;

export function route(pathname: string): string | null {
  const p = pathname.replace(/^\/api\/rest/, "");
  return p.startsWith("/") && !p.includes("..") ? p : null;
}

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = route(url.pathname);
  if (!path) return new Response("Bad path", { status: 400 });
  if (req.method === "GET") {
    if (!ALLOWED_READ.test(path)) return new Response("Not allowed", { status: 403 });
    const r = await fetch(UPSTREAM + path + url.search, { headers: { accept: "application/json" } });
    return new Response(r.body, { status: r.status, headers: { "content-type": r.headers.get("content-type") ?? "application/json", "cache-control": "no-store" } });
  }
  if (req.method === "POST" && path === BROADCAST) {
    const body = await req.text();
    if (body.length > 200_000) return new Response("Too large", { status: 413 });
    let parsed: { tx_bytes?: unknown; mode?: unknown };
    try { parsed = JSON.parse(body); } catch { return new Response("Bad JSON", { status: 400 }); }
    if (typeof parsed.tx_bytes !== "string") return new Response("tx_bytes required", { status: 400 });
    const r = await fetch(UPSTREAM + BROADCAST, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tx_bytes: parsed.tx_bytes, mode: "BROADCAST_MODE_SYNC" }) });
    return new Response(r.body, { status: r.status, headers: { "content-type": "application/json" } });
  }
  return new Response("Method not allowed", { status: 405 });
}

// Vercel calls the method exports.
export const GET = handler;
export const POST = handler;
export default handler;
