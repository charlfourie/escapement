/**
 * What the drawn watch face shows, worked out from your data: the time the
 * real watch says (its offset now), whether its seconds hand stops when the
 * crown is pulled, and how old its dial looks. No DOM here, so it's testable.
 */
import type { Measurement, QuartzTest, TimeCheck, Watch } from '../db';
import type { Patina } from '../views/watch-art';
import type { RefMovement } from './movements';

const DAY = 86_400_000;
const MONTH_DAYS = 30.44;

/** First year in a production period ("c. 1972", "1974+", "From 1960", "1963 - 1977"). */
export function productionYear(ref: RefMovement | null | undefined): number | null {
  const m = ref?.archive?.years?.match(/\b(1[6-9]\d\d|20\d\d)/);
  return m ? Number(m[1]) : null;
}

export type PatinaLevel = 'none' | 'light' | 'heavy';

/** How aged the dial looks: your choice, or from the movement's age. */
export function patinaLevel(choice: Patina, year: number | null, thisYear = new Date().getFullYear()): PatinaLevel {
  if (choice !== 'auto') return choice;
  if (!year) return 'none';
  const age = thisYear - year;
  return age >= 55 ? 'heavy' : age >= 30 ? 'light' : 'none';
}

export interface Hacking {
  hacks: boolean;
  /** False when assumed rather than known for this movement. */
  known: boolean;
  why: string;
}

/** Does pulling the crown stop the seconds hand? */
export function hackingFor(w: Pick<Watch, 'movementType'>, ref: RefMovement | null | undefined): Hacking {
  const name = ref ? (ref.archive ? ref.caliber : `${ref.maker.split(/[ (/]/)[0]} ${ref.caliber}`) : '';
  const t = w.movementType;
  if (t === 'quartz' || t === 'solar' || t === 'kinetic') return { hacks: true, known: true, why: 'Quartz movements stop the seconds hand while the crown is out.' };
  if (t === 'spring-drive') return { hacks: true, known: true, why: 'Spring Drive stops the seconds hand while the crown is out.' };
  if (ref?.hacks !== undefined) return { hacks: ref.hacks, known: true, why: ref.hacks ? `The ${name} hacks: its seconds hand stops while the crown is out.` : `The ${name} doesn’t hack: its seconds hand keeps running while you set it.` };
  const year = productionYear(ref);
  if (year && year < 1970) return { hacks: false, known: false, why: `Not recorded for the ${name}; most movements from the ${Math.floor(year / 10) * 10}s don’t hack, so the seconds keep running.` };
  return { hacks: true, known: false, why: `Not recorded for ${name ? `the ${name}` : 'this movement'}; assuming it hacks, as most modern movements do.` };
}

export interface WatchOffset {
  /** Seconds the watch is ahead (+) or behind (−) at time `at`. */
  at: (ms: number) => number;
  perDay: number;
  /** When it was last set (start of the series). */
  since: number;
  basis: 'checks' | 'quartz' | 'timegrapher';
  checks: number;
}

/**
 * The real watch's offset from true time, so the drawn face can show what it
 * says. Needs a time check since it was last set; the drift comes from the
 * checks themselves (two or more), else from its latest quartz test or recent
 * timegrapher readings.
 */
export function watchOffset(checks: TimeCheck[], quartz: QuartzTest[], readings: Measurement[]): WatchOffset | null {
  const sorted = [...checks].sort((a, b) => a.at - b.at);
  if (!sorted.length) return null;
  let start = 0;
  sorted.forEach((c, i) => {
    if (c.reset) start = i;
  });
  const series = sorted.slice(start);
  const since = series[0].at;
  if (series.length >= 2) {
    const xs = series.map((c) => c.at / DAY);
    const ys = series.map((c) => c.offset);
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < n; i++) {
      sxy += (xs[i] - mx) * (ys[i] - my);
      sxx += (xs[i] - mx) ** 2;
    }
    if (sxx > 0) {
      const perDay = sxy / sxx;
      return { at: (ms) => my + perDay * (ms / DAY - mx), perDay, since, basis: 'checks', checks: n };
    }
  }
  const last = series[series.length - 1];
  const q = [...quartz].sort((a, b) => b.at - a.at)[0];
  const recent = [...readings].sort((a, b) => b.takenAt - a.takenAt).slice(0, 6);
  const perDay = q ? q.perMonth / MONTH_DAYS : recent.length ? recent.reduce((a, m) => a + m.rate, 0) / recent.length : null;
  if (perDay === null) return null;
  return { at: (ms) => last.offset + perDay * ((ms - last.at) / DAY), perDay, since, basis: q ? 'quartz' : 'timegrapher', checks: series.length };
}
