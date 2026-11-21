// Invariant and fuzz tests for BulkheadAccount.
//
// Randomised sequences run against one account. A TypeScript model predicts every outcome
// (success, which revert, which trip, balances, period windows, queue state). After every step
// the model is compared with contract reads, and the invariants I1-I6 are checked on chain state.
//
// Reproducibility: every random run uses a seeded mulberry32 PRNG. The seed is printed. Override
// with INV_SEED=<n> (applies to every random test) to replay a different sequence.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeAbiParameters, keccak256, parseEther, type Address, type Hex } from "viem";
import { setup, deployAccount, approve, deadline, NATIVE, type Env, type Policy } from "./helpers.js";

// Contract handles come back from viem untyped in this project (no generated typings), so they are
// typed loosely here. Calls are still checked against the ABI at runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Contract = any;

const PERIOD = 100n;          // periodBlocks used by deployAccount
const DELAY = 50n;            // loosenDelay used by deployAccount
const MAX_T = PERIOD / 2n;    // maxThrottleBlocks(): half a period
const MAX_K = 1n;             // MAX_THROTTLES_PER_PERIOD
const ZERO = "0x0000000000000000000000000000000000000000";
const TRIP = ["None", "OverTxCap", "OverPeriodCap", "BelowFloor", "UnknownPayee"];
// Custom errors the random driver may expect. An unknown failure is a harness error, not a pass.
const REVERTS = [
  "NotEveryday", "NotSentinel", "NotTighter", "ThrottleTooLong", "ThrottleBudgetUsed", "Expired",
  "NonceReused", "BadSafetySignature", "NotQueued", "TooEarly", "CancelledByTighten", "NoRecovery",
  "RecoveryNotAccount", "TransferFailed",
];
const POLICY_TUPLE = [
  { name: "perTxCap", type: "uint256" },
  { name: "periodCap", type: "uint256" },
  { name: "floor", type: "uint256" },
] as const;
// Steps that may move funds out of the account (I3 allows only the last three while sealed).
const OUT_WHILE_SEALED = new Set(["spendWA", "breakGlassWA", "breakGlass"]);
// Steps that must never move funds.
const NO_MOVE = new Set(["throttle", "seal", "cancel", "payee", "tightenValid", "tightenInvalid", "queue", "execute", "mine"]);
// Steps made by the everyday key or a sentinel (I2 applies to these; executeLoosen is excluded
// because it runs a Safety-key-authorised widening once its delay has passed).
const I2_KINDS = (k: string) =>
  ["spend", "tightenValid", "tightenInvalid", "seal", "cancel", "payee", "throttle", "queue", "breakGlass"].includes(k) ||
  k.startsWith("attack");
const sameTerms = (a: Policy, b: Policy) => a.perTxCap === b.perTxCap && a.periodCap === b.periodCap && a.floor === b.floor;
const LOOSEN_KIND_NAMES = ["SetPolicy", "AddPayee", "DisablePayeeList", "Unseal", "AddSentinel", "SetRecovery"];

class HarnessError extends Error {}

/// Everything viem attaches to a failed call, so the custom error name is found whichever field carries it.
function errorText(e: unknown): string {
  const parts: string[] = [];
  let cur: any = e;
  for (let depth = 0; cur && depth < 5; depth++) {
    for (const k of ["shortMessage", "message", "details", "metaMessages", "reason"]) {
      const v = cur[k];
      if (typeof v === "string") parts.push(v);
      else if (Array.isArray(v)) parts.push(v.join(" "));
    }
    if (cur.data?.errorName) parts.push(String(cur.data.errorName));
    cur = cur.cause;
  }
  return parts.length ? parts.join(" | ") : String(e);
}

// ------------------------------------------------------------------ PRNG

function rng(seed: number) {
  let a = seed >>> 0;
  const f = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int: (n: number) => Math.floor(f() * n),
    bool: (p: number) => f() < p,
    pick: <T,>(xs: readonly T[]): T => xs[Math.floor(f() * xs.length)]!,
    big: (max: bigint): bigint => {
      if (max <= 0n) return 0n;
      let r = 0n;
      for (let i = 0; i < 8; i++) r = (r << 32n) | BigInt(Math.floor(f() * 4294967296));
      return r % (max + 1n);
    },
    weighted: (w: Record<string, number>): string => {
      const total = Object.values(w).reduce((x, y) => x + y, 0);
      let x = f() * total;
      for (const [k, v] of Object.entries(w)) if ((x -= v) < 0) return k;
      return Object.keys(w).at(-1)!;
    },
  };
}
type Rng = ReturnType<typeof rng>;

function loosenId(action: number, data: Hex, nonce: bigint): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "uint8" }, { type: "bytes" }, { type: "uint256" }] as const, [action, data, nonce]),
  );
}

// ------------------------------------------------------------------ model

type Entry = { action: number; data: Hex; nonce: bigint; arg: unknown; readyAt: bigint; qEpoch: bigint };
type Outcome = { revert?: string };

/// Expected contract state, computed from the rules in BulkheadAccount.sol alone.
class Model {
  pol: Policy;
  balance: bigint;
  otherBal = 0n;
  sealed = false;
  thr = 0n;
  lastTrip = 0;
  epoch = 0n;
  allowanceUsed = 0n;   // debt against periodCap, refilled linearly from lastSpendBlock
  lastSpendBlock = 0n;
  payeeOn: boolean;
  payees = new Set<string>();
  sentinels = new Set<string>();
  sentPer = new Map<string, bigint>();
  sentUses = new Map<string, bigint>();
  recovery: string;
  nonces = new Set<bigint>();
  queue = new Map<Hex, Entry>();
  ids: Hex[] = [];
  readonly accounts: Set<string>;

  constructor(o: { pol: Policy; balance: bigint; payeeOn: boolean; payees: string[]; recovery: string; other: string }) {
    this.pol = o.pol;
    this.balance = o.balance;
    this.payeeOn = o.payeeOn;
    o.payees.forEach((p) => this.payees.add(p.toLowerCase()));
    this.recovery = o.recovery;
    this.accounts = new Set([o.other.toLowerCase()]);
  }

  /// Allowance used at block B: the stored debt less the linear refill since the last spend.
  usedAt(B: bigint): bigint {
    const u = this.allowanceUsed;
    if (u === 0n) return 0n;
    const refill = (this.pol.periodCap * (B - this.lastSpendBlock)) / PERIOD;
    return refill >= u ? 0n : u - refill;
  }

  periodLeft(B: bigint): bigint {
    const used = this.usedAt(B);
    return this.pol.periodCap > used ? this.pol.periodCap - used : 0n;
  }

  /// Returns true if funds moved. A breach trips and seals without reverting.
  spend(B: bigint, to: string, amt: bigint): boolean {
    if (this.sealed || B < this.thr) return false;
    const used = this.usedAt(B);
    const p = this.pol;
    let t = 0;
    if (amt > p.perTxCap) t = 1;
    else if (used + amt > p.periodCap) t = 2;
    else if (this.balance < p.floor + amt) t = 3;
    else if (this.payeeOn && !this.payees.has(to.toLowerCase())) t = 4;
    if (t) {
      this.sealed = true;
      this.lastTrip = t;
      this.epoch++;
      return false;
    }
    this.allowanceUsed = used + amt;
    this.lastSpendBlock = B;
    this.balance -= amt;
    return true;
  }

  tighten(np: Policy): Outcome {
    const c = this.pol;
    if (np.perTxCap > c.perTxCap || np.periodCap > c.periodCap || np.floor < c.floor) return { revert: "NotTighter" };
    this.pol = np;
    this.epoch++;
    return {};
  }

  seal() { this.sealed = true; this.epoch++; }
  cancel() { this.epoch++; }
  removePayee(who: string) { this.payees.delete(who.toLowerCase()); this.epoch++; }
  enablePayeeList() { this.payeeOn = true; this.epoch++; }
  removeSentinel(who: string) { this.sentinels.delete(who.toLowerCase()); this.epoch++; }

  throttle(B: bigint, who: string, len: bigint): Outcome {
    const k = who.toLowerCase();
    if (!this.sentinels.has(k)) return { revert: "NotSentinel" };
    if (len > MAX_T) return { revert: "ThrottleTooLong" };
    const per = B / PERIOD;
    if ((this.sentPer.get(k) ?? 0n) !== per) { this.sentPer.set(k, per); this.sentUses.set(k, 0n); }
    const uses = this.sentUses.get(k) ?? 0n;
    if (uses >= MAX_K) return { revert: "ThrottleBudgetUsed" };
    this.sentUses.set(k, uses + 1n);
    const until = B + len;
    if (until > this.thr) this.thr = until;   // throttle no longer bumps the epoch
    return {};
  }

  /// Safety-key checks in the order the contract applies them.
  safetyCheck(expired: boolean, nonce: bigint, badSig: boolean): Outcome {
    if (expired) return { revert: "Expired" };
    if (this.nonces.has(nonce)) return { revert: "NonceReused" };
    if (badSig) return { revert: "BadSafetySignature" };
    return {};
  }

  queueLoosen(B: bigint, action: number, data: Hex, nonce: bigint, expired: boolean, badSig: boolean, arg: unknown): Outcome {
    const o = this.safetyCheck(expired, nonce, badSig);
    if (o.revert) return o;
    this.nonces.add(nonce);
    const id = loosenId(action, data, nonce);
    this.queue.set(id, { action, data, nonce, arg, readyAt: B + DELAY, qEpoch: this.epoch });
    this.ids.push(id);
    return {};
  }

  executeLoosen(B: bigint, id: Hex): Outcome {
    const e = this.queue.get(id);
    const r = e?.readyAt ?? 0n;
    if (!e || r === 0n) return { revert: "NotQueued" };
    if (B < r) return { revert: "TooEarly" };
    if (e.qEpoch !== this.epoch) return { revert: "CancelledByTighten" };
    if (e.action === 5 && !this.accounts.has(String(e.arg).toLowerCase())) return { revert: "RecoveryNotAccount" };
    e.readyAt = 0n;
    switch (e.action) {
      case 0: this.pol = e.arg as Policy; break;
      case 1: this.payees.add(String(e.arg).toLowerCase()); break;
      case 2: this.payeeOn = false; break;
      case 3: this.sealed = false; this.thr = 0n; this.lastTrip = 0; break;
      case 4: this.sentinels.add(String(e.arg).toLowerCase()); break;
      case 5: this.recovery = String(e.arg); break;
    }
    return {};
  }

  spendWA(expired: boolean, nonce: bigint, badSig: boolean, amt: bigint): Outcome {
    const o = this.safetyCheck(expired, nonce, badSig);
    if (o.revert) return o;
    if (amt > this.balance) return { revert: "TransferFailed" };
    this.nonces.add(nonce);
    this.balance -= amt;
    return {};
  }

  evacuate(): void {
    this.sealed = true;
    this.epoch++;
    if (this.balance > 0n) { this.otherBal += this.balance; this.balance = 0n; }
  }

  breakGlass(): Outcome {
    if (this.recovery === ZERO) return { revert: "NoRecovery" };
    this.evacuate();
    return {};
  }

  breakGlassWA(expired: boolean, nonce: bigint, badSig: boolean): Outcome {
    const o = this.safetyCheck(expired, nonce, badSig);
    if (o.revert) return o;
    if (this.recovery === ZERO) return { revert: "NoRecovery" };
    this.nonces.add(nonce);
    this.evacuate();
    return {};
  }
}

// ------------------------------------------------------------------ chain snapshot

type Chain = {
  bal: bigint; other: bigint; sealed: boolean; thr: bigint; lastTrip: number; epoch: bigint;
  lastSpend: bigint; allowance: bigint; pol: Policy; payeeOn: boolean; rec: string; block: bigint;
  sUses: bigint; sPer: bigint; payee: boolean[]; sentinel: boolean[];
};

// ------------------------------------------------------------------ harness

type Wallet = { account: { address: Address } };
type Cfg = {
  seed: number;
  steps: number;
  weights: Record<string, number>;
  pol: Policy;
  funds: bigint;
  payees: boolean;
  recovery: boolean;
};

class Harness {
  readonly trace: string[] = [];
  spendLog: { B: bigint; amt: bigint; cap: bigint }[] = [];
  readonly stats: Record<string, number> = {};
  nonceCtr = 1000n;
  last!: Chain;
  pool!: Address[];
  spendTo!: Address[];
  payPool!: Address[];
  sentinelAddr!: Address;

  constructor(
    readonly env: Env,
    readonly acct: Contract,
    readonly other: Contract,
    readonly m: Model,
    readonly r: Rng,
  ) {
    const w = env;
    this.sentinelAddr = w.sentinel.account.address;
    this.pool = [w.everyday.account.address, w.safety.account.address, w.relayer.account.address,
      w.stranger.account.address, w.sentinel.account.address, w.payee.account.address, other.address];
    this.spendTo = [w.payee.account.address, w.stranger.account.address, w.sentinel.account.address,
      w.relayer.account.address, w.safety.account.address];
    this.payPool = this.spendTo;
  }

  count(key: string) { this.stats[key] = (this.stats[key] ?? 0) + 1; }
  freshNonce() { this.nonceCtr += 1n; return this.nonceCtr; }
  async nextBlock(): Promise<bigint> { return (await this.env.pub.getBlockNumber()) + 1n; }

  /// Sends a transaction and returns the revert name it failed with, or undefined on success.
  /// If B is given, the mined block must equal it (the model predicts the block).
  async send(label: string, B: bigint | null, fn: () => Promise<Hex>): Promise<string | undefined> {
    let hash: Hex;
    try {
      hash = await fn();
    } catch (e) {
      const msg = errorText(e);
      const hit = REVERTS.find((n) => msg.includes(n));
      if (!hit) throw new HarnessError(`${label}: unexpected failure: ${msg.slice(0, 400)}`);
      return hit;
    }
    const rc = await this.env.pub.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new HarnessError(`${label}: mined but reverted`);
    if (B !== null && rc.blockNumber !== B) throw new HarnessError(`${label}: predicted block ${B}, mined ${rc.blockNumber}`);
    return undefined;
  }

  expect(label: string, got: string | undefined, want: string | undefined) {
    assert.equal(got ?? "success", want ?? "success", `${label}: expected ${want ?? "success"}, got ${got ?? "success"}`);
  }

  async readChain(): Promise<Chain> {
    const a = this.acct;
    const pub = this.env.pub;
    const [pol, sealed, thr, lastTrip, epoch, lastSpend, allowance, payeeOn, rec, bal, other, block, sUses, sPer, payee, sentinel] =
      await Promise.all([
        a.read.policy([NATIVE]),
        a.read.sealed_(),
        a.read.throttledUntil(),
        a.read.lastTrip(),
        a.read.epoch(),
        a.read.lastSpendBlock([NATIVE]),
        a.read.allowanceUsed([NATIVE]),
        a.read.payeeListOn(),
        a.read.recovery(),
        pub.getBalance({ address: a.address }),
        pub.getBalance({ address: this.other.address }),
        pub.getBlockNumber(),
        a.read.sentinelUses([this.sentinelAddr]),
        a.read.sentinelPeriod([this.sentinelAddr]),
        Promise.all(this.pool.map((x) => a.read.payee([x]))),
        Promise.all(this.pool.map((x) => a.read.sentinel([x]))),
      ]);
    return {
      bal, other, sealed, thr, lastTrip: Number(lastTrip), epoch, lastSpend, allowance,
      pol: { perTxCap: pol[0], periodCap: pol[1], floor: pol[2] },
      payeeOn, rec, block, sUses, sPer, payee, sentinel,
    } as Chain;
  }

  /// Model against chain, every field.
  compare(c: Chain) {
    const m = this.m, p = m.pol;
    const eq = (label: string, got: unknown, want: unknown) => assert.equal(got, want, `state mismatch: ${label}`);
    eq("balance", c.bal, m.balance);
    eq("otherBal", c.other, m.otherBal);
    eq("sealed", c.sealed, m.sealed);
    eq("throttledUntil", c.thr, m.thr);
    eq("lastTrip", c.lastTrip, m.lastTrip);
    eq("epoch", c.epoch, m.epoch);
    eq("lastSpendBlock", c.lastSpend, m.lastSpendBlock);
    eq("allowanceUsed", c.allowance, m.allowanceUsed);
    eq("perTxCap", c.pol.perTxCap, p.perTxCap);
    eq("periodCap", c.pol.periodCap, p.periodCap);
    eq("floor", c.pol.floor, p.floor);
    eq("payeeListOn", c.payeeOn, m.payeeOn);
    eq("recovery", c.rec.toLowerCase(), m.recovery.toLowerCase());
    this.pool.forEach((a, i) => {
      const k = a.toLowerCase();
      eq(`payee[${a}]`, c.payee[i], m.payees.has(k));
      eq(`sentinel[${a}]`, c.sentinel[i], m.sentinels.has(k));
    });
    const sk = this.sentinelAddr.toLowerCase();
    eq("sentinelUses", c.sUses, m.sentUses.get(sk) ?? 0n);
    eq("sentinelPeriod", c.sPer, m.sentPer.get(sk) ?? 0n);
    // I4: a throttle never reaches more than MAX_THROTTLE_BLOCKS past the current block, and a
    // sentinel never uses more than MAX_THROTTLES_PER_PERIOD in one period.
    assert.ok(c.thr <= c.block + MAX_T, "I4: throttledUntil is more than MAX_THROTTLE_BLOCKS ahead");
    assert.ok(c.sUses <= MAX_K, "I4: sentinel exceeded MAX_THROTTLES_PER_PERIOD");
  }

  /// I2 on a snapshot pair from an everyday or sentinel step.
  i2(before: Chain, after: Chain) {
    assert.ok(after.pol.perTxCap <= before.pol.perTxCap, "I2: perTxCap was raised");
    assert.ok(after.pol.periodCap <= before.pol.periodCap, "I2: periodCap was raised");
    assert.ok(after.pol.floor >= before.pol.floor, "I2: Savings floor was lowered");
    assert.ok(!before.payeeOn || after.payeeOn, "I2: payee list was switched off");
    this.pool.forEach((_, i) => {
      assert.ok(!after.payee[i] || before.payee[i], "I2: a payee was added");
      assert.ok(!after.sentinel[i] || before.sentinel[i], "I2: a sentinel was added");
    });
    assert.ok(!before.sealed || after.sealed, "I2: the account was unsealed");
    assert.equal(after.rec, before.rec, "I2: recovery was changed");
    assert.ok(after.thr >= before.thr, "I2: throttledUntil moved backwards");
    assert.ok(after.epoch >= before.epoch, "I2: epoch moved backwards");
  }

  /// Runs one action, then checks the invariants that span the step and the full model.
  async act(kind: string, fn: () => Promise<void>) {
    this.trace.push(kind);
    const before = this.last;
    await fn();
    const after = await this.readChain();

    // I3: while sealed, only breakGlass and spendWithApproval move money out.
    if (before.sealed && after.bal < before.bal) {
      assert.ok(OUT_WHILE_SEALED.has(kind), `I3: ${kind} moved funds out while sealed`);
    }
    if (NO_MOVE.has(kind) || kind.startsWith("attack")) {
      assert.equal(after.bal, before.bal, `${kind} moved funds`);
    }
    if (kind.startsWith("attack")) {
      assert.equal(after.other, before.other, `${kind} moved funds to recovery`);
    }
    if (!sameTerms(before.pol, after.pol)) this.spendLog = [];
    if (kind === "spend") {
      // I1: single spend within perTxCap, never below the floor, allowance within periodCap, and
      // over any run of spends the outflow stays within periodCap plus the linear refill.
      const out = before.bal > after.bal ? before.bal - after.bal : 0n;
      if (out > 0n) {
        assert.ok(out <= before.pol.perTxCap, `I1: single spend ${out} exceeds perTxCap ${before.pol.perTxCap}`);
        assert.ok(after.bal >= before.pol.floor, `I1: spend took balance below floor ${before.pol.floor}`);
        assert.ok(after.allowance <= before.pol.periodCap, `I1: allowance ${after.allowance} exceeds periodCap`);
        this.spendLog.push({ B: after.block, amt: out, cap: before.pol.periodCap });
        let sum = 0n;
        for (let i = this.spendLog.length - 1; i >= 0; i--) {
          const e = this.spendLog[i]!;
          sum += e.amt;
          const bound = e.cap + (e.cap * (after.block - e.B)) / PERIOD;
          assert.ok(sum <= bound, `I1 burst: ${sum} spent since block ${e.B} exceeds periodCap + refill ${bound}`);
        }
      }
    }
    if (I2_KINDS(kind)) this.i2(before, after);

    this.compare(after);
    // I6: every nonce the model has consumed is still consumed on chain.
    if (this.m.nonces.size > 0) {
      const last = [...this.m.nonces].at(-1)!;
      assert.equal(await this.acct.read.nonceUsed([last]), true, "I6: used nonce is not recorded");
    }
    this.last = after;
  }

  // ---------------------------------------------------------- actions

  pickAmount(B: bigint): bigint {
    const p = this.m.pol;
    const bal = this.m.balance;
    const room = this.m.periodLeft(B);
    const above = bal > p.floor ? bal - p.floor : 0n;
    const cases: Array<() => bigint> = [
      () => p.perTxCap,
      () => p.perTxCap + 1n,
      () => (p.perTxCap > 0n ? p.perTxCap - 1n : 0n),
      () => room,
      () => room + 1n,
      () => above,
      () => above + 1n,
      () => this.r.big(p.perTxCap),
      () => this.r.big(p.perTxCap),
      () => this.r.big(2n * p.perTxCap + 1n),
      () => 0n,
      () => this.r.big(bal),
    ];
    return this.r.pick(cases)();
  }

  async doSpend() {
    const B = await this.nextBlock();
    // With the payee list on, most spends go to the listed payee; the rest test the trip.
    const to = this.m.payeeOn && this.r.bool(0.8) ? this.env.payee.account.address : this.r.pick(this.spendTo);
    const amt = this.pickAmount(B);
    await this.act("spend", async () => {
      const wasSealed = this.m.sealed;
      const moved = this.m.spend(B, to, amt);
      this.count(moved ? "spend.moved" : wasSealed ? "spend.refused.sealed" : `spend.tripped.${TRIP[this.m.lastTrip]}`);
      const got = await this.send("spend", B, () => this.acct.write.spend([NATIVE, to, amt]));
      this.expect("spend", got, undefined);
    });
  }

  async doTighten(valid: boolean) {
    const p = this.m.pol, r = this.r;
    let np: Policy;
    if (valid) {
      np = {
        perTxCap: r.big(p.perTxCap),
        periodCap: r.bool(0.3) ? p.periodCap : r.big(p.periodCap),
        floor: p.floor + r.big(parseEther("2")),
      };
    } else {
      np = { ...p };
      const k = r.int(3);
      if (k === 0) np.perTxCap = p.perTxCap + 1n;
      else if (k === 1) np.periodCap = p.periodCap + 1n;
      else if (p.floor > 0n) np.floor = p.floor - 1n;
      else np.perTxCap = p.perTxCap + 1n;
    }
    await this.act(valid ? "tightenValid" : "tightenInvalid", async () => {
      const want = this.m.tighten(np);
      const got = await this.send("tighten", null, () => this.acct.write.tightenPolicy([NATIVE, np]));
      this.expect("tighten", got, want.revert);
    });
  }

  async doSimple(kind: "seal" | "cancel") {
    await this.act(kind, async () => {
      if (kind === "seal") this.m.seal(); else this.m.cancel();
      const got = await this.send(kind, null, () =>
        kind === "seal" ? this.acct.write.seal() : this.acct.write.cancelLoosens());
      this.expect(kind, got, undefined);
    });
  }

  async doPayee() {
    const who = this.r.pick(this.payPool);
    const op = this.r.int(3);
    await this.act("payee", async () => {
      if (op === 0) {
        this.m.removePayee(who);
        this.expect("removePayee", await this.send("removePayee", null, () => this.acct.write.removePayee([who])), undefined);
      } else if (op === 1) {
        this.m.enablePayeeList();
        this.expect("enablePayeeList", await this.send("enablePayeeList", null, () => this.acct.write.enablePayeeList()), undefined);
      } else {
        this.m.removeSentinel(who);
        this.expect("removeSentinel", await this.send("removeSentinel", null, () => this.acct.write.removeSentinel([who])), undefined);
      }
    });
  }

  async doThrottle() {
    const B = await this.nextBlock();
    const len = this.r.bool(0.85) ? BigInt(this.r.int(51)) : BigInt(51 + this.r.int(750));
    await this.act("throttle", async () => {
      const want = this.m.throttle(B, this.sentinelAddr, len);
      const got = await this.send("throttle", want.revert ? null : B, () =>
        this.acct.write.throttle([len], { account: this.env.sentinel.account }));
      this.expect("throttle", got, want.revert);
      this.count(want.revert ? `throttle.${want.revert}` : "throttle.ok");
    });
  }

  makeData(action: number): { data: Hex; arg: unknown } {
    const r = this.r;
    switch (action) {
      case 0: {
        const pol: Policy = { perTxCap: r.big(parseEther("3")), periodCap: r.big(parseEther("6")), floor: r.big(parseEther("8")) };
        return { data: encodeAbiParameters([{ type: "address" }, { type: "tuple", components: POLICY_TUPLE }] as const, [NATIVE, pol]), arg: pol };
      }
      case 1: {
        const who = r.pick(this.payPool);
        return { data: encodeAbiParameters([{ type: "address" }] as const, [who]), arg: who };
      }
      case 2:
      case 3:
        return { data: "0x", arg: null };
      case 4: {
        const who = r.pick([this.sentinelAddr, this.env.stranger.account.address, this.env.payee.account.address]);
        return { data: encodeAbiParameters([{ type: "address" }] as const, [who]), arg: who };
      }
      default: {
        const who = r.pick([this.other.address, this.env.stranger.account.address]);
        return { data: encodeAbiParameters([{ type: "address" }] as const, [who]), arg: who };
      }
    }
  }

  async doQueue() {
    const r = this.r, m = this.m;
    const action = m.sealed && r.bool(0.4) ? 3 : r.int(6); // Unseal is the usual way out of a seal
    const { data, arg } = this.makeData(action);
    const expired = r.bool(0.08);
    const badSig = !expired && r.bool(0.08);
    const reuse = m.nonces.size > 0 && r.bool(0.15);
    const nonce = reuse ? r.pick([...m.nonces]) : this.freshNonce();
    const dl = expired ? 1n : deadline();
    let sig: Hex = "0x";
    if (!expired) {
      const d = await this.acct.read.digest([16 + action, data, nonce, dl]);
      sig = badSig ? "0x1234" : await approve(this.env, d);
    }
    await this.act("queue", async () => {
      const B = await this.nextBlock();
      const want = m.queueLoosen(B, action, data, nonce, expired, badSig, arg);
      const got = await this.send("queue", want.revert ? null : B, () =>
        this.acct.write.queueLoosen([action, data, nonce, dl, sig], { account: this.env.relayer.account }));
      this.expect("queue", got, want.revert);
      this.count(`queue.${LOOSEN_KIND_NAMES[action]}.${want.revert ?? "ok"}`);
    });
  }

  async doExecute() {
    const r = this.r, m = this.m;
    let action: number, data: Hex, nonce: bigint;
    const now = (await this.env.pub.getBlockNumber()) + 1n;
    const ready = [...m.queue.values()].filter((e) => e.readyAt !== 0n && e.readyAt <= now && e.qEpoch === m.epoch);
    if (ready.length > 0 && r.bool(0.7)) {
      ({ action, data, nonce } = r.pick(ready));
    } else if (m.queue.size > 0 && r.bool(0.85)) {
      const e = r.pick([...m.queue.values()]);
      ({ action, data, nonce } = e);
    } else {
      action = r.int(6);
      data = "0x";
      nonce = 900000n + BigInt(r.int(1000));
    }
    const id = loosenId(action, data, nonce);
    const callers: Wallet[] = [this.env.everyday, this.env.stranger, this.env.sentinel, this.env.relayer, this.env.payee];
    const caller = r.pick(callers);
    await this.act("execute", async () => {
      const B = await this.nextBlock();
      const want = m.executeLoosen(B, id);
      const got = await this.send("execute", want.revert ? null : B, () =>
        this.acct.write.executeLoosen([action, data, nonce], { account: caller.account }));
      this.expect("execute", got, want.revert);
      this.count(`execute.${LOOSEN_KIND_NAMES[action]}.${want.revert ?? "ok"}`);
    });
  }

  async doSpendWA() {
    const r = this.r, m = this.m;
    const to = r.pick(this.spendTo);
    const amt = this.pickAmount(await this.nextBlock());
    const expired = r.bool(0.06);
    const badSig = !expired && r.bool(0.06);
    const reuse = m.nonces.size > 0 && r.bool(0.12);
    const nonce = reuse ? r.pick([...m.nonces]) : this.freshNonce();
    const dl = expired ? 1n : deadline();
    const data = encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }] as const, [NATIVE, to, amt]);
    let sig: Hex = "0x";
    if (!expired) {
      const d = await this.acct.read.digest([0, data, nonce, dl]);
      sig = badSig ? "0x1234" : await approve(this.env, d);
    }
    await this.act("spendWA", async () => {
      const want = m.spendWA(expired, nonce, badSig, amt);
      const got = await this.send("spendWA", null, () =>
        this.acct.write.spendWithApproval([NATIVE, to, amt, nonce, dl, sig], { account: this.env.relayer.account }));
      this.expect("spendWA", got, want.revert);
      this.count(`spendWA.${want.revert ?? "ok"}`);
    });
  }

  async doBreakGlassWA() {
    const r = this.r, m = this.m;
    const expired = r.bool(0.05);
    const badSig = !expired && r.bool(0.05);
    const nonce = this.freshNonce();
    const dl = expired ? 1n : deadline();
    const data = encodeAbiParameters([{ type: "address[]" }] as const, [[NATIVE]]);
    let sig: Hex = "0x";
    if (!expired) {
      const d = await this.acct.read.digest([1, data, nonce, dl]);
      sig = badSig ? "0x1234" : await approve(this.env, d);
    }
    await this.act("breakGlassWA", async () => {
      const want = m.breakGlassWA(expired, nonce, badSig);
      const got = await this.send("breakGlassWA", null, () =>
        this.acct.write.breakGlassWithApproval([[NATIVE], nonce, dl, sig], { account: this.env.relayer.account }));
      this.expect("breakGlassWA", got, want.revert);
      this.count(`breakGlassWA.${want.revert ?? "ok"}`);
    });
  }

  async doBreakGlass() {
    await this.act("breakGlass", async () => {
      const want = this.m.breakGlass();
      const got = await this.send("breakGlass", null, () => this.acct.write.breakGlass([[NATIVE]]));
      this.expect("breakGlass", got, want.revert);
      this.count(`breakGlass.${want.revert ?? "ok"}`);
    });
  }

  async doFund() {
    const value = this.r.big(parseEther("3")) + parseEther("0.01");
    await this.act("fund", async () => {
      const hash = await this.env.everyday.sendTransaction({ to: this.acct.address, value });
      await this.env.pub.waitForTransactionReceipt({ hash });
      this.m.balance += value;
    });
  }

  async doMine() {
    const n = this.r.int(151);
    await this.act("mine", async () => {
      if (n > 0) await this.env.networkHelpers.mine(n);
    });
  }

  /// Everyday-only functions called by a stranger or a sentinel must revert, and a garbage Safety
  /// signature must never authorise anything.
  async doAttack() {
    const r = this.r;
    const att = r.bool(0.5) ? this.env.stranger : this.env.sentinel;
    const to = r.pick(this.spendTo);
    const a = { account: att.account };
    const nonce = this.freshNonce();
    const dl = deadline();
    const garbage = "0x1234" as Hex;
    const table: Array<{ name: string; want: string; run: () => Promise<Hex> }> = [
      { name: "spend", want: "NotEveryday", run: () => this.acct.write.spend([NATIVE, to, 1n], a) },
      { name: "seal", want: "NotEveryday", run: () => this.acct.write.seal(a) },
      { name: "tighten", want: "NotEveryday", run: () => this.acct.write.tightenPolicy([NATIVE, { perTxCap: 0n, periodCap: 0n, floor: parseEther("100") }], a) },
      { name: "removePayee", want: "NotEveryday", run: () => this.acct.write.removePayee([to], a) },
      { name: "enablePayeeList", want: "NotEveryday", run: () => this.acct.write.enablePayeeList(a) },
      { name: "removeSentinel", want: "NotEveryday", run: () => this.acct.write.removeSentinel([to], a) },
      { name: "cancelLoosens", want: "NotEveryday", run: () => this.acct.write.cancelLoosens(a) },
      { name: "breakGlass", want: "NotEveryday", run: () => this.acct.write.breakGlass([[NATIVE]], a) },
      { name: "spendWA-garbage", want: "BadSafetySignature", run: () => this.acct.write.spendWithApproval([NATIVE, to, 1n, nonce, dl, garbage], a) },
      { name: "breakGlassWA-garbage", want: "BadSafetySignature", run: () => this.acct.write.breakGlassWithApproval([[NATIVE], nonce, dl, garbage], a) },
      { name: "queue-garbage", want: "BadSafetySignature", run: () => this.acct.write.queueLoosen([3, "0x", nonce, dl, garbage], a) },
      { name: "execute-unknown", want: "NotQueued", run: () => this.acct.write.executeLoosen([3, "0x", nonce], a) },
    ];
    if (att === this.env.stranger) table.push({ name: "throttle", want: "NotSentinel", run: () => this.acct.write.throttle([1n], a) });
    const pick = r.pick(table);
    await this.act(`attack:${att === this.env.stranger ? "stranger" : "sentinel"}:${pick.name}`, async () => {
      const got = await this.send(pick.name, null, pick.run);
      this.expect(pick.name, got, pick.want);
      this.count(`attack.${pick.name}.${pick.want}`);
    });
  }

  async randomStep(weights: Record<string, number>) {
    let k = this.r.weighted(weights);
    // Steer toward useful states: a sealed account mostly needs a Safety-key widening, not more spends.
    if (k === "spend" && this.m.sealed && this.r.bool(0.7)) k = "queue";
    // A pending widening only runs once its delay has passed, so mine toward it.
    const pending = [...this.m.queue.values()].some((e) => e.readyAt !== 0n && e.qEpoch === this.m.epoch);
    if (pending && this.m.sealed && this.r.bool(0.4)) k = "mine";
    switch (k) {
      case "spend": return this.doSpend();
      case "tightenValid": return this.doTighten(true);
      case "tightenInvalid": return this.doTighten(false);
      case "seal": return this.doSimple("seal");
      case "cancel": return this.doSimple("cancel");
      case "payee": return this.doPayee();
      case "throttle": return this.doThrottle();
      case "queue": return this.doQueue();
      case "execute": return this.doExecute();
      case "spendWA": return this.doSpendWA();
      case "breakGlassWA": return this.doBreakGlassWA();
      case "breakGlass": return this.doBreakGlass();
      case "mine": return this.doMine();
      case "fund": return this.doFund();
      case "attack": return this.doAttack();
    }
    throw new HarnessError(`unknown step ${k}`);
  }

  async finalCheck() {
    for (const n of this.m.nonces) {
      assert.equal(await this.acct.read.nonceUsed([n]), true, `I6: nonce ${n} consumed in the model but not on chain`);
    }
    for (const id of this.m.ids) {
      const want = this.m.queue.get(id)!.readyAt;
      assert.equal(await this.acct.read.readyAt([id]), want, `readyAt mismatch for ${id}`);
    }
  }
}

// ------------------------------------------------------------------ drivers

const DEFAULT_WEIGHTS: Record<string, number> = {
  spend: 30, tightenValid: 5, tightenInvalid: 3, seal: 3, cancel: 2, payee: 3, throttle: 8,
  queue: 10, execute: 8, spendWA: 6, breakGlassWA: 1, breakGlass: 1, mine: 8, fund: 6, attack: 5,
};

// The coverage guards are tuned for the default seeds. An INV_SEED override can trip one without any
// invariant failing, so a coverage failure under an override is not by itself a contract bug.
const seedOf = (fallback: number) => (process.env.INV_SEED ? Number(process.env.INV_SEED) : fallback);

async function runRandom(name: string, cfg: Cfg) {
  const seed = seedOf(cfg.seed);
  const env = await setup();
  const { account: other } = await deployAccount(env);
  const { account } = await deployAccount(env, {
    recovery: cfg.recovery ? other.address : undefined,
    payees: cfg.payees ? [env.payee.account.address] : [],
    policy: cfg.pol,
  });
  const fundHash = await env.everyday.sendTransaction({ to: account.address, value: cfg.funds });
  await env.pub.waitForTransactionReceipt({ hash: fundHash });

  const m = new Model({
    pol: cfg.pol,
    balance: cfg.funds,
    payeeOn: cfg.payees,
    payees: cfg.payees ? [env.payee.account.address] : [],
    recovery: cfg.recovery ? other.address : ZERO,
    other: other.address,
  });
  const h = new Harness(env, account, other, m, rng(seed));
  console.log(`[invariants] ${name}: seed=${seed} steps=${cfg.steps}`);
  try {
    h.last = await h.readChain();
    h.compare(h.last);
    for (let i = 0; i < cfg.steps; i++) await h.randomStep(cfg.weights);
    await h.finalCheck();
  } catch (e) {
    const msg = (e as Error).message;
    throw new Error(`[${name} seed=${seed}] ${msg}\n  last steps: ${h.trace.slice(-15).join(" > ")}`);
  }
  console.log(`[invariants] ${name}: done, outcomes ${JSON.stringify(h.stats)}`);
  return h;
}

// Helpers for the deterministic edge tests.
async function fresh(pol: Policy, funds: bigint, payees: boolean = false) {
  const env = await setup();
  const { account: other } = await deployAccount(env);
  const { account } = await deployAccount(env, { policy: pol, payees: payees ? [env.payee.account.address] : [] });
  const hash = await env.everyday.sendTransaction({ to: account.address, value: funds });
  await env.pub.waitForTransactionReceipt({ hash });
  return { env, account, other };
}

/// Next transaction lands at block `B`. Mines the gap; the caller must be behind B.
async function mineUntilNext(env: Env, B: bigint) {
  const cur = await env.pub.getBlockNumber();
  const n = B - 1n - cur;
  if (n > 0n) await env.networkHelpers.mine(Number(n));
}

const eth = parseEther;

// ------------------------------------------------------------------ randomised suites

describe("Invariants: randomised sequences (seeded)", async () => {
  it("default walls, payee list off, recovery pinned", async () => {
    const h = await runRandom("default walls", {
      seed: 101, steps: 250, weights: DEFAULT_WEIGHTS,
      pol: { perTxCap: eth("1"), periodCap: eth("3"), floor: eth("5") }, funds: eth("10"), payees: false, recovery: true,
    });
    assert.ok(Object.keys(h.stats).some((k) => k.startsWith("spend.tripped.")), "coverage: no tripwire was reached");
    assert.ok((h.stats["spend.moved"] ?? 0) > 0, "coverage: no everyday spend ever moved funds");
  });

  it("tight walls near the floor, payee list on", async () => {
    const h = await runRandom("tight walls", {
      seed: 202, steps: 300, weights: { ...DEFAULT_WEIGHTS, spend: 40, mine: 4 },
      pol: { perTxCap: eth("0.3"), periodCap: eth("0.9"), floor: eth("2") }, funds: eth("6"), payees: true, recovery: true,
    });
    // The first over-cap or unknown-payee spend seals this config, so the coverage here is the trip and
    // the refusal-while-sealed paths. Successful spends are covered by the mixed runs below.
    assert.ok(Object.keys(h.stats).some((k) => k.startsWith("spend.tripped.")), "coverage: no spend tripped");
    assert.ok((h.stats["spend.refused.sealed"] ?? 0) > 0, "coverage: no spend was refused while sealed");
  });

  it("ratchet heavy: tightens, widenings queued, executed and cancelled", async () => {
    const h = await runRandom("ratchet", {
      seed: 303, steps: 300,
      weights: { ...DEFAULT_WEIGHTS, tightenValid: 10, tightenInvalid: 8, queue: 15, execute: 15, throttle: 3, spendWA: 2 },
      pol: { perTxCap: eth("1"), periodCap: eth("3"), floor: eth("5") }, funds: eth("10"), payees: false, recovery: true,
    });
    assert.ok(Object.keys(h.stats).some((k) => k.startsWith("execute.") && k.endsWith(".ok")), "coverage: no widening executed");
  });

  it("attack heavy: sentinel and stranger calls never move funds", async () => {
    await runRandom("attacks", {
      seed: 404, steps: 300,
      weights: { ...DEFAULT_WEIGHTS, attack: 25, throttle: 15, queue: 5, execute: 6, spend: 20 },
      pol: { perTxCap: eth("1"), periodCap: eth("3"), floor: eth("5") }, funds: eth("10"), payees: true, recovery: false,
    });
  });

  it("seal and break-glass heavy: Safety-key outflows and evacuation", async () => {
    const h = await runRandom("seal and break-glass", {
      seed: 505, steps: 220,
      weights: { ...DEFAULT_WEIGHTS, seal: 8, cancel: 4, breakGlass: 4, breakGlassWA: 4, spendWA: 15, fund: 8 },
      pol: { perTxCap: eth("1"), periodCap: eth("3"), floor: eth("5") }, funds: eth("10"), payees: false, recovery: true,
    });
    assert.ok((h.stats["spendWA.ok"] ?? 0) > 0 && (h.stats["breakGlass.ok"] ?? 0) + (h.stats["breakGlassWA.ok"] ?? 0) > 0, "coverage: Safety-key outflow or evacuation missing");
  });

  it("mixed: many blocks mined, so period windows roll often", async () => {
    await runRandom("mixed with mining", {
      seed: 606, steps: 260,
      weights: { ...DEFAULT_WEIGHTS, mine: 25, spend: 25, throttle: 10 },
      pol: { perTxCap: eth("0.8"), periodCap: eth("1.5"), floor: eth("1") }, funds: eth("4"), payees: true, recovery: true,
    });
  });

  it("mixed: default weights, second seed", async () => {
    await runRandom("mixed", {
      seed: 707, steps: 200,
      weights: DEFAULT_WEIGHTS,
      pol: { perTxCap: eth("2"), periodCap: eth("4"), floor: eth("3") }, funds: eth("12"), payees: false, recovery: true,
    });
  });
});

// ------------------------------------------------------------------ targeted edge cases

describe("Edge cases", async () => {
  it("perTxCap = 0: zero spends pass, anything above zero trips OverTxCap", async () => {
    const { env, account } = await fresh({ perTxCap: 0n, periodCap: eth("3"), floor: 0n }, eth("5"));
    await account.write.spend([NATIVE, env.payee.account.address, 0n]);
    assert.equal(await account.read.sealed_(), false);
    assert.equal(await account.read.blastRadius([NATIVE]), 0n);
    await account.write.spend([NATIVE, env.payee.account.address, 1n]);
    assert.equal(await account.read.lastTrip(), 1);
    assert.equal(await account.read.sealed_(), true);
    assert.equal(await env.pub.getBalance({ address: account.address }), eth("5"));
  });

  it("periodCap smaller than perTxCap: a spend under perTxCap still trips OverPeriodCap", async () => {
    const { env, account } = await fresh({ perTxCap: eth("2"), periodCap: eth("1"), floor: 0n }, eth("5"));
    await account.write.spend([NATIVE, env.payee.account.address, eth("1.5")]);
    assert.equal(await account.read.lastTrip(), 2, "1.5 is under perTxCap 2 but over periodCap 1");
    assert.equal(await env.pub.getBalance({ address: account.address }), eth("5"));

    const b = await fresh({ perTxCap: eth("2"), periodCap: eth("1"), floor: 0n }, eth("5"));
    await b.account.write.spend([NATIVE, b.env.payee.account.address, eth("1")]);
    assert.equal(await b.account.read.lastTrip(), 0, "exactly periodCap is allowed");
    // The allowance refills 1% of periodCap per block (1 ETH / 100 blocks = 0.01 ETH), so the next
    // block has room for exactly 0.01 ETH: one wei more trips.
    await b.account.write.spend([NATIVE, b.env.payee.account.address, eth("0.01") + 1n]);
    assert.equal(await b.account.read.lastTrip(), 2, "one wei over the refilled room trips");
  });

  it("spends exactly at the caps and at the floor boundary", async () => {
    // Exactly at perTxCap and periodCap: three spends of 1 with caps 1 and 3 all pass.
    const a = await fresh({ perTxCap: eth("1"), periodCap: eth("3"), floor: eth("5") }, eth("10"));
    for (let k = 0; k < 3; k++) await a.account.write.spend([NATIVE, a.env.payee.account.address, eth("1")]);
    assert.equal(await a.account.read.lastTrip(), 0);
    assert.equal(await a.env.pub.getBalance({ address: a.account.address }), eth("7"));
    await a.account.write.spend([NATIVE, a.env.payee.account.address, eth("1")]);
    assert.equal(await a.account.read.lastTrip(), 2, "the fourth spend crosses periodCap");

    // Exactly to the floor: balance 6 may pay 1 and land on 5; another 1 trips BelowFloor.
    const b = await fresh({ perTxCap: eth("1"), periodCap: eth("3"), floor: eth("5") }, eth("6"));
    await b.account.write.spend([NATIVE, b.env.payee.account.address, eth("1")]);
    assert.equal(await b.env.pub.getBalance({ address: b.account.address }), eth("5"));
    assert.equal(await b.account.read.sealed_(), false);
    await b.account.write.spend([NATIVE, b.env.payee.account.address, eth("1")]);
    assert.equal(await b.account.read.lastTrip(), 3);

    // One wei above the floor boundary: balance 5.5, floor 5, spend 0.5 + 1 wei trips.
    const c = await fresh({ perTxCap: eth("1"), periodCap: eth("3"), floor: eth("5") }, eth("5.5"));
    await c.account.write.spend([NATIVE, c.env.payee.account.address, eth("0.5") + 1n]);
    assert.equal(await c.account.read.lastTrip(), 3);
    assert.equal(await c.env.pub.getBalance({ address: c.account.address }), eth("5.5"));

    // Exactly to the floor from 5.5 with 0.5 passes.
    const d = await fresh({ perTxCap: eth("1"), periodCap: eth("3"), floor: eth("5") }, eth("5.5"));
    await d.account.write.spend([NATIVE, d.env.payee.account.address, eth("0.5")]);
    assert.equal(await d.account.read.sealed_(), false);
    assert.equal(await d.env.pub.getBalance({ address: d.account.address }), eth("5"));
  });

  it("an expired deadline reverts with Expired and leaves the nonce unused", async () => {
    const { env, account } = await fresh({ perTxCap: eth("1"), periodCap: eth("3"), floor: 0n }, eth("5"));
    const to = env.payee.account.address;
    const data = encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }] as const, [NATIVE, to, eth("1")]);
    await assert.rejects(
      account.write.spendWithApproval([NATIVE, to, eth("1"), 7n, 1n, "0x"], { account: env.relayer.account }),
      /Expired/,
    );
    assert.equal(await account.read.nonceUsed([7n]), false);
    // The same nonce works with a live deadline, so the expired attempt did not consume it.
    const dl = deadline();
    const sig = await approve(env, await account.read.digest([0, data, 7n, dl]));
    await account.write.spendWithApproval([NATIVE, to, eth("1"), 7n, dl, sig], { account: env.relayer.account });
    assert.equal(await account.read.nonceUsed([7n]), true);
    await assert.rejects(account.write.queueLoosen([3, "0x", 8n, 1n, "0x"], { account: env.relayer.account }), /Expired/);
  });

  it("the allowance refills linearly: 2.97 ETH fits 99 blocks after a full 3 ETH spend, one wei more trips", async () => {
    for (const extra of [0n, 1n]) {
      const { env, account } = await fresh({ perTxCap: eth("3"), periodCap: eth("3"), floor: 0n }, eth("10"));
      await env.networkHelpers.mine(100);
      await account.write.spend([NATIVE, env.payee.account.address, eth("3")]);
      const L = await env.pub.getBlockNumber();
      await mineUntilNext(env, L + 99n);
      await account.write.spend([NATIVE, env.payee.account.address, eth("2.97") + extra]);
      assert.equal(await account.read.lastTrip(), extra === 0n ? 0 : 2, `refill after 99 blocks is 2.97 ETH (extra ${extra} wei)`);
    }
  });

  it("the full allowance is back exactly periodBlocks after the last spend", async () => {
    for (const offset of [99n, 100n]) {
      const { env, account } = await fresh({ perTxCap: eth("3"), periodCap: eth("3"), floor: 0n }, eth("10"));
      await env.networkHelpers.mine(100);
      await account.write.spend([NATIVE, env.payee.account.address, eth("3")]);
      const L = await env.pub.getBlockNumber();
      await mineUntilNext(env, L + offset);
      await account.write.spend([NATIVE, env.payee.account.address, eth("3")]);
      assert.equal(await account.read.lastTrip(), offset === 100n ? 0 : 2, `probe at last spend + ${offset}`);
    }
  });
});

// ------------------------------------------------------------------ regressions: refilling allowance and bounded throttles
//
// These were the open issues (see the report that accompanied them). Each one now proves its fix.

async function addSentinel(env: Env, account: Contract, nonce: bigint) {
  const data = encodeAbiParameters([{ type: "address" }] as const, [env.sentinel.account.address]);
  const dl = deadline();
  const sig = await approve(env, await account.read.digest([16 + 4, data, nonce, dl]));
  await account.write.queueLoosen([4, data, nonce, dl, sig], { account: env.relayer.account });
  await env.networkHelpers.mine(50);
  await account.write.executeLoosen([4, data, nonce], { account: env.stranger.account });
}

describe("Regressions: refilling allowance and bounded throttles", async () => {
  it("first-period anchoring no longer matters: only blocks since the last spend count", async () => {
    // Same history on a young chain (block < periodBlocks) and an old one. The outcome of a probe
    // k blocks after the spend must be identical, and matches the refill formula.
    for (const k of [1n, 33n, 34n, 50n, 99n, 100n]) {
      for (const warm of [false, true]) {
        const { env, account } = await fresh({ perTxCap: eth("3"), periodCap: eth("3"), floor: 0n }, eth("10"));
        if (warm) await env.networkHelpers.mine(100);
        await account.write.spend([NATIVE, env.payee.account.address, eth("3")]);
        const s = await env.pub.getBlockNumber();
        await mineUntilNext(env, s + k);
        await account.write.spend([NATIVE, env.payee.account.address, eth("1")]);
        // used = 3 - floor(3k/100); the probe fits only if used + 1 <= 3
        const want = 3n - (3n * k) / 100n + 1n <= 3n ? 0 : 2;
        assert.equal(await account.read.lastTrip(), want, `k=${k} warm=${warm}`);
      }
    }
  });

  it("a burst across a period boundary stays within periodCap plus refill (the old 2x burst)", async () => {
    const { env, account } = await fresh({ perTxCap: eth("3"), periodCap: eth("3"), floor: 0n }, eth("10"));
    await env.networkHelpers.mine(100);
    await account.write.spend([NATIVE, env.payee.account.address, eth("1")]);
    const X = await env.pub.getBlockNumber();
    await mineUntilNext(env, X + 99n);
    await account.write.spend([NATIVE, env.payee.account.address, eth("2")]); // refill 2: used 0 -> 2
    assert.equal(await account.read.lastTrip(), 0);
    await account.write.spend([NATIVE, env.payee.account.address, eth("3")]); // 2 + 3 > 3: trips
    assert.equal(await account.read.lastTrip(), 2, "5 out within two blocks must not pass periodCap 3");
    assert.equal(await env.pub.getBalance({ address: account.address }), eth("7"));
  });

  it("throttles pause at most half of each period, once per period, and cannot cancel a queued Unseal", async () => {
    // (a) a pause is at most half a period, one throttle per period
    const { env, account } = await fresh({ perTxCap: eth("1"), periodCap: eth("3"), floor: 0n }, eth("10"));
    await addSentinel(env, account, 20n);
    const sent = { account: env.sentinel.account };
    await assert.rejects(account.write.throttle([51n], sent), /ThrottleTooLong/);
    for (const period of [2n, 3n, 4n]) {
      const base = period * PERIOD + 10n;
      await mineUntilNext(env, base);
      await account.write.throttle([50n], sent); // paused for [base, base + 50)
      await assert.rejects(account.write.throttle([1n], sent), /ThrottleBudgetUsed/);
      const before = await env.pub.getBalance({ address: account.address });
      await mineUntilNext(env, base + 49n);
      await account.write.spend([NATIVE, env.payee.account.address, 1n]); // block base + 49: paused
      assert.equal(await env.pub.getBalance({ address: account.address }), before, `paused at ${base + 49n}`);
      await mineUntilNext(env, base + 50n);
      await account.write.spend([NATIVE, env.payee.account.address, 1n]); // block base + 50: free again
      assert.equal(await env.pub.getBalance({ address: account.address }), before - 1n, `free at ${base + 50n}`);
    }

    // (b) a throttle does not cancel a queued Unseal
    const b = await fresh({ perTxCap: eth("1"), periodCap: eth("3"), floor: 0n }, eth("10"));
    await addSentinel(b.env, b.account, 21n);
    await b.account.write.seal();
    const dl = deadline();
    const sig = await approve(b.env, await b.account.read.digest([16 + 3, "0x", 33n, dl]));
    await b.account.write.queueLoosen([3, "0x", 33n, dl, sig], { account: b.env.relayer.account });
    const epochBefore = await b.account.read.epoch();
    await b.account.write.throttle([10n], { account: b.env.sentinel.account });
    assert.equal(await b.account.read.epoch(), epochBefore, "a throttle must not bump the epoch");
    await b.env.networkHelpers.mine(50);
    await b.account.write.executeLoosen([3, "0x", 33n], { account: b.env.stranger.account });
    assert.equal(await b.account.read.sealed_(), false, "the queued Unseal ran after the throttle");
  });
});
