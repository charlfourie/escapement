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
  /** Deviation from the nominal beat grid, ms. Slope of this line = rate. */
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
  for (let s = 1; s < Math.min(10, times.length - 8); s++) {
    const u = unwrap(times, P, s);
    if (u.sel.length > best.sel.length) best = u;
  }

  const t0 = times[best.sel[0]];
  let ts = best.sel.map((i) => times[i] - t0);
  let ns = best.idx.slice();
  let coeffs: { a: number; b: number; c: number | null } | null = null;
  let sigma = 0;

  for (let iter = 0; iter < 4; iter++) {
    if (ts.length < 8) return null;
    const ss = ns.map((n) => (n % 2 === 0 ? -0.5 : 0.5));
    const hasBoth = ss.some((s) => s < 0) && ss.some((s) => s > 0);
    const ones = ts.map(() => 1);
    const sol = hasBoth ? lstsq([ones, ns, ss], ts) : lstsq([ones, ns], ts);
    if (!sol) return null;
    coeffs = { a: sol[0], b: sol[1], c: hasBoth ? sol[2] : null };
    const res = ts.map((t, i) => t - (sol[0] + sol[1] * ns[i] + (hasBoth ? sol[2] * ss[i] : 0)));
    sigma = 1.4826 * median(res.map(Math.abs));
    const limit = Math.max(4 * sigma, 0.00015);
    const keep = res.map((r) => Math.abs(r) <= limit);
    if (keep.every(Boolean)) break;
    ts = ts.filter((_, i) => keep[i]);
    ns = ns.filter((_, i) => keep[i]);
  }
  if (!coeffs || ts.length < 8) return null;

  const { a, b, c } = coeffs;
  const span = ns[ns.length - 1] - ns[0] + 1;
  const tFirst = ts[0];
  const points: TracePoint[] = ts.map((t, i) => ({
    t: t - tFirst,
    dev: (t - (a + P * ns[i])) * 1000,
    odd: ns[i] % 2 !== 0,
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
