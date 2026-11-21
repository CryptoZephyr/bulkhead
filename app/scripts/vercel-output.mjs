// Packages the app for Vercel with the Build Output API (v3): the Vite build becomes static files, and each
// server function is bundled by esbuild into one self-contained ESM file, so nothing is resolved at runtime.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";

const OUT = ".vercel/output";
const FUNCTIONS = ["rest", "relay", "requests", "agent", "agent-key", "bills"];
rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/static`, { recursive: true });
cpSync("dist", `${OUT}/static`, { recursive: true });

// Adapter: Vercel's Node launcher calls (req, res); our handlers take a web Request and return a Response.
const adapter = (name) => `
import handler from "../functions/${name}.ts";
export default async function (req, res) {
  const url = new URL(req.url, "https://" + (req.headers.host ?? "localhost"));
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length && req.method !== "GET" && req.method !== "HEAD" ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  const r = await handler(new Request(url, { method: req.method, headers, body }));
  res.statusCode = r.status;
  r.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(Buffer.from(await r.arrayBuffer()));
}
`;

mkdirSync(".vercel-entry", { recursive: true });
for (const name of FUNCTIONS) {
  const dir = `${OUT}/functions/api/${name}.func`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`.vercel-entry/${name}.mjs`, adapter(name));
  await build({
    entryPoints: [`.vercel-entry/${name}.mjs`], bundle: true, platform: "node", format: "esm", target: "node22",
    outfile: `${dir}/index.mjs`, logLevel: "warning",
    banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  });
  writeFileSync(`${dir}/.vc-config.json`, JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: false, maxDuration: 60 }, null, 2));
}
rmSync(".vercel-entry", { recursive: true, force: true });

writeFileSync(`${OUT}/config.json`, JSON.stringify({
  version: 3,
  // The bill agent's daily run: pays every approved bill that is due.
  crons: [{ path: "/api/bills?cron=1", schedule: "17 10 * * *" }],
  routes: [
    { src: "^/api/rest/(.*)$", dest: "/api/rest?path=$1" },
    { handle: "filesystem" },
  ],
}, null, 2));
console.log("Build Output API ready:", FUNCTIONS.length, "functions");
