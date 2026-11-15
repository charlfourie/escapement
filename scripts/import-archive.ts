/**
 * Import movement facts from Watch Movements Archive
 * (https://watch-movements-archive.com, a database from the UHRFORUM.de
 * community), used with the site admin's permission. Only the facts
 * Escapement needs are kept: no photos, no descriptions. Every entry keeps
 * its contributor credit and a link back to its archive page.
 *
 * Input: the JSON written by the crawler's parse.py (title, fields, slug).
 * Output: src/data/archive.json
 *
 *   npx tsx scripts/import-archive.ts path/to/movements.json
 */

import { readFileSync, writeFileSync } from 'node:fs';

interface Raw {
  slug: string;
  title: string;
  fields: Record<string, string>;
}

import type { ArchiveRec } from '../src/data/archive-types';

const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const unknown = (s: string) => !s || /^unknown$/i.test(s) || s === 'None';

function bph(v: string): Pick<ArchiveRec, 'b' | 'bq' | 'hz'> {
  if (/hz/i.test(v)) return { b: null, hz: v.replace(/\s*\(not bph!?\)/i, '').trim() };
  const nums = [...v.matchAll(/(\d{1,2}),?(\d{3})/g)].map((m) => Number(m[1] + m[2])).filter((n) => n >= 3600 && n <= 72000);
  if (!nums.length) return { b: null };
  const unsure = nums.length > 1 || /\?|probably|unknown|or /i.test(v);
  return unsure ? { b: nums[0], bq: 1 } : { b: nums[0] };
}

/** Largest dimension in mm: "11 1/2'''" → 25.9, "6 3/4 x 8'''" → 18, "39,5 mm (17 1/2''')" → 39.5. */
function sizeMm(v: string): number | null {
  const mm = v.match(/^\s*(\d+(?:[.,]\d+)?)\s*mm/i);
  if (mm) return Number(mm[1].replace(',', '.'));
  const t = v.replace(/’’’|”’|‴/g, "'''");
  const head = t.split("'''")[0];
  if (head === t) return null; // no lignes mark: not a lignes size
  const expr = head.split(/[(,;=]/).pop()!;
  const vals = expr.split(/x|×/i).map((p) => {
    const m = p.trim().match(/^(\d+)?\s*(?:(\d+)\/(\d+))?$/);
    if (!m || (!m[1] && !m[2])) return NaN;
    return Number(m[1] ?? 0) + (m[2] ? Number(m[2]) / Number(m[3]) : 0);
  });
  const ok = vals.filter((x) => Number.isFinite(x) && x >= 2 && x <= 30);
  return ok.length ? Math.round(Math.max(...ok) * 2.2558 * 10) / 10 : null;
}

function years(v: string): string | undefined {
  if (unknown(v)) return undefined;
  v = v.replace(/\s*\((?:see [^)]*|[A-Z][^)]*\d[^)]*)\)/gi, '');
  const around = v.match(/^(?:unknown[,.]\s*)?(?:probably|perhaps|possibly|presumably|maybe) (?:around |from approx\. |approx\. )?(.+)$/i);
  let y = around ? `c. ${around[1]}` : v.replace(/^unknown,\s*/i, '').replace(/^approx\.\s*/i, 'c. ');
  // Long notes ("Perhaps around 1920, certainly before 1936, because…") → the first year.
  if (y.length > 24) {
    const m = y.match(/\b(1[6-9]\d\d|20[0-2]\d)\b(\+|s)?/);
    y = m ? `c. ${m[1]}${m[2] ?? ''}` : '';
  }
  return /\d{4}/.test(y) ? y : undefined;
}

/** "Uhrforum.de members buchenhain and Badener (Andreas Kelz)" → "buchenhain and Badener (Andreas Kelz)". */
function contributor(v: string): string {
  const names = v
    .replace(/uhrforum(?:\.de)?\s+members?\s+/gi, '')
    .split(/\s+(?:and|\+|&)\s+|,\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
  return names.length ? names.join(' and ') : 'Anonymous';
}

export function convert(r: Raw): ArchiveRec | null {
  const f = Object.fromEntries(Object.entries(r.fields).map(([k, v]) => [k, clean(v)]));
  const title = clean(r.title);
  if (!title) return null;
  const winding = f['Winding'] ?? '';
  const esc = f['Escapement'] ?? '';
  const rec: ArchiveRec = {
    s: r.slug,
    n: title,
    m: f['Manufacturer / Brand'] ?? '',
    c: f['Caliber'] ?? '',
    t: /battery/i.test(winding) || /tuning/i.test(esc) ? 'quartz' : /automatic/i.test(winding) ? 'automatic' : 'manual',
    ...bph(f['Beats per hour'] ?? ''),
    e: /tuning/i.test(esc) ? 'fork' : /pin/i.test(esc) ? 'pin' : /cylinder/i.test(esc) ? 'cylinder' : /lever/i.test(esc) ? 'lever' : '',
    by: contributor(f['Contributor ©'] ?? ''),
  };
  const j = f['Jewels'];
  if (j && !unknown(j)) rec.j = j;
  const pr = (f['Power Reserve'] ?? '').match(/(\d+)\s*h/i);
  if (pr) rec.pr = Number(pr[1]);
  const l = f['Size in French Lignes'];
  if (l && !unknown(l)) {
    rec.l = l.replace(/'''|’’’|”’/g, '‴');
    const n = sizeMm(l);
    if (n) rec.mm = n;
  }
  const y = years(f['Production Period'] ?? '');
  if (y) rec.y = y;
  if (f['Country']) rec.co = f['Country'].replace(/U\. S\. A\./g, 'USA');
  const sec = f['Seconds Hand'] ?? '';
  if (/small/i.test(sec)) rec.sec = 's';
  else if (/jumping/i.test(sec)) rec.sec = 'j';
  else if (/central|sweep/i.test(sec)) rec.sec = 'c';
  const dt = f['Date, Day, Month...'];
  if (dt && !unknown(dt)) rec.dt = dt;
  if (f['Other Functions']) rec.f = f['Other Functions'];
  const id = f['Identification'];
  if (id && !unknown(id) && id !== '-') rec.id = id.length > 240 ? `${id.slice(0, 237)}…` : id;
  return rec;
}

if (process.argv[2]) {
  const raw: Raw[] = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const out = raw.map(convert).filter((r): r is ArchiveRec => !!r);
  out.sort((a, b) => a.n.localeCompare(b.n, 'en', { numeric: true }));
  writeFileSync('src/data/archive.json', JSON.stringify(out));
  const withBph = out.filter((r) => r.b).length;
  console.log(`${out.length} movements, ${withBph} with a beat rate → src/data/archive.json`);
}
