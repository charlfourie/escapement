/**
 * Settled readouts: what the measure page shows, as opposed to what it
 * measures. Each update's value goes in; out comes a steady figure, how much
 * it's wandering (±), whether it has settled, and the precision it deserves.
 *
 * - The shown value is the median of the last few seconds of updates, and it
 *   only moves when that median moves by more than half its display step, so
 *   it doesn't flicker.
 * - A genuine change (the watch turned to another position, running down)
 *   isn't averaged away: when the latest updates all sit well to one side of
 *   the shown value, it starts again from them.
 */

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface Settled {
  value: number;
  /** Typical wander, same units (robust standard deviation). */
  spread: number;
  settled: boolean;
  /** Decimal places worth showing. */
  decimals: number;
}

export interface SettleOptions {
  /** Updates to keep (at 4 updates a second, 24 = 6 s). */
  keep?: number;
  /** Updates needed before a value is shown as settled. */
  settleAfter?: number;
  /** Spread below which tenths are worth showing. */
  fineSpread?: number;
  /** Smallest change counted as genuine, whatever the spread. */
  minShift?: number;
  /** Most decimals ever shown. */
  maxDecimals?: number;
}

export class Settler {
  private xs: number[] = [];
  private shown: number | null = null;
  private readonly o: Required<SettleOptions>;

  constructor(opts: SettleOptions = {}) {
    this.o = { keep: 24, settleAfter: 8, fineSpread: 0.5, minShift: 2, maxDecimals: 1, ...opts };
  }

  reset(): void {
    this.xs = [];
    this.shown = null;
  }

  get count(): number {
    return this.xs.length;
  }

  push(x: number | null | undefined): void {
    if (x === null || x === undefined || !Number.isFinite(x)) return;
    this.xs.push(x);
    if (this.xs.length > this.o.keep) this.xs.shift();
    // A genuine change: the last few all well away, on the same side.
    const k = 6;
    if (this.shown !== null && this.xs.length >= k + 4) {
      const recent = this.xs.slice(-k);
      const older = this.xs.slice(0, -k);
      const m = median(older);
      const s = Math.max(1.4826 * median(older.map((v) => Math.abs(v - m))), 1e-9);
      const gap = Math.max(4 * s, this.o.minShift);
      if (recent.every((v) => v - m > gap) || recent.every((v) => m - v > gap)) {
        this.xs = recent;
        this.shown = null;
      }
    }
  }

  get(): Settled | null {
    if (!this.xs.length) return null;
    const m = median(this.xs);
    const spread = this.xs.length >= 3 ? 1.4826 * median(this.xs.map((v) => Math.abs(v - m))) : Infinity;
    const decimals = spread <= this.o.fineSpread ? this.o.maxDecimals : 0;
    const step = 10 ** -decimals;
    // Only move the shown value when the median has really moved.
    if (this.shown === null || Math.abs(m - this.shown) >= step / 2 + Math.min(spread, 10 * step) / 4) this.shown = m;
    return { value: this.shown, spread, settled: this.xs.length >= this.o.settleAfter, decimals };
  }
}

/** How a value is written: "+30", "+29.6"; the ± only when it's worth saying. */
export function plusMinus(s: Settled, shownAbove: number): string {
  if (!Number.isFinite(s.spread) || s.spread < shownAbove) return '';
  const d = s.spread < 1 ? 1 : 0;
  return `±${s.spread.toFixed(d)}`;
}
