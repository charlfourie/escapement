import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Real API handlers on top of an in-memory Blob store.
const blobs = new Map<string, { body: Uint8Array; uploadedAt: Date }>();
let clock = Date.now() - 60_000;
vi.mock('@vercel/blob', () => ({
  put: async (p: string, body: string | ArrayBuffer | Blob) => {
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body instanceof Blob ? new Uint8Array(await body.arrayBuffer()) : new Uint8Array(body);
    blobs.set(p, { body: bytes, uploadedAt: new Date((clock = Math.max(Date.now(), clock + 1))) });
    return { pathname: p };
  },
  get: async (p: string) => {
    const b = blobs.get(p);
    return b ? { statusCode: 200, stream: new Response(b.body as BodyInit).body, headers: new Headers(), blob: {} } : null;
  },
  del: async (p: string) => {
    if (!blobs.delete(p)) throw new Error('nf');
  },
  list: async ({ prefix }: { prefix: string }) => ({ blobs: [...blobs.entries()].filter(([p]) => p.startsWith(prefix)).map(([pathname, b]) => ({ pathname, uploadedAt: b.uploadedAt })), hasMore: false }),
}));

process.env.GITHUB_CLIENT_ID = 'id';
process.env.GITHUB_CLIENT_SECRET = 'secret';
process.env.SESSION_SECRET = 'y'.repeat(48);
process.env.OWNER_GITHUB = 'charlfourie';
process.env.BLOB_READ_WRITE_TOKEN = 't';

let cookie = '';
beforeAll(async () => {
  const { makeSession } = await import('../api/_lib/auth');
  cookie = `esc_session=${encodeURIComponent(await makeSession('charlfourie'))}`;
  const sync = await import('../api/sync');
  const photo = await import('../api/photo');
  const routes: Record<string, Record<string, (r: Request) => Promise<Response> | Response>> = { '/api/sync': sync, '/api/photo': photo };
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const url = new URL(input, 'https://escapement.test');
    const headers = new Headers(init.headers);
    headers.set('cookie', cookie);
    const handler = routes[url.pathname]?.[(init.method ?? 'GET').toUpperCase()];
    if (!handler) return new Response('not found', { status: 404 });
    return handler(new Request(url, { ...init, headers }));
  });
});

const settle = () => new Promise((r) => setTimeout(r, 50));

describe('sync engine against the real API', () => {
  it('merges, pushes edits and deletions, and pulls remote changes', async () => {
    const { db, blankWatch, newId } = await import('../src/db');
    const sync = await import('../src/sync/sync');

    // Local data from before signing in
    const w = { ...blankWatch(), name: 'Bell-Matic', caliber: '4006A', photo: new Blob([new Uint8Array([0xff, 0xd8, 1])], { type: 'image/jpeg' }) };
    await db.watches.add(w);
    await db.measurements.add({ id: newId(), watchId: w.id, takenAt: Date.now(), position: 'DU', wind: 'full', durationSec: 30, bph: 19800, rate: 3.1, beatError: 0.4, amplitude: 270, jitter: 0.02, ticks: 100, quality: 1, notes: '', trace: [] });

    await db.checks.add({ id: newId(), watchId: w.id, at: Date.now(), offset: 1.5, reset: true, source: 'internet', notes: '', updatedAt: Date.now() });
    sync.markSignedIn('charlfourie');
    await sync.syncNow();
    expect(sync.getSyncState()).toMatchObject({ status: 'idle', pending: 0 });
    expect([...blobs.keys()].filter((k) => k.startsWith('records/checks/'))).toHaveLength(1);
    expect([...blobs.keys()].sort()).toEqual(expect.arrayContaining([`records/watches/${w.id}.json`, `photos/${w.id}.jpg`]));
    expect([...blobs.keys()].filter((k) => k.startsWith('records/measurements/'))).toHaveLength(1);

    // Local edit → pushed
    await db.watches.update(w.id, { name: 'Bell-Matic 4006-7000', updatedAt: Date.now() + 1 });
    await settle();
    expect(sync.getSyncState().pending).toBe(1);
    await sync.syncNow();
    const online = JSON.parse(new TextDecoder().decode(blobs.get(`records/watches/${w.id}.json`)!.body));
    expect(online.name).toBe('Bell-Matic 4006-7000');
    expect(online.hasPhoto).toBe(true);
    expect(online.photo).toBeUndefined();

    // Remote change from "another device" → pulled
    const { putRecord } = await import('../api/_lib/store');
    await putRecord('watches', { ...online, name: 'Renamed on phone', updatedAt: Date.now() + 10_000 });
    await putRecord('movements', { id: '7s26', caliber: '7S26', maker: 'Seiko', bph: 21600, liftAngle: 53, jewels: 21, size: '', notes: '', createdAt: 1, updatedAt: Date.now() });
    const apiFetch = globalThis.fetch;
    let failPhotoDownload = true;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input), 'https://escapement.test').pathname === '/api/photo' && failPhotoDownload) {
        failPhotoDownload = false;
        return new Response('temporary failure', { status: 503 });
      }
      return apiFetch(input, init);
    });
    await sync.syncNow();
    expect(sync.getSyncState().status).toBe('error');
    await sync.syncNow();
    vi.stubGlobal('fetch', apiFetch);
    expect((await db.watches.get(w.id))!.name).toBe('Renamed on phone');
    expect(await db.movements.get('7s26')).toMatchObject({ jewels: 21 });
    expect((await db.watches.get(w.id))!.photo).toBeInstanceOf(Blob);
    expect(sync.getSyncState().pending).toBe(0); // applying remote data doesn't echo back

    // Local deletion → tombstone online, record gone
    const { deleteWatch } = await import('../src/db');
    await deleteWatch(w.id);
    await sync.syncNow();
    expect(blobs.has(`records/watches/${w.id}.json`)).toBe(false);
    expect(blobs.has(`deleted/watches/${w.id}.json`)).toBe(true);
    expect([...blobs.keys()].filter((k) => k.startsWith('records/measurements/'))).toHaveLength(0);
    expect([...blobs.keys()].filter((k) => k.startsWith('records/checks/'))).toHaveLength(0);

    // A fresh device (empty local DB) gets everything that's left
    await db.delete();
    await db.open();
    await sync.signOut();
    sync.markSignedIn('charlfourie');
    await sync.syncNow();
    expect(await db.movements.count()).toBe(1);
    expect(await db.watches.count()).toBe(0);
  });
});
