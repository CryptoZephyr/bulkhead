import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEther, type Address } from "viem";
import { setup, deployAccount, approve, encode, deadline, NATIVE, type Env } from "./helpers.js";

const fund = async (env: Env, to: Address, qor: string) =>
  env.everyday.sendTransaction({ to, value: parseEther(qor) });

describe("Factory", async () => {
  it("deploys through any relayer with a valid Safety-key signature", async () => {
    const env = await setup();
    const { account } = await deployAccount(env);
    assert.equal(await env.factory.read.isAccount([account.address]), true);
    assert.equal((await account.read.everyday()).toLowerCase(), env.everyday.account.address.toLowerCase());
  });

  it("refuses an unproven Safety key (I5)", async () => {
    const env = await setup();
    await env.keys.write.setKey([env.safety.account.address, "0x01", false]);
    await assert.rejects(deployAccount(env), /SafetyKeyNotProven/);
  });

  it("refuses an unregistered Safety key (I5)", async () => {
    const env = await setup();
    await env.keys.write.setKey([env.safety.account.address, "0x", false]);
    await assert.rejects(deployAccount(env), /NoSafetyKey/);
  });

  it("refuses a recovery address that is not a Bulkhead account", async () => {
    const env = await setup();
    await assert.rejects(deployAccount(env, { recovery: env.stranger.account.address }), /RecoveryNotAccount/);
  });

  it("fails closed when the PQ precompile is inactive (I7)", async () => {
    const env = await setup();
    const dead = await env.viem.deployContract("MockInactive");
    const code = await env.pub.getCode({ address: dead.address });
    await env.networkHelpers.setCode("0x0000000000000000000000000000000000000a02", code!);
    await assert.rejects(deployAccount(env), /PrecompileInactive/);
  });
});

describe("Everyday compartment", async () => {
  it("spends within the walls", async () => {
    const env = await setup();
    const { account } = await deployAccount(env);
    await fund(env, account.address, "10");
    const before = await env.pub.getBalance({ address: env.payee.account.address });
    await account.write.spend([NATIVE, env.payee.account.address, parseEther("1")]);
    assert.equal((await env.pub.getBalance({ address: env.payee.account.address })) - before, parseEther("1"));
    assert.equal(await account.read.sealed_(), false);
  });

  it("over the per-transaction cap: trips and seals without reverting, moves nothing", async () => {
    const env = await setup();
    const { account } = await deployAccount(env);
    await fund(env, account.address, "10");
    const hash = await account.write.spend([NATIVE, env.stranger.account.address, parseEther("2")]);
    const r = await env.pub.waitForTransactionReceipt({ hash });
    assert.equal(r.status, "success");
    assert.equal(await account.read.sealed_(), true);
    assert.equal(await account.read.lastTrip(), 1);
    assert.equal(await env.pub.getBalance({ address: account.address }), parseEther("10"));
  });

  it("over the period cap: trips on the spend that would cross it", async () => {
    const env = await setup();
    const { account } = await deployAccount(env);
    await fund(env, account.address, "20");
    for (let k = 0; k < 3; k++) await account.write.spend([NATIVE, env.payee.account.address, parseEther("1")]);
    await account.write.spend([NATIVE, env.payee.account.address, parseEther("1")]);
    assert.equal(await account.read.lastTrip(), 2);
    assert.equal(await env.pub.getBalance({ address: account.address }), parseEther("17"));
  });

  it("the period cap resets after the period", async () => {
    const env = await setup();
    const { account } = await deployAccount(env);
    await fund(env, account.address, "20");
    for (let k = 0; k < 3; k++) await account.write.spend([NATIVE, env.payee.account.address, parseEther("1")]);
    await env.networkHelpers.mine(100);
    await account.write.spend([NATIVE, env.payee.account.address, parseEther("1")]);
    assert.equal(await account.read.sealed_(), false);
  });

  it("a burst across a period boundary cannot reach twice the period cap", async () => {
    const env = await setup();
    const { account } = await deployAccount(env, { policy: { perTxCap: parseEther("3"), periodCap: parseEther("3"), floor: 0n } });
    await fund(env, account.address, "20");
    await env.networkHelpers.mine(98);
    await account.write.spend([NATIVE, env.payee.account.address, parseEther("3")]);
    await account.write.spend([NATIVE, env.payee.account.address, parseEther("3")]);
    assert.equal(await account.read.lastTrip(), 2);
    assert.equal(await env.pub.getBalance({ address: account.address }), parseEther("17"));
  });

  it("never goes below the Savings floor", async () => {
    const env = await setup();
    const { account } = await deployAccount(env);
    await fund(env, account.address, "5.5");
    await account.write.spend([NATIVE, env.payee.account.address, parseEther("1")]);
    assert.equal(await account.read.lastTrip(), 3);
    assert.equal(await env.pub.getBalance({ address: account.address }), parseEther("5.5"));
  });

  it("with a payee list, an unknown payee trips", async () => {
    const env = await setup();
    const { account } = await deployAccount(env, { payees: [env.payee.account.address] });
    await fund(env, account.address, "10");
    await account.write.spend([NATIVE, env.payee.account.address, parseEther("1")]);
    await account.write.spend([NATIVE, env.stranger.account.address, parseEther("1")]);
    assert.equal(await account.read.lastTrip(), 4);
  });

  it("only the everyday key can spend", async () => {
    const env = await setup();
    const { account } = await deployAccount(env);
    await fund(env, account.address, "10");
    await assert.rejects(account.write.spend([NATIVE, env.stranger.account.address, 1n], { account: env.stranger.account }), /NotEveryday/);
  });

  it("works with ERC-20s that return nothing", async () => {
    const env = await setup();
    const tok = await env.viem.deployContract("NoReturnToken", [env.everyday.account.address, parseEther("100")]);
    const { account } = await deployAccount(env, { assets: [tok.address] });
    await tok.write.transfer([account.address, parseEther("10")]);
    await account.write.spend([tok.address, env.payee.account.address, parseEther("1")]);
    assert.equal(await tok.read.balanceOf([env.payee.account.address]), parseEther("1"));
  });

  it("blastRadius reports what the everyday key could still move", async () => {
    const env = await setup();
    const { account } = await deployAccount(env);
    await fund(env, account.address, "10");
    assert.equal(await account.read.blastRadius([NATIVE]), parseEther("1"));
    await account.write.seal();
    assert.equal(await account.read.blastRadius([NATIVE]), 0n);
  });
});

describe("Ratchet: tighten instantly, widen only with the Safety key after a delay", async () => {
  it("everyday key can tighten but not widen (I2)", async () => {
    const env = await setup();
    const { account } = await deployAccount(env);
    await account.write.tightenPolicy([NATIVE, { perTxCap: parseEther("0.5"), periodCap: parseEther("3"), floor: parseEther("6") }]);
    await assert.rejects(account.write.tightenPolicy([NATIVE, { perTxCap: parseEther("2"), periodCap: parseEther("3"), floor: parseEther("6") }]), /NotTighter/);
  });

  it("a signed widening waits out the delay, then anyone can run it", async () => {
    const env = await setup();
    const { account } = await deployAccount(env);
    await account.write.seal();
    const data = "0x";
    const dl = deadline();
    const sig = await approve(env, await account.read.digest([16 + 3, data, 1n, dl]));
    await account.write.queueLoosen([3, data, 1n, dl, sig], { account: env.relayer.account });
    await assert.rejects(account.write.executeLoosen([3, data, 1n], { account: env.stranger.account }), /TooEarly/);
    await env.networkHelpers.mine(50);
    await account.write.executeLoosen([3, data, 1n], { account: env.stranger.account });
    assert.equal(await account.read.sealed_(), false);
  });

  it("any tighten cancels a queued widening", async () => {
    const env = await setup();
    const { account } = await deployAccount(env);
    const data = encode([{ type: "address" }, { type: "tuple", components: [{ name: "perTxCap", type: "uint256" }, { name: "periodCap", type: "uint256" }, { name: "floor", type: "uint256" }] }],
      [NATIVE, { perTxCap: parseEther("100"), periodCap: parseEther("100"), floor: 0n }]);
    const dl = deadline();
    const sig = await approve(env, await account.read.digest([16 + 0, data, 2n, dl]));
    await account.write.queueLoosen([0, data, 2n, dl, sig]);
    await account.write.cancelLoosens();
    await env.networkHelpers.mine(50);
    await assert.rejects(account.write.executeLoosen([0, data, 2n]), /CancelledByTighten/);
  });

  it("a widening signature cannot be replayed (I6)", async () => {
    const env = await setup();
    const { account } = await deployAccount(env);
    const dl = deadline();
    const sig = await approve(env, await account.read.digest([16 + 3, "0x", 3n, dl]));
    await account.write.queueLoosen([3, "0x", 3n, dl, sig]);
    await assert.rejects(account.write.queueLoosen([3, "0x", 3n, dl, sig]), /NonceReused/);
  });

  it("a signature for one action does not authorise another", async () => {
    const env = await setup();
    const { account } = await deployAccount(env);
    const dl = deadline();
    const sig = await approve(env, await account.read.digest([16 + 3, "0x", 4n, dl]));
    await assert.rejects(account.write.queueLoosen([2, "0x", 4n, dl, sig]), /BadSafetySignature/);
  });
});

describe("Safety-key spends", async () => {
  it("moves money below the floor and works while sealed", async () => {
    const env = await setup();
    const { account } = await deployAccount(env);
    await fund(env, account.address, "10");
    await account.write.seal();
    const to = env.payee.account.address, amt = parseEther("8"), dl = deadline();
    const data = encode([{ type: "address" }, { type: "address" }, { type: "uint256" }], [NATIVE, to, amt]);
    const sig = await approve(env, await account.read.digest([0, data, 9n, dl]));
    await account.write.spendWithApproval([NATIVE, to, amt, 9n, dl, sig], { account: env.relayer.account });
    assert.equal(await env.pub.getBalance({ address: account.address }), parseEther("2"));
  });

  it("refuses a forged signature", async () => {
    const env = await setup();
    const { account } = await deployAccount(env);
    await fund(env, account.address, "10");
    await assert.rejects(account.write.spendWithApproval([NATIVE, env.stranger.account.address, parseEther("8"), 10n, deadline(), "0x1234"]), /BadSafetySignature/);
  });
});

describe("Break-glass", async () => {
  it("the everyday key can only send everything to the pinned recovery account", async () => {
    const env = await setup();
    const { account: rec } = await deployAccount(env);
    const { account } = await deployAccount(env, { recovery: rec.address });
    await fund(env, account.address, "10");
    await account.write.breakGlass([[NATIVE]]);
    assert.equal(await env.pub.getBalance({ address: rec.address }), parseEther("10"));
    assert.equal(await account.read.sealed_(), true);
  });

  it("refuses without a recovery account", async () => {
    const env = await setup();
    const { account } = await deployAccount(env);
    await assert.rejects(account.write.breakGlass([[NATIVE]]), /NoRecovery/);
  });
});

describe("Sentinels (I4)", async () => {
  async function withSentinel() {
    const env = await setup();
    const { account } = await deployAccount(env);
    const data = encode([{ type: "address" }], [env.sentinel.account.address]);
    const dl = deadline();
    const sig = await approve(env, await account.read.digest([16 + 4, data, 20n, dl]));
    await account.write.queueLoosen([4, data, 20n, dl, sig]);
    await env.networkHelpers.mine(50);
    await account.write.executeLoosen([4, data, 20n]);
    return { env, account };
  }

  it("can pause everyday spending for a bounded time only", async () => {
    const { env, account } = await withSentinel();
    await assert.rejects(account.write.throttle([51n], { account: env.sentinel.account }), /ThrottleTooLong/);
    await account.write.throttle([10n], { account: env.sentinel.account });
    assert.equal(await account.read.blastRadius([NATIVE]), 0n);
  });

  it("has a bounded number of throttles per period", async () => {
    const { env, account } = await withSentinel();
    await account.write.throttle([1n], { account: env.sentinel.account });
    await assert.rejects(account.write.throttle([1n], { account: env.sentinel.account }), /ThrottleBudgetUsed/);
  });

  it("cannot cancel the Safety key's queued widenings", async () => {
    const { env, account } = await withSentinel();
    await account.write.seal();
    const dl = deadline();
    const sig = await approve(env, await account.read.digest([16 + 3, "0x", 21n, dl]));
    await account.write.queueLoosen([3, "0x", 21n, dl, sig]);
    await account.write.throttle([10n], { account: env.sentinel.account });
    await env.networkHelpers.mine(50);
    await account.write.executeLoosen([3, "0x", 21n]);
    assert.equal(await account.read.sealed_(), false);
  });

  it("cannot spend, seal or widen", async () => {
    const { env, account } = await withSentinel();
    const s = { account: env.sentinel.account };
    await assert.rejects(account.write.spend([NATIVE, env.sentinel.account.address, 1n], s), /NotEveryday/);
    await assert.rejects(account.write.seal(s), /NotEveryday/);
    await assert.rejects(account.write.tightenPolicy([NATIVE, { perTxCap: 0n, periodCap: 0n, floor: parseEther("100") }], s), /NotEveryday/);
  });
});
