import { describe, expect, it } from 'vitest';
import { findReference, REFERENCE_MOVEMENTS } from '../src/data/movements';

describe('reference movements', () => {
  it('finds calibres however they are typed', () => {
    expect(findReference('ETA 2824-2')?.id).toBe('eta-2824-2');
    expect(findReference('2824')?.id).toBe('eta-2824-2');
    expect(findReference('Cal. 7S26')?.id).toBe('seiko-7s26');
    expect(findReference('NH35A')?.id).toBe('seiko-nh35');
    expect(findReference('Seiko NH36')?.id).toBe('seiko-nh35');
    expect(findReference('Valjoux 7750')?.id).toBe('eta-7750');
    expect(findReference('sw 200-1')?.id).toBe('sellita-sw200-1');
    expect(findReference('2892')?.id).toBe('eta-2892-a2');
    expect(findReference('Powermatic 80')?.id).toBe('eta-c07-111');
    expect(findReference('Miyota 8215')?.id).toBe('miyota-8215');
  });

  it('does not guess', () => {
    expect(findReference('Citizen Automatic')).toBeNull();
    expect(findReference('Manual-Wind')).toBeNull();
    expect(findReference('28')).toBeNull();
    expect(findReference('E670')).toBeNull();
  });

  it('has sane, sourced data', () => {
    const ids = new Set<string>();
    for (const m of REFERENCE_MOVEMENTS) {
      expect(ids.has(m.id)).toBe(false);
      ids.add(m.id);
      expect([18000, 19800, 21600, 25200, 28800, 36000]).toContain(m.bph);
      if (m.liftAngle !== null) expect(m.liftAngle).toBeGreaterThanOrEqual(36);
      if (m.liftAngle !== null) expect(m.liftAngle).toBeLessThanOrEqual(56);
      expect(m.source).toMatch(/^https:\/\//);
    }
    expect(REFERENCE_MOVEMENTS.length).toBeGreaterThan(30);
  });
});
