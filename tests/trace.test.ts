import { describe, expect, it } from 'vitest';
import { analyze } from '../src/analysis/analyze';

// A watch gaining 9 s/day with 2 ms beat error and a little timing noise, like the real Citizen.
function ticks(n: number, start = 0) {
  const P = 3600 / 21600;
  const k = 1 - 9 / 86400;
  let s = 3;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.0002;
  return Array.from({ length: n }, (_, i) => 5 + (start + i) * P * k + (i % 2 ? 0.002 : 0) + rnd());
}

describe('trace', () => {
  it('keeps the dots it has drawn in place as the reading goes on', () => {
    const all = ticks(600);
    const early = analyze(all.slice(0, 200), { bph: 21600 })!;
    const later = analyze(all, { bph: 21600 })!;
    for (let i = 0; i < 150; i++) expect(Math.abs(later.points[i].dev - early.points[i].dev)).toBeLessThan(0.05);
  });

  it('keeps tic and toc on their own lines whichever tick it starts from', () => {
    const all = ticks(400);
    for (const skip of [0, 1, 2, 3]) {
      const a = analyze(all.slice(skip), { bph: 21600 })!;
      const late = a.points.filter((p) => p.odd).map((p) => p.dev);
      const early = a.points.filter((p) => !p.odd).map((p) => p.dev);
      const mean = (xs: number[]) => xs.reduce((x, y) => x + y, 0) / xs.length;
      // "toc" is always the later tick: about 2 ms later than "tic"
      expect(mean(late) - mean(early)).toBeGreaterThan(1.5);
    }
  });
});
