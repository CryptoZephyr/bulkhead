import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";
import { execSync } from "node:child_process";

// The commit the docs were built from, shown in every docs page footer.
const COMMIT = (process.env.VERCEL_GIT_COMMIT_SHA ?? (() => { try { return execSync("git rev-parse HEAD").toString(); } catch { return "local"; } })()).trim().slice(0, 7);

// Runs the server functions in functions/ inside the dev and preview servers, so the whole
// app (gateway, relayer, approval queue, agent) works locally exactly as it will when deployed.
const ROUTES: [RegExp, string][] = [
  [/^\/api\/rest\//, "/functions/rest.ts"],
  [/^\/api\/relay$/, "/functions/relay.ts"],
  [/^\/api\/requests$/, "/functions/requests.ts"],
  [/^\/api\/agent$/, "/functions/agent.ts"],
  [/^\/api\/agent-key$/, "/functions/agent-key.ts"],
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
  define: { __COMMIT__: JSON.stringify(COMMIT) },
});
