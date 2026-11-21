import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";

// Runs the Vercel-style functions in api/ inside the dev and preview servers, so the whole
// app (gateway, relayer, approval queue, agent) works locally exactly as it will when deployed.
const ROUTES: [RegExp, string][] = [
  [/^\/api\/rest\//, "/api/rest/[...path].ts"],
  [/^\/api\/relay$/, "/api/relay.ts"],
  [/^\/api\/requests$/, "/api/requests.ts"],
  [/^\/api\/agent$/, "/api/agent.ts"],
  [/^\/api\/agent-key$/, "/api/agent-key.ts"],
];

function apiBridge(): Plugin {
  let server: ViteDevServer;
  const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const hit = ROUTES.find(([re]) => re.test(url.pathname));
    if (!hit) return next();
    try {
      const mod = await server.ssrLoadModule(hit[1]);
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const r: Response = await mod.default(new Request(url, { method: req.method, headers: req.headers as Record<string, string>, body: req.method === "GET" ? undefined : body }));
      res.statusCode = r.status;
      r.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      res.statusCode = 500; res.end(JSON.stringify({ error: (e as Error).message }));
    }
  };
  return {
    name: "bulkhead-api-bridge",
    configureServer(s) { server = s; s.middlewares.use(handle); },
  };
}

export default defineConfig({
  plugins: [react(), apiBridge()],
});
