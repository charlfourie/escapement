import { describe, expect, it } from 'vitest';
import { hackingFor, patinaLevel, productionYear, watchOffset } from '../src/data/face-time';
import { findReference, type RefMovement } from '../src/data/movements';
import type { Measurement, QuartzTest, TimeCheck } from '../src/db';

const DAY = 86_400_000;
const arc = (years?: string): RefMovement => ({ id: 'wma-x', caliber: 'AS 1726', maker: 'AS', type: 'manual', bph: 21600, liftAngle: null, jewels: 17, diameterMm: null, heightMm: null, powerReserveH: null, source: 'x', archive: { escapement: 'lever', years } });

describe('dial age', () => {
  it('reads the production year', () => {
    expect(productionYear(arc('c. 1969'))).toBe(1969);
    expect(productionYear(arc('1974+'))).toBe(1974);
    expect(productionYear(arc('From 1960'))).toBe(1960);
    expect(productionYear(arc('1963 - 1977'))).toBe(1963);
    expect(productionYear(arc())).toBeNull();
    expect(productionYear(findReference('ETA 2824'))).toBeNull();
  });
  it('ages with the years, unless chosen', () => {
    expect(patinaLevel('auto', 2010, 2026)).toBe('none');
    expect(patinaLevel('auto', 1974, 2026)).toBe('light');
    expect(patinaLevel('auto', 1928, 2026)).toBe('heavy');
    expect(patinaLevel('auto', null, 2026)).toBe('none');
    expect(patinaLevel('heavy', 2020, 2026)).toBe('heavy');
    expect(patinaLevel('none', 1928, 2026)).toBe('none');
  });
});

describe('hacking', () => {
  it('uses what is known about the movement', () => {
    expect(hackingFor({ movementType: 'automatic' }, findReference('7S26'))).toMatchObject({ hacks: false, known: true });
    expect(hackingFor({ movementType: 'automatic' }, findReference('NH35A'))).toMatchObject({ hacks: true, known: true });
    expect(hackingFor({ movementType: 'quartz' }, null)).toMatchObject({ hacks: true, known: true });
  });
  it('says when it is assuming', () => {
    const old = hackingFor({ movementType: 'manual' }, arc('c. 1955'));
    expect(old).toMatchObject({ hacks: false, known: false });
    expect(old.why).toMatch(/1950s/);
    expect(hackingFor({ movementType: 'automatic' }, null)).toMatchObject({ hacks: true, known: false });
  });
});

describe('watch time', () => {
  const now = Date.UTC(2026, 10, 15, 12);
  const tc = (daysAgo: number, offset: number, reset = false): TimeCheck => ({ id: `c${daysAgo}`, watchId: 'w', at: now - daysAgo * DAY, offset, reset, source: 'internet', notes: '', updatedAt: now });

  it('needs a time check', () => {
    expect(watchOffset([], [], [])).toBeNull();
  });
  it('extrapolates the checks since the watch was set', () => {
    const o = watchOffset([tc(40, 30, true), tc(30, 99), tc(20, 0, true), tc(10, 70), tc(0, 140)], [], [])!;
    expect(o.basis).toBe('checks');
    expect(o.checks).toBe(3);
    expect(o.perDay).toBeCloseTo(7, 5);
    expect(o.at(now + 2 * DAY)).toBeCloseTo(154, 5);
    expect(o.since).toBe(now - 20 * DAY);
  });
  it('falls back to the quartz test, then the timegrapher', () => {
    const q = { at: now - DAY, perMonth: 15.22 } as QuartzTest;
    expect(watchOffset([tc(10, 0, true)], [q], [])!.at(now)).toBeCloseTo(5, 1);
    const ms = [5, 7, 9].map((rate, i) => ({ takenAt: now - i * DAY, rate }) as Measurement);
    const o = watchOffset([tc(3, 1, true)], [], ms)!;
    expect(o.basis).toBe('timegrapher');
    expect(o.at(now)).toBeCloseTo(1 + 7 * 3, 5);
  });
  it('needs a rate when there is only one check', () => {
    expect(watchOffset([tc(3, 0, true)], [], [])).toBeNull();
  });
});
