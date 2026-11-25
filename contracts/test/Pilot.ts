// The pilot: moves the live walls inside the phone-signed policy. Added only by the phone.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEther } from "viem";
import { setup, deployAccount, approve, encode, deadline, NATIVE } from "./helpers.js";

const E = parseEther;
const SET_PILOT = 6;

async function withPilot() {
  const env = await setup();
  const { account } = await deployAccount(env); // policy: 1 per tx, 3 per 100 blocks, floor 5
  await env.everyday.sendTransaction({ to: account.address, value: E("20") });
  const data = encode([{ type: "address" }], [env.sentinel.account.address]);
  const dl = deadline();
  const sig = await approve(env, await account.read.digest([16 + SET_PILOT, data, 30n, dl]));
  await account.write.queueLoosen([SET_PILOT, data, 30n, dl, sig]);
  await env.networkHelpers.mine(50);
  await account.write.executeLoosen([SET_PILOT, data, 30n]);
  const pilot = { account: env.sentinel.account };
  const now = async () => env.pub.getBlockNumber();
  const live = (perTx: string, period: string, until: bigint, restPerTx: string, restPeriod: string) =>
    ({ perTx: E(perTx), period: E(period), until, restPerTx: E(restPerTx), restPeriod: E(restPeriod) });
  return { env, account, pilot, now, live };
}

describe("Pilot", async () => {
  it("is added only through the phone, after the delay", async () => {
    const env = await setup();
    const { account } = await deployAccount(env);
    assert.equal(await account.read.pilot(), "0x0000000000000000000000000000000000000000");
    const { account: a2, env: e2 } = await withPilot();
    assert.equal((await a2.read.pilot()).toLowerCase(), e2.sentinel.account.address.toLowerCase());
  });

  it("lowers the blast radius at once, without sealing or cancelling queued widenings", async () => {
    const { env, account, pilot, now, live } = await withPilot();
    assert.equal(await account.read.blastRadius([NATIVE]), E("1"));
    const epoch = await account.read.epoch();
    await account.write.setLive([NATIVE, live("0.1", "0.2", 0n, "0.1", "0.2")], pilot);
    assert.equal(await account.read.blastRadius([NATIVE]), E("0.1"));
    assert.equal(await account.read.epoch(), epoch, "no epoch bump");
    assert.equal(await account.read.sealed_(), false);
    void env; void now;
  });

  it("refuses a spend over the live walls without sealing, and seals over the policy as before", async () => {
    const { env, account, pilot, live } = await withPilot();
    await account.write.setLive([NATIVE, live("0.1", "0.2", 0n, "0.1", "0.2")], pilot);
    const to = env.payee.account.address;
    const before = await env.pub.getBalance({ address: to });
    await account.write.spend([NATIVE, to, E("0.5")]);
    assert.equal(await env.pub.getBalance({ address: to }), before, "nothing moved");
    assert.equal(await account.read.sealed_(), false, "held, not sealed");
    await account.write.spend([NATIVE, to, E("0.1")]);
    assert.equal(await env.pub.getBalance({ address: to }), before + E("0.1"));
    await account.write.spend([NATIVE, to, E("2")]); // over the phone-signed policy
    assert.equal(await account.read.sealed_(), true);
  });

  it("can never set a wall above the phone-signed policy", async () => {
    const { account, pilot, now, live } = await withPilot();
    const u = (await now()) + 10n;
    await assert.rejects(account.write.setLive([NATIVE, live("2", "1", u, "0", "0")], pilot), /AbovePolicy/);
    await assert.rejects(account.write.setLive([NATIVE, live("1", "4", u, "0", "0")], pilot), /AbovePolicy/);
    await assert.rejects(account.write.setLive([NATIVE, live("0", "0", u, "2", "0")], pilot), /AbovePolicy/);
    await assert.rejects(account.write.setLive([NATIVE, live("0", "0", u, "0", "4")], pilot), /AbovePolicy/);
  });

  it("worst case when hijacked is the policy itself", async () => {
    const { account, pilot, now, live } = await withPilot();
    const u = (await now()) + 100n;
    await account.write.setLive([NATIVE, live("1", "3", u, "1", "3")], pilot);
    const [tx, period] = await account.read.effectiveCaps([NATIVE]);
    const p = await account.read.policy([NATIVE]);
    assert.equal(tx, p[0]); assert.equal(period, p[1]);
    assert.equal(await account.read.blastRadius([NATIVE]), E("1"));
  });

  it("a raise closes itself when it expires, even with no pilot action", async () => {
    const { env, account, pilot, now, live } = await withPilot();
    await account.write.setLive([NATIVE, live("1", "3", (await now()) + 5n, "0.05", "0.1")], pilot);
    assert.equal(await account.read.blastRadius([NATIVE]), E("1"));
    await env.networkHelpers.mine(10);
    assert.equal(await account.read.blastRadius([NATIVE]), E("0.05"));
  });

  it("a raise can last at most one period", async () => {
    const { account, pilot, now, live } = await withPilot();
    await assert.rejects(account.write.setLive([NATIVE, live("1", "1", (await now()) + 500n, "0", "0")], pilot), /TooFarAhead/);
  });

  it("the laptop can lower the live walls but never raise them", async () => {
    const { account, pilot, live } = await withPilot();
    await account.write.setLive([NATIVE, live("0.1", "0.2", 0n, "0.1", "0.2")], pilot);
    await assert.rejects(account.write.setLive([NATIVE, live("1", "3", 0n, "1", "3")]), /NotTighter/, "a stolen laptop can't reopen the night wall");
    await account.write.setLive([NATIVE, live("0.05", "0.1", 0n, "0.05", "0.1")]);
    assert.equal(await account.read.blastRadius([NATIVE]), E("0.05"));
  });

  it("a stranger can't move the walls, the laptop can lower them", async () => {
    const { env, account, live } = await withPilot();
    await assert.rejects(account.write.setLive([NATIVE, live("0", "0", 0n, "0", "0")], { account: env.stranger.account }), /NotPilot/);
    await account.write.setLive([NATIVE, live("0", "0", 0n, "0", "0")]);
    assert.equal(await account.read.blastRadius([NATIVE]), 0n);
  });

  it("can't spend, seal, unseal or widen the policy", async () => {
    const { env, account, pilot } = await withPilot();
    await assert.rejects(account.write.spend([NATIVE, env.sentinel.account.address, 1n], pilot), /NotEveryday/);
    await assert.rejects(account.write.seal(pilot), /NotEveryday/);
    await assert.rejects(account.write.tightenPolicy([NATIVE, { perTxCap: 0n, periodCap: 0n, floor: E("6") }], pilot), /NotEveryday/);
    await assert.rejects(account.write.removePilot(pilot), /NotEveryday/);
  });

  it("the laptop removes the pilot at once", async () => {
    const { env, account, pilot, live } = await withPilot();
    await account.write.removePilot();
    assert.equal(await account.read.pilot(), "0x0000000000000000000000000000000000000000");
    await assert.rejects(account.write.setLive([NATIVE, live("0", "0", 0n, "0", "0")], pilot), /NotPilot/);
    void env;
  });

  it("a tightened policy pulls the live walls down with it", async () => {
    const { account, pilot, now, live } = await withPilot();
    await account.write.setLive([NATIVE, live("1", "3", (await now()) + 50n, "1", "3")], pilot);
    await account.write.tightenPolicy([NATIVE, { perTxCap: E("0.3"), periodCap: E("1"), floor: E("5") }]);
    const [tx] = await account.read.effectiveCaps([NATIVE]);
    assert.equal(tx, E("0.3"));
  });
});

describe("Pilot v4: no wait to add it", async () => {
  it("can be set when the account is created, and works at once", async () => {
    const env = await setup();
    const { account } = await deployAccount(env, { pilot: env.sentinel.account.address });
    assert.equal((await account.read.pilot()).toLowerCase(), env.sentinel.account.address.toLowerCase());
    await env.everyday.sendTransaction({ to: account.address, value: E("20") });
    await account.write.setLive([NATIVE, { perTx: E("0.1"), period: E("0.2"), until: 0n, restPerTx: E("0.1"), restPeriod: E("0.2") }], { account: env.sentinel.account });
    assert.equal(await account.read.blastRadius([NATIVE]), E("0.1"));
  });

  it("the factory refuses a pilot that is the laptop or the phone", async () => {
    const env = await setup();
    await assert.rejects(deployAccount(env, { pilot: env.everyday.account.address }), /BadInit/);
    await assert.rejects(deployAccount(env, { pilot: env.safety.account.address }), /BadInit/);
  });

  it("the phone can add or replace the pilot later, effective at once", async () => {
    const env = await setup();
    const { account } = await deployAccount(env);
    const data = encode([{ type: "address" }], [env.sentinel.account.address]);
    const dl = deadline();
    const sig = await approve(env, await account.read.digest([4, data, 40n, dl]));
    await account.write.setPilotWithApproval([env.sentinel.account.address, 40n, dl, sig], { account: env.relayer.account });
    assert.equal((await account.read.pilot()).toLowerCase(), env.sentinel.account.address.toLowerCase());
    await assert.rejects(account.write.setPilotWithApproval([env.sentinel.account.address, 40n, dl, sig], { account: env.relayer.account }), /NonceReused/);
  });

  it("refuses a forged phone signature and a pilot that is the laptop", async () => {
    const env = await setup();
    const { account } = await deployAccount(env);
    await assert.rejects(account.write.setPilotWithApproval([env.sentinel.account.address, 41n, deadline(), "0x1234"], { account: env.relayer.account }), /BadSafetySignature/);
    const data = encode([{ type: "address" }], [env.everyday.account.address]);
    const dl = deadline();
    const sig = await approve(env, await account.read.digest([4, data, 42n, dl]));
    await assert.rejects(account.write.setPilotWithApproval([env.everyday.account.address, 42n, dl, sig], { account: env.relayer.account }), /BadPilot/);
  });

  it("the laptop still removes the pilot at once", async () => {
    const env = await setup();
    const { account } = await deployAccount(env, { pilot: env.sentinel.account.address });
    await account.write.removePilot();
    assert.equal(await account.read.pilot(), "0x0000000000000000000000000000000000000000");
  });
});
