import { describe, expect, it } from 'vitest';
import { convert } from '../scripts/import-archive';
import { findMovement, setArchive } from '../src/data/movements';
import type { ArchiveRec } from '../src/data/archive-types';

const raw = (title: string, f: Record<string, string>, slug = title.toLowerCase().replace(/\W+/g, '-')) => ({ slug, title, fields: f });

describe('archive importer', () => {
  it('keeps the facts and normalises them', () => {
    const r = convert(
      raw('Citizen / Miyota 8200', {
        'Manufacturer / Brand': 'Citizen / Miyota', Caliber: '8200', 'Size in French Lignes': "11 1/2'''", Winding: 'Automatic',
        Escapement: 'Lever (Swiss, English, Glashütte)', Jewels: '21', 'Beats per hour': '21,600', 'Power Reserve': 'Approx. 43 hours',
        'Production Period': '1974+', Country: 'Japan', 'Seconds Hand': 'Sweeping seconds (central seconds)', 'Date, Day, Month...': 'Date & Day',
        Identification: 'Rotor marked with CITIZEN 8200.', 'Contributor ©': 'Uhrforum.de member Badener (Andreas Kelz)',
      }),
    )!;
    expect(r).toMatchObject({ m: 'Citizen / Miyota', c: '8200', t: 'automatic', b: 21600, e: 'lever', j: '21', pr: 43, mm: 25.9, y: '1974+', co: 'Japan', sec: 'c', by: 'Badener (Andreas Kelz)' });
    expect(r.bq).toBeUndefined();
  });

  it('flags guesses and handles odd movements', () => {
    expect(convert(raw('AS 1', { 'Beats per hour': 'Unknown, probably 18,000' }))).toMatchObject({ b: 18000, bq: 1 });
    expect(convert(raw('Bulova 214', { 'Beats per hour': '360 Hz (not bph!)', Escapement: 'Tuning fork', Winding: 'Battery' }))).toMatchObject({ b: null, hz: '360 Hz', t: 'quartz', e: 'fork' });
    expect(convert(raw('AS 2', { 'Production Period': 'Unknown, probably around 1928' }))!.y).toBe('c. 1928');
    expect(convert(raw('AS 4', { 'Production Period': 'Unknown. Perhaps around 1920, certainly before 1936, because of old AS logo' }))!.y).toBe('c. 1920');
    expect(convert(raw('AM 154', { 'Production Period': 'Approx. 30 hours' }))!.y).toBeUndefined();
    expect(convert(raw('AS 5', { 'Contributor ©': 'Uhrforum Member Schnupperfuss + Badener (Andreas Kelz)' }))!.by).toBe('Schnupperfuss and Badener (Andreas Kelz)');
    expect(convert(raw('Omega 39.5', { 'Size in French Lignes': "39,5 mm (17 1/2''')" }))!.mm).toBe(39.5);
    expect(convert(raw('Felsa 1560', { 'Size in French Lignes': '1560' }))!.mm).toBeUndefined();
    expect(convert(raw('AS 6', { 'Production Period': 'Presumably around 1928 (see remarks)' }))!.y).toBe('c. 1928');
    expect(convert(raw('AS 3', { 'Size in French Lignes': "6 3/4 x 8'''" }))!.mm).toBe(18);
  });
});

describe('archive lookup', () => {
  const rec = (s: string, n: string, m: string, c: string): ArchiveRec => ({ s, n, m, c, t: 'manual', b: 18000, e: 'lever', by: 'x' });
  setArchive([
    rec('citizen-miyota-8200', 'Citizen / Miyota 8200', 'Citizen / Miyota', '8200'),
    rec('bulova-11do', 'Bulova 11DO = Caravelle 11DO = Citizen 0240', 'Bulova / Caravelle / Citizen', 'Bulova 11DO = Caravelle 11DO = Citizen 0240'),
    rec('as-40', 'AS 40', 'AS', '40'),
    rec('am-40', 'AM 40', 'AM', '40'),
    rec('unitas-6497', 'Unitas 6497', 'Unitas', '6497'),
  ]);
  const id = (c: string, b = '') => findMovement(c, b)?.id;

  it('matches maker + caliber however typed', () => {
    expect(id('Citizen 8200')).toBe('wma-citizen-miyota-8200');
    expect(id('Miyota 8200')).toBe('wma-citizen-miyota-8200');
    expect(id('8200')).toBe('wma-citizen-miyota-8200');
    expect(id('Caravelle 11DO')).toBe('wma-bulova-11do');
    expect(id('Citizen 0240')).toBe('wma-bulova-11do');
  });

  it('uses the brand for shared numbers, and does not guess', () => {
    expect(id('40')).toBeUndefined();
    expect(id('40', 'AS')).toBe('wma-as-40');
    expect(id('Citizen Automatic')).toBeUndefined();
  });

  it('prefers the sourced library', () => {
    expect(id('6497')).toBe('unitas-6497-1');
    expect(findMovement('ETA 2824')?.liftAngle).toBe(50);
  });
});
