import Dexie, { type EntityTable } from 'dexie';
import type { TracePoint } from './analysis/analyze';
import type { FaceDesign } from './views/watch-art';
import { findReference } from './data/movements';

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

export type MovementType = 'automatic' | 'manual' | 'quartz' | 'solar' | 'kinetic' | 'spring-drive' | 'other';
export const MOVEMENT_TYPES: Record<MovementType, string> = {
  automatic: 'Automatic',
  manual: 'Hand-wound',
  quartz: 'Quartz',
  solar: 'Solar quartz (Eco-Drive, etc.)',
  kinetic: 'Kinetic / automatic quartz',
  'spring-drive': 'Spring Drive',
  other: 'Other',
};

/**
 * Can a timegrapher read it? Quartz-regulated movements (Spring Drive too)
 * have no balance to listen to, so they're tracked with time checks instead.
 */
export const isTimegraphable = (w: Pick<Watch, 'movementType'>) => !w.movementType || w.movementType === 'automatic' || w.movementType === 'manual' || w.movementType === 'other';

export interface BatteryChange {
  /** yyyy-mm-dd */
  date: string;
  /** Cell type, e.g. "SR626SW" or "rechargeable cell". */
  type: string;
  notes: string;
}

/** Focus point of a photo (0–1 across and down) and zoom (1 = fill the frame). */
export interface PhotoCrop {
  x: number;
  y: number;
  zoom: number;
}

export interface Watch {
  id: string;
  name: string;
  /** Older records have none: treated as mechanical. */
  movementType?: MovementType;
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
  /** How the photo is framed in thumbnails; centre and no zoom when absent. */
  photoCrop?: PhotoCrop;
  /** Battery changes, newest first (quartz watches). */
  batteries?: BatteryChange[];
  /** Choices for the drawn face; anything missing follows the watch automatically. */
  face?: Partial<FaceDesign>;
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
  // Known caliber: the reference library fills what's still empty.
  const ref = findReference(caliber);
  if (ref) {
    specs = {
      maker: ref.maker,
      bph: ref.bph,
      ...(ref.liftAngle ? { liftAngle: ref.liftAngle } : {}),
      ...(ref.jewels ? { jewels: ref.jewels } : {}),
      ...(ref.diameterMm ? { size: `${ref.diameterMm} mm` } : {}),
      ...Object.fromEntries(Object.entries(specs).filter(([, v]) => v !== undefined && v !== null && v !== '')),
    };
  }
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

/**
 * A time check: the watch's offset from reference time at a moment. A run of
 * checks since the watch was last set gives its real-world drift.
 */
export interface TimeCheck {
  id: string;
  watchId: string;
  /** Reference time of the check (ms). */
  at: number;
  /** Seconds the watch is ahead (+) or behind (−) reference time. */
  offset: number;
  /** The watch was set to the right time just now; starts a new series. */
  reset: boolean;
  /** 'internet' when the reference came from the server clock, else 'device'. */
  source: 'internet' | 'device';
  notes: string;
  updatedAt: number;
}

/**
 * An acoustic quartz test: the stepping motor timed over several minutes,
 * corrected for the sound card's clock.
 */
export interface QuartzTest {
  id: string;
  watchId: string;
  /** When the test ended (ms). */
  at: number;
  durationSec: number;
  /** Clicks used. */
  ticks: number;
  /** 1 normally; 2 means the battery or charge is low. */
  stepSec: 1 | 2;
  /** Rate after clock correction: ppm and seconds per month (+ = fast). */
  ppm: number;
  perMonth: number;
  /** 1-sigma uncertainty, seconds per month. */
  sigmaMonth: number;
  /** Rate against the sound card's clock alone. */
  rawPpm: number;
  /** Click timing scatter, ms. */
  jitter: number;
  /** Sound card clock correction used: where it came from and its value (ppm). */
  clock: { source: 'test' | 'saved' | 'both' | 'none'; ppm: number | null; sigma: number | null };
  /** Audio dropouts during the run (older tests: absent). */
  dropouts?: number;
  notes: string;
  updatedAt: number;
}

class EscapementDB extends Dexie {
  watches!: EntityTable<Watch, 'id'>;
  measurements!: EntityTable<Measurement, 'id'>;
  movements!: EntityTable<Movement, 'id'>;
  checks!: EntityTable<TimeCheck, 'id'>;
  qtests!: EntityTable<QuartzTest, 'id'>;

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
    this.version(3).stores({ checks: 'id, watchId, at, [watchId+at]' });
    this.version(4).stores({ qtests: 'id, watchId, at, [watchId+at]' });
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

export async function watchChecks(watchId: string): Promise<TimeCheck[]> {
  return db.checks.where('[watchId+at]').between([watchId, Dexie.minKey], [watchId, Dexie.maxKey]).toArray();
}

export async function watchQuartzTests(watchId: string): Promise<QuartzTest[]> {
  return db.qtests.where('[watchId+at]').between([watchId, Dexie.minKey], [watchId, Dexie.maxKey]).reverse().toArray();
}

export async function deleteWatch(id: string): Promise<void> {
  await db.transaction('rw', db.watches, db.measurements, db.checks, db.qtests, async () => {
    await db.measurements.where('watchId').equals(id).delete();
    await db.checks.where('watchId').equals(id).delete();
    await db.qtests.where('watchId').equals(id).delete();
    await db.watches.delete(id);
  });
}
