// End-to-end: phone creates its Safety key, laptop sets up, the phone approves account creation with ML-DSA-87,
// the relayer deploys it. Run against the dev server (npm run dev with RELAYER_MNEMONIC and FACTORY_ADDRESS set):
//   E2E_FUNDER_MNEMONIC="..." node e2e/setup-flow.cjs
// Full flow in real browsers: phone creates its Safety key, laptop sets up and asks the phone to create the account,
// phone approves with ML-DSA-87, relayer deploys. Test gas comes from the spike funder (never committed).
const { chromium } = require("playwright");
const fs = require("fs");
const SHOTS = process.env.E2E_SHOTS ?? "e2e-shots/";
const URL = process.env.E2E_URL ?? "http://127.0.0.1:5173/";
(async () => {
  const sdk = await import("@qorechain/sdk");
  const mnemonic = process.env.E2E_FUNDER_MNEMONIC; if (!mnemonic) { console.log("Set E2E_FUNDER_MNEMONIC to a funded testnet mnemonic."); process.exit(2); }
  const client = sdk.createClient(); const n0 = await sdk.deriveNativeAccount(mnemonic);
  const funder = await client.connectTx(await sdk.directSignerFromPrivateKey(n0.privateKey, "qor"), { pqcKeypair: sdk.derivePqcCanonical(n0.address, mnemonic) });
  const fund = async (to, q) => { const r = await funder.bankSend(to, [{ denom: "uqor", amount: sdk.toBase(q) }], { fee: await client.fees.estimate() }); console.log("  funded", to.slice(0, 14), q, "QOR code", r.code); };
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const b = await chromium.launch({ proxy: proxy ? { server: proxy, bypass: "localhost,127.0.0.1" } : undefined });
  const phone = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const laptop = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  for (const p of [phone, laptop]) { p.on("pageerror", (e) => console.log("  page error:", String(e).slice(0, 200))); p.on("console", (m) => { if (m.type() === "warning" || m.type() === "error") console.log("  console:", m.text().slice(0, 300)); }); }
  const PW = "test-password-123";
  const step = (s) => console.log(new Date().toISOString().slice(11, 19), s);
  try {
    step("phone: create Safety key");
    await phone.goto(URL + "#/phone");
    await phone.getByLabel("Password", { exact: true }).fill(PW); await phone.getByLabel("Confirm password").fill(PW);
    await phone.getByRole("button", { name: "Create your Safety key" }).click();
    await phone.waitForFunction(() => /qor1[0-9a-z]{38}/.test(document.body.innerText), null, { timeout: 60000 });
    const ptext = await phone.innerText("body");
    const phoneQor = ptext.match(/qor1[0-9a-z]{38,58}/)[0], phoneEvm = sdk.qorToEvm ? sdk.qorToEvm(phoneQor) : null;
    step(`phone address ${phoneQor} / ${phoneEvm}`);
    await fund(phoneQor, "1.5");
    step("phone: register keys");
    await phone.getByRole("button", { name: "Register this phone's keys" }).first().click({ timeout: 60000 });
    await phone.getByText("Nothing to approve.").waitFor({ timeout: 120000 });
    step("phone ready");
    step("laptop: setup");
    await laptop.goto(URL + "#/setup");
    await laptop.getByLabel("Password", { exact: true }).fill(PW); await laptop.getByLabel("Type it again").fill(PW);
    await laptop.getByRole("button", { name: "Create my laptop key" }).click();
    await laptop.waitForFunction(() => /qor1[0-9a-z]{38}/.test(document.body.innerText), null, { timeout: 60000 });
    const lapQor = (await laptop.innerText("body")).match(/qor1[0-9a-z]{38,58}/)[0];
    await fund(lapQor, "1.5");
    await laptop.getByRole("button", { name: "Continue" }).click();
    await laptop.locator('input[placeholder="0x"]').waitFor({ timeout: 90000 });
    await laptop.locator('input[placeholder="0x"]').fill(phoneEvm);
    await laptop.getByRole("button", { name: "Use this phone" }).click();
    await laptop.getByLabel("How much do you spend in a normal day?").fill("4");
    await laptop.getByLabel("How much do you want to keep in Savings?").fill("10");
    await laptop.getByRole("button", { name: "Set these walls" }).click();
    step("laptop: send create request to phone");
    await laptop.getByRole("button", { name: "Send to my phone" }).click();
    step("phone: wait for request and hold to approve");
    const hold = phone.getByRole("button", { name: /Approve\. Hold for one second/ });
    await hold.waitFor({ timeout: 60000 });
    await phone.screenshot({ path: SHOTS + "phone-request.png", fullPage: true });
    console.log("  phone shows:", (await phone.innerText("main, body")).replace(/\s+/g, " ").match(/Create your Bulkhead account.{0,260}/)?.[0]);
    await hold.scrollIntoViewIfNeeded(); const box = await hold.boundingBox();
      return { top: el && (el.className.baseVal ?? el.className), disabled: b.disabled, bw: b.getBoundingClientRect().width }; }, [box.x + box.width / 2, box.y + box.height / 2]));
    await phone.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await phone.mouse.down(); await phone.waitForTimeout(1300); await phone.mouse.up();

    await phone.waitForFunction(() => /0x[0-9a-f]{4,}…|explore\.qore\.network\/tx\//.test(document.body.innerHTML), null, { timeout: 180000 });
    step("phone: approved");
    await laptop.getByText("Account created").first().waitFor({ timeout: 120000 });
    await laptop.screenshot({ path: SHOTS + "laptop-created.png", fullPage: true });
    const paired = await laptop.evaluate(() => localStorage.getItem("bh-paired"));
    step("laptop: account created " + paired);
  } catch (e) {
    console.log("FAILED:", String(e).split("\n")[0].slice(0, 300));
    await phone.screenshot({ path: SHOTS + "fail-phone.png", fullPage: true }); await laptop.screenshot({ path: SHOTS + "fail-laptop.png", fullPage: true });
  }
  await b.close();
})();
