import { json, requireOwner } from './_lib/auth.js';
import { changesSince, deleteRecord, KINDS, mapLimit, putRecord, type Doc, type Kind } from './_lib/store.js';

const MAX_ITEMS = 200;
const validId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200;

/** Pull: everything changed or deleted since `?since=` (ms). */
export async function GET(req: Request): Promise<Response> {
  const who = await requireOwner(req);
  if (who instanceof Response) return who;
  const since = Number(new URL(req.url).searchParams.get('since')) || 0;
  // A little overlap guards against clock skew; re-sending a record is harmless.
  const cursor = Date.now() - 5000;
  const { records, deletions } = await changesSince(since);
  return json({ cursor, ...records, deletions });
}

/** Push: upsert records and apply deletions. */
export async function POST(req: Request): Promise<Response> {
  const who = await requireOwner(req, true);
  if (who instanceof Response) return who;
  let body: Partial<Record<Kind, Doc[]>> & { deletions?: Array<{ kind: Kind; id: string }> };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  const upserts: Array<{ kind: Kind; doc: Doc }> = [];
  for (const kind of KINDS) {
    const list = body[kind];
    if (list === undefined) continue;
    if (!Array.isArray(list)) return json({ error: `${kind} must be an array` }, 400);
    for (const doc of list) {
      if (!doc || typeof doc !== 'object' || !validId(doc.id)) return json({ error: `Bad ${kind} record` }, 400);
      upserts.push({ kind, doc });
    }
  }
  const deletions = Array.isArray(body.deletions) ? body.deletions.filter((d) => (KINDS as readonly string[]).includes(d?.kind) && validId(d?.id)) : [];
  if (upserts.length + deletions.length > MAX_ITEMS) return json({ error: `At most ${MAX_ITEMS} items per request` }, 413);

  await mapLimit(upserts, 6, ({ kind, doc }) => putRecord(kind, doc));
  await mapLimit(deletions, 6, ({ kind, id }) => deleteRecord(kind, id));
  return json({ ok: true, saved: upserts.length, deleted: deletions.length });
}
