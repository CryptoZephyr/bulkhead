// POST /api/relay { to, data }: relays a Safety-key-signed action. Keys come from the environment.
import { relay, Refused } from "../server/relayer.js";

export const config = { runtime: "nodejs", maxDuration: 60 };

async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const mnemonic = process.env.RELAYER_MNEMONIC, factory = process.env.FACTORY_ADDRESS;
  if (!mnemonic || !factory) return Response.json({ error: "Relayer is not configured." }, { status: 503 });
  let body: { to?: string; data?: string };
  try { body = await req.json(); } catch { return Response.json({ error: "Bad JSON." }, { status: 400 }); }
  if (!/^0x[0-9a-fA-F]{40}$/.test(body.to ?? "") || !/^0x[0-9a-fA-F]*$/.test(body.data ?? "")) return Response.json({ error: "to and data are required." }, { status: 400 });
  try {
    return Response.json(await relay({ to: body.to as `0x${string}`, data: body.data as `0x${string}` }, { mnemonic, factory }));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof Refused ? 422 : 502 });
  }
}

// Vercel calls the method exports.
export const GET = handler;
export const POST = handler;
export default handler;
