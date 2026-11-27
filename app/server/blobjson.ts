// Server state in Upstash Redis (Vercel Marketplace), through its REST API: plain fetch, no extra
// dependency. One key per record, so a write is visible to the next read at once (Vercel Blob served
// stale copies and its list() quota suspended the store). Folders are Redis sets of record ids, so
// the daily and five-minute runs can find every account without listing storage.
//
// The module keeps its old function names (readLatest, writeVersion, folders) so callers don't change.

const url = () => process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const token = () => process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

/** Whether shared storage is configured. Without it the functions fall back to memory (local runs). */
export const hasStore = () => !!(url() && token());

/** Records that only matter for a while expire on their own. */
const TTL_SECONDS: Record<string, number> = { requests: 2 * 24 * 3600, pair: 3600 };

async function redis<T>(command: (string | number)[]): Promise<T> {
  const r = await fetch(url()!, { method: "POST", headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" }, body: JSON.stringify(command) });
  const j = (await r.json().catch(() => null)) as { result?: T; error?: string } | null;
  if (!r.ok || !j || j.error) throw new Error(`Storage refused ${command[0]}: ${j?.error ?? r.status}`);
  return j.result as T;
}

async function pipeline(commands: (string | number)[][]): Promise<void> {
  const r = await fetch(`${url()}/pipeline`, { method: "POST", headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" }, body: JSON.stringify(commands) });
  const j = (await r.json().catch(() => null)) as { error?: string }[] | null;
  const bad = Array.isArray(j) ? j.find((x) => x?.error) : { error: `status ${r.status}` };
  if (!r.ok || bad) throw new Error(`Storage refused a write: ${bad?.error ?? r.status}`);
}

/** Claims `k` once (SET k 1 NX EX ttl): true the first time, false while the claim lasts. For single-use nonces and signatures. */
export async function setOnce(k: string, ttlSeconds: number): Promise<boolean> {
  return (await redis<string | null>(["SET", k, "1", "NX", "EX", ttlSeconds])) === "OK";
}

/** The same claim in memory, for local runs and tests. */
export function memoryOnce(): (k: string, ttlSeconds: number) => Promise<boolean> {
  const seen = new Map<string, number>();
  return async (k, ttlSeconds) => {
    const now = Date.now();
    if ((seen.get(k) ?? 0) > now) return false;
    seen.set(k, now + ttlSeconds * 1000);
    return true;
  };
}

const split = (folder: string) => { const i = folder.indexOf("/"); return { prefix: folder.slice(0, i), id: folder.slice(i + 1) }; };
const key = (folder: string) => `bh:${folder}`;
const index = (prefix: string) => `bh:index:${prefix}`;

/** The record at `folder` ("pilot/0xabc…"), or null. */
export async function readLatest<T>(folder: string): Promise<T | null> {
  const v = await redis<string | null>(["GET", key(folder)]);
  return v ? (JSON.parse(v) as T) : null;
}

/** Saves the record and remembers its id under its prefix. */
export async function writeVersion(folder: string, data: unknown): Promise<void> {
  const { prefix, id } = split(folder);
  const ttl = TTL_SECONDS[prefix];
  await pipeline([
    ttl ? ["SET", key(folder), JSON.stringify(data), "EX", ttl] : ["SET", key(folder), JSON.stringify(data)],
    ["SADD", index(prefix), id],
  ]);
}

/** Ids saved under a prefix, e.g. the accounts under "pilot". Ids whose record expired are dropped. */
export async function folders(prefix: string): Promise<string[]> {
  const ids = await redis<string[]>(["SMEMBERS", index(prefix)]);
  if (!TTL_SECONDS[prefix] || ids.length === 0) return ids;
  const alive = await redis<number[]>(["MGET", ...ids.map((id) => key(`${prefix}/${id}`))]) as unknown as (string | null)[];
  const gone = ids.filter((_, i) => alive[i] === null);
  if (gone.length) await redis(["SREM", index(prefix), ...gone]);
  return ids.filter((_, i) => alive[i] !== null);
}
