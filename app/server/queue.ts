// Approval queue: requests from the laptop (or the bill agent) waiting for the phone.
// The server only ever holds ciphertext: every request body is a QoreSeal envelope encrypted
// to the phone account's ML-KEM key, so a breached server can't read or forge a request.
// Storage is pluggable: memory for tests, a JSON file for local dev, a hosted store at deploy time.
import { hasStore, setOnce, memoryOnce } from "./blobjson.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

export interface QueuedRequest {
  id: string;
  account: string;        // Bulkhead account (0x)
  phone: string;          // phone account (qor1...), the envelope's recipient
  envelope: string;       // "qoreseal:..." text, opaque to the server
  createdAt: number;      // ms
  expiresAt: number;      // ms
  status: "waiting" | "approved" | "refused" | "expired";
  txHash?: string;
}

export interface Store {
  list(): Promise<QueuedRequest[]>;
  put(r: QueuedRequest): Promise<void>;
}

export class MemoryStore implements Store {
  private rows = new Map<string, QueuedRequest>();
  async list() { return [...this.rows.values()]; }
  async put(r: QueuedRequest) { this.rows.set(r.id, r); }
}

export class FileStore implements Store {
  private path: string;
  constructor(path: string) { this.path = path; }
  async list(): Promise<QueuedRequest[]> { return existsSync(this.path) ? JSON.parse(readFileSync(this.path, "utf8")) : []; }
  async put(r: QueuedRequest) { const rows = (await this.list()).filter((x) => x.id !== r.id); rows.push(r); writeFileSync(this.path, JSON.stringify(rows, null, 2)); }
}

const ENVELOPE = /^qoreseal:[A-Za-z0-9_-]+$/;
const ADDR = /^0x[0-9a-fA-F]{40}$/, QOR = /^qor1[0-9a-z]{38,58}$/;
export const TTL_MS = 10 * 60 * 1000;

export class BadRequest extends Error {}

export async function submit(store: Store, body: { account?: string; phone?: string; envelope?: string }, now = Date.now()): Promise<QueuedRequest> {
  if (!ADDR.test(body.account ?? "")) throw new BadRequest("account must be a 0x address.");
  if (!QOR.test(body.phone ?? "")) throw new BadRequest("phone must be a qor1 address.");
  if (!ENVELOPE.test(body.envelope ?? "") || body.envelope!.length > 20_000) throw new BadRequest("envelope must be a QoreSeal envelope.");
  const r: QueuedRequest = { id: crypto.randomUUID(), account: body.account!.toLowerCase(), phone: body.phone!, envelope: body.envelope!, createdAt: now, expiresAt: now + TTL_MS, status: "waiting" };
  await store.put(r);
  return r;
}

export async function waitingFor(store: Store, phone: string, now = Date.now()): Promise<QueuedRequest[]> {
  return (await store.list()).map((r) => (r.status === "waiting" && r.expiresAt < now ? { ...r, status: "expired" as const } : r))
    .filter((r) => r.phone === phone && r.status === "waiting").sort((a, b) => a.createdAt - b.createdAt);
}

export async function get(store: Store, id: string, now = Date.now()): Promise<QueuedRequest | undefined> {
  const r = (await store.list()).find((x) => x.id === id);
  return r && r.status === "waiting" && r.expiresAt < now ? { ...r, status: "expired" } : r;
}

/** What settle checks before it changes a request. Injected, so unit tests make no network calls. */
export interface Proofs {
  /** Whether this mined transaction succeeded and went to the account (or a listed factory, for a Deploy). */
  txApproves(account: string, txHash: string): Promise<boolean>;
  /** Whether the account's phone signed the refusal of this request. */
  phoneRefused(account: string, requestId: string, nonce: bigint, deadline: bigint, phoneSig: string): Promise<boolean>;
  /** Claims a key once (single-use nonces and transactions). */
  once(k: string, ttlSeconds: number): Promise<boolean>;
}

export const REFUSE_MAX_AHEAD_S = 15 * 60;
export const NOT_THIS_TX = "That transaction doesn't approve this request.";

export interface SettleBody { status?: unknown; txHash?: unknown; offchain?: unknown; nonce?: unknown; deadline?: unknown; phoneSig?: unknown }

/**
 * The phone reports what happened, with proof:
 *   approved + txHash: the chain transaction must have succeeded and gone to this account (or the factory).
 *   refused: the phone's ML-DSA-87 signature over refuseDigest, single-use nonce, deadline at most 15 minutes ahead.
 *   approved offchain: only the server (functions/pilot.ts, after it checked the phone's signature) passes `internal`.
 */
export async function settle(store: Store, id: string, outcome: SettleBody, proofs: Proofs, now = Date.now(), internal?: { account: string }) {
  const r = await get(store, id, now);
  if (!r) throw new BadRequest("No such request.");
  if (r.status !== "waiting") throw new BadRequest(`This request is already ${r.status}.`);

  if (outcome.status === "approved" && outcome.offchain !== undefined) {
    if (!internal || outcome.offchain !== true || internal.account.toLowerCase() !== r.account) throw new BadRequest("Only the server can record an approval without a transaction.");
    await store.put({ ...r, status: "approved" });
    return;
  }
  if (outcome.status === "approved") {
    const txHash = String(outcome.txHash ?? "");
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new BadRequest("An approval needs its transaction hash.");
    if (!(await proofs.txApproves(r.account, txHash).catch(() => false))) throw new BadRequest(NOT_THIS_TX);
    // One transaction settles one request.
    if (!(await proofs.once(`bh:used:tx:${txHash.toLowerCase()}`, 3 * 24 * 3600))) throw new BadRequest(NOT_THIS_TX);
    await store.put({ ...r, status: "approved", txHash });
    return;
  }
  if (outcome.status === "refused") {
    let nonce: bigint, deadline: bigint;
    try { nonce = BigInt(String(outcome.nonce)); deadline = BigInt(String(outcome.deadline)); } catch { throw new BadRequest("A refusal needs your phone's signature."); }
    const sig = String(outcome.phoneSig ?? "");
    if (!/^0x[0-9a-fA-F]+$/.test(sig)) throw new BadRequest("A refusal needs your phone's signature.");
    const nowS = BigInt(Math.floor(now / 1000));
    if (deadline < nowS) throw new BadRequest("This refusal has expired. Refuse it again on your phone.");
    if (deadline > nowS + BigInt(REFUSE_MAX_AHEAD_S)) throw new BadRequest("This refusal's deadline is too far ahead.");
    if (!(await proofs.phoneRefused(r.account, r.id, nonce, deadline, sig).catch(() => false))) throw new BadRequest("This refusal wasn't signed by the account's phone.");
    if (!(await proofs.once(`bh:used:refuse:${r.account}:${nonce}`, 2 * REFUSE_MAX_AHEAD_S))) throw new BadRequest("This refusal was already used.");
    await store.put({ ...r, status: "refused" });
    return;
  }
  throw new BadRequest("status must be approved or refused.");
}

/** The real checks: testnet reads and the shared store. FACTORY_ADDRESS may list several factories. */
export function liveProofs(): Proofs {
  return {
    async txApproves(account, txHash) {
      const { pub } = await import("./relayer.js");
      const hash = txHash as `0x${string}`;
      const [receipt, tx] = await Promise.all([pub.getTransactionReceipt({ hash }), pub.getTransaction({ hash })]);
      return txGoesTo(receipt.status, tx.to, account, process.env.FACTORY_ADDRESS ?? "");
    },
    async phoneRefused(account, requestId, nonce, deadline, phoneSig) {
      const { phoneSignedRefuse } = await import("./phoneSig.js");
      return phoneSignedRefuse(account as `0x${string}`, requestId, nonce, deadline, phoneSig as `0x${string}`);
    },
    once: (k, ttl) => (hasStore() ? setOnce(k, ttl) : localOnce(k, ttl)),
  };
}
const localOnce = memoryOnce();

/** Pure part of txApproves: a successful transaction to the account, or to one of the listed factories. */
export function txGoesTo(status: string, to: string | null | undefined, account: string, factories: string): boolean {
  if (status !== "success" || !to) return false;
  const t = to.toLowerCase();
  return t === account.toLowerCase() || factories.split(",").map((f) => f.trim().toLowerCase()).filter(Boolean).includes(t);
}

/** Vercel Blob: one JSON object per request. Requests hold only ciphertext, so public blob URLs expose nothing readable. */
export class BlobStore implements Store {
  async list(): Promise<QueuedRequest[]> {
    const { folders, readLatest } = await import("./blobjson.js");
    const rows = await Promise.all((await folders("requests")).map((id) => readLatest<QueuedRequest>(`requests/${id}`).catch(() => null)));
    return rows.filter((r): r is QueuedRequest => !!r);
  }
  async put(r: QueuedRequest) {
    const { writeVersion } = await import("./blobjson.js");
    await writeVersion(`requests/${r.id}`, r);
  }
}

export function defaultStore(): Store {
  if (hasStore()) return new BlobStore();
  if (process.env.QUEUE_FILE) return new FileStore(process.env.QUEUE_FILE);
  return new MemoryStore();
}
