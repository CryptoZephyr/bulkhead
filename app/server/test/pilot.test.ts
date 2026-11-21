import { test } from "node:test";
import assert from "node:assert/strict";
import { plan, planRequest, isQuiet, validate, sameAsChain, untilBlock, BadPilot, type PilotSettings, type Ceiling } from "../pilot.js";

const C: Ceiling = { perTx: 5_000_000n, period: 15_000_000n };
const S: PilotSettings = { tzOffsetMin: 60, quietStart: "00:00", quietEnd: "07:00", restPerTx: 400_000n, restPeriod: 400_000n, dayPerTx: 5_000_000n, dayPeriod: 15_000_000n };
const at = (h: number, m = 0) => Date.UTC(2026, 10, 21, h - 1, m); // local time in UTC+1
const P = 60_800n, B = 1_000_000n;

test("quiet hours, including ones that wrap midnight", () => {
  assert.equal(isQuiet(S, at(3)), true);
  assert.equal(isQuiet(S, at(7)), false);
  assert.equal(isQuiet(S, at(23, 59)), false);
  const wrap = { ...S, quietStart: "22:30", quietEnd: "06:00" };
  assert.equal(isQuiet(wrap, at(23)), true);
  assert.equal(isQuiet(wrap, at(5)), true);
  assert.equal(isQuiet(wrap, at(12)), false);
});

test("at night the plan is rest; by day it opens until quiet hours and closes by itself", () => {
  const night = plan(S, C, at(3), B, P);
  assert.equal(night.perTx, 400_000n); assert.equal(night.until, 0n);
  const day = plan(S, C, at(12), B, P);
  assert.equal(day.perTx, 5_000_000n);
  const twelveHours = BigInt(Math.floor((12 * 3600) / 1.42));
  assert.ok(day.until - B >= twelveHours - 2n && day.until - B <= twelveHours + 2n);
  assert.equal(day.restPerTx, 400_000n);
});

test("a raise is capped at one period", () => {
  assert.equal(untilBlock(B, 10 * 24 * 3600 * 1000, P), B + P);
});

test("settings above the phone-signed ceiling are refused", () => {
  assert.throws(() => validate({ ...S, dayPerTx: 6_000_000n }, C), BadPilot);
  assert.throws(() => validate({ ...S, restPeriod: 20_000_000n }, C), BadPilot);
  assert.throws(() => validate({ ...S, quietStart: "25:00" }, C), BadPilot);
});

test("requests: never at night, never above the ceiling, end at quiet hours", () => {
  const night = planRequest(S, C, { amount: 2_000_000n, untilMs: at(4) }, at(3), B, P);
  assert.equal(night.ok, false);
  assert.match((night as { reason: string }).reason, /phone/);
  assert.equal(planRequest(S, C, { amount: 20_000_000n, untilMs: at(18) }, at(12), B, P).ok, false);
  const r = planRequest({ ...S, dayPerTx: 1_000_000n, dayPeriod: 2_000_000n }, C, { amount: 3_000_000n, untilMs: at(14) }, at(12), B, P);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.target.perTx, 3_000_000n); assert.equal(r.target.period, 3_000_000n);
    const twoHours = BigInt(Math.floor((2 * 3600) / 1.42));
    assert.ok(r.target.until - B <= twoHours + 2n);
  }
});

test("sameAsChain ignores small drift in the raise end", () => {
  const t = plan(S, C, at(12), B, P);
  assert.equal(sameAsChain(t, { ...t, until: t.until + 100n }, B), true);
  assert.equal(sameAsChain(t, { ...t, perTx: 1n }, B), false);
  const n = plan(S, C, at(3), B, P);
  assert.equal(sameAsChain(n, { perTx: 9n, period: 9n, until: B - 5n, restPerTx: n.restPerTx, restPeriod: n.restPeriod }, B), true);
});
