/**
 * Sound-card clock calibration.
 *
 * Tick times come from the sound card's sample clock, which can be off by
 * 10–50 ppm (25–130 s a month): more than a quartz watch's own error. So the
 * quartz test also asks an internet time server for the time every few
 * seconds and fits how fast the sound card's clock runs against it.
 *
 * Each sample brackets the request with sound-card time; the server's time
 * belongs to the midpoint. Samples with a slow round trip are less certain
 * and dropped. The slope of (server − sound card) against sound-card time is
 * the clock error. With a few ms of route jitter, a sample every 3 s over
 * 10 minutes pins it to about ±1.5 ppm (±4 s a month); a 30-minute
 * calibration run to about ±0.3 ppm. Results are kept per input so later
 * tests lean on earlier calibrations too.
 */

import type { ClockCorrection } from './quartz';
import { lsq, segmentOf } from './lsq';

export interface ClockSample {
  /** Sound-card time at the middle of the request, seconds. */
  audio: number;
  /** Reference time at that moment, seconds (epoch). */
  ref: number;
  /** Round trip, seconds (0 for a local clock). */
  rtt: number;
}

export interface ClockFit extends ClockCorrection {
  samples: number;
  span: number;
}

/**
 * A real sound card is within a few hundred ppm. Anything beyond means the
 * audio stalled or the network misbehaved, not that the clock is that far off.
 */
export const MAX_CLOCK_PPM = 400;

/**
 * Fit the sound card's clock error from reference samples. Null until there
 * are enough. `breaks` are sound-card times where the audio dropped out: the
 * offset jumps there, so each stretch gets its own offset and only the
 * slope is shared.
 */
export function fitClock(samples: ClockSample[], opts: { minSpan?: number; minSamples?: number; breaks?: number[] } = {}): ClockFit | null {
  const minSpan = opts.minSpan ?? 60;
  const minSamples = opts.minSamples ?? 6;
  const breaks = [...(opts.breaks ?? [])].sort((p, q) => p - q);
  if (samples.length < minSamples) return null;
  // Keep the faster round trips: their midpoint is closest to the truth.
  const rtts = samples.map((s) => s.rtt).sort((a, b) => a - b);
  const best = rtts[0];
  const cut = Math.max(best * 1.5, best + 0.03, rtts[Math.floor(rtts.length * 0.6)]);
  let use = samples.filter((s) => s.rtt <= cut);

  for (let round = 0; round < 4; round++) {
    // Stretches with fewer than 3 samples can't contribute to the slope.
    const counts = new Map<number, number>();
    for (const s of use) counts.set(segmentOf(s.audio, breaks), (counts.get(segmentOf(s.audio, breaks)) ?? 0) + 1);
    use = use.filter((s) => (counts.get(segmentOf(s.audio, breaks)) ?? 0) >= 3);
    if (use.length < minSamples) return null;
    const ids = [...new Set(use.map((s) => segmentOf(s.audio, breaks)))];
    const col = new Map(ids.map((id, i) => [id, i]));
    const k = ids.length;
    const a0 = use[0].audio;
    const y0 = use[0].ref - use[0].audio;
    const X = use.map((s) => {
      const row = new Array<number>(k + 1).fill(0);
      row[col.get(segmentOf(s.audio, breaks))!] = 1;
      row[k] = s.audio - a0;
      return row;
    });
    const y = use.map((s) => s.ref - s.audio - y0);
    // Time actually covered: sum of each stretch's span.
    let span = 0;
    for (const id of ids) {
      const xs = use.filter((s) => segmentOf(s.audio, breaks) === id).map((s) => s.audio);
      span += xs[xs.length - 1] - xs[0];
    }
    if (span < minSpan) return null;
    const r = lsq(X, y);
    if (!r) return null;
    const sd = [...r.resid].map(Math.abs).sort((p, q) => p - q)[Math.floor(r.resid.length / 2)] * 1.4826;
    const lim = Math.max(0.004, 4 * sd);
    const keep = r.resid.map((e) => Math.abs(e) <= lim);
    if (round < 3 && !keep.every(Boolean) && keep.filter(Boolean).length >= minSamples) {
      use = use.filter((_, i) => keep[i]);
      continue;
    }
    // Floor the scatter at 1 ms: the reference itself is only that good.
    const s2 = Math.max(r.s2, 1e-6);
    const sigma = Math.sqrt((r.variance(k) * s2) / r.s2 || 0);
    return { ppm: r.coef[k] * 1e6, sigma: sigma * 1e6, samples: use.length, span };
  }
  return null;
}

/** A fit that a real sound card could produce, tight enough to use. */
export function plausibleClock(f: ClockFit | null): boolean {
  return !!f && Math.abs(f.ppm) <= MAX_CLOCK_PPM && f.sigma < 30;
}

/** Inverse-variance mean of several calibrations of the same sound card. */
export function combineClock(fits: ClockCorrection[]): ClockCorrection | null {
  const ok = fits.filter((f) => Number.isFinite(f.ppm) && f.sigma > 0);
  if (!ok.length) return null;
  let w = 0;
  let s = 0;
  for (const f of ok) {
    const wi = 1 / (f.sigma * f.sigma);
    w += wi;
    s += wi * f.ppm;
  }
  const ppm = s / w;
  let sigma = Math.sqrt(1 / w);
  // If the calibrations disagree more than their error bars say, widen it.
  if (ok.length > 1) {
    const chi = ok.reduce((p, f) => p + ((f.ppm - ppm) / f.sigma) ** 2, 0) / (ok.length - 1);
    if (chi > 1) sigma *= Math.sqrt(chi);
  }
  return { ppm, sigma };
}

// ---- Saved calibrations, per input device -------------------------------

const KEY = 'escapement:clock';
const KEEP = 8;

export interface SavedClock extends ClockCorrection {
  at: number;
  span: number;
}

function load(): Record<string, SavedClock[]> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

/** Calibrations saved for this input (most recent first). */
export function savedClock(inputKey: string): SavedClock[] {
  return load()[inputKey] ?? [];
}

/** Remember a calibration for this input. Only reasonably tight ones are kept. */
export function saveClock(inputKey: string, fit: ClockFit): void {
  if (!plausibleClock(fit) || !(fit.sigma < 5) || !(fit.span >= 120)) return;
  try {
    const all = load();
    all[inputKey] = [{ ppm: fit.ppm, sigma: fit.sigma, at: Date.now(), span: fit.span }, ...(all[inputKey] ?? [])].slice(0, KEEP);
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable */
  }
}

export function forgetClock(inputKey: string): void {
  try {
    const all = load();
    delete all[inputKey];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Best correction for a test: this run's own fit, combined with what's saved
 * for the same input.
 */
export function bestClock(own: ClockFit | null, saved: SavedClock[]): { correction: ClockCorrection | null; source: 'test' | 'saved' | 'both' | 'none' } {
  if (own && !plausibleClock(own)) own = null;
  const parts: ClockCorrection[] = [...(own ? [own] : []), ...saved.filter((x) => Math.abs(x.ppm) <= MAX_CLOCK_PPM)];
  const correction = combineClock(parts);
  return { correction, source: !correction ? 'none' : own && saved.length ? 'both' : own ? 'test' : 'saved' };
}
