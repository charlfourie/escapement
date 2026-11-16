import { json, requireOwner } from './_lib/auth.js';
import { changesSince, deleteRecord, KINDS, mapLimit, putRecord, type Doc, type Kind } from './_lib/store.js';

const MAX_ITEMS = 200;
const validId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200;
const validKind = (kind: unknown): kind is Kind => typeof kind === 'string' && (KINDS as readonly string[]).includes(kind);

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
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json({ error: 'Body must be a JSON object' }, 400);
  const body = parsed as Partial<Record<Kind, unknown>> & { deletions?: unknown };

  const upserts: Array<{ kind: Kind; doc: Doc }> = [];
  for (const kind of KINDS) {
    const list = body[kind];
    if (list === undefined) continue;
    if (!Array.isArray(list)) return json({ error: `${kind} must be an array` }, 400);
    for (const doc of list) {
      if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !validId((doc as { id?: unknown }).id)) {
        return json({ error: `Bad ${kind} record` }, 400);
      }
      upserts.push({ kind, doc: doc as Doc });
    }
  }
  if (body.deletions !== undefined && !Array.isArray(body.deletions)) return json({ error: 'deletions must be an array' }, 400);
  const deletions: Array<{ kind: Kind; id: string }> = [];
  for (const deletion of body.deletions ?? []) {
    if (!deletion || typeof deletion !== 'object' || Array.isArray(deletion)) return json({ error: 'Bad deletion' }, 400);
    const { kind, id } = deletion as { kind?: unknown; id?: unknown };
    if (!validKind(kind) || !validId(id)) return json({ error: 'Bad deletion' }, 400);
    deletions.push({ kind, id });
  }
  if (upserts.length + deletions.length > MAX_ITEMS) return json({ error: `At most ${MAX_ITEMS} items per request` }, 413);

  await mapLimit(upserts, 6, ({ kind, doc }) => putRecord(kind, doc));
  await mapLimit(deletions, 6, ({ kind, id }) => deleteRecord(kind, id));
  return json({ ok: true, saved: upserts.length, deleted: deletions.length });
}
