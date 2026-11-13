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
}

class EscapementDB extends Dexie {
  watches!: EntityTable<Watch, 'id'>;
  measurements!: EntityTable<Measurement, 'id'>;

  constructor() {
    super('escapement');
    this.version(1).stores({
      watches: 'id, name, updatedAt',
      measurements: 'id, watchId, takenAt, [watchId+takenAt]',
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
