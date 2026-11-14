import { json, requireOwner } from './_lib/auth.js';
import { getPhoto, putPhoto } from './_lib/store.js';

const MAX_BYTES = 3 * 1024 * 1024;

function idFrom(req: Request): string | null {
  const id = new URL(req.url).searchParams.get('id');
  return id && id.length <= 200 ? id : null;
}

export async function GET(req: Request): Promise<Response> {
  const who = await requireOwner(req);
  if (who instanceof Response) return who;
  const id = idFrom(req);
  if (!id) return json({ error: 'Missing id' }, 400);
  return (await getPhoto(id)) ?? json({ error: 'No photo' }, 404);
}

export async function PUT(req: Request): Promise<Response> {
  const who = await requireOwner(req, true);
  if (who instanceof Response) return who;
  const id = idFrom(req);
  if (!id) return json({ error: 'Missing id' }, 400);
  const body = await req.arrayBuffer();
  if (!body.byteLength || body.byteLength > MAX_BYTES) return json({ error: 'Photo must be under 3 MB' }, 413);
  await putPhoto(id, body);
  return json({ ok: true });
}
