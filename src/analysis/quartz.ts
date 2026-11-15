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

import { lsq, segmentOf } from './lsq';

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
  /** Seconds covered by the clicks used (summed over unbroken stretches). */
  span: number;
  /** Unbroken stretches of audio the clicks came from (1 without dropouts). */
  stretches: number;
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

/**
 * Fit t = a_j + b·n + c_j·s over clicks in one or more unbroken stretches j
 * (s = ±1 for alternate steps). Each stretch gets its own offset, because an
 * audio dropout shifts every later click; the slope b is shared.
 */
function segFit(seg: number[], n: number[], t: number[]): { b: number; sigmaB: number; resid: number[]; polarity: number } | null {
  const ids = [...new Set(seg)];
  const col = new Map(ids.map((id, i) => [id, i]));
  const k = ids.length;
  const first = new Map<number, { n: number; t: number }>();
  seg.forEach((sg, i) => {
    if (!first.has(sg)) first.set(sg, { n: n[i], t: t[i] });
  });
  const X: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < n.length; i++) {
    const row = new Array<number>(2 * k + 1).fill(0);
    const j = col.get(seg[i])!;
    const f = first.get(seg[i])!;
    row[j] = 1;
    row[k + j] = n[i] % 2 === 0 ? 1 : -1;
    row[2 * k] = n[i] - f.n;
    X.push(row);
    y.push(t[i] - f.t);
  }
  const r = lsq(X, y);
  if (!r) return null;
  const b = r.coef[2 * k];
  const polarity = (2000 * ids.reduce((acc, _, j) => acc + Math.abs(r.coef[k + j]), 0)) / k;
  return { b, sigmaB: Math.sqrt(r.variance(2 * k)), resid: r.resid, polarity };
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
 * around the clicks are expected and ignored. `breaks` are times where the
 * audio dropped out: the beat is found and fitted afresh in each stretch.
 */
export function analyzeQuartz(times: number[], opts: { minTicks?: number; breaks?: number[] } = {}): QuartzResult | null {
  const minTicks = opts.minTicks ?? 8;
  if (times.length < minTicks) return null;
  const breaks = [...(opts.breaks ?? [])].sort((p, q) => p - q);

  const groups = new Map<number, number[]>();
  for (const t of times) {
    const g = segmentOf(t, breaks);
    groups.set(g, [...(groups.get(g) ?? []), t]);
  }
  const largest = [...groups.values()].sort((p, q) => q.length - p.length)[0];

  // 1 s or 2 s steps? A 2 s watch fills only every other slot of a 1 s grid,
  // so both folds catch the same clicks; a 1 s watch puts half as many on a
  // 2 s fold. Decided on the longest stretch.
  const b1 = findBeat(largest, 1);
  const b2 = findBeat(largest, 2);
  if (!b1) return null;
  const stepSec: 1 | 2 = b2 && b2.hits > b1.hits * 0.8 ? 2 : 1;

  const seg: number[] = [];
  const idx: number[] = [];
  const tt: number[] = [];
  let rejected = 0;
  for (const [g, ts] of groups) {
    const span = ts[ts.length - 1] - ts[0];
    const beat = ts.length >= 6 ? findBeat(ts, stepSec) : null;
    // The beat must stand far above what noise alone would pile into one bin.
    const expectedNoise = (ts.length * 0.006) / stepSec + 1;
    if (!beat || beat.hits < 6 || beat.hits < 4 * expectedNoise || beat.hits < (span / stepSec) * 0.15) {
      rejected += ts.length;
      continue;
    }
    // Keep the clicks on the beat; one per step, the one nearest the grid.
    const byStep = new Map<number, number>();
    for (const t of ts) {
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
    for (const k of [...byStep.keys()].sort((p, q) => p - q)) {
      seg.push(g);
      idx.push(k);
      tt.push(byStep.get(k)!);
    }
  }
  if (idx.length < minTicks) return null;

  // Fit, drop outliers (knocks, a noise burst on the beat), fit again.
  let f = segFit(seg, idx, tt);
  if (!f) return null;
  for (let round = 0; round < 3; round++) {
    const res = f.resid;
    const mad = median(res.map((e) => Math.abs(e - median(res))));
    const lim = Math.max(0.0005, 5 * 1.4826 * mad);
    const keep = res.map((e) => Math.abs(e) <= lim);
    if (keep.every(Boolean)) break;
    const n0 = keep.filter(Boolean).length;
    if (n0 < minTicks) return null;
    rejected += idx.length - n0;
    for (const arr of [seg, idx, tt]) {
      const kept = arr.filter((_, i) => keep[i]);
      arr.splice(0, arr.length, ...kept);
    }
    const g = segFit(seg, idx, tt);
    if (!g) return null;
    f = g;
  }

  const rms = Math.sqrt(f.resid.reduce((acc, e) => acc + e * e, 0) / f.resid.length);
  // Steps expected but not heard, and time covered, stretch by stretch.
  let missed = 0;
  let span = 0;
  const used = [...new Set(seg)];
  for (const g of used) {
    const ks = idx.filter((_, i) => seg[i] === g);
    const ts = tt.filter((_, i) => seg[i] === g);
    missed += ks[ks.length - 1] - ks[0] + 1 - ks.length;
    span += ts[ts.length - 1] - ts[0];
  }
  return {
    stepSec,
    ticks: idx.length,
    missed,
    rejected,
    span,
    stretches: used.length,
    rawPpm: (stepSec / f.b - 1) * 1e6,
    rawSigmaPpm: ((stepSec * f.sigmaB) / (f.b * f.b)) * 1e6,
    jitter: rms * 1000,
    polarity: f.polarity,
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
export function pickQuartzStream(streams: number[][], windowSec = 120, breaks: number[] = []): { index: number; result: QuartzResult; score: number } | null {
  let best: { index: number; result: QuartzResult; score: number } | null = null;
  streams.forEach((s, index) => {
    const recent = s.length && windowSec ? s.filter((t) => t >= s[s.length - 1] - windowSec) : s;
    const result = analyzeQuartz(recent, { breaks });
    if (!result) return;
    const heard = result.ticks / (result.ticks + result.missed);
    const clean = result.ticks / (result.ticks + result.rejected);
    const score = (heard * clean) / (1 + result.jitter / 1.5);
    if (!best || score > best.score) best = { index, result, score };
  });
  return best;
}
