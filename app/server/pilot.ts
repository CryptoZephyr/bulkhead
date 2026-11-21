// The pilot: keeps the live walls as low as the owner's day needs. Every level is computed here,
// deterministically. The model never chooses a number; at most it reads "I need about 200 until 6pm"
// into fields that planRequest() then checks.
//
// The contract is the backstop: nothing the pilot sets can exceed the phone-signed policy, a raise
// expires by itself, and the laptop key can only lower the walls.

export interface Ceiling { perTx: bigint; period: bigint }

export interface PilotSettings {
  /** Minutes east of UTC for the owner's clock, e.g. 60 for Lagos. */
  tzOffsetMin: number;
  /** Quiet hours, owner's local time, "HH:MM". May wrap midnight. */
  quietStart: string;
  quietEnd: string;
  /** Walls while quiet (base units). */
  restPerTx: bigint;
  restPeriod: bigint;
  /** Walls while awake (base units). */
  dayPerTx: bigint;
  dayPeriod: bigint;
}

/** What the pilot wants on chain. Mirrors the contract's Live struct. */
export interface LiveTarget { perTx: bigint; period: bigint; until: bigint; restPerTx: bigint; restPeriod: bigint; reason: string }

export class BadPilot extends Error {}

export const BLOCK_SECONDS = 1.42;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const mins = (t: string) => { const m = HHMM.exec(t); if (!m) throw new BadPilot(`"${t}" isn't a time like 23:30.`); return Number(m[1]) * 60 + Number(m[2]); };

export function validate(s: PilotSettings, c: Ceiling) {
  if (!Number.isInteger(s.tzOffsetMin) || s.tzOffsetMin < -720 || s.tzOffsetMin > 840) throw new BadPilot("Time zone offset out of range.");
  if (mins(s.quietStart) === mins(s.quietEnd)) throw new BadPilot("Quiet hours need a start and an end that differ.");
  for (const [k, v] of [["restPerTx", s.restPerTx], ["restPeriod", s.restPeriod], ["dayPerTx", s.dayPerTx], ["dayPeriod", s.dayPeriod]] as const) if (v < 0n) throw new BadPilot(`${k} can't be negative.`);
  if (s.dayPerTx > c.perTx || s.dayPeriod > c.period) throw new BadPilot("The daytime wall can't be above the ceiling your phone signed.");
  if (s.restPerTx > s.dayPerTx || s.restPeriod > s.dayPeriod) throw new BadPilot("The night wall must be lower than the daytime wall.");
}

/** Owner's local minute of the day. */
const localMinute = (now: number, tz: number) => (((Math.floor(now / 60000) + tz) % 1440) + 1440) % 1440;

export function isQuiet(s: PilotSettings, now: number): boolean {
  const m = localMinute(now, s.tzOffsetMin), a = mins(s.quietStart), b = mins(s.quietEnd);
  return a < b ? m >= a && m < b : m >= a || m < b;
}

/** Milliseconds until quiet hours next start. */
export function msToQuiet(s: PilotSettings, now: number): number {
  const m = localMinute(now, s.tzOffsetMin), a = mins(s.quietStart);
  const d = (a - m + 1440) % 1440 || 1440;
  return d * 60000 - (now % 60000);
}

/** Block at which a raise must end so it closes when quiet hours start. Capped at one period. */
export function untilBlock(block: bigint, ms: number, periodBlocks: bigint): bigint {
  const ahead = BigInt(Math.floor(ms / 1000 / BLOCK_SECONDS));
  return block + (ahead < periodBlocks ? ahead : periodBlocks);
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);
const max = (a: bigint, b: bigint) => (a > b ? a : b);

/** The scheduled target: rest while quiet; the daytime wall until quiet hours start, which then closes by itself. */
export function plan(s: PilotSettings, c: Ceiling, now: number, block: bigint, periodBlocks: bigint): LiveTarget {
  validate(s, c);
  if (isQuiet(s, now)) return { perTx: s.restPerTx, period: s.restPeriod, until: 0n, restPerTx: s.restPerTx, restPeriod: s.restPeriod, reason: `Quiet hours (${s.quietStart} to ${s.quietEnd}): the wall stays at rest.` };
  return { perTx: s.dayPerTx, period: s.dayPeriod, until: untilBlock(block, msToQuiet(s, now), periodBlocks), restPerTx: s.restPerTx, restPeriod: s.restPeriod,
    reason: `You're in your daytime hours: the wall is open to your daytime level and closes by itself at ${s.quietStart}.` };
}

/**
 * An owner asks for more ("about 200 until 6pm"). Code decides:
 *  - in quiet hours, the pilot never raises: a stolen laptop could be the one asking. Use the phone.
 *  - otherwise raise to cover the amount, never above the ceiling, ending at the earlier of the
 *    requested time and the start of quiet hours.
 */
export function planRequest(s: PilotSettings, c: Ceiling, req: { amount: bigint; untilMs: number }, now: number, block: bigint, periodBlocks: bigint):
  { ok: true; target: LiveTarget } | { ok: false; reason: string } {
  validate(s, c);
  if (req.amount <= 0n) return { ok: false, reason: "The amount must be more than zero." };
  if (isQuiet(s, now)) return { ok: false, reason: `It's inside your quiet hours (${s.quietStart} to ${s.quietEnd}), so the pilot won't open the wall. A stolen laptop could be the one asking. Approve this payment on your phone instead.` };
  if (req.amount > c.period) return { ok: false, reason: "That's more than the ceiling your phone signed allows in a day. It needs your phone." };
  if (req.untilMs <= now) return { ok: false, reason: "The end time has already passed." };
  const perTx = min(c.perTx, max(s.dayPerTx, req.amount));
  const period = min(c.period, max(s.dayPeriod, req.amount));
  const until = untilBlock(block, Math.min(req.untilMs - now, msToQuiet(s, now)), periodBlocks);
  const note = req.amount > c.perTx ? ` Each payment is still capped at the ceiling's per-payment limit, so pay it in parts or use your phone.` : "";
  return { ok: true, target: { perTx, period, until, restPerTx: s.restPerTx, restPeriod: s.restPeriod, reason: `You asked for room for ${req.amount} base units. Opened within your phone-signed ceiling until your requested time or quiet hours, whichever comes first.${note}` } };
}

/** Whether the chain already holds this target (ignoring a small drift in `until`). */
export function sameAsChain(t: LiveTarget, chain: { perTx: bigint; period: bigint; until: bigint; restPerTx: bigint; restPeriod: bigint }, block: bigint): boolean {
  const raiseLive = chain.until > block;
  const want = t.until > block;
  if (t.restPerTx !== chain.restPerTx || t.restPeriod !== chain.restPeriod || want !== raiseLive) return false;
  if (!want) return true;
  const drift = chain.until > t.until ? chain.until - t.until : t.until - chain.until;
  return t.perTx === chain.perTx && t.period === chain.period && drift < 600n;
}

export const DEFAULTS = (c: Ceiling): Omit<PilotSettings, "tzOffsetMin"> => ({
  quietStart: "00:00", quietEnd: "07:00",
  restPerTx: c.perTx / 12n, restPeriod: c.period / 36n,
  dayPerTx: c.perTx, dayPeriod: c.period,
});
