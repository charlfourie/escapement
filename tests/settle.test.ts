import { describe, expect, it } from 'vitest';
import { Settler, plusMinus } from '../src/analysis/settle';

let s = 11;
const noise = (amp: number) => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * amp;

describe('settled readouts', () => {
  it('holds steady on a noisy reading and says how noisy', () => {
    const st = new Settler();
    const shown = new Set<number>();
    for (let i = 0; i < 80; i++) {
      st.push(30 + noise(2.5));
      if (i > 20) shown.add(st.get()!.value);
    }
    const g = st.get()!;
    expect(g.settled).toBe(true);
    expect(Math.abs(g.value - 30)).toBeLessThan(1);
    expect(g.decimals).toBe(0);
    expect(plusMinus(g, 0.75)).toMatch(/^±[12]$/);
    // It shouldn't flicker through many values
    expect(shown.size).toBeLessThan(8);
  });

  it('shows tenths when the signal is clean', () => {
    const st = new Settler();
    for (let i = 0; i < 30; i++) st.push(4.2 + noise(0.15));
    const g = st.get()!;
    expect(g.decimals).toBe(1);
    expect(g.value).toBeCloseTo(4.2, 0);
    expect(plusMinus(g, 0.75)).toBe('');
  });

  it('follows a genuine change quickly instead of averaging it away', () => {
    const st = new Settler();
    for (let i = 0; i < 30; i++) st.push(30 + noise(1));
    let after = -1;
    for (let i = 0; i < 20; i++) {
      st.push(9 + noise(1));
      if (Math.abs(st.get()!.value - 9) < 2 && after < 0) after = i;
    }
    expect(after).toBeGreaterThanOrEqual(0);
    expect(after).toBeLessThanOrEqual(8); // about 2 s at 4 updates a second
  });

  it('is not settled at first', () => {
    const st = new Settler();
    st.push(10);
    st.push(11);
    expect(st.get()!.settled).toBe(false);
  });
});
