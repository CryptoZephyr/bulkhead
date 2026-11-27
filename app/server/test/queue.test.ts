import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryStore, submit, waitingFor, get, settle, txGoesTo, TTL_MS, NOT_THIS_TX, type Proofs } from "../queue.js";
import { memoryOnce } from "../blobjson.js";

const ok = { account: "0x1c548456DE8683d816409eceBd19D3C4BAD75a5E", phone: "qor1qphpfm88wztjm48znu4g44zhlk767vqp5rndra", envelope: "qoreseal:AAAA_b-c" };
const HASH = "0x" + "ab".repeat(32);
const SIG = "0x" + "cd".repeat(100);
const T0 = 1_800_000_000_000; // ms
const deadline = String(T0 / 1000 + 600);

/** Stub proofs: the chain says yes to HASH and to SIG, nothing else. Records the calls. */
function stub(over: Partial<Proofs> = {}): Proofs & { calls: string[] } {
  const calls: string[] = [];
  const once = memoryOnce();
  return {
    calls,
    async txApproves(account, txHash) { calls.push(`tx ${account} ${txHash}`); return txHash === HASH; },
    async phoneRefused(account, id, nonce, dl, sig) { calls.push(`refuse ${account} ${id} ${nonce} ${dl}`); return sig === SIG; },
    once,
    ...over,
  };
}

test("queues a sealed request for the phone", async () => {
  const s = new MemoryStore();
  const r = await submit(s, ok, 1000);
  assert.equal((await waitingFor(s, ok.phone, 2000)).length, 1);
  assert.equal((await get(s, r.id, 2000))?.status, "waiting");
});

test("refuses anything that isn't a QoreSeal envelope", async () => {
  const s = new MemoryStore();
  await assert.rejects(() => submit(s, { ...ok, envelope: '{"raise":"80"}' }), /QoreSeal/);
  await assert.rejects(() => submit(s, { ...ok, account: "acme" }), /0x address/);
});

test("requests expire visibly", async () => {
  const s = new MemoryStore();
  const r = await submit(s, ok, 0);
  assert.equal((await get(s, r.id, TTL_MS + 1))?.status, "expired");
  assert.equal((await waitingFor(s, ok.phone, TTL_MS + 1)).length, 0);
  await assert.rejects(() => settle(s, r.id, { status: "refused", nonce: "1", deadline, phoneSig: SIG }, stub(), TTL_MS + 1), /already expired/);
});

test("an approval without a hash is refused", async () => {
  const s = new MemoryStore();
  const r = await submit(s, ok, T0);
  await assert.rejects(() => settle(s, r.id, { status: "approved" }, stub(), T0 + 1), /transaction hash/);
  await assert.rejects(() => settle(s, r.id, { status: "approved", txHash: "0x1234" }, stub(), T0 + 1), /transaction hash/);
  assert.equal((await get(s, r.id, T0 + 2))?.status, "waiting");
});

test("an approval is checked on chain, and settles only once", async () => {
  const s = new MemoryStore();
  const r = await submit(s, ok, T0);
  const p = stub();
  await assert.rejects(() => settle(s, r.id, { status: "approved", txHash: "0x" + "ee".repeat(32) }, p, T0 + 1), new RegExp(NOT_THIS_TX));
  await settle(s, r.id, { status: "approved", txHash: HASH }, p, T0 + 1);
  assert.equal(p.calls.at(-1), `tx ${ok.account.toLowerCase()} ${HASH}`);
  assert.equal((await get(s, r.id, T0 + 2))?.txHash, HASH);
  await assert.rejects(() => settle(s, r.id, { status: "refused", nonce: "1", deadline, phoneSig: SIG }, p, T0 + 2), /already approved/);
});

test("one transaction can't approve two requests", async () => {
  const s = new MemoryStore();
  const a = await submit(s, ok, T0), b = await submit(s, ok, T0);
  const p = stub();
  await settle(s, a.id, { status: "approved", txHash: HASH }, p, T0 + 1);
  await assert.rejects(() => settle(s, b.id, { status: "approved", txHash: HASH }, p, T0 + 1), new RegExp(NOT_THIS_TX));
});

test("a chain error counts as no proof", async () => {
  const s = new MemoryStore();
  const r = await submit(s, ok, T0);
  await assert.rejects(() => settle(s, r.id, { status: "approved", txHash: HASH }, stub({ txApproves: async () => { throw new Error("rpc down"); } }), T0 + 1), new RegExp(NOT_THIS_TX));
});

test("a refusal without the phone's signature is refused", async () => {
  const s = new MemoryStore();
  const r = await submit(s, ok, T0);
  const p = stub();
  await assert.rejects(() => settle(s, r.id, { status: "refused" }, p, T0 + 1), /phone's signature/);
  await assert.rejects(() => settle(s, r.id, { status: "refused", nonce: "1", deadline }, p, T0 + 1), /phone's signature/);
  await assert.rejects(() => settle(s, r.id, { status: "refused", nonce: "1", deadline, phoneSig: "0x" + "00".repeat(100) }, p, T0 + 1), /wasn't signed/);
  assert.equal((await get(s, r.id, T0 + 2))?.status, "waiting");
});

test("a signed refusal settles, bound to this request; its deadline and nonce are checked", async () => {
  const s = new MemoryStore();
  const r = await submit(s, ok, T0), r2 = await submit(s, ok, T0);
  const p = stub();
  const nowS = T0 / 1000;
  await assert.rejects(() => settle(s, r.id, { status: "refused", nonce: "7", deadline: String(nowS - 1), phoneSig: SIG }, p, T0), /expired/);
  await assert.rejects(() => settle(s, r.id, { status: "refused", nonce: "7", deadline: String(nowS + 15 * 60 + 1), phoneSig: SIG }, p, T0), /too far ahead/);
  await settle(s, r.id, { status: "refused", nonce: "7", deadline, phoneSig: SIG }, p, T0);
  assert.equal(p.calls.at(-1), `refuse ${ok.account.toLowerCase()} ${r.id} 7 ${deadline}`);
  assert.equal((await get(s, r.id, T0 + 1))?.status, "refused");
  await assert.rejects(() => settle(s, r2.id, { status: "refused", nonce: "7", deadline, phoneSig: SIG }, p, T0), /already used/);
});

test("a client can't record an approval without a transaction", async () => {
  const s = new MemoryStore();
  const r = await submit(s, ok, T0);
  await assert.rejects(() => settle(s, r.id, { status: "approved", offchain: true }, stub(), T0 + 1), /Only the server/);
  await assert.rejects(() => settle(s, r.id, { status: "approved", offchain: true, txHash: HASH }, stub(), T0 + 1), /Only the server/);
  // The server path, for the same account only.
  await assert.rejects(() => settle(s, r.id, { status: "approved", offchain: true }, stub(), T0 + 1, { account: "0x" + "11".repeat(20) }), /Only the server/);
  await settle(s, r.id, { status: "approved", offchain: true }, stub(), T0 + 1, { account: ok.account });
  assert.equal((await get(s, r.id, T0 + 2))?.status, "approved");
  assert.equal((await get(s, r.id, T0 + 2))?.txHash, undefined);
});

test("an unknown status is refused", async () => {
  const s = new MemoryStore();
  const r = await submit(s, ok, T0);
  await assert.rejects(() => settle(s, r.id, { status: "expired" }, stub(), T0 + 1), /approved or refused/);
});

test("txGoesTo: a successful transaction to the account or a listed factory", () => {
  const acct = ok.account, f1 = "0x" + "aa".repeat(20), f2 = "0x" + "bb".repeat(20);
  assert.equal(txGoesTo("success", acct.toLowerCase(), acct, ""), true);
  assert.equal(txGoesTo("reverted", acct, acct, ""), false);
  assert.equal(txGoesTo("success", null, acct, f1), false);
  assert.equal(txGoesTo("success", f2, acct, `${f1}, ${f2.toUpperCase().replace("0X", "0x")}`), true);
  assert.equal(txGoesTo("success", "0x" + "cc".repeat(20), acct, `${f1},${f2}`), false);
});
