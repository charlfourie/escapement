import type { Watch } from '../db';
import { svg } from '../util/dom';
import { liveFace, reducedMotion } from '../ui/ticker';

/**
 * The drawn watch face: what may be the most over-engineered image
 * placeholder ever. By default it follows the watch: the movement type sets
 * the dial furniture (rotor, small seconds, sunburst, power reserve), the
 * dial text and how the seconds hand moves; words in the name like "cushion"
 * or "tank" set the case; the watch's id picks the colours. Every part can be
 * overridden in the watch's face design. The hands show the real time.
 */

export type CaseShape = 'round' | 'cushion' | 'tank' | 'tonneau' | 'octagon';
export type Markers = 'batons' | 'arabic' | 'roman' | 'dots' | 'none';
export type Texture = 'plain' | 'sunburst' | 'rotor' | 'linen';
export type Bezel = 'none' | 'dive' | 'coin';
export type Strap = 'leather' | 'rubber' | 'bracelet' | 'nato';
export type Metal = 'steel' | 'gold' | 'rose' | 'black';
export type Seconds = 'center' | 'small' | 'none';

export interface FaceDesign {
  shape: CaseShape;
  metal: Metal;
  dial: string;
  hands: string;
  secondsColour: string;
  markers: Markers;
  texture: Texture;
  bezel: Bezel;
  strap: Strap;
  strapColour: string;
  seconds: Seconds;
  date: boolean;
  powerReserve: boolean;
  /** Line under the brand; '' for none. */
  text: string;
  /** Show the drawn face even when the watch has a photo. */
  preferArt: boolean;
}

export const SHAPES: Array<[CaseShape, string]> = [
  ['round', 'Round'],
  ['cushion', 'Cushion'],
  ['tank', 'Rectangular'],
  ['tonneau', 'Tonneau'],
  ['octagon', 'Octagonal'],
];
export const MARKERS: Array<[Markers, string]> = [
  ['batons', 'Batons'],
  ['arabic', '12 3 6 9'],
  ['roman', 'XII III VI IX'],
  ['dots', 'Dots'],
  ['none', 'None'],
];
export const TEXTURES: Array<[Texture, string]> = [
  ['plain', 'Plain'],
  ['sunburst', 'Sunburst'],
  ['rotor', 'Open rotor'],
  ['linen', 'Linen'],
];
export const BEZELS: Array<[Bezel, string]> = [
  ['none', 'Plain'],
  ['dive', 'Diver'],
  ['coin', 'Coin edge'],
];
export const STRAPS: Array<[Strap, string]> = [
  ['leather', 'Leather'],
  ['rubber', 'Rubber'],
  ['bracelet', 'Bracelet'],
  ['nato', 'NATO'],
];
export const METALS: Array<[Metal, string]> = [
  ['steel', 'Steel'],
  ['gold', 'Gold'],
  ['rose', 'Rose gold'],
  ['black', 'Black'],
];
export const SECONDS: Array<[Seconds, string]> = [
  ['center', 'Centre'],
  ['small', 'Small seconds'],
  ['none', 'None'],
];
export const DIAL_SWATCHES = ['#1a1b1c', '#121a24', '#1d3a5f', '#14472f', '#5a1f24', '#e9e4d8', '#b9bec2', '#d9b77a'];
export const HAND_SWATCHES = ['#e6efe9', '#111111', '#1b2a4a', '#c9a24a', '#7cf2a5', '#ff5a4a'];
export const STRAP_SWATCHES = ['#1b211e', '#5a3a22', '#203247', '#2e3b2c', '#6b6f73', '#7a1f2b'];

const AUTO_PALETTES: Array<{ dial: string; hand: string }> = [
  { dial: '#13201a', hand: '#7cf2a5' },
  { dial: '#1f1a12', hand: '#f5b84a' },
  { dial: '#121a24', hand: '#8cc8ff' },
  { dial: '#1a1b1c', hand: '#e6efe9' },
  { dial: '#22160f', hand: '#ff9d7a' },
  { dial: '#e9e4d8', hand: '#1b2a4a' },
];

const METAL_TONES: Record<Metal, { body: string; edge: string; crown: string }> = {
  steel: { body: '#3a433e', edge: '#9aa6a0', crown: '#8a968f' },
  gold: { body: '#7a5a1c', edge: '#e2c06a', crown: '#d1ad55' },
  rose: { body: '#7a4a3a', edge: '#e6a98f', crown: '#d49a80' },
  black: { body: '#1c1f1e', edge: '#4a5150', crown: '#3e4443' },
};

function hash(s: string): number {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619);
  return x >>> 0;
}

function shapeFromName(w: Watch): CaseShape {
  const t = `${w.name} ${w.reference} ${w.notes}`.toLowerCase();
  if (/cushion/.test(t)) return 'cushion';
  if (/tonneau|barrel/.test(t)) return 'tonneau';
  if (/octagon/.test(t)) return 'octagon';
  if (/\btank\b|square|rectangular|reverso/.test(t)) return 'tank';
  return 'round';
}

function autoText(w: Watch): string {
  const t = `${w.name} ${w.caliber}`.toLowerCase();
  switch (w.movementType) {
    case 'automatic':
      return 'AUTOMATIC';
    case 'quartz':
      return 'QUARTZ';
    case 'solar':
      return t.includes('eco-drive') || t.includes('eco drive') ? 'ECO-DRIVE' : 'SOLAR';
    case 'kinetic':
      return 'KINETIC';
    case 'spring-drive':
      return 'SPRING DRIVE';
    default:
      return '';
  }
}

/** The face the watch gets with no design of its own. */
export function autoFace(w: Watch): FaceDesign {
  const seed = hash(w.id || w.name);
  const pal = AUTO_PALETTES[seed % AUTO_PALETTES.length];
  const type = w.movementType;
  const shape = shapeFromName(w);
  const seconds: Seconds = type === 'manual' ? 'small' : 'center';
  return {
    shape,
    metal: 'steel',
    dial: pal.dial,
    hands: pal.hand,
    secondsColour: type === 'quartz' || type === 'solar' ? '#ff7a6b' : pal.hand,
    markers: 'batons',
    texture: type === 'solar' ? 'sunburst' : type === 'automatic' || type === 'kinetic' ? 'rotor' : 'plain',
    bezel: 'none',
    strap: 'leather',
    strapColour: '#1b211e',
    seconds,
    date: seconds === 'center' && type !== 'spring-drive' && (seed >>> 3) % 3 === 0 && shape !== 'tank',
    powerReserve: type === 'spring-drive',
    text: autoText(w),
    preferArt: false,
  };
}

/** The design to draw: automatic, with the watch's own choices on top. */
export function resolveFace(w: Watch): FaceDesign {
  return { ...autoFace(w), ...(w.face ?? {}) };
}

/** Readable ink for markers and text on a dial colour. */
function inkFor(dial: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(dial);
  const n = m ? parseInt(m[1], 16) : 0x222222;
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.55 ? '#4a4944' : '#b7c2bc';
}

const pt = (cx: number, cy: number, r: number, turn: number) => [cx + Math.sin(turn * 2 * Math.PI) * r, cy - Math.cos(turn * 2 * Math.PI) * r];
let uidCounter = 0;

export function watchArt(w: Watch, opts: { live?: boolean; design?: FaceDesign } = {}): SVGElement {
  const f = opts.design ?? resolveFace(w);
  const seed = hash(w.id || w.name);
  const ink = inkFor(f.dial);
  const metal = METAL_TONES[f.metal] ?? METAL_TONES.steel;
  const cx = 50;
  const cy = 50;
  const parts: SVGElement[] = [];
  const uid = `wa${++uidCounter}`;

  // ---- Strap (behind the case) ----
  const strapW = f.shape === 'tank' ? 26 : 24;
  const sx = cx - strapW / 2;
  const strapPart = (y: number, hgt: number) => {
    const g = svg('g', {});
    if (f.strap === 'bracelet') {
      const rows = Math.round(hgt / 5);
      for (let i = 0; i < rows; i++) {
        const yy = y + (i * hgt) / rows;
        const hh = hgt / rows - 0.6;
        g.append(
          svg('rect', { x: sx, y: yy + 0.3, width: strapW * 0.3, height: hh, rx: 0.8, fill: metal.edge, opacity: 0.7 }),
          svg('rect', { x: sx + strapW * 0.32, y: yy + 0.3, width: strapW * 0.36, height: hh, rx: 0.8, fill: metal.edge, opacity: 0.95 }),
          svg('rect', { x: sx + strapW * 0.7, y: yy + 0.3, width: strapW * 0.3, height: hh, rx: 0.8, fill: metal.edge, opacity: 0.7 }),
        );
      }
    } else {
      g.append(svg('rect', { x: sx, y, width: strapW, height: hgt, rx: 3, fill: f.strapColour }));
      if (f.strap === 'leather') g.append(svg('rect', { x: sx + 1.6, y: y + 1, width: strapW - 3.2, height: hgt - 2, rx: 2, fill: 'none', stroke: '#ffffff', 'stroke-opacity': 0.22, 'stroke-width': 0.4, 'stroke-dasharray': '1.2 1' }));
      if (f.strap === 'rubber') for (let i = 1; i < 5; i++) g.append(svg('line', { x1: sx + 3, x2: sx + strapW - 3, y1: y + (i * hgt) / 5, y2: y + (i * hgt) / 5, stroke: '#000', 'stroke-opacity': 0.35, 'stroke-width': 0.8 }));
      if (f.strap === 'nato') {
        g.append(svg('rect', { x: sx + strapW * 0.36, y, width: strapW * 0.28, height: hgt, fill: '#e8e3d6', opacity: 0.85 }));
        g.append(svg('rect', { x: sx + strapW * 0.44, y, width: strapW * 0.12, height: hgt, fill: f.strapColour }));
      }
    }
    return g;
  };
  parts.push(strapPart(0, 24), strapPart(76, 24));

  // ---- Crown ----
  const ring = f.bezel !== 'none' && (f.shape === 'round' || f.shape === 'octagon' || f.shape === 'cushion') ? 5 : 0;
  const crownX = f.shape === 'tank' ? 78 : f.shape === 'tonneau' ? 81 : f.shape === 'octagon' ? 88 : ring ? 89 : 87;
  parts.push(svg('rect', { x: crownX, y: cy - 4, width: 5, height: 8, rx: 1.5, fill: metal.crown }));

  // ---- Case and dial area ----
  let r: number;
  let dialShape: () => SVGElement;
  const caseAttrs = { fill: metal.body, stroke: metal.edge, 'stroke-width': 1.5 };
  if (f.shape === 'round') {
    parts.push(svg('circle', { cx, cy, r: 38 + ring * 0.4, ...caseAttrs }));
    r = 33 - ring * 0.7;
    dialShape = () => svg('circle', { cx, cy, r });
  } else if (f.shape === 'octagon') {
    const oct = (rad: number) => Array.from({ length: 8 }, (_, i) => pt(cx, cy, rad, (i + 0.5) / 8).join(',')).join(' ');
    parts.push(svg('polygon', { points: oct(41 + ring * 0.2), ...caseAttrs }));
    r = 31 - ring * 0.7;
    dialShape = () => svg('circle', { cx, cy, r });
  } else if (f.shape === 'cushion') {
    parts.push(svg('rect', { x: 13, y: 13, width: 74, height: 74, rx: 22, ...caseAttrs }));
    r = 32 - ring * 0.7;
    dialShape = ring ? () => svg('circle', { cx, cy, r }) : () => svg('rect', { x: 18, y: 18, width: 64, height: 64, rx: 17 });
  } else if (f.shape === 'tank') {
    parts.push(svg('rect', { x: 22, y: 12, width: 56, height: 76, rx: 6, ...caseAttrs }));
    r = 22;
    dialShape = () => svg('rect', { x: 27, y: 17, width: 46, height: 66, rx: 3 });
  } else {
    parts.push(svg('path', { d: 'M28 12 Q50 6 72 12 Q84 50 72 88 Q50 94 28 88 Q16 50 28 12 Z', ...caseAttrs }));
    r = 26;
    dialShape = () => svg('path', { d: 'M32 17 Q50 12 68 17 Q78 50 68 83 Q50 88 32 83 Q22 50 32 17 Z' });
  }

  // Bezel ring between case and dial.
  if (ring) {
    const br = r + ring * 0.8;
    if (f.bezel === 'dive') {
      parts.push(svg('circle', { cx, cy, r: br, fill: '#141716', stroke: metal.edge, 'stroke-width': 0.6 }));
      for (let i = 1; i < 60; i++) {
        const major = i % 5 === 0;
        if (i > 15 && !major) continue;
        const [x1, y1] = pt(cx, cy, br - (major ? 2.6 : 1.5), i / 60);
        const [x2, y2] = pt(cx, cy, br + 0.4, i / 60);
        parts.push(svg('line', { x1, y1, x2, y2, stroke: '#d8ddd9', 'stroke-width': major ? 0.9 : 0.5 }));
      }
      const [a1, b1] = pt(cx, cy, br - 1.2, 0);
      parts.push(svg('polygon', { points: `${a1 - 1.8},${b1 - 1.4} ${a1 + 1.8},${b1 - 1.4} ${a1},${b1 + 1.6}`, fill: '#f5b84a' }));
    } else {
      parts.push(svg('circle', { cx, cy, r: br, fill: metal.body, stroke: metal.edge, 'stroke-width': 0.6 }));
      for (let i = 0; i < 90; i++) {
        const [x1, y1] = pt(cx, cy, br - 2.4, i / 90);
        const [x2, y2] = pt(cx, cy, br + 0.3, i / 90);
        parts.push(svg('line', { x1, y1, x2, y2, stroke: metal.edge, 'stroke-width': 0.45, opacity: 0.8 }));
      }
    }
  }

  // Dial, with a clip so textures stay on it.
  const dial = dialShape();
  dial.setAttribute('fill', f.dial);
  parts.push(dial);
  const clipId = `${uid}c`;
  parts.push(svg('defs', {}, svg('clipPath', { id: clipId }, dialShape())));
  const onDial = svg('g', { 'clip-path': `url(#${clipId})` });
  parts.push(onDial);

  if (f.texture === 'sunburst') {
    for (let i = 0; i < 60; i++) {
      const [x, y] = pt(cx, cy, 48, i / 60);
      onDial.append(svg('line', { x1: cx, y1: cy, x2: x, y2: y, stroke: ink, 'stroke-width': 0.35, opacity: 0.16 }));
    }
  } else if (f.texture === 'linen') {
    for (let i = -48; i < 48; i += 1.6) {
      onDial.append(svg('line', { x1: cx + i, y1: 0, x2: cx + i, y2: 100, stroke: ink, 'stroke-width': 0.25, opacity: 0.1 }));
      onDial.append(svg('line', { x1: 0, y1: cy + i, x2: 100, y2: cy + i, stroke: ink, 'stroke-width': 0.25, opacity: 0.1 }));
    }
  } else if (f.texture === 'rotor') {
    // A rotor seen through an open dial: a faint half-disc.
    const rr = r * 0.82;
    const turn = ((seed >>> 8) % 360) / 360;
    const [x1, y1] = pt(cx, cy, rr, turn);
    const [x2, y2] = pt(cx, cy, rr, turn + 0.5);
    onDial.append(svg('path', { d: `M${x1} ${y1} A${rr} ${rr} 0 0 1 ${x2} ${y2} Z`, fill: ink, opacity: 0.09 }));
  }

  if (f.powerReserve) {
    const pr = r * 0.55;
    const [ax, ay] = pt(cx, cy, pr, 0.6);
    const [bx, by] = pt(cx, cy, pr, 0.9);
    onDial.append(svg('path', { d: `M${ax} ${ay} A${pr} ${pr} 0 0 1 ${bx} ${by}`, fill: 'none', stroke: ink, 'stroke-width': 1.6, opacity: 0.6 }));
    const [nx, ny] = pt(cx, cy, pr - 3, 0.6 + 0.3 * (0.4 + ((seed >>> 4) % 50) / 100));
    onDial.append(svg('line', { x1: cx, y1: cy, x2: nx, y2: ny, stroke: f.hands, 'stroke-width': 0.9, opacity: 0.7 }));
  }

  // ---- Markers ----
  const small = f.seconds === 'small';
  const label = (x: number, y: number, s: string, size: number, weight = 600, spacing = 0.6, serif = false) =>
    svg('text', { x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': size, 'font-weight': weight, 'letter-spacing': spacing, fill: ink, 'font-family': serif ? 'Georgia, serif' : 'system-ui, sans-serif' }, document.createTextNode(s));
  const numerals: Partial<Record<number, string>> | null = f.markers === 'arabic' ? { 0: '12', 3: '3', 6: '6', 9: '9' } : f.markers === 'roman' ? { 0: 'XII', 3: 'III', 6: 'VI', 9: 'IX' } : null;
  if (f.markers !== 'none') {
    for (let i = 0; i < 12; i++) {
      if (small && i === 6) continue;
      if (f.date && i === 3) continue;
      const major = i % 3 === 0;
      const num = numerals?.[i];
      if (num) {
        const [x, y] = pt(cx, cy, r - 6.5, i / 12);
        onDial.append(label(x, y, num, f.markers === 'roman' ? 5.2 : 6.6, 650, f.markers === 'roman' ? 0 : -0.2, f.markers === 'roman'));
        continue;
      }
      if (f.markers === 'dots') {
        const [x, y] = pt(cx, cy, r - 4, i / 12);
        onDial.append(svg('circle', { cx: x, cy: y, r: major ? 1.6 : 1.1, fill: ink }));
        continue;
      }
      const [x1, y1] = pt(cx, cy, r - (major ? 7 : 4.5), i / 12);
      const [x2, y2] = pt(cx, cy, r - 1.5, i / 12);
      onDial.append(svg('line', { x1, y1, x2, y2, stroke: ink, 'stroke-width': major ? 2 : 1.2, 'stroke-linecap': 'round' }));
    }
  }

  // ---- Dial text: brand at 12, the line below at 6 (above a small-seconds dial) ----
  const brand = w.brand.trim().toUpperCase().slice(0, 14);
  const tank = f.shape === 'tank';
  const brandY = cy - r * (tank ? 0.32 : numerals ? 0.36 : 0.42);
  if (brand) onDial.append(label(cx, brandY, brand, tank ? 3.6 : 4.4));
  if (f.text) onDial.append(label(cx, small ? brandY + 6 : cy + r * (numerals ? 0.42 : 0.48), f.text.toUpperCase().slice(0, 20), 3, 500));

  // ---- Date window at 3: today's date ----
  let dateText: SVGElement | null = null;
  if (f.date) {
    const dx = cx + r * (tank ? 0.42 : 0.55);
    onDial.append(svg('rect', { x: dx - 3.2, y: cy - 2.7, width: 6.4, height: 5.4, rx: 0.6, fill: '#eae6dc' }));
    dateText = svg('text', { x: dx, y: cy + 0.1, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 3.8, 'font-weight': 700, fill: '#222', 'font-family': 'system-ui, sans-serif' }, document.createTextNode(String(new Date().getDate())));
    onDial.append(dateText);
  }

  // ---- Hands, drawn at 12 and turned to the real time ----
  const hand = (len: number, width: number, colour: string, tail = 0, ox = cx, oy = cy) => {
    const g = svg('g', {}, svg('line', { x1: ox, y1: oy + tail, x2: ox, y2: oy - len, stroke: colour, 'stroke-width': width, 'stroke-linecap': 'round' }));
    parts.push(g);
    return (turn: number) => g.setAttribute('transform', `rotate(${(turn * 360).toFixed(2)} ${ox} ${oy})`);
  };
  let setSec: ((turn: number) => void) | null = null;
  if (small) {
    const sy = cy + r * 0.5;
    const sr = r * 0.24;
    onDial.append(svg('circle', { cx, cy: sy, r: sr, fill: 'none', stroke: ink, 'stroke-width': 0.6, opacity: 0.8 }));
    setSec = hand(sr * 0.85, 0.9, f.secondsColour, 0, cx, sy);
  }
  const setHour = hand(r * 0.5, 2.6, f.hands);
  const setMin = hand(r * 0.8, 1.8, f.hands);
  if (f.seconds === 'center') setSec = hand(r * 0.88, 0.7, f.secondsColour, r * 0.2);
  parts.push(svg('circle', { cx, cy, r: 1.6, fill: f.hands }));

  // How the seconds hand moves: quartz steps once a second, a mechanical
  // watch in small beats at its beat rate, Spring Drive glides.
  const type = w.movementType;
  const quartzLike = type === 'quartz' || type === 'solar' || type === 'kinetic';
  const beatsPerSec = quartzLike ? 1 : type === 'spring-drive' ? 0 : (w.bph || 21600) / 3600;
  let lastKey = -1;
  const update = (now: Date) => {
    const exact = now.getSeconds() + now.getMilliseconds() / 1000;
    const sec = reducedMotion() ? Math.floor(exact) : beatsPerSec ? Math.floor(exact * beatsPerSec) / beatsPerSec : exact;
    const key = now.getMinutes() * 60 + (setSec ? sec : 0);
    if (key === lastKey) return;
    lastKey = key;
    const min = now.getMinutes() + sec / 60;
    setSec?.(sec / 60);
    setMin(min / 60);
    setHour(((now.getHours() % 12) + min / 60) / 12);
    if (dateText && dateText.textContent !== String(now.getDate())) dateText.textContent = String(now.getDate());
  };

  const el = svg('svg', { viewBox: '0 0 100 100', class: 'watch-art', 'aria-hidden': 'true' }, ...parts);
  if (opts.live === false) update(new Date());
  else liveFace(el, update);
  return el;
}
