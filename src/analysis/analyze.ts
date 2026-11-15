/**
 * Turns tick timestamps into timegrapher readings.
 *
 * Model: each accepted tick i gets a beat index n_i, and parity s_i = ±½
 * (tic vs toc). We least-squares fit
 *
 *     t_i = a + b·n_i + c·s_i
 *
 * b is the real beat period, c is the tic/toc offset.
 *   rate       = 86400 · (P_nominal / b − 1)   s/day
 *   beat error = |c|                            (half the tic/toc interval difference)
 */

export const STANDARD_BPH = [14400, 18000, 19800, 21600, 25200, 28800, 36000] as const;

export interface TracePoint {
  /** Seconds since the first accepted tick. */
  t: number;
  /** How late the tick is against the nominal beat grid, ms (early = negative). Its slope is −rate; the trace is drawn inverted so gaining slopes up. */
  dev: number;
  odd: boolean;
}

export interface Analysis {
  bph: number;
  bphDetected: boolean;
  /** s/day, + = gaining */
  rate: number;
  /** ms, null when only one of tic/toc was heard */
  beatError: number | null;
  /** Residual scatter, ms (signal cleanliness). */
  jitter: number;
  ticks: number;
  /** Accepted ticks / beats that should have happened, 0–1. */
  quality: number;
  duration: number;
  points: TracePoint[];
}

export function detectBph(times: number[]): number | null {
  if (times.length < 8) return null;
  let best: number | null = null;
  let bestCount = 0;
  for (const bph of STANDARD_BPH) {
    // Sum of two consecutive intervals cancels beat error, so it matches 2P cleanly.
    const twoP = 7200 / bph;
    let count = 0;
    for (let i = 2; i < times.length; i++) {
      if (Math.abs(times[i] - times[i - 2] - twoP) < twoP * 0.03) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = bph;
    }
  }
  if (best === null || bestCount < 6 || bestCount < (times.length - 2) * 0.25) return null;
  return best;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Assign beat indices. The grid phase is the median of the last few accepted
 * ticks' offsets, so an occasional knock or bump can't drag the grid off.
 */
function unwrap(times: number[], period: number, start: number): { sel: number[]; idx: number[] } {
  const sel = [start];
  const idx = [0];
  const offs = [times[start]];
  const fracs = [0];
  for (let i = start + 1; i < times.length; i++) {
    const a = median(offs.slice(-15));
    const k = (times[i] - a) / period;
    const n = Math.round(k);
    const frac = Math.abs(k - n);
    if (frac >= 0.25) continue;
    const last = idx.length - 1;
    if (n < idx[last]) continue;
    if (n === idx[last]) {
      // Two candidates for one beat: keep whichever sits closer to the grid.
      if (frac < fracs[last]) {
        sel[last] = i;
        offs[last] = times[i] - period * n;
        fracs[last] = frac;
      }
      continue;
    }
    sel.push(i);
    idx.push(n);
    offs.push(times[i] - period * n);
    fracs.push(frac);
  }
  return { sel, idx };
}

/**
 * Where the ticks jump and stay jumped: after a knock or a burst of noise the
 * detector can start timing each tick from a different click of the beat
 * (the impulse instead of the drop), shifting every later tick by the gap
 * between clicks, a few ms. Returns the tick indices where a new stretch
 * starts. The watch's own drift is taken out first, so a fast or slow watch
 * isn't mistaken for a step.
 */
export function findSteps(ts: number[], ns: number[], P: number): Set<number> {
  const out = new Set<number>();
  const n = ts.length;
  const W = 10;
  if (n < 3 * W) return out;
  const r = ts.map((t, i) => t - P * ns[i]);
  // Robust drift: the median slope over spans of ~20 ticks.
  const L = Math.min(20, n >> 2);
  const slopes: number[] = [];
  for (let i = 0; i + L < n; i++) if (ts[i + L] > ts[i]) slopes.push((r[i + L] - r[i]) / (ts[i + L] - ts[i]));
  const slope = slopes.length ? median(slopes) : 0;
  const d0 = r.map((v, i) => v - slope * ts[i]);
  // Take out the beat error: each side about its own median.
  const odd = median(d0.filter((_, i) => ns[i] % 2));
  const even = median(d0.filter((_, i) => !(ns[i] % 2)));
  const d = d0.map((v, i) => v - (ns[i] % 2 ? odd : even));
  const noise = 1.4826 * median(d.map((v) => Math.abs(v - median(d))));
  const minJump = Math.max(0.0025, 6 * Math.min(noise, 0.001));
  const jump: number[] = new Array(n).fill(0);
  for (let i = W; i <= n - W; i++) jump[i] = median(d.slice(i, i + W)) - median(d.slice(i - W, i));
  for (let i = W; i <= n - W; i++) {
    if (Math.abs(jump[i]) < minJump) continue;
    // The sharpest point of the jump, once.
    let best = true;
    for (let j = Math.max(W, i - W); j <= Math.min(n - W, i + W); j++) if (Math.abs(jump[j]) > Math.abs(jump[i])) best = false;
    if (best && ![...out].some((k) => Math.abs(k - i) < W)) out.add(i);
  }
  return out;
}

/** Solve least squares for columns given as arrays (small dense normal equations). */
function lstsq(cols: number[][], y: number[]): number[] | null {
  const k = cols.length;
  const A: number[][] = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  for (let r = 0; r < y.length; r++) {
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) A[i][j] += cols[i][r] * cols[j][r];
      A[i][k] += cols[i][r] * y[r];
    }
  }
  for (let i = 0; i < k; i++) {
    let p = i;
    for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    if (Math.abs(A[p][i]) < 1e-12) return null;
    [A[i], A[p]] = [A[p], A[i]];
    for (let r = 0; r < k; r++) {
      if (r === i) continue;
      const f = A[r][i] / A[i][i];
      for (let c = i; c <= k; c++) A[r][c] -= f * A[i][c];
    }
  }
  return A.map((row, i) => row[k] / row[i]);
}

export interface AnalyzeOptions {
  /** Force a beat rate instead of auto-detecting. */
  bph?: number | null;
  /** Only use the most recent N seconds. */
  windowSec?: number;
  /** How many leading ticks to try as the grid's starting point (default 10). */
  starts?: number;
}

export function analyze(allTimes: number[], opts: AnalyzeOptions = {}): Analysis | null {
  let times = allTimes;
  if (opts.windowSec && times.length) {
    const cutoff = times[times.length - 1] - opts.windowSec;
    let i = 0;
    while (i < times.length && times[i] < cutoff) i++;
    times = times.slice(i);
  }
  if (times.length < 8) return null;

  const bphDetected = !opts.bph;
  const bph = opts.bph || detectBph(times);
  if (!bph) return null;
  const P = 3600 / bph;

  // Pick the starting tick that lets the most ticks line up on the grid.
  let best = unwrap(times, P, 0);
  for (let s = 1; s < Math.min(opts.starts ?? 10, times.length - 8); s++) {
    const u = unwrap(times, P, s);
    if (u.sel.length > best.sel.length) best = u;
  }

  const t0 = times[best.sel[0]];
  let ts = best.sel.map((i) => times[i] - t0);
  let ns = best.idx.slice();

  // A gap in the ticks (the beat lost for a moment) can come back with the
  // whole line shifted a few ms: another detector, a re-learned tick shape.
  // Each unbroken stretch gets its own offset; they share the slope (the rate)
  // and the beat error, so one step can't tilt the whole reading.
  const GAP = Math.max(1, 6 * P);
  let seg: number[] = [];
  {
    const breaks = findSteps(ts, ns, P);
    let k = 0;
    ts.forEach((t, i) => {
      if (i && (t - ts[i - 1] > GAP || breaks.has(i))) k++;
      seg.push(k);
    });
    // Too few ticks to place a stretch on its own: leave it out.
    const count = new Map<number, number>();
    for (const g of seg) count.set(g, (count.get(g) ?? 0) + 1);
    const keep = seg.map((g) => (count.get(g) ?? 0) >= 6);
    if (keep.some(Boolean)) {
      ts = ts.filter((_, i) => keep[i]);
      ns = ns.filter((_, i) => keep[i]);
      seg = seg.filter((_, i) => keep[i]);
    }
    const ids = [...new Set(seg)];
    seg = seg.map((g) => ids.indexOf(g));
  }

  let coeffs: { a: number[]; b: number; c: number | null } | null = null;
  let sigma = 0;

  for (let iter = 0; iter < 4; iter++) {
    if (ts.length < 8) return null;
    const S = Math.max(...seg) + 1;
    const ss = ns.map((n) => (n % 2 === 0 ? -0.5 : 0.5));
    const hasBoth = ss.some((s) => s < 0) && ss.some((s) => s > 0);
    const segCols = Array.from({ length: S }, (_, j) => seg.map((g) => (g === j ? 1 : 0)));
    const sol = lstsq(hasBoth ? [...segCols, ns, ss] : [...segCols, ns], ts);
    if (!sol) return null;
    const a = sol.slice(0, S);
    coeffs = { a, b: sol[S], c: hasBoth ? sol[S + 1] : null };
    const res = ts.map((t, i) => t - (a[seg[i]] + sol[S] * ns[i] + (hasBoth ? sol[S + 1] * ss[i] : 0)));
    sigma = 1.4826 * median(res.map(Math.abs));
    const limit = Math.max(4 * sigma, 0.00015);
    const keep = res.map((r) => Math.abs(r) <= limit);
    if (keep.every(Boolean)) break;
    ts = ts.filter((_, i) => keep[i]);
    ns = ns.filter((_, i) => keep[i]);
    seg = seg.filter((_, i) => keep[i]);
    // A stretch emptied by outlier removal: renumber the rest.
    const ids = [...new Set(seg)];
    seg = seg.map((g) => ids.indexOf(g));
    if (coeffs) coeffs.a = ids.map((g) => coeffs!.a[g]);
  }
  if (!coeffs || ts.length < 8) return null;

  const { b, c } = coeffs;
  const span = ns[ns.length - 1] - ns[0] + 1;
  const tFirst = ts[0];
  // The trace is anchored to its start, not to the fit: as more ticks come in
  // and the fit is refined, the dots already drawn stay where they are. Later
  // stretches are shifted by their fitted offset so the line runs on unbroken.
  const step = (i: number) => (coeffs!.a[seg[i]] - coeffs!.a[seg[0]]) * 1000;
  const raw = ts.map((t, i) => (t - P * (ns[i] - ns[0])) * 1000 - step(i));
  const anchor = median(raw.slice(0, Math.min(20, raw.length)));
  // "toc" (odd) is always the later of the two ticks, so the two lines keep
  // their places even when the analysis starts from a different tick.
  const flip = c !== null && c < 0;
  const points: TracePoint[] = ts.map((t, i) => ({
    t: t - tFirst,
    dev: raw[i] - anchor,
    odd: (ns[i] % 2 !== 0) !== flip,
  }));

  return {
    bph,
    bphDetected,
    rate: 86400 * (P / b - 1),
    beatError: c === null ? null : Math.abs(c) * 1000,
    jitter: sigma * 1000,
    ticks: ts.length,
    quality: Math.min(1, ts.length / span),
    duration: ts[ts.length - 1] - tFirst,
    points,
  };
}

/** Thin a trace for storage while keeping its shape. */
export function downsample(points: TracePoint[], max: number): TracePoint[] {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out: TracePoint[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.floor(i * step)]);
  return out;
}

/** COSC chronometer criteria for average daily rate. */
export const COSC = { min: -4, max: 6 } as const;

export interface AmplitudeResult {
  /** Degrees. */
  amplitude: number;
  /** Spread (interquartile range) of the per-tick estimates, degrees. */
  spread: number;
  samples: number;
  /** Read from the average of many ticks, because single ticks were too noisy. */
  averaged?: boolean;
}

/**
 * Balance amplitude from lift times (unlock → drop, seconds).
 * The balance swings θ(t) = A·sin(2πt/T); crossing the lift angle LA takes
 * t = (T/π)·asin(LA / 2A), so A = LA / (2·sin(π·t/T)) with T = 7200 / bph.
 */
/** Amplitude for one lift time (seconds), or null when it's outside a plausible range. */
export function amplitudeFromLift(lift: number, bph: number, liftAngle: number): number | null {
  const T = 7200 / bph;
  if (!(lift > 0 && lift < T / 4)) return null;
  const a = liftAngle / (2 * Math.sin((Math.PI * lift) / T));
  return a > 90 && a < 400 ? a : null;
}

export function amplitudeFrom(lifts: number[], bph: number, liftAngle: number): AmplitudeResult | null {
  const T = 7200 / bph;
  const amps = lifts
    .filter((t) => t > 0 && t < T / 4)
    .map((t) => liftAngle / (2 * Math.sin((Math.PI * t) / T)))
    .filter((a) => a > 90 && a < 400)
    .sort((a, b) => a - b);
  if (amps.length < 8) return null;
  const q = (p: number) => amps[Math.min(amps.length - 1, Math.floor(p * amps.length))];
  return { amplitude: q(0.5), spread: q(0.75) - q(0.25), samples: amps.length };
}

/** A reading saves on its own when it's at least this long… */
export const MIN_SAVE_SEC = 10;
/** …with at least this share of clean beats. */
export const MIN_SAVE_QUALITY = 0.6;

export function isValidReading(a: Pick<Analysis, 'duration' | 'quality'>): boolean {
  return a.duration >= MIN_SAVE_SEC && a.quality >= MIN_SAVE_QUALITY;
}
