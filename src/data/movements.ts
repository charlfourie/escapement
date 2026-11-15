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
  bph: number;
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
  { id: 'citizen-8200', caliber: '8200', maker: 'Citizen', type: 'automatic', aliases: ['8200a', 'citizen 8200'], bph: 21600, liftAngle: null, jewels: 21, diameterMm: null, heightMm: null, powerReserveH: null, notes: 'Vintage Citizen automatic, from the same family as the Miyota 8215 (which is 49°). No published lift angle of its own.', source: 'https://watchrepairtalk.com/topic/20273-citizenmiyota-8200-lift-angle' },

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
