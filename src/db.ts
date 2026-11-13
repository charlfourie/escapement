import Dexie, { type EntityTable } from 'dexie';
import type { TracePoint } from './analysis/analyze';

export type Position = 'DU' | 'DD' | 'CU' | 'CD' | 'CL' | 'CR';
export const POSITIONS: Record<Position, string> = {
  DU: 'Dial up',
  DD: 'Dial down',
  CU: 'Crown up',
  CD: 'Crown down',
  CL: 'Crown left',
  CR: 'Crown right',
};

export type WindState = 'full' | '24h' | 'unknown';
export const WIND_STATES: Record<WindState, string> = {
  full: 'Fully wound',
  '24h': 'After 24 h',
  unknown: 'Not noted',
};

export interface Watch {
  id: string;
  name: string;
  brand: string;
  reference: string;
  caliber: string;
  /** Known beat rate; null = auto-detect. */
  bph: number | null;
  liftAngle: number;
  purchaseDate: string;
  lastService: string;
  notes: string;
  photo: Blob | null;
  createdAt: number;
  updatedAt: number;
}

export interface Measurement {
  id: string;
  watchId: string;
  takenAt: number;
  position: Position;
  wind: WindState;
  durationSec: number;
  bph: number;
  rate: number;
  beatError: number | null;
  /** Reserved for the amplitude phase. */
  amplitude: number | null;
  jitter: number;
  ticks: number;
  quality: number;
  notes: string;
  trace: TracePoint[];
  /** Shared by the readings of one six-position test. */
  testId?: string;
}

/**
 * One entry per movement calibre, shared by every watch that uses it.
 * Specs come from the user or from AI identification; Ranfft DB is linked
 * for reference, never copied.
 */
export interface Movement {
  /** Normalised calibre name, see movementId(). */
  id: string;
  caliber: string;
  maker: string;
  bph: number | null;
  liftAngle: number | null;
  jewels: number | null;
  /** Free text, e.g. "25.6 mm" or "11½'''". */
  size: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export const movementId = (caliber: string) => caliber.trim().toLowerCase().replace(/^cal(iber|ibre)?\.?\s*/, '').replace(/\s+/g, ' ');

export type MovementSpecs = Partial<Pick<Movement, 'maker' | 'bph' | 'liftAngle' | 'jewels' | 'size'>>;

/**
 * Make sure a movement entry exists for this calibre. Existing values are
 * kept; only empty ones are filled from `specs`.
 */
export async function upsertMovement(caliber: string, specs: MovementSpecs = {}): Promise<Movement | null> {
  const id = movementId(caliber);
  if (!id) return null;
  const now = Date.now();
  const existing = await db.movements.get(id);
  const m: Movement = existing ?? { id, caliber: caliber.trim(), maker: '', bph: null, liftAngle: null, jewels: null, size: '', notes: '', createdAt: now, updatedAt: now };
  let changed = !existing;
  for (const k of ['maker', 'bph', 'liftAngle', 'jewels', 'size'] as const) {
    const v = specs[k];
    if (v !== undefined && v !== null && v !== '' && (m[k] === null || m[k] === '')) {
      (m as unknown as Record<string, unknown>)[k] = v;
      changed = true;
    }
  }
  if (changed) {
    m.updatedAt = now;
    await db.movements.put(m);
  }
  return m;
}

class EscapementDB extends Dexie {
  watches!: EntityTable<Watch, 'id'>;
  measurements!: EntityTable<Measurement, 'id'>;
  movements!: EntityTable<Movement, 'id'>;

  constructor() {
    super('escapement');
    this.version(1).stores({
      watches: 'id, name, updatedAt',
      measurements: 'id, watchId, takenAt, [watchId+takenAt]',
    });
    this.version(2)
      .stores({ movements: 'id, caliber, maker' })
      .upgrade(async (tx) => {
        // Seed the movement library from watches that already have a calibre.
        const watches = (await tx.table('watches').toArray()) as Watch[];
        const now = Date.now();
        for (const w of watches) {
          const id = movementId(w.caliber ?? '');
          if (!id || (await tx.table('movements').get(id))) continue;
          await tx.table('movements').put({ id, caliber: w.caliber.trim(), maker: w.brand ?? '', bph: w.bph, liftAngle: w.liftAngle ?? null, jewels: null, size: '', notes: '', createdAt: now, updatedAt: now } satisfies Movement);
        }
      });
  }
}

export const db = new EscapementDB();

export const newId = (): string =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function blankWatch(): Watch {
  const now = Date.now();
  return {
    id: newId(),
    name: '',
    brand: '',
    reference: '',
    caliber: '',
    bph: null,
    liftAngle: 52,
    purchaseDate: '',
    lastService: '',
    notes: '',
    photo: null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function watchMeasurements(watchId: string): Promise<Measurement[]> {
  return db.measurements
    .where('[watchId+takenAt]')
    .between([watchId, Dexie.minKey], [watchId, Dexie.maxKey])
    .reverse()
    .toArray();
}

export async function deleteWatch(id: string): Promise<void> {
  await db.transaction('rw', db.watches, db.measurements, async () => {
    await db.measurements.where('watchId').equals(id).delete();
    await db.watches.delete(id);
  });
}
