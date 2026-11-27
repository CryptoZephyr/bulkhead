import assert from "node:assert/strict";
import { test } from "node:test";
import { keccak256, type Hex } from "viem";
import { firstUse, SIGNATURE_TTL_S } from "../replay.js";
import { memoryOnce } from "../blobjson.js";

const SIG = ("0x" + "ab".repeat(65)) as Hex;

test("the same laptop signature is accepted once, then rejected", async () => {
  const once = memoryOnce();
  assert.equal(await firstUse(SIG, once), true);
  assert.equal(await firstUse(SIG, once), false);
  assert.equal(await firstUse(("0x" + "cd".repeat(65)) as Hex, once), true);
});

test("the claim key is the signature's hash, held longer than the 5-minute window", async () => {
  const seen: [string, number][] = [];
  await firstUse(SIG, async (k, ttl) => { seen.push([k, ttl]); return true; });
  assert.deepEqual(seen, [[`bh:used:${keccak256(SIG)}`, SIGNATURE_TTL_S]]);
  assert.ok(SIGNATURE_TTL_S > 5 * 60);
});
