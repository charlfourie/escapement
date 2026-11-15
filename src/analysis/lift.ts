/**
 * Lift time from an averaged beat.
 *
 * Amplitude normally comes from timing the unlock and drop clicks inside each
 * tick. With a quiet pickup the unlock click is lost in the noise on single
 * ticks, but it survives in the average of many aligned ticks: noise falls by
 * roughly √n while the clicks stay put. The shape matcher keeps that average
 * (TickAligner.average), so amplitude can be read from it when the per-tick
 * method gives up.
 *
 * Seen on real recordings (vintage 21,600 bph watches through a piezo pickup):
 * the unlock click sat 13–14 ms before the drop and at under a tenth of its
 * height, so it needs both a long lead-in and a low, noise-aware threshold.
 */

/** A click must stand this many noise-sigmas above the baseline. */
const MIN_SIGMA = 5;
/** …and at least this fraction of the drop's height. */
const MIN_HEIGHT = 0.04;
/** The drop click must reach this fraction of the loudest click. */
const DROP_MIN = 0.3;
/** Sub-clicks closer than this are one click. */
const MIN_SEPARATION_MS = 0.8;
const LIFT_MIN_MS = 2;
const LIFT_MAX_MS = 25;

export interface TemplateLift {
  /** Seconds from the unlock click to the drop click. */
  lift: number;
  /** Height of the unlock click relative to the drop click, 0–1. */
  unlockLevel: number;
  /** Unlock height in noise sigmas: how sure the click is real. */
  unlockSigma: number;
}

function quantile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];
}

/** Time from the unlock click to the drop click of an averaged beat envelope. */
export function liftFromEnvelope(env: ArrayLike<number>, binMs: number): TemplateLift | null {
  const n = env.length;
  if (n < 40) return null;
  const v = Array.from(env);
  const sorted = [...v].sort((a, b) => a - b);
  // Most of the snippet is quiet: its median and spread describe the noise.
  const base = quantile(sorted, 0.5);
  const dev = v.map((x) => Math.abs(x - base)).sort((a, b) => a - b);
  const sigma = Math.max(1e-9, 1.4826 * quantile(dev, 0.5));

  let main = 0;
  for (let i = 1; i < n; i++) if (v[i] > v[main]) main = i;
  const top = v[main] - base;
  if (top < 8 * sigma) return null; // the average is still mostly noise

  // Local maxima that stand clear of the noise, merged when too close.
  const sep = Math.max(1, Math.round(MIN_SEPARATION_MS / binMs));
  const minH = Math.max(MIN_SIGMA * sigma, MIN_HEIGHT * top);
  const peaks: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (!(v[i] >= v[i - 1] && v[i] > v[i + 1])) continue;
    if (v[i] - base < minH) continue;
    const last = peaks[peaks.length - 1];
    if (last !== undefined && i - last < sep) {
      if (v[i] > v[last]) peaks[peaks.length - 1] = i;
    } else peaks.push(i);
  }

  // Rising edge at half of the click's own height above the baseline.
  const edge = (p: number) => {
    const thr = base + (v[p] - base) * 0.5;
    let j = p;
    while (j > 0 && v[j - 1] > thr) j--;
    const a = j > 0 ? v[j - 1] : base;
    const frac = v[j] !== a ? Math.min(1, Math.max(0, (thr - a) / (v[j] - a))) : 1;
    return (j - 1 + frac) * binMs;
  };

  // Drop: the last loud click. Unlock: the earliest clear click before it,
  // within a plausible lift time.
  const loud = peaks.filter((p) => v[p] - base >= DROP_MIN * top);
  for (let k = loud.length - 1; k >= 0; k--) {
    const drop = loud[k];
    const dropMs = edge(drop);
    for (const p of peaks) {
      if (p >= drop) break;
      const gap = dropMs - edge(p);
      if (gap > LIFT_MAX_MS) continue;
      if (gap < LIFT_MIN_MS) break;
      return { lift: gap / 1000, unlockLevel: (v[p] - base) / (v[drop] - base), unlockSigma: (v[p] - base) / sigma };
    }
  }
  return null;
}
