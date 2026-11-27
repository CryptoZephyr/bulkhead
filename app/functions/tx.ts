// Explorer links: GET /api/tx?h=<hash> redirects to the transaction on the QoreChain explorer.
// The explorer finds transactions only by their native (cosmos) hash, so an EVM 0x hash is looked
// up through its ethereum_tx event first. A native hash passes straight through.
export const config = { runtime: "edge" };
export const runtime = "edge";

const REST = "https://api-testnet.qore.host";
const EXPLORER = "https://explore.qore.network/tx/";
const EVM = /^0x[0-9a-fA-F]{64}$/, NATIVE = /^[0-9A-F]{64}$/i;

export async function nativeHash(h: string, get: (u: string) => Promise<unknown> = (u) => fetch(u).then((r) => r.json())): Promise<string | null> {
  if (NATIVE.test(h)) return h.toUpperCase();
  if (!EVM.test(h)) return null;
  const q = encodeURIComponent(`ethereum_tx.ethereumTxHash='${h.toLowerCase()}'`);
  const j = (await get(`${REST}/cosmos/tx/v1beta1/txs?query=${q}&pagination.limit=1`).catch(() => null)) as { tx_responses?: { txhash?: string }[] } | null;
  return j?.tx_responses?.[0]?.txhash ?? null;
}

async function handler(req: Request): Promise<Response> {
  const h = new URL(req.url).searchParams.get("h") ?? "";
  if (!EVM.test(h) && !NATIVE.test(h)) return new Response("Send ?h= with a transaction hash.", { status: 400 });
  const n = await nativeHash(h);
  // Not indexed yet: fall back to the explorer's search with the hash as given.
  return Response.redirect(n ? EXPLORER + n : EXPLORER + h, 302);
}

export const GET = handler;
export default handler;
