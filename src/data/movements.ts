/**
 * Reference movements: a starting set of common calibres with the specs a
 * timegrapher needs (beat rate, lift angle) and a few more. Each entry links
 * to where its figures come from. A lift angle is only given where a source
 * documents it; otherwise it's left empty rather than guessed, since a wrong
 * lift angle gives a wrong amplitude (about 6° of amplitude per degree).
 *
 * Facts only, gathered from public caliber listings (mainly Caliber Corner,
 * plus watchmaker forums for Omega). Ranfft DB is linked, never copied.
 */

import type { MovementType } from '../db';

export interface RefMovement {
  /** Stable id, also the URL slug. */
  id: string;
  caliber: string;
  maker: string;
  type: MovementType;
  /** Other names it goes by (branded versions, sub-variants). */
  aliases?: string[];
  /** Null for tuning-fork and quartz movements, or where the source doesn't know. */
  bph: number | null;
  /** Degrees; null where no source documents it. */
  liftAngle: number | null;
  jewels: number | null;
  diameterMm: number | null;
  heightMm: number | null;
  powerReserveH: number | null;
  /** What it's based on, or what it clones. */
  basedOn?: string;
  features?: string;
  /** Co-axial escapement: rate is fine, amplitude needs a co-axial-aware machine. */
  coAxial?: boolean;
  notes?: string;
  source: string;
  /** Extra facts for entries from Watch Movements Archive. */
  archive?: {
    years?: string;
    country?: string;
    escapement: 'lever' | 'cylinder' | 'pin' | 'fork' | '';
    lignes?: string;
    jewels?: string;
    bphUnsure?: boolean;
    hz?: string;
    identification?: string;
    /** The archive's caliber field ("8200"). */
    code?: string;
  };
}

const CC = 'https://calibercorner.com/';

export const REFERENCE_MOVEMENTS: RefMovement[] = [
  // ---- ETA ----
  { id: 'eta-2824-2', caliber: '2824-2', maker: 'ETA', type: 'automatic', aliases: ['2824'], bph: 28800, liftAngle: 50, jewels: 25, diameterMm: 25.6, heightMm: 4.6, powerReserveH: 38, features: 'Hours, minutes, seconds, date', notes: 'The Swiss workhorse; made in four grades.', source: `${CC}eta-caliber-2824-2/` },
  { id: 'eta-2804-2', caliber: '2804-2', maker: 'ETA', type: 'manual', aliases: ['2804'], bph: 28800, liftAngle: 50, jewels: 17, diameterMm: 25.6, heightMm: 3.35, powerReserveH: null, basedOn: 'Hand-wound sibling of the 2824-2', features: 'Hours, minutes, seconds, date', source: `${CC}eta-caliber-2824-2-vs-2804-2/` },
  { id: 'eta-2836-2', caliber: '2836-2', maker: 'ETA', type: 'automatic', aliases: ['2836'], bph: 28800, liftAngle: 50, jewels: null, diameterMm: 25.6, heightMm: 5.05, powerReserveH: 38, basedOn: '2824-2 with day and date', features: 'Day and date', notes: 'Specs as its Sellita clone, the SW220-1.', source: `${CC}sellita-caliber-sw220-1/` },
  { id: 'eta-2892-a2', caliber: '2892-A2', maker: 'ETA', type: 'automatic', aliases: ['2892', '2892a2', '2892-2'], bph: 28800, liftAngle: 51, jewels: 21, diameterMm: 25.6, heightMm: 3.6, powerReserveH: 42, features: 'Hours, minutes, seconds, quickset date; hacking', notes: 'The slim, higher-grade sibling of the 2824.', source: `${CC}eta-caliber-2892-a2/` },
  { id: 'eta-7750', caliber: '7750', maker: 'ETA / Valjoux', type: 'automatic', aliases: ['valjoux 7750', '7751', '7753', '7754', '7755'], bph: 28800, liftAngle: 49, jewels: 25, diameterMm: 30, heightMm: 7.9, powerReserveH: 48, basedOn: 'Valjoux 7733 (hand-wound)', features: 'Chronograph, day-date', notes: 'Early ones beat at 21,600 bph.', source: `${CC}eta-valjoux-caliber-7750/` },
  { id: 'unitas-6497-1', caliber: '6497-1', maker: 'ETA / Unitas', type: 'manual', aliases: ['6497', 'unitas 6497'], bph: 18000, liftAngle: 44, jewels: 17, diameterMm: 36.6, heightMm: 4.5, powerReserveH: 46, features: 'Hours, minutes, small seconds (pocket-watch size)', source: `${CC}unitas-caliber-6497/` },
  { id: 'unitas-6497-2', caliber: '6497-2', maker: 'ETA / Unitas', type: 'manual', bph: 21600, liftAngle: 44, jewels: 17, diameterMm: 36.6, heightMm: 4.5, powerReserveH: 53, features: 'Hours, minutes, small seconds', source: `${CC}unitas-caliber-6497/` },
  { id: 'unitas-6498-1', caliber: '6498-1', maker: 'ETA / Unitas', type: 'manual', aliases: ['6498', 'unitas 6498'], bph: 18000, liftAngle: 44, jewels: 17, diameterMm: 36.6, heightMm: 4.5, powerReserveH: 46, features: 'Hours, minutes, small seconds at 6', source: `${CC}eta-caliber-6498-1/` },
  { id: 'unitas-6498-2', caliber: '6498-2', maker: 'ETA / Unitas', type: 'manual', bph: 21600, liftAngle: 44, jewels: 17, diameterMm: 36.6, heightMm: 4.5, powerReserveH: 53, features: 'Hours, minutes, small seconds at 6', source: `${CC}eta-caliber-6498-2/` },
  { id: 'eta-c07-111', caliber: 'C07.111', maker: 'ETA', type: 'automatic', aliases: ['powermatic 80', 'powermatic 80.111', 'pm80', 'h-10', 'h10'], bph: 21600, liftAngle: null, jewels: null, diameterMm: 25.6, heightMm: null, powerReserveH: 80, basedOn: 'ETA 2824-2, slowed to 21,600 bph for an 80-hour reserve', notes: 'Tissot, Hamilton (H-10), Certina and Mido versions. Lift angle not published.', source: `${CC}tissot-caliber-powermatic-80/` },

  // ---- Sellita ----
  { id: 'sellita-sw200-1', caliber: 'SW200-1', maker: 'Sellita', type: 'automatic', aliases: ['sw200'], bph: 28800, liftAngle: 50, jewels: 26, diameterMm: 25.6, heightMm: 4.6, powerReserveH: 38, basedOn: 'Clone of the ETA 2824-2', source: `${CC}sellita-caliber-sw200-1/` },
  { id: 'sellita-sw220-1', caliber: 'SW220-1', maker: 'Sellita', type: 'automatic', aliases: ['sw220'], bph: 28800, liftAngle: 50, jewels: 26, diameterMm: 25.6, heightMm: 5.05, powerReserveH: 41, basedOn: 'Clone of the ETA 2836-2', features: 'Day and date', source: `${CC}sellita-caliber-sw220-1/` },
  { id: 'sellita-sw300-1', caliber: 'SW300-1', maker: 'Sellita', type: 'automatic', aliases: ['sw300'], bph: 28800, liftAngle: 51, jewels: 25, diameterMm: 25.6, heightMm: 3.6, powerReserveH: 42, basedOn: 'Clone of the ETA 2892-A2', source: `${CC}sellita-caliber-sw300-1/` },
  { id: 'sellita-sw400-1', caliber: 'SW400-1', maker: 'Sellita', type: 'automatic', aliases: ['sw400'], bph: 28800, liftAngle: 50, jewels: 26, diameterMm: 31, heightMm: 4.67, powerReserveH: 38, basedOn: 'A larger SW200-1', source: `${CC}sellita-caliber-sw400-1/` },
  { id: 'sellita-sw500', caliber: 'SW500', maker: 'Sellita', type: 'automatic', aliases: ['sw500-1', 'sw510'], bph: 28800, liftAngle: 50, jewels: 25, diameterMm: 30, heightMm: 7.9, powerReserveH: 48, basedOn: 'Clone of the ETA/Valjoux 7750', features: 'Chronograph', source: `${CC}sellita-caliber-sw500/` },

  // ---- Seiko ----
  { id: 'seiko-7s26', caliber: '7S26', maker: 'Seiko', type: 'automatic', aliases: ['7s26a', '7s26b', '7s26c', '7s36'], bph: 21600, liftAngle: 53, jewels: 21, diameterMm: 27.4, heightMm: 4.9, powerReserveH: 41, features: 'Day-date; no hacking, no hand-winding', notes: 'In the Seiko 5 and SKX divers; replaced by the 4R36.', source: `${CC}seiko-caliber-7s26/` },
  { id: 'seiko-nh35', caliber: 'NH35A', maker: 'Seiko (SII / TMI)', type: 'automatic', aliases: ['nh35', 'nh36', 'nh36a', 'nh34', 'nh38'], bph: 21600, liftAngle: 53, jewels: 24, diameterMm: 27.4, heightMm: 5.32, powerReserveH: 41, features: 'Date (NH36: day-date); hacking, hand-winding', notes: 'The supplier version of the 4R35; in countless microbrand watches. Spec −20 to +40 s/day.', source: `${CC}seiko-caliber-nh35a/` },
  { id: 'seiko-4r35', caliber: '4R35', maker: 'Seiko', type: 'automatic', aliases: ['4r35a', '4r35b', '4r36', '4r36a', '4r37', '4r38', '4r39'], bph: 21600, liftAngle: 53, jewels: 24, diameterMm: 27.4, heightMm: 5.32, powerReserveH: 40, features: 'Date (4R36: day-date); hacking, hand-winding', notes: 'Seiko gives 53° for the 4R35B and 52° for the older 4R35A.', source: `${CC}seiko-caliber-4r35/` },
  { id: 'seiko-6r15', caliber: '6R15', maker: 'Seiko', type: 'automatic', aliases: ['6r15a', '6r15b', '6r15c', '6r15d'], bph: 21600, liftAngle: 53, jewels: 23, diameterMm: 27.4, heightMm: 5.25, powerReserveH: 50, features: 'Date; hacking, hand-winding', notes: 'An upgraded 7S26, in Presage, Prospex and Alpinist models. 23 or 24 jewels by version.', source: `${CC}seiko-caliber-6r15/` },
  { id: 'seiko-6r35', caliber: '6R35', maker: 'Seiko', type: 'automatic', aliases: ['6r35a'], bph: 21600, liftAngle: 53, jewels: 24, diameterMm: 27.4, heightMm: 5.25, powerReserveH: 70, basedOn: '6R15 with a 70-hour reserve', source: `${CC}seiko-caliber-6r35/` },

  // ---- Miyota (Citizen) ----
  { id: 'miyota-8215', caliber: '8215', maker: 'Miyota (Citizen)', type: 'automatic', aliases: ['miyota 8215', '8217', '8218', '8219'], bph: 21600, liftAngle: 49, jewels: 21, diameterMm: 26, heightMm: 5.67, powerReserveH: 42, features: 'Date; hand-winding', notes: 'Introduced in 1977; the entry-level workhorse. Known for a stuttering seconds hand.', source: `${CC}miyota-caliber-8215/` },
  { id: 'miyota-821a', caliber: '821A', maker: 'Miyota (Citizen)', type: 'automatic', bph: 21600, liftAngle: 49, jewels: 21, diameterMm: 26, heightMm: 5.67, powerReserveH: 42, basedOn: 'Decorated 8215 with a skeleton rotor', source: `${CC}miyota-caliber-821a/` },
  { id: 'miyota-8205', caliber: '8205', maker: 'Miyota (Citizen)', type: 'automatic', bph: 21600, liftAngle: 49, jewels: 21, diameterMm: 26, heightMm: 5.67, powerReserveH: 42, basedOn: '8215 with day and date', source: `${CC}miyota-caliber-8205/` },
  { id: 'miyota-8245', caliber: '8245', maker: 'Miyota (Citizen)', type: 'automatic', aliases: ['8247'], bph: 21600, liftAngle: 49, jewels: 21, diameterMm: 26, heightMm: 5.67, powerReserveH: 40, basedOn: '8215 with small seconds', source: `${CC}miyota-caliber-8245/` },
  { id: 'miyota-9015', caliber: '9015', maker: 'Miyota (Citizen)', type: 'automatic', aliases: ['miyota 9015'], bph: 28800, liftAngle: 51, jewels: 24, diameterMm: 26, heightMm: 3.9, powerReserveH: 42, features: 'Date; hacking, hand-winding', notes: 'Introduced in 2009; Japan’s answer to the 2824. Spec −10 to +30 s/day.', source: `${CC}miyota-caliber-9015/` },
  { id: 'miyota-9039', caliber: '9039', maker: 'Miyota (Citizen)', type: 'automatic', bph: 28800, liftAngle: 51, jewels: 24, diameterMm: 26, heightMm: 3.9, powerReserveH: 42, basedOn: '9015 without date', source: `${CC}miyota-caliber-9039/` },

  // ---- Rolex ----
  { id: 'rolex-3135', caliber: '3135', maker: 'Rolex', type: 'automatic', aliases: ['3136', '3155', '3156'], bph: 28800, liftAngle: 52, jewels: 31, diameterMm: 28.5, heightMm: 6, powerReserveH: 48, features: 'Quickset date; hacking', notes: 'From 1988; Submariner, Datejust and more. COSC.', source: `${CC}rolex-caliber-3135/` },
  { id: 'rolex-3035', caliber: '3035', maker: 'Rolex', type: 'automatic', bph: 28800, liftAngle: null, jewels: 27, diameterMm: null, heightMm: null, powerReserveH: 42, notes: 'From 1977, a high-beat successor to the 1575; replaced by the 3135.', source: `${CC}rolex-caliber-3035-vs-3135/` },
  { id: 'rolex-3235', caliber: '3235', maker: 'Rolex', type: 'automatic', bph: 28800, liftAngle: null, jewels: 31, diameterMm: 28.5, heightMm: null, powerReserveH: 70, features: 'Chronergy escapement, Parachrom hairspring', source: `${CC}rolex-caliber-3235/` },
  { id: 'rolex-3185', caliber: '3185', maker: 'Rolex', type: 'automatic', aliases: ['3186'], bph: 28800, liftAngle: null, jewels: 31, diameterMm: 28.5, heightMm: 6.45, powerReserveH: null, basedOn: '3135 with a GMT hand', source: `${CC}rolex-caliber-3185/` },

  // ---- Omega ----
  { id: 'omega-8500', caliber: '8500', maker: 'Omega', type: 'automatic', aliases: ['8501', '8900', '8800', '8912'], bph: 25200, liftAngle: 38, jewels: null, diameterMm: null, heightMm: null, powerReserveH: null, coAxial: true, notes: 'Co-Axial: 38° for most of the 8000 family (36° for the 8806/8807). Rate and beat error read normally; amplitude needs a timing machine with a co-axial mode, so treat it as rough here.', source: 'https://omegaforums.net/threads/lift-angles-for-new-coaxial-calibres.98306/' },
  { id: 'omega-1120', caliber: '1120', maker: 'Omega', type: 'automatic', bph: 28800, liftAngle: 51, jewels: null, diameterMm: 25.6, heightMm: null, powerReserveH: null, basedOn: 'ETA 2892', notes: 'Seamaster and Speedmaster Reduced era. The co-axial 2500 on the same base is 38°.', source: 'https://omegaforums.net/threads/timing-machine.11260/' },
  { id: 'omega-1164', caliber: '1164', maker: 'Omega', type: 'automatic', bph: 28800, liftAngle: 50, jewels: 25, diameterMm: 30, heightMm: 7.9, powerReserveH: 44, basedOn: 'ETA/Valjoux 7750', features: 'Chronograph; COSC', source: `${CC}omega-caliber-1164/` },
  { id: 'omega-1861', caliber: '1861', maker: 'Omega', type: 'manual', aliases: ['1863', '861', '863'], bph: 21600, liftAngle: null, jewels: null, diameterMm: 27, heightMm: null, powerReserveH: 42, basedOn: 'Lemania 1873', features: 'Chronograph (Speedmaster Professional)', notes: 'Cam-switched chronograph; replaced by the co-axial 3861.', source: `${CC}omega-caliber-1863/` },
  { id: 'omega-3861', caliber: '3861', maker: 'Omega', type: 'manual', bph: 21600, liftAngle: null, jewels: 26, diameterMm: 27, heightMm: null, powerReserveH: 50, coAxial: true, basedOn: 'Lemania 1873 lineage', features: 'Chronograph; Master Chronometer', notes: 'Co-Axial: amplitude needs a co-axial-aware machine.', source: `${CC}omega-caliber-3861/` },
  { id: 'omega-321', caliber: '321', maker: 'Omega', type: 'manual', aliases: ['lemania 2310', '2310'], bph: 18000, liftAngle: null, jewels: null, diameterMm: null, heightMm: null, powerReserveH: 40, basedOn: 'Lemania 2310', features: 'Column-wheel chronograph', notes: 'The movement in the Speedmasters that went to the Moon.', source: `${CC}omega-caliber-1863/` },

  // ---- Branded versions of common calibres ----
  { id: 'tag-calibre-16', caliber: 'Calibre 16', maker: 'TAG Heuer', type: 'automatic', aliases: ['cal 16', 'caliber 16'], bph: 28800, liftAngle: 49, jewels: 25, diameterMm: 30, heightMm: 7.9, powerReserveH: 48, basedOn: 'ETA/Valjoux 7750 or Sellita SW500', features: 'Chronograph', source: `${CC}tag-heuer-caliber-16/` },
  { id: 'tag-calibre-7', caliber: 'Calibre 7', maker: 'TAG Heuer', type: 'automatic', aliases: ['cal 7', 'caliber 7'], bph: 28800, liftAngle: 51, jewels: null, diameterMm: 26.2, heightMm: null, powerReserveH: 42, basedOn: 'ETA 2892-A2 or Sellita SW300-1', source: `${CC}tag-heuer-caliber-7/` },
];

const MAKER_WORDS = /\b(cal(iber|ibre)?|eta|valjoux|unitas|sellita|seiko|sii|tmi|miyota|citizen|rolex|omega|tissot|hamilton|tag|heuer|lemania|no\.?)\b/g;

/** Match key: lower case, maker names and punctuation dropped. */
export function refKey(s: string): string {
  return s.toLowerCase().replace(MAKER_WORDS, ' ').replace(/[^a-z0-9]/g, '');
}

const INDEX = new Map<string, RefMovement>();
for (const m of REFERENCE_MOVEMENTS) {
  for (const name of [m.caliber, m.id, ...(m.aliases ?? [])]) {
    const k = refKey(name);
    if (k && !INDEX.has(k)) INDEX.set(k, m);
  }
}

/**
 * The reference entry for a calibre as a person might type it ("ETA 2824",
 * "Cal. 7S26", "NH35A"). Exact names and aliases first, then a unique prefix
 * ("2892" → 2892-A2).
 */
export function findReference(caliber: string): RefMovement | null {
  const k = refKey(caliber);
  if (k.length < 3) return null;
  const exact = INDEX.get(k);
  if (exact) return exact;
  const hits = new Set<RefMovement>();
  for (const [key, m] of INDEX) if (key.startsWith(k) && k.length >= 4) hits.add(m);
  return hits.size === 1 ? [...hits][0] : null;
}

export const referenceById = (id: string): RefMovement | undefined => REFERENCE_MOVEMENTS.find((m) => m.id === id);

// ---------------------------------------------------------------------------
// Watch Movements Archive (watch-movements-archive.com), from the UHRFORUM.de
// community, used with the site admin's permission. Facts only, each entry
// linked to its archive page. Thousands of
// entries, so it's loaded on demand.

import type { ArchiveRec } from './archive-types';

export const ARCHIVE_URL = 'https://watch-movements-archive.com/';
export const archivePageUrl = (slug: string) => `${ARCHIVE_URL}watch-movement/${slug}/`;
const ARCHIVE_PREFIX = 'wma-';

const SECONDS = { s: 'small seconds', c: 'centre seconds', j: 'jumping centre seconds' } as const;

export function fromArchive(r: ArchiveRec): RefMovement {
  const single = r.j && /^\d+$/.test(r.j) ? Number(r.j) : null;
  const features = [r.sec && SECONDS[r.sec], r.dt && r.dt !== 'None' ? r.dt.toLowerCase() : '', r.f?.toLowerCase()].filter(Boolean).join(', ');
  return {
    id: ARCHIVE_PREFIX + r.s,
    caliber: r.n,
    maker: r.m,
    type: r.t,
    bph: r.b,
    liftAngle: null,
    jewels: single,
    diameterMm: r.mm ?? null,
    heightMm: null,
    powerReserveH: r.pr ?? null,
    features: features ? features[0].toUpperCase() + features.slice(1) : undefined,
    aliases: r.n.includes('=') ? r.n.split(/\s*=\s*/).slice(1) : undefined,
    source: archivePageUrl(r.s),
    archive: {
      years: r.y,
      country: r.co,
      escapement: r.e,
      lignes: r.l,
      jewels: r.j,
      bphUnsure: !!r.bq,
      hz: r.hz,
      identification: r.id,
      code: r.c && !r.c.includes('=') ? r.c : undefined,
    },
  };
}

let archive: RefMovement[] | null = null;
let loading: Promise<RefMovement[]> | null = null;
let fullIndex = new Map<string, RefMovement[]>();
let caliberIndex = new Map<string, RefMovement[]>();

/** Match key that keeps maker names: "Citizen 8200" → "citizen8200". */
const fullKey = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
const push = (map: Map<string, RefMovement[]>, k: string, m: RefMovement) => {
  if (k.length < 2) return;
  const list = map.get(k);
  if (!list) map.set(k, [m]);
  else if (!list.includes(m)) list.push(m);
};

/** For tests and the importer: index a given set of records. */
export function setArchive(recs: ArchiveRec[]): RefMovement[] {
  archive = recs.map(fromArchive);
  fullIndex = new Map();
  caliberIndex = new Map();
  recs.forEach((r, i) => {
    const m = archive![i];
    // Every name in the title: "Bulova 11DO = Caravelle 11DO = Citizen 0240", "SII NH35A / TMI NH35A".
    for (const seg of r.n.split(/\s*[=\/]\s*/)) if (/\d/.test(seg)) push(fullIndex, fullKey(seg), m);
    push(fullIndex, fullKey(r.n), m);
    if (r.c && !r.c.includes('=')) {
      push(caliberIndex, fullKey(r.c), m);
      for (const maker of r.m.split(/\s*\/\s*/)) push(fullIndex, fullKey(maker + r.c), m);
    }
  });
  return archive;
}

/** Load the archive (once). */
export function loadArchive(): Promise<RefMovement[]> {
  if (archive) return Promise.resolve(archive);
  loading ??= import('./archive.json').then((mod) => setArchive((mod.default ?? mod) as ArchiveRec[]));
  return loading;
}

export const archiveLoaded = () => archive;

function findInArchive(caliber: string, brand = ''): RefMovement | null {
  if (!archive) return null;
  const k = fullKey(caliber);
  if (k.length < 2) return null;
  const pick = (list: RefMovement[] | undefined) => {
    if (!list?.length) return null;
    if (list.length === 1) return list[0];
    const b = fullKey(brand);
    const byBrand = b ? list.filter((m) => fullKey(m.maker).includes(b) || fullKey(m.caliber).startsWith(b)) : [];
    return byBrand.length === 1 ? byBrand[0] : null;
  };
  return (
    pick(fullIndex.get(k)) ??
    (brand ? pick(fullIndex.get(fullKey(brand) + k)) : null) ??
    // A bare caliber number ("8200") only if it's unambiguous, or the brand settles it.
    (/\d/.test(k) && k.length >= 3 ? pick(caliberIndex.get(k)) : null)
  );
}

/**
 * The best reference for a caliber: the sourced library first, then the
 * archive if it's loaded. Pass the watch's brand to settle bare numbers.
 */
export function findMovement(caliber: string, brand = ''): RefMovement | null {
  return findReference(caliber) ?? findInArchive(caliber, brand);
}

/** As findMovement, loading the archive first if needed. */
export async function findMovementAsync(caliber: string, brand = ''): Promise<RefMovement | null> {
  const ref = findReference(caliber);
  if (ref) return ref;
  await loadArchive();
  return findInArchive(caliber, brand);
}

export async function referenceByIdAsync(id: string): Promise<RefMovement | undefined> {
  if (!id.startsWith(ARCHIVE_PREFIX)) return referenceById(id);
  return (await loadArchive()).find((m) => m.id === id);
}

/** Display name: archive titles already include the maker. */
export const refName = (m: RefMovement) => (m.archive ? m.caliber : `${m.maker} ${m.caliber}`);

/** Notes on what a timegrapher can and can't read for this escapement. */
export function escapementNote(m: RefMovement): string {
  switch (m.archive?.escapement) {
    case 'fork':
      return 'Tuning-fork movement: it hums rather than ticks, so a timegrapher can’t read it. Use time checks.';
    case 'cylinder':
      return 'Cylinder escapement: rate reads normally, but amplitude and beat error don’t mean the same as on a lever escapement.';
    case 'pin':
      return 'Pin-lever escapement: rate and beat error read normally; amplitude is rough, since pin-lever ticks are less crisp.';
    default:
      return m.type === 'quartz' ? 'Quartz: a timegrapher can’t read it. Use time checks.' : '';
  }
}


// ---------------------------------------------------------------------------
// Finding a watch's movement from what we know about it.

/** Brands whose own movements go by another maker name too. */
const BRAND_MAKERS: Record<string, string[]> = {
  citizen: ['citizen', 'miyota'],
  miyota: ['citizen', 'miyota'],
  seiko: ['seiko', 'sii', 'tmi'],
};

export interface FinderInput {
  brand: string;
  type?: string;
  bph?: number | null;
}

/**
 * Movements that could be in a watch: same winding type and beat rate.
 * `byBrand` are the ones from the watch's own maker (Citizen → Citizen and
 * Miyota); `others` the rest, for brands that fitted other makers' movements.
 */
export function movementCandidates(w: FinderInput, all: RefMovement[]): { byBrand: RefMovement[]; others: RefMovement[] } {
  const b = fullKey(w.brand);
  const makers = BRAND_MAKERS[b] ?? (b ? [b] : []);
  const fits = (m: RefMovement) =>
    m.type !== 'quartz' && (!w.type || (w.type !== 'automatic' && w.type !== 'manual') || m.type === w.type) && (!w.bph || m.bph === w.bph);
  const byBrand: RefMovement[] = [];
  const others: RefMovement[] = [];
  for (const m of all) {
    if (!fits(m)) continue;
    // An archive entry for a caliber the sourced library already has (it has the lift angle).
    if (m.archive && findReference(m.caliber)) continue;
    const mk = fullKey(m.maker);
    (makers.some((x) => mk.includes(x)) ? byBrand : others).push(m);
  }
  return { byBrand, others };
}

/** The caliber to store on a watch for a chosen movement: short where it still matches. */
export function caliberFor(m: RefMovement, brand: string): string {
  const short = m.archive ? m.archive.code : m.caliber;
  if (short && findMovement(short, brand)?.id === m.id) return short;
  return m.caliber;
}
