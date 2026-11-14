/**
 * The online collection, kept in a private Vercel Blob store:
 *
 *   records/<kind>/<id>.json   one JSON document per watch, reading or movement
 *   deleted/<kind>/<id>.json   tombstones, so deletions reach other devices
 *   photos/<watchId>.jpg       watch photos
 *
 * Changes are found by each blob's upload time, so a device asks for
 * "everything since my last sync".
 */
import { del, get, list, put } from '@vercel/blob';

export const KINDS = ['watches', 'measurements', 'movements'] as const;
export type Kind = (typeof KINDS)[number];
export type Doc = Record<string, unknown> & { id: string };

const recPath = (k: Kind, id: string) => `records/${k}/${encodeURIComponent(id)}.json`;
const delPath = (k: Kind, id: string) => `deleted/${k}/${encodeURIComponent(id)}.json`;
const photoPath = (id: string) => `photos/${encodeURIComponent(id)}.jpg`;

const JSON_OPTS = { access: 'private' as const, allowOverwrite: true, addRandomSuffix: false, contentType: 'application/json', cacheControlMaxAge: 60 };

async function quietDel(path: string) {
  try {
    await del(path);
  } catch {
    /* already gone */
  }
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export async function putRecord(kind: Kind, doc: Doc): Promise<void> {
  await put(recPath(kind, doc.id), JSON.stringify(doc), JSON_OPTS);
  await quietDel(delPath(kind, doc.id));
}

export async function deleteRecord(kind: Kind, id: string): Promise<void> {
  await put(delPath(kind, id), JSON.stringify({ deletedAt: Date.now() }), JSON_OPTS);
  await quietDel(recPath(kind, id));
  if (kind === 'watches') await quietDel(photoPath(id));
}

async function listAll(prefix: string) {
  const blobs: Array<{ pathname: string; uploadedAt: Date }> = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    blobs.push(...page.blobs.map((b) => ({ pathname: b.pathname, uploadedAt: new Date(b.uploadedAt) })));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

function parsePath(pathname: string, root: 'records' | 'deleted'): { kind: Kind; id: string } | null {
  const m = pathname.match(new RegExp(`^${root}/([a-z]+)/(.+)\\.json$`));
  if (!m || !(KINDS as readonly string[]).includes(m[1])) return null;
  return { kind: m[1] as Kind, id: decodeURIComponent(m[2]) };
}

async function readJson(pathname: string): Promise<Doc | null> {
  const r = await get(pathname, { access: 'private' });
  if (!r || r.statusCode !== 200) return null;
  return (await new Response(r.stream).json()) as Doc;
}

export interface Changes {
  records: Record<Kind, Doc[]>;
  deletions: Array<{ kind: Kind; id: string }>;
}

export async function changesSince(since: number): Promise<Changes> {
  const [recs, dels] = await Promise.all([listAll('records/'), listAll('deleted/')]);
  const changed = recs.filter((b) => b.uploadedAt.getTime() > since);
  const docs = await mapLimit(changed, 8, async (b) => ({ where: parsePath(b.pathname, 'records'), doc: await readJson(b.pathname) }));
  const records: Record<Kind, Doc[]> = { watches: [], measurements: [], movements: [] };
  for (const d of docs) if (d.where && d.doc) records[d.where.kind].push(d.doc);
  const deletions = dels
    .filter((b) => b.uploadedAt.getTime() > since)
    .map((b) => parsePath(b.pathname, 'deleted'))
    .filter((x): x is { kind: Kind; id: string } => x !== null);
  return { records, deletions };
}

export async function putPhoto(id: string, body: ArrayBuffer): Promise<void> {
  await put(photoPath(id), body, { access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType: 'image/jpeg', cacheControlMaxAge: 60 });
}

export async function getPhoto(id: string): Promise<Response | null> {
  const r = await get(photoPath(id), { access: 'private' });
  if (!r || r.statusCode !== 200) return null;
  return new Response(r.stream, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, no-store' } });
}
