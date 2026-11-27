import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFunctionData, encodeFunctionResult, type Address, type Hex } from "viem";
import { phoneSigned, phoneSignedRefuse, phoneSignedSchedule, phoneSignedReopen, keyStatusAbi, verifyAbi, PQC_KEY_STATUS, PQC_VERIFY, type PqcChain } from "../phoneSig.js";
import { refuseDigest, pilotScheduleDigest, pilotReopenDigest, type PilotSettingsJson } from "../../src/chain/pilotSchedule.js";

const ACCOUNT = "0xE44f94756f274bb41522077Af66F8213733453C2" as Address;
const SAFETY = "0x" + "5a".repeat(20) as Address;
const PUBKEY = ("0x" + "11".repeat(64)) as Hex;
const SIG = ("0x" + "22".repeat(64)) as Hex;
const DIGEST = ("0x" + "33".repeat(32)) as Hex;

/** A mocked chain: the key status and verify answers are set per test. Records what pqcVerify was asked. */
function chain(o: { safety?: Address; keyStatus?: Hex | undefined; verify?: Hex | undefined | ((sig: Hex, msg: Hex) => boolean); throws?: boolean } = {}) {
  const asked: { pubkey: Hex; sig: Hex; message: Hex }[] = [];
  const keyStatus = "keyStatus" in o ? o.keyStatus : encodeFunctionResult({ abi: keyStatusAbi, functionName: "pqcKeyStatus", result: [true, 3, PUBKEY, true] });
  const c: PqcChain = {
    async safetyOf() { if (o.throws) throw new Error("rpc down"); return o.safety ?? SAFETY; },
    async call(to, data) {
      if (to === PQC_KEY_STATUS) return keyStatus;
      if (to === PQC_VERIFY) {
        const [pubkey, sig, message] = decodeFunctionData({ abi: verifyAbi, data }).args;
        asked.push({ pubkey, sig, message });
        if (typeof o.verify === "function") return encodeFunctionResult({ abi: verifyAbi, functionName: "pqcVerify", result: o.verify(sig, message) });
        return "verify" in o ? o.verify : encodeFunctionResult({ abi: verifyAbi, functionName: "pqcVerify", result: true });
      }
      throw new Error(`unexpected call to ${to}`);
    },
  };
  return { c, asked };
}
const status = (registered: boolean, pubkey: Hex, proven: boolean) => encodeFunctionResult({ abi: keyStatusAbi, functionName: "pqcKeyStatus", result: [registered, 3, pubkey, proven] });

test("true when the precompile says the signature is valid, for the account's proven key", async () => {
  const { c, asked } = chain();
  assert.equal(await phoneSigned(ACCOUNT, DIGEST, SIG, c), true);
  assert.deepEqual(asked, [{ pubkey: PUBKEY, sig: SIG, message: DIGEST }]);
});

test("fails closed on an empty precompile answer", async () => {
  assert.equal(await phoneSigned(ACCOUNT, DIGEST, SIG, chain({ keyStatus: "0x" }).c), false);
  assert.equal(await phoneSigned(ACCOUNT, DIGEST, SIG, chain({ keyStatus: undefined }).c), false);
  assert.equal(await phoneSigned(ACCOUNT, DIGEST, SIG, chain({ verify: "0x" }).c), false);
  assert.equal(await phoneSigned(ACCOUNT, DIGEST, SIG, chain({ verify: undefined }).c), false);
});

test("fails closed on an unregistered or unproven key", async () => {
  assert.equal(await phoneSigned(ACCOUNT, DIGEST, SIG, chain({ keyStatus: status(false, PUBKEY, true) }).c), false);
  assert.equal(await phoneSigned(ACCOUNT, DIGEST, SIG, chain({ keyStatus: status(true, PUBKEY, false) }).c), false);
  assert.equal(await phoneSigned(ACCOUNT, DIGEST, SIG, chain({ keyStatus: status(true, "0x", true) }).c), false);
});

test("fails closed on a bad signature or digest hex, a zero Safety address, or a chain error", async () => {
  for (const bad of ["", "0x", "0xzz", "0x123", "1122"]) assert.equal(await phoneSigned(ACCOUNT, DIGEST, bad as Hex, chain().c), false, bad);
  assert.equal(await phoneSigned(ACCOUNT, "0x1234" as Hex, SIG, chain().c), false);
  assert.equal(await phoneSigned(ACCOUNT, DIGEST, SIG, chain({ safety: ("0x" + "00".repeat(20)) as Address }).c), false);
  assert.equal(await phoneSigned(ACCOUNT, DIGEST, SIG, chain({ throws: true }).c), false);
});

test("fails closed when verify returns false", async () => {
  assert.equal(await phoneSigned(ACCOUNT, DIGEST, SIG, chain({ verify: () => false }).c), false);
});

test("the refuse check signs over refuseDigest, bound to the request id", async () => {
  const want = refuseDigest(ACCOUNT, "req-1", 7n, 1_800_000_600n);
  const { c } = chain({ verify: (_s, m) => m === want });
  assert.equal(await phoneSignedRefuse(ACCOUNT, "req-1", 7n, 1_800_000_600n, SIG, c), true);
  assert.equal(await phoneSignedRefuse(ACCOUNT, "req-2", 7n, 1_800_000_600n, SIG, c), false);
  assert.equal(await phoneSignedRefuse(ACCOUNT, "req-1", 8n, 1_800_000_600n, SIG, c), false);
});

const SETTINGS: PilotSettingsJson = { tzOffsetMin: 60, quietStart: "00:00", quietEnd: "07:00", restPerTx: "400000", restPeriod: "400000", dayPerTx: "5000000", dayPeriod: "15000000" };

test("schedule and reopen checks use their own digests", async () => {
  const s = pilotScheduleDigest(ACCOUNT, SETTINGS, 1n, 2n), r = pilotReopenDigest(ACCOUNT, 1_700_000_000_000, 1n, 2n);
  assert.equal(await phoneSignedSchedule(ACCOUNT, SETTINGS, 1n, 2n, SIG, chain({ verify: (_x, m) => m === s }).c), true);
  assert.equal(await phoneSignedReopen(ACCOUNT, 1_700_000_000_000, 1n, 2n, SIG, chain({ verify: (_x, m) => m === r }).c), true);
  assert.equal(await phoneSignedReopen(ACCOUNT, 1_700_000_000_001, 1n, 2n, SIG, chain({ verify: (_x, m) => m === r }).c), false);
});

// Fixed vectors, computed once. A change here changes what phones sign: every signed approval in flight breaks.
test("digest builders match fixed vectors", () => {
  assert.equal(refuseDigest(ACCOUNT, "00000000-0000-4000-8000-000000000000", 1n, 1_800_000_600n), "0x1a505990edd7eda49fc658eb74c63dad799fcac8c2a31a1e7d92a9048a271831");
  assert.equal(pilotScheduleDigest(ACCOUNT, SETTINGS, 1n, 1_800_000_600n), "0x4dc97135882ab10e4e3c62f603b54aea785e37a9451049bec9a19ee167c89d48");
  assert.equal(pilotReopenDigest(ACCOUNT, 1_700_000_000_000, 1n, 1_800_000_600n), "0xa5e10982cfe8e3d80a0238532ba4c380f3688ee52cb923e2d0210917bd3771f8");
});
