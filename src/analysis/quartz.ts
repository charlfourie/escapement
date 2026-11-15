/**
 * Acoustic quartz test: rate from the stepping motor's clicks.
 *
 * A quartz watch's seconds hand steps once a second (every 2 s when the
 * battery or the solar charge is low). Each step clicks. Fitting a straight
 * line through the click times gives the watch's second in sound-card
 * seconds; the sound card's own clock error is then taken out (see clock.ts).
 *
 * Seen on a real Eco-Drive through a piezo pickup: clicks 4–15× above the
 * noise, timed to about 0.9 ms each by shape matching, with alternate steps
 * slightly different (the motor's drive pulse alternates polarity). One
 * click a second for minutes averages that jitter down: 5 minutes gives
 * about ±1.5 s/month from timing alone, 10 minutes about ±0.5.
 *
 * Many movements correct their rate in bursts (logical inhibition: a few
 * crystal pulses dropped every 10 or 60 s). Over whole minutes that averages
 * out, and the residual shows up as extra scatter, which the uncertainty
 * already reflects.
 */

const DAY = 86400;
export const MONTH_DAYS = 30.44;

export interface QuartzResult {
  /** Seconds between steps: 1 normally, 2 when the battery or charge is low. */
  stepSec: 1 | 2;
  /** Clicks used in the fit. */
  ticks: number;
  /** Steps the fit expected but didn't hear. */
  missed: number;
  /** Clicks rejected as off the beat (noise, knocks). */
  rejected: number;
  /** Seconds from first to last click used. */
  span: number;
  /** Watch rate against the sound card's clock, parts per million (+ = fast). */
  rawPpm: number;
  /** Uncertainty of rawPpm from the click timing (1 sigma). */
  rawSigmaPpm: number;
  /** Scatter of clicks around the fit, ms (RMS). */
  jitter: number;
  /** Timing difference between alternate steps, ms. */
  polarity: number;
}

export interface ClockCorrection {
  /** Sound card clock error: true seconds per sound-card second, minus one, in ppm. */
  ppm: number;
  /** Its uncertainty (1 sigma), ppm. */
  sigma: number;
}

export interface QuartzRate {
  ppm: number;
  /** Seconds per day (+ = fast). */
  perDay: number;
  /** Seconds per month (30.44 days). */
  perMonth: number;
  /** 1-sigma uncertainty, seconds per month. */
  sigmaMonth: number;
}

export const ppmToDay = (ppm: number) => (ppm * DAY) / 1e6;
export const ppmToMonth = (ppm: number) => (ppm * DAY * MONTH_DAYS) / 1e6;

/** Combine the watch-vs-sound-card rate with the sound card's clock error. */
export function quartzRate(r: QuartzResult, clock: ClockCorrection | null): QuartzRate {
  // A sound card that runs fast makes the watch look slow, and vice versa.
  const ppm = r.rawPpm - (clock?.ppm ?? 0);
  const sigma = Math.hypot(r.rawSigmaPpm, clock?.sigma ?? 0);
  return { ppm, perDay: ppmToDay(ppm), perMonth: ppmToMonth(ppm), sigmaMonth: ppmToMonth(sigma) };
}

interface Fit {
  a: number;
  b: number;
  c: number;
  resid: number[];
  sigmaB: number;
}

/** Least squares t = a + b·n + c·s, with s = ±1 for alternate steps. */
function fit(n: number[], t: number[]): Fit | null {
  const m = n.length;
  if (m < 4) return null;
  // Normal equations for three unknowns.
  let S = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  let r = [0, 0, 0];
  const n0 = n[0];
  for (let i = 0; i < m; i++) {
    const x = [1, n[i] - n0, n[i] % 2 === 0 ? 1 : -1];
    for (let p = 0; p < 3; p++) {
      r[p] += x[p] * t[i];
      for (let q = 0; q < 3; q++) S[p * 3 + q] += x[p] * x[q];
    }
  }
  const det = (M: number[]) => M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
  const D = det(S);
  if (!(Math.abs(D) > 1e-12)) return null;
  const solve = (k: number) => {
    const M = [...S];
    for (let p = 0; p < 3; p++) M[p * 3 + k] = r[p];
    return det(M) / D;
  };
  const a = solve(0);
  const b = solve(1);
  const c = solve(2);
  const resid = n.map((ni, i) => t[i] - (a + b * (ni - n0) + c * (ni % 2 === 0 ? 1 : -1)));
  const ss = resid.reduce((s, e) => s + e * e, 0);
  const s2 = ss / Math.max(1, m - 3);
  // Variance of b: s² · (S⁻¹)₁₁, cofactor of element (1,1).
  const cof11 = S[0] * S[8] - S[2] * S[6];
  const sigmaB = Math.sqrt(Math.max(0, (s2 * cof11) / D));
  S = [];
  r = [];
  return { a, b, c, resid, sigmaB };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((p, q) => p - q);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

/** Clicks further than this from the beat are noise. */
const GATE_SEC = 0.01;
/** Search rates within this of nominal (sound card error plus a bad watch). */
const SEARCH_PPM = 600;

/**
 * Find the steady beat among noise: for each trial period, fold the click
 * times and count how many fall in the busiest 2 ms phase bin. The true
 * period stacks the motor's clicks into one bin; noise spreads evenly.
 */
function findBeat(times: number[], step: number): { period: number; phase: number; hits: number } | null {
  const span = times[times.length - 1] - times[0];
  if (span < step * 4) return null;
  const binSec = 0.002;
  const nBins = Math.round(step / binSec);
  // Period steps small enough that the phase drifts < 1 bin over the run.
  const dP = (binSec * step) / Math.max(span, step);
  const range = step * SEARCH_PPM * 1e-6;
  const counts = new Int32Array(nBins);
  let best: { period: number; phase: number; hits: number } | null = null;
  const t0 = times[0];
  for (let P = step - range; P <= step + range; P += dP) {
    counts.fill(0);
    for (const t of times) {
      const ph = ((t - t0) / P) % 1;
      counts[Math.floor(ph * nBins) % nBins]++;
    }
    for (let i = 0; i < nBins; i++) {
      const c = counts[i] + Math.max(counts[(i + 1) % nBins], counts[(i + nBins - 1) % nBins]);
      if (!best || c > best.hits) best = { period: P, phase: t0 + ((i + 0.5) / nBins) * P, hits: c };
    }
  }
  return best;
}

/**
 * Fit click times (seconds, sound-card clock). Returns null until there are
 * enough clicks on a steady 1 s or 2 s beat. Noise triggers between and
 * around the clicks are expected and ignored.
 */
export function analyzeQuartz(times: number[], opts: { minTicks?: number } = {}): QuartzResult | null {
  const minTicks = opts.minTicks ?? 8;
  if (times.length < minTicks) return null;

  // 1 s or 2 s steps? A 2 s watch fills only every other slot of a 1 s grid,
  // so both folds catch the same clicks; a 1 s watch puts half as many on a
  // 2 s fold.
  const b1 = findBeat(times, 1);
  const b2 = findBeat(times, 2);
  if (!b1) return null;
  const stepSec: 1 | 2 = b2 && b2.hits > b1.hits * 0.8 ? 2 : 1;
  const beat = stepSec === 2 ? b2! : b1;
  const span = times[times.length - 1] - times[0];
  // The beat must stand far above what noise alone would pile into one bin.
  const expectedNoise = (times.length * 0.006) / stepSec + 1;
  if (beat.hits < minTicks || beat.hits < 4 * expectedNoise || beat.hits < (span / stepSec) * 0.15) return null;

  // Keep the clicks on the beat; one per step, the one nearest the grid.
  const byStep = new Map<number, number>();
  let rejected = 0;
  for (const t of times) {
    const k = Math.round((t - beat.phase) / beat.period);
    const off = t - (beat.phase + k * beat.period);
    if (Math.abs(off) > GATE_SEC) {
      rejected++;
      continue;
    }
    const prev = byStep.get(k);
    if (prev !== undefined) {
      rejected++;
      if (Math.abs(off) >= Math.abs(prev - (beat.phase + k * beat.period))) continue;
    }
    byStep.set(k, t);
  }
  const idx = [...byStep.keys()].sort((p, q) => p - q);
  const tt = idx.map((k) => byStep.get(k)!);
  if (idx.length < minTicks) return null;

  // Fit, drop outliers (knocks, a noise burst on the beat), fit again.
  let f = fit(idx, tt);
  if (!f) return null;
  for (let round = 0; round < 3; round++) {
    const mad = median(f.resid.map((e) => Math.abs(e - median(f!.resid))));
    const lim = Math.max(0.0005, 5 * 1.4826 * mad);
    const keep = f.resid.map((e) => Math.abs(e) <= lim);
    if (keep.every(Boolean)) break;
    const n2 = idx.filter((_, i) => keep[i]);
    const t2 = tt.filter((_, i) => keep[i]);
    rejected += idx.length - n2.length;
    idx.splice(0, idx.length, ...n2);
    tt.splice(0, tt.length, ...t2);
    if (idx.length < minTicks) return null;
    const g = fit(idx, tt);
    if (!g) return null;
    f = g;
  }

  const rms = Math.sqrt(f.resid.reduce((acc, e) => acc + e * e, 0) / f.resid.length);
  const steps = idx[idx.length - 1] - idx[0];
  return {
    stepSec,
    ticks: idx.length,
    missed: steps + 1 - idx.length,
    rejected,
    span: tt[tt.length - 1] - tt[0],
    rawPpm: (stepSec / f.b - 1) * 1e6,
    rawSigmaPpm: ((stepSec * f.sigmaB) / (f.b * f.b)) * 1e6,
    jitter: rms * 1000,
    polarity: Math.abs(f.c) * 2000,
  };
}

/** Accuracy grade for a quartz rate (s/month) against a spec (± s/month). */
export function quartzGrade(perMonth: number, specMonth = 15): 'good' | 'ok' | 'bad' {
  const a = Math.abs(perMonth);
  return a <= specMonth ? 'good' : a <= specMonth * 2 ? 'ok' : 'bad';
}

/**
 * Pick the detector stream that hears the steps best: most clicks on the
 * beat, least jitter, few strays.
 */
export function pickQuartzStream(streams: number[][], windowSec = 120): { index: number; result: QuartzResult; score: number } | null {
  let best: { index: number; result: QuartzResult; score: number } | null = null;
  streams.forEach((s, index) => {
    const recent = s.length && windowSec ? s.filter((t) => t >= s[s.length - 1] - windowSec) : s;
    const result = analyzeQuartz(recent);
    if (!result) return;
    const heard = result.ticks / (result.ticks + result.missed);
    const clean = result.ticks / (result.ticks + result.rejected);
    const score = (heard * clean) / (1 + result.jitter / 1.5);
    if (!best || score > best.score) best = { index, result, score };
  });
  return best;
}
