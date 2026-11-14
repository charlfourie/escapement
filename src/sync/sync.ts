/**
 * Manual sync between this browser's local database and the online
 * collection (see /api). Local-first: the app always reads and writes
 * IndexedDB; changes are only sent or fetched when you press Sync (or
 * right after signing in). Each sync lists the online store, which counts
 * against Vercel Blob's advanced-operation quota, so it never runs on a timer.
 *
 * Change tracking: Dexie hooks note every created, updated or deleted record
 * in a small "dirty" map. A push sends the current local version of each dirty
 * record, or a deletion when it no longer exists locally. A pull fetches what
 * changed online since the last pull; newer wins (by updatedAt).
 */
import type { Transaction } from 'dexie';
import { db, type Measurement, type Movement, type TimeCheck, type Watch } from '../db';

type Kind = 'watches' | 'measurements' | 'movements' | 'checks';
const KINDS: Kind[] = ['watches', 'measurements', 'movements', 'checks'];
type AnyRecord = Watch | Measurement | Movement | TimeCheck;

export type SyncStatus = 'unavailable' | 'not-configured' | 'signed-out' | 'idle' | 'syncing' | 'error' | 'offline';

export interface SyncState {
  status: SyncStatus;
  login: string | null;
  lastSync: number | null;
  pending: number;
  error: string | null;
}

const META_KEY = 'escapement:sync';
const DIRTY_KEY = 'escapement:sync-dirty';
const BATCH = 20;

interface Meta {
  lastPull: number;
  lastSync: number | null;
  /** True once this browser has done its first full merge. */
  merged: boolean;
}

const readJson = <T>(key: string, fallback: T): T => {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(key) ?? '{}') };
  } catch {
    return fallback;
  }
};
const writeJson = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage full or unavailable */
  }
};

let meta: Meta = readJson<Meta>(META_KEY, { lastPull: 0, lastSync: null, merged: false });
/** key `${kind}:${id}` → change counter, so a push only clears what it actually sent. */
let dirty: Record<string, number> = readJson<Record<string, number>>(DIRTY_KEY, {});

let state: SyncState = { status: 'unavailable', login: null, lastSync: meta.lastSync, pending: Object.keys(dirty).length, error: null };
const listeners = new Set<(s: SyncState) => void>();

function set(patch: Partial<SyncState>) {
  state = { ...state, ...patch, pending: Object.keys(dirty).length };
  listeners.forEach((l) => l(state));
}

export function getSyncState(): SyncState {
  return state;
}

export function onSyncState(fn: (s: SyncState) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

const saveMeta = () => writeJson(META_KEY, meta);
const saveDirty = () => writeJson(DIRTY_KEY, dirty);

function markDirty(kind: Kind, id: string) {
  const k = `${kind}:${id}`;
  dirty[k] = (dirty[k] ?? 0) + 1;
  saveDirty();
  set({});
}

// ---------------------------------------------------------------- hooks
const FROM_SYNC = Symbol('fromSync');
const fromSync = (tx: Transaction | undefined) => Boolean(tx && (tx as unknown as Record<symbol, boolean>)[FROM_SYNC]);

let hooked = false;
function installHooks() {
  if (hooked) return;
  hooked = true;
  for (const kind of KINDS) {
    const table = db.table(kind);
    table.hook('creating', (_pk, obj: AnyRecord, tx) => {
      if (!fromSync(tx)) markDirty(kind, obj.id);
    });
    table.hook('updating', (_mods, pk, _obj, tx) => {
      if (!fromSync(tx)) markDirty(kind, String(pk));
    });
    table.hook('deleting', (pk, _obj, tx) => {
      if (!fromSync(tx)) markDirty(kind, String(pk));
    });
  }
}

// ---------------------------------------------------------------- api
class AuthError extends Error {}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(path, { ...init, credentials: 'same-origin', headers: { 'x-escapement': '1', ...(init.headers ?? {}) } });
  if (res.status === 401) throw new AuthError('Signed out');
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return res;
}

const updatedAt = (r: Partial<AnyRecord> & { updatedAt?: number; takenAt?: number }) => r.updatedAt ?? r.takenAt ?? 0;

function toDoc(kind: Kind, rec: AnyRecord): Record<string, unknown> {
  if (kind !== 'watches') return rec as unknown as Record<string, unknown>;
  const { photo, ...rest } = rec as Watch;
  return { ...rest, hasPhoto: Boolean(photo) };
}

// ---------------------------------------------------------------- pull
/** Returns how many local records changed. */
async function pull(): Promise<number> {
  let changed = 0;
  const res = await api(`/api/sync?since=${meta.lastPull}`);
  const data = (await res.json()) as Record<Kind, Array<Record<string, unknown> & { id: string }>> & {
    cursor: number;
    deletions: Array<{ kind: Kind; id: string }>;
  };

  // Photos first (network), then one local transaction for everything.
  const photos = new Map<string, Blob | null>();
  for (const doc of data.watches ?? []) {
    const local = await db.watches.get(doc.id);
    if (!local && dirty[`watches:${doc.id}`]) continue;
    const isNewer = !local || updatedAt(doc) > updatedAt(local);
    if (!isNewer) continue;
    if (doc.hasPhoto) {
      const r = await fetch(`/api/photo?id=${encodeURIComponent(doc.id)}`, { credentials: 'same-origin' });
      photos.set(doc.id, r.ok ? await r.blob() : (local?.photo ?? null));
    } else {
      photos.set(doc.id, null);
    }
  }

  await db.transaction('rw', db.watches, db.measurements, db.movements, db.checks, async (tx) => {
    (tx as unknown as Record<symbol, boolean>)[FROM_SYNC] = true;
    for (const kind of KINDS) {
      const table = db.table(kind);
      for (const doc of data[kind] ?? []) {
        const key = `${kind}:${doc.id}`;
        const local = (await table.get(doc.id)) as AnyRecord | undefined;
        // Deleted here but not pushed yet: the deletion wins.
        if (!local && dirty[key]) continue;
        // A local edit that's at least as new wins; it'll be pushed next.
        if (local && dirty[key] && updatedAt(local) >= updatedAt(doc)) continue;
        if (local && updatedAt(local) > updatedAt(doc)) continue;
        if (local && !dirty[key] && updatedAt(local) === updatedAt(doc)) continue;
        let rec: Record<string, unknown> = { ...doc };
        if (kind === 'watches') {
          delete rec.hasPhoto;
          rec = { ...rec, photo: photos.has(doc.id) ? photos.get(doc.id) : ((local as Watch | undefined)?.photo ?? null) };
        }
        await table.put(rec);
        delete dirty[key];
        changed++;
      }
    }
    for (const d of data.deletions ?? []) {
      const key = `${d.kind}:${d.id}`;
      if (dirty[key]) continue; // edited here since: keep it, the push re-creates it online
      if (await db.table(d.kind).get(d.id)) {
        await db.table(d.kind).delete(d.id);
        changed++;
      }
    }
  });
  saveDirty();
  meta.lastPull = data.cursor;
  saveMeta();
  return changed;
}

// ---------------------------------------------------------------- push
async function push() {
  const entries = Object.entries(dirty);
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const body: Record<Kind, unknown[]> & { deletions: Array<{ kind: Kind; id: string }> } = { watches: [], measurements: [], movements: [], checks: [], deletions: [] };
    const photoUploads: Array<{ id: string; photo: Blob }> = [];
    for (const [key] of batch) {
      const sep = key.indexOf(':');
      const kind = key.slice(0, sep) as Kind;
      const id = key.slice(sep + 1);
      if (!KINDS.includes(kind)) continue;
      const rec = (await db.table(kind).get(id)) as AnyRecord | undefined;
      if (!rec) body.deletions.push({ kind, id });
      else {
        body[kind].push(toDoc(kind, rec));
        if (kind === 'watches' && (rec as Watch).photo) photoUploads.push({ id, photo: (rec as Watch).photo! });
      }
    }
    await api('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    for (const p of photoUploads) await api(`/api/photo?id=${encodeURIComponent(p.id)}`, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: p.photo });
    for (const [key, count] of batch) if (dirty[key] === count) delete dirty[key];
    saveDirty();
    set({});
  }
}

async function markEverythingDirty() {
  for (const kind of KINDS) {
    const keys = (await db.table(kind).toCollection().primaryKeys()) as string[];
    for (const id of keys) {
      const k = `${kind}:${id}`;
      dirty[k] = (dirty[k] ?? 0) + 1;
    }
  }
  saveDirty();
}

// ---------------------------------------------------------------- driver
let running: Promise<void> | null = null;
let again = false;

export async function syncNow(): Promise<void> {
  if (!state.login) return;
  if (running) {
    again = true;
    return running;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    set({ status: 'offline' });
    return;
  }
  running = (async () => {
    set({ status: 'syncing', error: null });
    try {
      if (!meta.merged) await markEverythingDirty();
      const changed = await pull();
      await push();
      // Let open pages refresh with what arrived from other devices.
      if (changed && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('escapement:synced', { detail: { changed } }));
      meta.merged = true;
      meta.lastSync = Date.now();
      saveMeta();
      set({ status: 'idle', lastSync: meta.lastSync });
    } catch (err) {
      if (err instanceof AuthError) set({ status: 'signed-out', login: null, error: null });
      else set({ status: 'error', error: (err as Error)?.message ?? String(err) });
    } finally {
      running = null;
    }
    if (again) {
      again = false;
      void syncNow();
    }
  })();
  return running;
}

let started = false;
export async function initSync(): Promise<void> {
  installHooks();
  if (started) return;
  started = true;
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return set({ status: 'unavailable' });
    const me = (await res.json()) as { configured: boolean; login: string | null };
    if (!me.configured) return set({ status: 'not-configured' });
    if (!me.login) return set({ status: 'signed-out', login: null });
    markSignedIn(me.login);
  } catch {
    return set({ status: 'unavailable' });
  }
  // Sync on its own only once, straight after a fresh sign-in; otherwise wait for the Sync button.
  if (location.hash.includes('sync=signed-in')) void syncNow();
}

/** Record a confirmed sign-in (from /api/me). Exported for tests. */
export function markSignedIn(login: string) {
  installHooks();
  set({ status: 'idle', login });
}

export function signIn() {
  location.href = '/api/auth/login';
}

export async function signOut(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  // Next sign-in does a full merge again; local data stays on this device.
  meta = { lastPull: 0, lastSync: null, merged: false };
  saveMeta();
  set({ status: 'signed-out', login: null, lastSync: null, error: null });
}
