import { db, type Watch } from '../db';
import { findMovement, loadArchive } from './movements';

export interface TestedInfo {
  /** Watches with this movement that have results, with their counts. */
  watches: Array<{ watch: Watch; readings: number; quartzTests: number }>;
  readings: number;
  quartzTests: number;
}

/**
 * Reference movements you've tested with Escapement: any movement matched by
 * a watch's caliber that has timegrapher readings or quartz tests. Worked out
 * from your data, so setting a caliber later tags its earlier readings too.
 */
export async function testedMovements(): Promise<Map<string, TestedInfo>> {
  await loadArchive();
  const [watches, ms, qt] = await Promise.all([db.watches.toArray(), db.measurements.toArray(), db.qtests.toArray()]);
  const count = (xs: Array<{ watchId: string }>) => {
    const n = new Map<string, number>();
    for (const x of xs) n.set(x.watchId, (n.get(x.watchId) ?? 0) + 1);
    return n;
  };
  const readings = count(ms);
  const quartz = count(qt);
  const out = new Map<string, TestedInfo>();
  for (const w of watches) {
    const r = readings.get(w.id) ?? 0;
    const q = quartz.get(w.id) ?? 0;
    if (!r && !q) continue;
    const ref = findMovement(w.caliber, w.brand);
    if (!ref) continue;
    const t = out.get(ref.id) ?? { watches: [], readings: 0, quartzTests: 0 };
    t.watches.push({ watch: w, readings: r, quartzTests: q });
    t.readings += r;
    t.quartzTests += q;
    out.set(ref.id, t);
  }
  return out;
}

export const testedSummary = (t: TestedInfo) =>
  [t.readings && `${t.readings} reading${t.readings === 1 ? '' : 's'}`, t.quartzTests && `${t.quartzTests} quartz test${t.quartzTests === 1 ? '' : 's'}`].filter(Boolean).join(', ');
