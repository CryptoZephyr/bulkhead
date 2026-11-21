// Pairing relay for the Bulkhead Handshake. It only carries public keys one way and a sealed reply
// the other way. It can't read the reply, and it can't swap the laptop's keys: the QR commits to them.
// It could replace the reply with someone else's valid card, which is why both screens show four words.
export interface PairSession { sid: string; kem: string; x25519: string; reply?: string; createdAt: number; expiresAt: number }
export interface PairStore { get(sid: string): Promise<PairSession | null>; put(s: PairSession): Promise<void> }
export class BadPair extends Error {}

export const PAIR_TTL_MS = 10 * 60_000;
const SID = /^[0-9a-f-]{36}$/, B64 = /^[A-Za-z0-9+/=]+$/;

export class MemoryPairs implements PairStore {
  private m = new Map<string, PairSession>();
  async get(sid: string) { return this.m.get(sid) ?? null; }
  async put(s: PairSession) { this.m.set(s.sid, s); }
}

export async function startPair(store: PairStore, b: { sid?: string; kem?: string; x25519?: string }, now = Date.now()) {
  if (!SID.test(b.sid ?? "")) throw new BadPair("sid must be a UUID.");
  if (!B64.test(b.kem ?? "") || Buffer.from(b.kem!, "base64").length !== 1568) throw new BadPair("kem must be a 1568-byte ML-KEM-1024 key in base64.");
  if (!B64.test(b.x25519 ?? "") || Buffer.from(b.x25519!, "base64").length !== 32) throw new BadPair("x25519 must be 32 bytes in base64.");
  if (await store.get(b.sid!)) throw new BadPair("That session already exists.");
  const s: PairSession = { sid: b.sid!, kem: b.kem!, x25519: b.x25519!, createdAt: now, expiresAt: now + PAIR_TTL_MS };
  await store.put(s);
  return s;
}

async function live(store: PairStore, sid: string, now: number) {
  const s = await store.get(sid);
  if (!s) throw new BadPair("No such pairing session.");
  if (s.expiresAt < now) throw new BadPair("This pairing code has expired. Start again on your laptop.");
  return s;
}

export const laptopKeys = async (store: PairStore, sid: string, now = Date.now()) => { const s = await live(store, sid, now); return { kem: s.kem, x25519: s.x25519 }; };

/** The phone's sealed reply. Accepted once, so a later reply can't replace the first. */
export async function reply(store: PairStore, sid: string, envelope: string, now = Date.now()) {
  const s = await live(store, sid, now);
  if (!/^qoreseal:[A-Za-z0-9_-]+$/.test(envelope) || envelope.length > 40_000) throw new BadPair("reply must be a QoreSeal envelope.");
  if (s.reply) throw new BadPair("This session already has a reply. Start again on your laptop.");
  await store.put({ ...s, reply: envelope });
}

export const replyOf = async (store: PairStore, sid: string, now = Date.now()) => (await live(store, sid, now)).reply ?? null;
