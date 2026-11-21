import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryStore, submit, waitingFor, get, settle, TTL_MS } from "../queue.ts";

const ok = { account: "0x1c548456DE8683d816409eceBd19D3C4BAD75a5E", phone: "qor1qphpfm88wztjm48znu4g44zhlk767vqp5rndra", envelope: "qoreseal:AAAA_b-c" };
const HASH = "0x" + "ab".repeat(32);

test("queues a sealed request for the phone", () => {
  const s = new MemoryStore();
  const r = submit(s, ok, 1000);
  assert.equal(waitingFor(s, ok.phone, 2000).length, 1);
  assert.equal(get(s, r.id, 2000)?.status, "waiting");
});

test("refuses anything that isn't a QoreSeal envelope", () => {
  const s = new MemoryStore();
  assert.throws(() => submit(s, { ...ok, envelope: '{"raise":"80"}' }), /QoreSeal/);
  assert.throws(() => submit(s, { ...ok, account: "acme" }), /0x address/);
});

test("requests expire visibly", () => {
  const s = new MemoryStore();
  const r = submit(s, ok, 0);
  assert.equal(get(s, r.id, TTL_MS + 1)?.status, "expired");
  assert.equal(waitingFor(s, ok.phone, TTL_MS + 1).length, 0);
  assert.throws(() => settle(s, r.id, { status: "refused" }, TTL_MS + 1), /already expired/);
});

test("an approval needs its transaction hash, and settles only once", () => {
  const s = new MemoryStore();
  const r = submit(s, ok, 0);
  assert.throws(() => settle(s, r.id, { status: "approved" }, 1), /transaction hash/);
  settle(s, r.id, { status: "approved", txHash: HASH }, 1);
  assert.throws(() => settle(s, r.id, { status: "refused" }, 2), /already approved/);
});
