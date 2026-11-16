import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for the private Blob store.
const blobs = new Map<string, { body: Uint8Array; uploadedAt: Date }>();
let clock = 1_000_000;
vi.mock('@vercel/blob', () => ({
  put: async (pathname: string, body: string | ArrayBuffer) => {
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(body);
    blobs.set(pathname, { body: bytes, uploadedAt: new Date((clock += 10)) });
    return { pathname };
  },
  get: async (pathname: string) => {
    const b = blobs.get(pathname);
    return b ? { statusCode: 200, stream: new Response(b.body as BodyInit).body, headers: new Headers(), blob: {} } : null;
  },
  del: async (pathname: string) => {
    if (!blobs.delete(pathname)) throw new Error('not found');
  },
  list: async ({ prefix }: { prefix: string }) => ({
    blobs: [...blobs.entries()].filter(([p]) => p.startsWith(prefix)).map(([pathname, b]) => ({ pathname, uploadedAt: b.uploadedAt })),
    hasMore: false,
  }),
}));

const ORIGIN = 'https://escapement.test';

function setEnv() {
  process.env.GITHUB_CLIENT_ID = 'client-id';
  process.env.GITHUB_CLIENT_SECRET = 'client-secret';
  process.env.SESSION_SECRET = 'x'.repeat(48);
  process.env.OWNER_GITHUB = 'CharlFourie';
  process.env.BLOB_READ_WRITE_TOKEN = 'token';
}

const req = (path: string, init: RequestInit & { cookie?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('cookie', init.cookie);
  return new Request(ORIGIN + path, { ...init, headers });
};

async function signIn(login = 'charlfourie'): Promise<string> {
  const { GET: login_ } = await import('../api/auth/login');
  const { GET: callback } = await import('../api/auth/callback');
  const start = login_(req('/api/auth/login'));
  const loc = new URL(start.headers.get('location')!);
  const state = loc.searchParams.get('state')!;
  const stateCookie = start.headers.get('set-cookie')!.split(';')[0];
  vi.stubGlobal('fetch', async (url: string) =>
    String(url).includes('access_token') ? new Response(JSON.stringify({ access_token: 'gho_x' })) : new Response(JSON.stringify({ login })),
  );
  const done = await callback(req(`/api/auth/callback?code=abc&state=${state}`, { cookie: stateCookie }));
  vi.unstubAllGlobals();
  const session = done.headers.getSetCookie().find((c) => c.startsWith('esc_session='));
  expect(done.headers.get('location')).toBe(login.toLowerCase() === 'charlfourie' ? '/#/data?sync=signed-in' : '/#/data?sync=denied');
  return session ? session.split(';')[0] : '';
}

beforeEach(() => {
  blobs.clear();
  setEnv();
});

describe('online sync API', () => {
  it('reports when it is not configured', async () => {
    delete process.env.GITHUB_CLIENT_SECRET;
    const { GET } = await import('../api/me');
    const body = await (await GET(req('/api/me'))).json();
    expect(body).toMatchObject({ configured: false, login: null });
    expect(body.missing).toContain('GITHUB_CLIENT_SECRET');
  });

  it('sends you to GitHub with a state cookie and no scopes', async () => {
    const { GET } = await import('../api/auth/login');
    const res = GET(req('/api/auth/login'));
    const loc = new URL(res.headers.get('location')!);
    expect(loc.origin + loc.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(loc.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/callback`);
    expect(loc.searchParams.get('scope')).toBeNull();
    expect(res.headers.get('set-cookie')).toMatch(/^esc_state=.+HttpOnly; Secure; SameSite=Lax/);
  });

  it('lets only the owner in', async () => {
    const owner = await signIn('charlfourie');
    expect(owner).toMatch(/^esc_session=/);
    expect(await signIn('someone-else')).toBe('');
    const { GET } = await import('../api/me');
    expect(await (await GET(req('/api/me', { cookie: owner }))).json()).toMatchObject({ configured: true, login: 'charlfourie' });
  });

  it('rejects a tampered or missing session, and writes without the CSRF header', async () => {
    const owner = await signIn();
    const { GET, POST } = await import('../api/sync');
    expect((await GET(req('/api/sync'))).status).toBe(401);
    expect((await GET(req('/api/sync', { cookie: owner.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')) }))).status).toBe(401);
    const post = await POST(req('/api/sync', { method: 'POST', cookie: owner, body: '{}' }));
    expect(post.status).toBe(403);
  });

  it('round-trips records, deletions and photos', async () => {
    const owner = await signIn();
    const { GET, POST } = await import('../api/sync');
    const write = (body: unknown) =>
      POST(req('/api/sync', { method: 'POST', cookie: owner, headers: { 'x-escapement': '1', 'content-type': 'application/json' }, body: JSON.stringify(body) }));

    const watch = { id: 'w1', name: 'Bell-Matic', updatedAt: 5, hasPhoto: true };
    const reading = { id: 'm1', watchId: 'w1', rate: 4.2, takenAt: 6 };
    const movement = { id: 'cal. 4006a/x', caliber: '4006A/x', updatedAt: 7 };
    expect(await (await write({ watches: [watch], measurements: [reading], movements: [movement] })).json()).toMatchObject({ saved: 3 });

    const all = await (await GET(req('/api/sync?since=0', { cookie: owner }))).json();
    expect(all.watches).toEqual([watch]);
    expect(all.measurements).toEqual([reading]);
    expect(all.movements).toEqual([movement]);
    expect(all.deletions).toEqual([]);

    // Nothing new since the last pull
    const later = await (await GET(req(`/api/sync?since=${clock}`, { cookie: owner }))).json();
    expect(later.watches).toEqual([]);

    const { GET: getPhoto, PUT: putPhoto } = await import('../api/photo');
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
    const up = await putPhoto(req('/api/photo?id=w1', { method: 'PUT', cookie: owner, headers: { 'x-escapement': '1' }, body: jpeg }));
    expect(up.status).toBe(200);
    expect(new Uint8Array(await (await getPhoto(req('/api/photo?id=w1', { cookie: owner }))).arrayBuffer())).toEqual(jpeg);

    // Delete the watch: record and photo go, a tombstone appears
    await write({ deletions: [{ kind: 'watches', id: 'w1' }] });
    const after = await (await GET(req('/api/sync?since=0', { cookie: owner }))).json();
    expect(after.watches).toEqual([]);
    expect(after.deletions).toEqual([{ kind: 'watches', id: 'w1' }]);
    expect((await getPhoto(req('/api/photo?id=w1', { cookie: owner }))).status).toBe(404);

    // Re-creating clears the tombstone
    await write({ watches: [watch] });
    const again = await (await GET(req('/api/sync?since=0', { cookie: owner }))).json();
    expect(again.watches).toHaveLength(1);
    expect(again.deletions).toEqual([]);
  });

  it('validates pushes', async () => {
    const owner = await signIn();
    const { POST } = await import('../api/sync');
    const post = (body: string) => POST(req('/api/sync', { method: 'POST', cookie: owner, headers: { 'x-escapement': '1' }, body }));
    expect((await post('null')).status).toBe(400);
    expect((await post('[]')).status).toBe(400);
    expect((await post(JSON.stringify({ watches: [{ name: 'no id' }] }))).status).toBe(400);
    expect((await post(JSON.stringify({ deletions: [{ kind: 'watches' }] }))).status).toBe(400);
  });
});
