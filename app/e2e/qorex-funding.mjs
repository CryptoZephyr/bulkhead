// QoreX funding through the app's own code path, signed for real by the official QoreX wallet mock.
// The mock calls REST from the page, so it is pointed at our gateway (the real extension has no CORS limit).
//   E2E_FUNDER_MNEMONIC="..." node e2e/qorex-funding.mjs   (dev server running)
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { readFileSync } from "node:fs";
import { createQorexMock } from "@qorechain/qorex-wallet-mock";
import { createPublicClient, http, parseAbi } from "viem";
const mnemonic = process.env.E2E_FUNDER_MNEMONIC; if (!mnemonic) { console.log("Set E2E_FUNDER_MNEMONIC (an account with a registered PQ key, QOR and fUSD bank coins)."); process.exit(2); }
const DEMO = "0x3d68f146EaEbFBCB1C0f64eFC07DbD687fc76959", FUSD = "0x97143B771D34ddb9130b807b135Ae675A5a963CA";
const pub = createPublicClient({ transport: http("https://evm-testnet.qore.host") });
const bal = async () => ({ fUSD: Number(await pub.readContract({ address: FUSD, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", args: [DEMO] })) / 1e6, QOR: Number(await pub.getBalance({ address: DEMO })) / 1e18 });
const mock = createQorexMock({ profile: "current", mnemonic, accountIndex: 0, rest: (process.env.E2E_URL ?? "http://127.0.0.1:5173/") + "api/rest" });
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const b = await chromium.launch({ proxy: proxy ? { server: proxy, bypass: "localhost,127.0.0.1" } : undefined });
const page = await b.newPage();
page.on("pageerror", (e) => console.log("page error:", String(e).slice(0, 200)));
await page.addInitScript({ content: mock.initScript() });
await page.goto((process.env.E2E_URL ?? "http://127.0.0.1:5173/") + "#/hull");
console.log("before:", JSON.stringify(await bal()));
const r = await page.evaluate(async (acct) => {
  const q = await import("/src/chain/qorex.ts");
  const out = { available: q.isQorexAvailable() };
  try { out.fusd = await q.fundFromQorex(acct, "fUSD", 1000000n, () => {}); } catch (e) { out.fusdErr = String(e.message || e); }
  try { out.qor = await q.fundFromQorex(acct, "QOR", 10000000000000000n, () => {}); } catch (e) { out.qorErr = String(e.message || e); }
  out.from = window.__qorexMock.addresses().native;
  return out;
}, DEMO);
console.log("QoreX (mock) results:", JSON.stringify(r));
await new Promise((s) => setTimeout(s, 6000));
console.log("after:", JSON.stringify(await bal()));
await b.close();
