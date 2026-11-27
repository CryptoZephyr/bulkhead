// Approval queue: requests from the laptop (or the bill agent) waiting for the phone.
// The server only ever holds ciphertext: every request body is a QoreSeal envelope encrypted
// to the phone account's ML-KEM key, so a breached server can't read or forge a request.
// Storage is pluggable: memory for tests, a JSON file for local dev, a hosted store at deploy time.
import { hasStore } from "./blobjson.js";
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

/** The phone reports what happened. Approval is proven by the chain transaction, not by this record. */
/** An off-chain approval (a pilot schedule the server checked against the phone's on-chain key) passes offchain: true and has no hash. */
export async function settle(store: Store, id: string, outcome: { status: "approved" | "refused"; txHash?: string; offchain?: boolean }, now = Date.now()) {
  const r = await get(store, id, now);
  if (!r) throw new BadRequest("No such request.");
  if (r.status !== "waiting") throw new BadRequest(`This request is already ${r.status}.`);
  const offchain = outcome.status === "approved" && outcome.offchain === true && outcome.txHash === undefined;
  if (outcome.status === "approved" && !offchain && !/^0x[0-9a-fA-F]{64}$/.test(outcome.txHash ?? "")) throw new BadRequest("An approval needs its transaction hash.");
  await store.put({ ...r, status: outcome.status, txHash: outcome.txHash });
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
