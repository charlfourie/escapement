/**
 * Tick timing by shape matching.
 *
 * The detector stamps each tick where its first click crosses a threshold.
 * In noise, that first (quiet) click is sometimes missed and the stamp lands
 * on the next click a few milliseconds later, which skews rate and beat
 * error. Instead, keep a running template of what a beat looks like (its
 * envelope: unlock, impulse, drop) and time every tick by where it best lines
 * up with that template. All three clicks then vote on the timing, and a
 * "tick" that doesn't look like a beat at all can be rejected.
 */

export interface AlignResult {
  /** Corrected time, seconds (same clock as the input). */
  time: number;
  /** Normalised correlation with the template, −1…1. */
  match: number;
}

const LEARN = 16;
const ALPHA = 0.05;
const REJECT_BELOW = 0.35;

export class TickAligner {
  private template: Float64Array | null = null;
  private count = 0;
  private readonly maxShift: number;

  constructor(
    private readonly binMs: number,
    maxShiftMs = 4,
  ) {
    this.maxShift = Math.round(maxShiftMs / binMs);
  }

  get learned(): boolean {
    return this.count >= LEARN;
  }

  /** Returns the corrected time, or null for a tick that doesn't match. */
  align(time: number, envelope: number[]): AlignResult | null {
    const x = normalise(envelope);
    if (!x) return null;
    if (!this.template) {
      this.template = Float64Array.from(x);
      this.count = 1;
      return { time, match: 1 };
    }
    const t = this.template;
    let best = -Infinity;
    let bestLag = 0;
    const scores = new Map<number, number>();
    for (let lag = -this.maxShift; lag <= this.maxShift; lag++) {
      const c = corr(t, x, lag);
      scores.set(lag, c);
      if (c > best) {
        best = c;
        bestLag = lag;
      }
    }
    // Parabolic interpolation for sub-bin timing.
    const l = scores.get(bestLag - 1);
    const r = scores.get(bestLag + 1);
    let frac = 0;
    if (l !== undefined && r !== undefined) {
      const d = l - 2 * best + r;
      if (d < 0) frac = Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / d));
    }
    if (this.count >= LEARN && best < REJECT_BELOW) return null;

    // Fold this tick into the template, shifted to line up.
    const a = this.count < LEARN ? 1 / (this.count + 1) : ALPHA;
    for (let i = 0; i < t.length; i++) {
      const j = i + bestLag;
      if (j >= 0 && j < x.length) t[i] += (x[j] - t[i]) * a;
    }
    this.count++;
    return { time: time + ((bestLag + frac) * this.binMs) / 1000, match: best };
  }
}

/** Scale to peak 1 and remove the mean, so loud and quiet ticks compare. */
function normalise(env: number[]): Float64Array | null {
  let peak = 0;
  for (const v of env) if (v > peak) peak = v;
  if (!(peak > 0)) return null;
  const out = new Float64Array(env.length);
  let mean = 0;
  for (let i = 0; i < env.length; i++) {
    out[i] = env[i] / peak;
    mean += out[i];
  }
  mean /= env.length;
  for (let i = 0; i < out.length; i++) out[i] -= mean;
  return out;
}

/** Normalised correlation of template t with x shifted by lag (x[i+lag] vs t[i]). */
function corr(t: Float64Array, x: Float64Array, lag: number): number {
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  const i0 = Math.max(0, -lag);
  const i1 = Math.min(t.length, x.length - lag);
  for (let i = i0; i < i1; i++) {
    const a = t[i];
    const b = x[i + lag];
    sxy += a * b;
    sxx += a * a;
    syy += b * b;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : -1;
}
