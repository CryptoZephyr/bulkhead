import { test } from "node:test";
import assert from "node:assert/strict";
import { plan, planRequest, isQuiet, validate, sameAsChain, untilBlock, isTightening, tripwire, CLOSED, BadPilot, type PilotSettings, type Ceiling, type TripEvent } from "../pilot.js";

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

test("schedule changes: only a stricter schedule counts as tightening", () => {
  assert.equal(isTightening(null, S), true, "the first save");
  assert.equal(isTightening(S, S), true, "no change");
  assert.equal(isTightening(S, { ...S, quietStart: "23:00", quietEnd: "08:00" }), true, "a longer window across midnight");
  assert.equal(isTightening(S, { ...S, quietEnd: "09:00" }), true, "a longer window");
  assert.equal(isTightening(S, { ...S, quietStart: "02:00", quietEnd: "09:00" }), false, "a window that shifts");
  assert.equal(isTightening(S, { ...S, quietEnd: "06:00" }), false, "shorter by an hour");
  const wrap = { ...S, quietStart: "22:00", quietEnd: "06:00" };
  assert.equal(isTightening(wrap, { ...wrap, quietStart: "21:30", quietEnd: "06:30" }), true, "a wrap-around superset");
  assert.equal(isTightening(wrap, { ...wrap, quietStart: "23:00", quietEnd: "06:00" }), false, "a wrap-around window that starts later");
  assert.equal(isTightening(S, { ...S, quietStart: "08:00", quietEnd: "07:00" }), true, "a 23-hour window still covers the old one");
  assert.equal(isTightening(S, { ...S, quietStart: "07:00", quietEnd: "23:00" }), false, "the window moved to the daytime");
  assert.equal(isTightening(S, { ...S, restPerTx: 500_000n }), false, "a raised night wall");
  assert.equal(isTightening(S, { ...S, restPeriod: 500_000n }), false, "a raised night daily wall");
  assert.equal(isTightening(S, { ...S, dayPerTx: 4_000_000n, dayPeriod: 10_000_000n }), true, "a lowered daytime wall");
  assert.equal(isTightening(S, { ...S, dayPeriod: 16_000_000n }), false, "a raised daytime daily wall");
  assert.equal(isTightening(S, { ...S, restPerTx: 100_000n }), true, "a lowered night wall");
  assert.equal(isTightening(S, { ...S, tzOffsetMin: 0 }), false, "a time zone change");
  assert.equal(isTightening(S, { ...S, tzOffsetMin: 0, quietStart: "23:00", quietEnd: "06:00" }), false, "a time zone change, even if it lines up");
});

const spent = (t: number, withApproval = false): TripEvent => ({ kind: "Spent", at: t, block: 1n, amount: 1_000_000n, withApproval });
const held = (t: number): TripEvent => ({ kind: "HeldByPilot", at: t, block: 1n, amount: 9_000_000n });

test("tripwire (a): any payment held over the live wall trips it, day or night", () => {
  const night = tripwire([held(at(3, 12)), held(at(3, 14))], at(3, 20), S);
  assert.equal(night.tripped, true);
  assert.equal(night.reason, "2 payments were held over your live wall at 03:12. The pilot closed the wall to zero.");
  const day = tripwire([spent(at(12)), held(at(13, 5))], at(13, 10), S);
  assert.equal(day.tripped, true);
  assert.match(day.reason, /^1 payment was held over your live wall at 13:05\./);
  assert.equal(tripwire([held(at(13))], at(13), null).tripped, true, "trips even without a schedule");
});

test("tripwire (b): three laptop payments within 10 minutes trip it; phone-approved ones don't count", () => {
  const r = tripwire([spent(at(12, 0)), spent(at(12, 4)), spent(at(12, 9))], at(12, 10), S);
  assert.equal(r.tripped, true);
  assert.equal(r.reason, "3 payments left Everyday within 10 minutes, the last at 12:09. The pilot closed the wall to zero.");
  assert.equal(tripwire([spent(at(12, 0)), spent(at(12, 6)), spent(at(12, 11))], at(12, 12), S).tripped, false, "spread over 11 minutes");
  assert.equal(tripwire([spent(at(12, 0)), spent(at(12, 1), true), spent(at(12, 2), true), spent(at(12, 3))], at(12, 4), S).tripped, false, "two of them approved on the phone");
});

test("tripwire (c): a laptop payment inside quiet hours trips it", () => {
  const r = tripwire([spent(at(2, 30))], at(2, 31), S);
  assert.equal(r.tripped, true);
  assert.equal(r.reason, "A payment left Everyday at 02:30, inside your quiet hours (00:00 to 07:00). The pilot closed the wall to zero.");
  assert.equal(tripwire([spent(at(2, 30), true)], at(2, 31), S).tripped, false, "approved on the phone");
});

test("tripwire: an ordinary day doesn't trip it", () => {
  const r = tripwire([spent(at(9)), spent(at(12, 30)), spent(at(12, 45)), spent(at(18), true), spent(at(18, 1), true), spent(at(18, 2), true)], at(19), S);
  assert.deepEqual(r, { tripped: false, reason: "Nothing unusual." });
  assert.equal(tripwire([], at(3), S).tripped, false);
  assert.equal(tripwire([held(at(13))], at(12), S).tripped, false, "an event after now is ignored");
  assert.deepEqual([CLOSED.perTx, CLOSED.period, CLOSED.until, CLOSED.restPerTx, CLOSED.restPeriod], [0n, 0n, 0n, 0n, 0n]);
});
