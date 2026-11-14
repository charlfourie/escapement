import { describe, expect, it } from 'vitest';
import { driftGrade, driftOf } from '../src/views/time-check';
import type { TimeCheck } from '../src/db';

const DAY = 86_400_000;
const check = (day: number, offset: number, reset = false): TimeCheck => ({ id: `${day}`, watchId: 'w', at: day * DAY, offset, reset, source: 'internet', notes: '', updatedAt: 0 });

describe('time-check drift', () => {
  it('needs two checks', () => {
    expect(driftOf([check(0, 0)])).toBeNull();
  });

  it('fits a quartz watch gaining half a second a day', () => {
    const d = driftOf([check(0, 0, true), check(10, 5.1), check(20, 9.9), check(30, 15.0)])!;
    expect(d.perDay).toBeCloseTo(0.5, 1);
    expect(d.perMonth).toBeCloseTo(15.2, 0);
    expect(d.checks).toBe(4);
    expect(driftGrade(d, true)).toBe('ok');
  });

  it('only uses checks since the watch was last set', () => {
    const d = driftOf([check(0, 0, true), check(5, -30), check(6, 0.2, true), check(16, -1.0)])!;
    expect(d.checks).toBe(2);
    expect(d.perDay).toBeCloseTo(-0.12, 2);
    expect(driftGrade(d, true)).toBe('good');
  });

  it('grades mechanical drift per day', () => {
    const d = driftOf([check(0, 0, true), check(3, 30)])!;
    expect(d.perDay).toBeCloseTo(10, 5);
    expect(driftGrade(d, false)).toBe('ok');
  });
});
