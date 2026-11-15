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

/** Fit the sound card's clock error from reference samples. Null until there are enough. */
export function fitClock(samples: ClockSample[], opts: { minSpan?: number; minSamples?: number } = {}): ClockFit | null {
  const minSpan = opts.minSpan ?? 60;
  const minSamples = opts.minSamples ?? 6;
  if (samples.length < minSamples) return null;
  // Keep the faster round trips: their midpoint is closest to the truth.
  const rtts = samples.map((s) => s.rtt).sort((a, b) => a - b);
  const best = rtts[0];
  const cut = Math.max(best * 1.5, best + 0.03, rtts[Math.floor(rtts.length * 0.6)]);
  let use = samples.filter((s) => s.rtt <= cut);
  if (use.length < minSamples) return null;

  for (let round = 0; round < 3; round++) {
    const n = use.length;
    const a0 = use[0].audio;
    const xs = use.map((s) => s.audio - a0);
    const ys = use.map((s) => s.ref - s.audio);
    const y0 = ys[0];
    const yy = ys.map((y) => y - y0);
    const mx = xs.reduce((p, x) => p + x, 0) / n;
    const my = yy.reduce((p, y) => p + y, 0) / n;
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < n; i++) {
      sxx += (xs[i] - mx) ** 2;
      sxy += (xs[i] - mx) * (yy[i] - my);
    }
    const span = xs[n - 1] - xs[0];
    if (span < minSpan || !(sxx > 0)) return null;
    const slope = sxy / sxx;
    const resid = xs.map((x, i) => yy[i] - (my + slope * (x - mx)));
    const s2 = resid.reduce((p, e) => p + e * e, 0) / Math.max(1, n - 2);
    // Floor the scatter at 1 ms: the reference itself is only that good.
    const sigmaY = Math.max(Math.sqrt(s2), 0.001);
    const sd = [...resid].map(Math.abs).sort((a, b) => a - b)[Math.floor(n / 2)] * 1.4826;
    const lim = Math.max(0.004, 4 * sd);
    const keep = resid.map((e) => Math.abs(e) <= lim);
    if (round < 2 && !keep.every(Boolean) && keep.filter(Boolean).length >= minSamples) {
      use = use.filter((_, i) => keep[i]);
      continue;
    }
    return { ppm: slope * 1e6, sigma: (sigmaY / Math.sqrt(sxx)) * 1e6, samples: n, span };
  }
  return null;
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
  if (!(fit.sigma < 5) || !(fit.span >= 120)) return;
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
  const parts: ClockCorrection[] = [...(own ? [own] : []), ...saved];
  const correction = combineClock(parts);
  return { correction, source: !correction ? 'none' : own && saved.length ? 'both' : own ? 'test' : 'saved' };
}
