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

/** Whether a local minute of the day (0..1439) is inside the quiet window. Wraps midnight. */
const quietMinute = (s: PilotSettings, m: number) => { const a = mins(s.quietStart), b = mins(s.quietEnd); return a < b ? m >= a && m < b : m >= a || m < b; };

/**
 * Whether a schedule change only makes the pilot stricter, so the laptop key alone may make it.
 * Tightening: the same time zone, a quiet window that covers every minute the old one did, and
 * each wall at or below the old one. The first ever schedule is tightening too: without one the
 * pilot does nothing and the walls sit at the phone-signed policy all day.
 * Anything else loosens the schedule and needs the phone.
 */
export function isTightening(oldS: PilotSettings | null, newS: PilotSettings): boolean {
  if (!oldS) return true;
  if (oldS.tzOffsetMin !== newS.tzOffsetMin) return false;
  if (newS.restPerTx > oldS.restPerTx || newS.restPeriod > oldS.restPeriod || newS.dayPerTx > oldS.dayPerTx || newS.dayPeriod > oldS.dayPeriod) return false;
  for (let m = 0; m < 1440; m++) if (quietMinute(oldS, m) && !quietMinute(newS, m)) return false;
  return true;
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
  return { ok: true, target: { perTx, period, until, restPerTx: s.restPerTx, restPeriod: s.restPeriod, reason: `You asked for room for ${(Number(req.amount) / 1e6).toFixed(2)} fUSD. Opened within your phone-signed ceiling until your requested time or quiet hours, whichever comes first.${note}` } };
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

// ------------------------------------------------------------------ tripwire

/** One on-chain event the tripwire reads. `at` is the block time in ms. */
export type TripEvent =
  | { kind: "Spent"; at: number; block: bigint; amount: bigint; withApproval: boolean; txHash?: string }
  | { kind: "HeldByPilot"; at: number; block: bigint; amount: bigint; txHash?: string };

/** The walls the pilot sets when the tripwire trips: nothing can leave Everyday. */
export const CLOSED: LiveTarget = { perTx: 0n, period: 0n, until: 0n, restPerTx: 0n, restPeriod: 0n, reason: "The tripwire closed the wall to zero." };

export const BURST_COUNT = 3;
export const BURST_MS = 10 * 60_000;

const clock = (at: number, tz: number) => { const m = localMinute(at, tz); return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
const CLOSED_NOTE = "The pilot closed the wall to zero.";

/**
 * Whether the account's recent events look like a stolen laptop. Pure and deterministic.
 *  (a) any HeldByPilot: someone tried to spend over the live wall.
 *  (b) BURST_COUNT or more laptop payments (not phone-approved) within BURST_MS.
 *  (c) a laptop payment during quiet hours.
 * Events later than `now` are ignored. Times in the reason are on the owner's clock.
 */
export function tripwire(events: TripEvent[], now: number, settings: PilotSettings | null): { tripped: boolean; reason: string } {
  const tz = settings?.tzOffsetMin ?? 0;
  const seen = events.filter((e) => e.at <= now).sort((a, b) => a.at - b.at);
  const held = seen.filter((e) => e.kind === "HeldByPilot");
  if (held.length) {
    const n = held.length;
    return { tripped: true, reason: `${n === 1 ? "1 payment was" : `${n} payments were`} held over your live wall at ${clock(held[0].at, tz)}. ${CLOSED_NOTE}` };
  }
  const laptop = seen.filter((e) => e.kind === "Spent" && !e.withApproval);
  if (settings) {
    const q = laptop.find((e) => isQuiet(settings, e.at));
    if (q) return { tripped: true, reason: `A payment left Everyday at ${clock(q.at, tz)}, inside your quiet hours (${settings.quietStart} to ${settings.quietEnd}). ${CLOSED_NOTE}` };
  }
  for (let i = 0, j = 0; j < laptop.length; j++) {
    while (laptop[j].at - laptop[i].at > BURST_MS) i++;
    if (j - i + 1 >= BURST_COUNT) return { tripped: true, reason: `${j - i + 1} payments left Everyday within 10 minutes, the last at ${clock(laptop[j].at, tz)}. ${CLOSED_NOTE}` };
  }
  return { tripped: false, reason: "Nothing unusual." };
}
