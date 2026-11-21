import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryPairs, startPair, laptopKeys, reply, replyOf, BadPair, PAIR_TTL_MS } from "../pair.js";
const sid = "123e4567-e89b-12d3-a456-426614174000";
const kem = Buffer.alloc(1568, 1).toString("base64"), x25519 = Buffer.alloc(32, 2).toString("base64");

test("starts once with well-formed keys", async () => {
  const s = new MemoryPairs();
  await assert.rejects(startPair(s, { sid, kem: "AAAA", x25519 }), BadPair);
  await startPair(s, { sid, kem, x25519 });
  await assert.rejects(startPair(s, { sid, kem, x25519 }), BadPair);
  assert.deepEqual(await laptopKeys(s, sid), { kem, x25519 });
});

test("takes one sealed reply, then refuses a second", async () => {
  const s = new MemoryPairs(); await startPair(s, { sid, kem, x25519 });
  assert.equal(await replyOf(s, sid), null);
  await assert.rejects(reply(s, sid, "not an envelope"), BadPair);
  await reply(s, sid, "qoreseal:abc_DEF-1");
  await assert.rejects(reply(s, sid, "qoreseal:other"), BadPair);
  assert.equal(await replyOf(s, sid), "qoreseal:abc_DEF-1");
});

test("expires", async () => {
  const s = new MemoryPairs(); const t = Date.now(); await startPair(s, { sid, kem, x25519 }, t);
  await assert.rejects(laptopKeys(s, sid, t + PAIR_TTL_MS + 1), /expired/);
});
