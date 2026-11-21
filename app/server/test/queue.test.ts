import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryStore, submit, waitingFor, get, settle, TTL_MS } from "../queue.js";

const ok = { account: "0x1c548456DE8683d816409eceBd19D3C4BAD75a5E", phone: "qor1qphpfm88wztjm48znu4g44zhlk767vqp5rndra", envelope: "qoreseal:AAAA_b-c" };
const HASH = "0x" + "ab".repeat(32);

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
  await assert.rejects(() => settle(s, r.id, { status: "refused" }, TTL_MS + 1), /already expired/);
});

test("an approval needs its transaction hash, and settles only once", async () => {
  const s = new MemoryStore();
  const r = await submit(s, ok, 0);
  await assert.rejects(() => settle(s, r.id, { status: "approved" }, 1), /transaction hash/);
  await settle(s, r.id, { status: "approved", txHash: HASH }, 1);
  await assert.rejects(() => settle(s, r.id, { status: "refused" }, 2), /already approved/);
});
