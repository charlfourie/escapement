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
 *
 * Matching uses a window of the snippet around the onset. A slower average
 * of the whole snippet, aligned the same way, is kept for amplitude: averaged
 * over a few hundred beats, a quiet unlock click that is lost in the noise on
 * single beats becomes visible (see lift.ts).
 */

import { ALIGN_MS, ALIGN_PRE_MS, SNIPPET_PRE_MS } from '../audio/detector';

export interface AlignResult {
  /** Corrected time, seconds (same clock as the input). */
  time: number;
  /** Normalised correlation with the template, −1…1. */
  match: number;
}

const LEARN = 16;
const ALPHA = 0.05;
/** The amplitude average remembers roughly this many beats. */
const AVERAGE_BEATS = 150;
const REJECT_BELOW = 0.35;

export class TickAligner {
  /** Fast-adapting template (whole snippet, scaled by the window's peak). */
  private template: Float64Array | null = null;
  /** Slow average for amplitude. */
  private avg: Float64Array | null = null;
  private count = 0;
  private readonly maxShift: number;
  private readonly w0: number;
  private readonly wLen: number;

  constructor(
    private readonly binMs: number,
    maxShiftMs = 4,
    window: { fromMs: number; lengthMs: number } = { fromMs: SNIPPET_PRE_MS - ALIGN_PRE_MS, lengthMs: ALIGN_MS },
  ) {
    this.maxShift = Math.round(maxShiftMs / binMs);
    this.w0 = Math.round(window.fromMs / binMs);
    this.wLen = Math.round(window.lengthMs / binMs);
  }

  get learned(): boolean {
    return this.count >= LEARN;
  }

  /** The averaged beat over the whole snippet (scaled to the main click), once learned. */
  get average(): number[] | null {
    return this.avg && this.learned ? Array.from(this.avg) : null;
  }

  /** Returns the corrected time, or null for a tick that doesn't match. */
  align(time: number, envelope: number[]): AlignResult | null {
    const x = scale(envelope, this.w0, this.wLen);
    if (!x) return null;
    if (!this.template) {
      this.template = Float64Array.from(x);
      this.avg = Float64Array.from(x);
      this.count = 1;
      return { time, match: 1 };
    }
    const t = this.template;
    let best = -Infinity;
    let bestLag = 0;
    const scores = new Map<number, number>();
    for (let lag = -this.maxShift; lag <= this.maxShift; lag++) {
      const c = corr(t, x, lag, this.w0, this.wLen);
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

    // Fold this tick into the template and the average, shifted to line up.
    const a = this.count < LEARN ? 1 / (this.count + 1) : ALPHA;
    const b = Math.max(1 / (this.count + 1), 1 / AVERAGE_BEATS);
    const avg = this.avg!;
    for (let i = 0; i < t.length; i++) {
      const j = i + bestLag;
      if (j >= 0 && j < x.length) {
        t[i] += (x[j] - t[i]) * a;
        avg[i] += (x[j] - avg[i]) * b;
      }
    }
    this.count++;
    return { time: time + ((bestLag + frac) * this.binMs) / 1000, match: best };
  }
}

/** Scale to the window's peak, so loud and quiet ticks compare. */
function scale(env: number[], w0: number, wLen: number): Float64Array | null {
  let peak = 0;
  const end = Math.min(env.length, w0 + wLen);
  for (let i = Math.max(0, w0); i < end; i++) if (env[i] > peak) peak = env[i];
  if (!(peak > 0)) return null;
  const out = new Float64Array(env.length);
  for (let i = 0; i < env.length; i++) out[i] = env[i] / peak;
  return out;
}

/** Pearson correlation of template t (over the window) with x shifted by lag. */
function corr(t: Float64Array, x: Float64Array, lag: number, w0: number, wLen: number): number {
  const i0 = Math.max(w0, -lag, 0);
  const i1 = Math.min(w0 + wLen, t.length, x.length - lag);
  const n = i1 - i0;
  if (n < 4) return -1;
  let st = 0;
  let sx = 0;
  for (let i = i0; i < i1; i++) {
    st += t[i];
    sx += x[i + lag];
  }
  const mt = st / n;
  const mx = sx / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = i0; i < i1; i++) {
    const a = t[i] - mt;
    const b = x[i + lag] - mx;
    sxy += a * b;
    sxx += a * a;
    syy += b * b;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : -1;
}
