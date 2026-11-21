// JSON records in Vercel Blob without overwriting. Overwriting a blob can serve the old copy from the
// CDN for a while (seen on the live site), so every save is a new file under the record's folder and
// a read takes the newest. Older versions are removed after a successful save, best effort.
const VERSION = /\/(\d{13})-[0-9a-f]{8}\.json$/;

export async function readLatest<T>(folder: string): Promise<T | null> {
  const { list } = await import("@vercel/blob");
  const { blobs } = await list({ prefix: `${folder}/` });
  const newest = blobs.filter((b) => VERSION.test(b.pathname)).sort((a, b) => (a.pathname < b.pathname ? 1 : -1))[0];
  if (!newest) return null;
  return (await fetch(newest.url, { cache: "no-store" })).json() as Promise<T>;
}

export async function writeVersion(folder: string, data: unknown): Promise<void> {
  const { put, list, del } = await import("@vercel/blob");
  const name = `${folder}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.json`;
  await put(name, JSON.stringify(data), { access: "public", addRandomSuffix: false, contentType: "application/json", cacheControlMaxAge: 0 });
  try {
    const { blobs } = await list({ prefix: `${folder}/` });
    const old = blobs.filter((b) => VERSION.test(b.pathname) && b.pathname < name).map((b) => b.url);
    if (old.length > 1) await del(old.slice(0, -1));   // keep one previous version
  } catch { /* cleanup only */ }
}

/** Folders directly under a prefix, e.g. the accounts under "pilot". */
export async function folders(prefix: string): Promise<string[]> {
  const { list } = await import("@vercel/blob");
  const { blobs } = await list({ prefix: `${prefix}/` });
  return [...new Set(blobs.map((b) => b.pathname.split("/")[1]).filter(Boolean))];
}
