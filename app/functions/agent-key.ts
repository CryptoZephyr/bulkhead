// GET /api/agent-key: when the bill agent's key expires. POST /api/agent-key: renew it (same key, same rule).
import { agentKeyStatus, renewAgentKey } from "../server/agentKey.js";

export const config = { runtime: "nodejs", maxDuration: 60 };

async function handler(req: Request): Promise<Response> {
  const e = process.env;
  if (!e.AGENT_OWNER_MNEMONIC || !e.AGENT_KEY_HEX) return Response.json({ error: "The agent is not configured." }, { status: 503 });
  const index = Number(e.AGENT_ACCOUNT_INDEX ?? 0);
  try {
    if (req.method === "GET") return Response.json(await agentKeyStatus(e.AGENT_OWNER_MNEMONIC, index, e.AGENT_KEY_HEX));
    if (req.method === "POST") return Response.json(await renewAgentKey(e.AGENT_OWNER_MNEMONIC, index, e.AGENT_KEY_HEX));
    return Response.json({ error: "Not allowed." }, { status: 405 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}

// Vercel calls the method exports.
export const GET = handler;
export const POST = handler;
export default handler;
