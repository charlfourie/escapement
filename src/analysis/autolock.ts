/**
 * Auto-lock: the worklet runs a bank of detectors (different filters and
 * trigger levels). Each produces its own stream of tick times. AutoLock scores
 * every stream, at every plausible beat rate, by how well it fits a steady
 * beat, and picks the winner.
 *
 *   score = precision × recall / (1 + jitter / 1.5 ms)
 *
 *   precision: fraction of the stream's ticks that land on the beat grid
 *              (low when noise or echoes trigger extra ticks)
 *   recall:    fraction of expected beats that were heard
 *              (low when the trigger is too high and misses beats)
 *   jitter:    scatter of on-grid ticks (high when the grid is a coincidence)
 */

import { analyze, STANDARD_BPH, type Analysis } from './analyze';

const EVAL_WINDOW_SEC = 10;
/** A stream is "locked" when it hears most beats, tightly on the grid. */
const LOCK_QUALITY = 0.75;
const LOCK_JITTER_MS = 0.6;
const LOCK_MIN_SCORE = 0.3;
/** Looser bar for keeping a lock than for gaining one, so it doesn't flicker. */
const HOLD_QUALITY = 0.6;
const HOLD_JITTER_MS = 1.0;
const HOLD_MIN_SCORE = 0.2;
/** Rounds a lock survives below even the hold bar before it is dropped. */
const GRACE_ROUNDS = 3;
/** A challenger must beat the current stream by this much to take over. */
const SWITCH_MARGIN = 0.08;
/** Evaluations without lock before the beat rate is searched again. */
const RESCAN_AFTER = 4;

export interface LockState {
  /** Index of the chosen detector stream. */
  index: number;
  bph: number | null;
  /** Ranking score, 0–1. */
  score: number;
  locked: boolean;
}

interface Candidate {
  score: number;
  bph: number | null;
  ok: boolean;
  hold: boolean;
}

function countInWindow(times: number[], windowSec: number): number {
  if (!times.length) return 0;
  const cutoff = times[times.length - 1] - windowSec;
  let n = 0;
  for (let i = times.length - 1; i >= 0 && times[i] >= cutoff; i--) n++;
  return n;
}

/**
 * Cheap pre-screen, O(n): the fraction of ticks that have a partner exactly two
 * beats later (same tic/toc side, so beat error cancels) and another about one
 * beat later. Noise and echoes rarely line up like that; real beats nearly
 * always do. The one-beat check stops 2/3 or 1/2 of the true rate scoring well.
 */
export function quickScore(times: number[], bph: number, windowSec = EVAL_WINDOW_SEC): number {
  const twoP = 7200 / bph;
  const tol = twoP * 0.03;
  const cutoff = times.length ? times[times.length - 1] - windowSec : 0;
  let start = times.length;
  while (start > 0 && times[start - 1] >= cutoff) start--;
  const n = times.length - start;
  if (n < 12) return 0;
  const P = twoP / 2;
  const tol1 = P * 0.12;
  let hits = 0;
  let j = start;
  let k = start;
  for (let i = start; i < times.length; i++) {
    const t2 = times[i] + twoP;
    const t1 = times[i] + P;
    if (j <= i) j = i + 1;
    if (k <= i) k = i + 1;
    while (j < times.length && times[j] < t2 - tol) j++;
    while (k < times.length && times[k] < t1 - tol1) k++;
    if (j < times.length && times[j] <= t2 + tol && k < times.length && times[k] <= t1 + tol1) hits++;
  }
  return hits / n;
}

/** Cap on (stream, beat rate) pairs that get the full analysis each round. */
const FULL_CHECKS = 16;

export function scoreAnalysis(times: number[], a: Analysis, windowSec = EVAL_WINDOW_SEC): number {
  const n = countInWindow(times, windowSec);
  const precision = Math.min(1, a.ticks / Math.max(1, n));
  return (precision * a.quality) / (1 + a.jitter / 1.5);
}

export class AutoLock {
  readonly streams: number[][];
  private state: LockState = { index: 0, bph: null, score: 0, locked: false };
  private lockedBph: number | null = null;
  private misses = 0;
  private grace = 0;

  constructor(streamCount: number) {
    this.streams = Array.from({ length: streamCount }, () => []);
  }

  add(stream: number, time: number): void {
    this.streams[stream]?.push(time);
  }

  /** Drop ticks older than maxSec before the newest one. */
  trim(maxSec: number): void {
    for (let i = 0; i < this.streams.length; i++) {
      const s = this.streams[i];
      if (s.length && s[s.length - 1] - s[0] > maxSec) {
        const cutoff = s[s.length - 1] - maxSec;
        let k = 0;
        while (k < s.length && s[k] < cutoff) k++;
        this.streams[i] = s.slice(k);
      }
    }
  }

  get current(): LockState {
    return this.state;
  }

  evaluate(bphSetting: number | null): LockState {
    const candidates: readonly number[] = bphSetting
      ? [bphSetting]
      : this.lockedBph && this.misses < RESCAN_AFTER
        ? [this.lockedBph]
        : STANDARD_BPH;

    // Pre-screen every pair cheaply. Each stream then gets a full analysis at
    // its most promising beat rate(s); echoes can make two rates look alike,
    // so near-ties are both checked.
    const pairs: Array<{ i: number; bph: number; q: number }> = [];
    this.streams.forEach((times, i) => {
      const qs = candidates.map((bph) => ({ i, bph, q: quickScore(times, bph) }));
      const top = Math.max(...qs.map((p) => p.q));
      if (top < 0.2) return;
      pairs.push(...qs.filter((p) => p.q >= top - 0.05).sort((a, b) => b.q - a.q).slice(0, 2));
    });
    pairs.sort((a, b) => b.q - a.q);
    const chosen = pairs.slice(0, FULL_CHECKS);

    const best: Candidate[] = this.streams.map(() => ({ score: 0, bph: null, ok: false, hold: false }));
    for (const p of chosen) {
      const times = this.streams[p.i];
      const a = analyze(times, { bph: p.bph, windowSec: EVAL_WINDOW_SEC, starts: 3 });
      if (!a || a.ticks < 12) continue;
      const sc = scoreAnalysis(times, a);
      if (sc > best[p.i].score) {
        best[p.i] = {
          score: sc,
          bph: p.bph,
          ok: a.quality >= LOCK_QUALITY && a.jitter <= LOCK_JITTER_MS && sc >= LOCK_MIN_SCORE,
          hold: a.quality >= HOLD_QUALITY && a.jitter <= HOLD_JITTER_MS && sc >= HOLD_MIN_SCORE,
        };
      }
    }

    // Prefer streams that qualify as locked, then the highest score.
    const rank = (c: Candidate) => (c.ok ? 1 : 0) + c.score;
    let winner = 0;
    best.forEach((b, i) => {
      if (rank(b) > rank(best[winner])) winner = i;
    });

    const cur = this.state.index;
    const wasLocked = this.state.locked;
    const curGood = wasLocked ? best[cur].hold : best[cur].ok;
    let index: number;
    let locked: boolean;
    if (curGood && !(best[winner].ok && rank(best[winner]) > rank(best[cur]) + SWITCH_MARGIN)) {
      index = cur;
      locked = true;
      this.grace = 0;
    } else if (best[winner].ok) {
      index = winner;
      locked = true;
      this.grace = 0;
    } else if (wasLocked && ++this.grace < GRACE_ROUNDS) {
      // Brief bad patch (a bump, a breath): hold the lock for a moment.
      this.state = { ...this.state, score: best[cur].score };
      return this.state;
    } else {
      index = winner;
      locked = false;
      this.grace = 0;
    }
    const { score } = best[index];
    const bph = best[index].bph ?? (locked ? this.state.bph : null);

    if (locked) {
      this.lockedBph = bph;
      this.misses = 0;
    } else if (++this.misses >= RESCAN_AFTER) {
      this.lockedBph = null;
    }
    this.state = { index, bph: locked ? bph : (this.lockedBph ?? bph), score, locked };
    return this.state;
  }
}
