import type { Watch } from '../db';
import { svg } from '../util/dom';

/**
 * Stand-in artwork for a watch with no photo. The movement type sets the
 * dial furniture (rotor, small seconds, sunburst, power reserve) and the
 * dial text; the watch's id picks a dial colour and the time shown, so no
 * two placeholders look alike. Words in the name like "cushion" or "tank"
 * change the case shape.
 */

const DIALS: Array<{ dial: string; hand: string; ink: string }> = [
  { dial: '#13201a', hand: '#7cf2a5', ink: '#9fb3a8' }, // green
  { dial: '#1f1a12', hand: '#f5b84a', ink: '#c2ad8a' }, // warm brown
  { dial: '#121a24', hand: '#8cc8ff', ink: '#9aaec2' }, // blue
  { dial: '#1a1b1c', hand: '#e6efe9', ink: '#a3aaa6' }, // graphite
  { dial: '#22160f', hand: '#ff9d7a', ink: '#c9a593' }, // tropical
  { dial: '#e9e4d8', hand: '#1b2a4a', ink: '#5b5a55' }, // cream
];

type CaseShape = 'round' | 'cushion' | 'tank' | 'tonneau';

function hash(s: string): number {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619);
  return x >>> 0;
}

function caseShape(w: Watch): CaseShape {
  const t = `${w.name} ${w.reference} ${w.notes}`.toLowerCase();
  if (/cushion/.test(t)) return 'cushion';
  if (/tonneau|barrel/.test(t)) return 'tonneau';
  if (/\btank\b|square|rectangular|reverso/.test(t)) return 'tank';
  return 'round';
}

function dialText(w: Watch): string {
  const t = `${w.name} ${w.caliber}`.toLowerCase();
  switch (w.movementType) {
    case 'automatic':
      return 'AUTOMATIC';
    case 'manual':
      return '';
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

const pt = (cx: number, cy: number, r: number, turn: number) => [cx + Math.sin(turn * 2 * Math.PI) * r, cy - Math.cos(turn * 2 * Math.PI) * r];

export function watchArt(w: Watch): SVGElement {
  const seed = hash(w.id || w.name);
  const pal = DIALS[seed % DIALS.length];
  const shape = caseShape(w);
  const type = w.movementType;
  const cx = 50;
  const cy = 50;
  const steel = '#7d8a83';
  const parts: SVGElement[] = [];

  // Straps / lugs.
  const lugW = shape === 'tank' ? 24 : 22;
  parts.push(svg('rect', { x: cx - lugW / 2, y: 0, width: lugW, height: 22, rx: 3, fill: '#1b211e' }));
  parts.push(svg('rect', { x: cx - lugW / 2, y: 78, width: lugW, height: 22, rx: 3, fill: '#1b211e' }));

  // Crown.
  const crownX = shape === 'tank' ? 79 : shape === 'tonneau' ? 82 : 87;
  parts.push(svg('rect', { x: crownX, y: cy - 4, width: 5, height: 8, rx: 1.5, fill: steel }));

  // Case and dial, sized per shape. `r` is the radius used for indices.
  let r = 34;
  if (shape === 'round') {
    parts.push(svg('circle', { cx, cy, r: 38, fill: '#2a312d', stroke: steel, 'stroke-width': 1.5 }));
    parts.push(svg('circle', { cx, cy, r: 33, fill: pal.dial }));
    r = 33;
  } else if (shape === 'cushion') {
    parts.push(svg('rect', { x: 13, y: 13, width: 74, height: 74, rx: 22, fill: '#2a312d', stroke: steel, 'stroke-width': 1.5 }));
    parts.push(svg('rect', { x: 18, y: 18, width: 64, height: 64, rx: 17, fill: pal.dial }));
    r = 32;
  } else if (shape === 'tank') {
    parts.push(svg('rect', { x: 22, y: 12, width: 56, height: 76, rx: 6, fill: '#2a312d', stroke: steel, 'stroke-width': 1.5 }));
    parts.push(svg('rect', { x: 27, y: 17, width: 46, height: 66, rx: 3, fill: pal.dial }));
    r = 22;
  } else {
    parts.push(svg('path', { d: 'M28 12 Q50 6 72 12 Q84 50 72 88 Q50 94 28 88 Q16 50 28 12 Z', fill: '#2a312d', stroke: steel, 'stroke-width': 1.5 }));
    parts.push(svg('path', { d: 'M32 17 Q50 12 68 17 Q78 50 68 83 Q50 88 32 83 Q22 50 32 17 Z', fill: pal.dial }));
    r = 26;
  }

  // Movement-specific dial furniture, drawn under the indices.
  if (type === 'solar') {
    for (let i = 0; i < 48; i++) {
      const [x, y] = pt(cx, cy, r, i / 48);
      parts.push(svg('line', { x1: cx, y1: cy, x2: x, y2: y, stroke: pal.ink, 'stroke-width': 0.4, opacity: 0.18 }));
    }
  }
  if (type === 'automatic' || type === 'kinetic') {
    // A rotor seen through an open dial: a faint half-disc.
    const rr = r * 0.82;
    const turn = ((seed >>> 8) % 360) / 360;
    const [x1, y1] = pt(cx, cy, rr, turn);
    const [x2, y2] = pt(cx, cy, rr, turn + 0.5);
    parts.push(svg('path', { d: `M${x1} ${y1} A${rr} ${rr} 0 0 1 ${x2} ${y2} Z`, fill: pal.ink, opacity: 0.08 }));
  }
  if (type === 'spring-drive') {
    // Power-reserve arc on the left of the dial.
    const pr = r * 0.55;
    const [ax, ay] = pt(cx, cy, pr, 0.6);
    const [bx, by] = pt(cx, cy, pr, 0.9);
    parts.push(svg('path', { d: `M${ax} ${ay} A${pr} ${pr} 0 0 1 ${bx} ${by}`, fill: 'none', stroke: pal.ink, 'stroke-width': 1.6, opacity: 0.6 }));
    const [nx, ny] = pt(cx, cy, pr - 3, 0.6 + 0.3 * (0.4 + ((seed >>> 4) % 50) / 100));
    parts.push(svg('line', { x1: cx, y1: cy, x2: nx, y2: ny, stroke: pal.hand, 'stroke-width': 0.9, opacity: 0.7 }));
  }

  // Indices.
  const subSeconds = type === 'manual';
  for (let i = 0; i < 12; i++) {
    if (subSeconds && i === 6) continue;
    const major = i % 3 === 0;
    const [x1, y1] = pt(cx, cy, r - (major ? 7 : 4.5), i / 12);
    const [x2, y2] = pt(cx, cy, r - 1.5, i / 12);
    parts.push(svg('line', { x1, y1, x2, y2, stroke: pal.ink, 'stroke-width': major ? 2 : 1.2, 'stroke-linecap': 'round' }));
  }

  // Dial text: brand at 12, movement at 6 (moved up when a subdial sits at 6).
  const brand = w.brand.trim().toUpperCase().slice(0, 12);
  const text = (y: number, s: string, size: number, weight = 600) =>
    svg('text', { x: cx, y, 'text-anchor': 'middle', 'font-size': size, 'font-weight': weight, 'letter-spacing': 0.6, fill: pal.ink, 'font-family': 'system-ui, sans-serif' }, document.createTextNode(s));
  if (brand) parts.push(text(cy - r * (shape === 'tank' ? 0.3 : 0.42), brand, shape === 'tank' ? 3.6 : 4.6));
  const label = dialText(w);
  if (label) parts.push(text(subSeconds ? cy - r * 0.42 + 6 : cy + r * 0.5, label, 3, 500));

  // Date window at 3 on some watches.
  if (!subSeconds && type !== 'spring-drive' && (seed >>> 3) % 3 === 0 && shape !== 'tank') {
    parts.push(svg('rect', { x: cx + r * 0.52, y: cy - 2.6, width: 6, height: 5.2, rx: 0.6, fill: '#eae6dc' }));
    parts.push(
      svg('text', { x: cx + r * 0.52 + 3, y: cy + 1.6, 'text-anchor': 'middle', 'font-size': 3.8, 'font-weight': 700, fill: '#222', 'font-family': 'system-ui, sans-serif' }, document.createTextNode(String(1 + ((seed >>> 11) % 31)))),
    );
  }

  // Small seconds at 6 for hand-wound watches.
  const secTurn = ((seed >>> 17) % 60) / 60;
  if (subSeconds) {
    const sy = cy + r * 0.5;
    const sr = r * 0.24;
    parts.push(svg('circle', { cx, cy: sy, r: sr, fill: 'none', stroke: pal.ink, 'stroke-width': 0.6, opacity: 0.8 }));
    const [sx, sy2] = pt(cx, sy, sr * 0.85, secTurn);
    parts.push(svg('line', { x1: cx, y1: sy, x2: sx, y2: sy2, stroke: pal.hand, 'stroke-width': 0.9, 'stroke-linecap': 'round' }));
  }

  // Hands: a pleasant, different time per watch.
  // Times chosen so the hands stay clear of the dial text at 12 and 6.
  const TIMES = [609, 111, 498, 163, 253, 582, 227, 432, 527, 98, 292, 624];
  const minutes = TIMES[(seed >>> 5) % TIMES.length];
  const hourTurn = minutes / 720;
  const minTurn = (minutes % 60) / 60;
  const [hx, hy] = pt(cx, cy, r * 0.5, hourTurn);
  const [mx, my] = pt(cx, cy, r * 0.8, minTurn);
  parts.push(svg('line', { x1: cx, y1: cy, x2: hx, y2: hy, stroke: pal.hand, 'stroke-width': 2.6, 'stroke-linecap': 'round' }));
  parts.push(svg('line', { x1: cx, y1: cy, x2: mx, y2: my, stroke: pal.hand, 'stroke-width': 1.8, 'stroke-linecap': 'round' }));
  if (!subSeconds) {
    const [sx, sy] = pt(cx, cy, r * 0.88, secTurn);
    const [tx, ty] = pt(cx, cy, r * 0.2, secTurn + 0.5);
    const secColour = type === 'quartz' || type === 'solar' ? '#ff7a6b' : pal.hand;
    parts.push(svg('line', { x1: tx, y1: ty, x2: sx, y2: sy, stroke: secColour, 'stroke-width': 0.7, 'stroke-linecap': 'round' }));
  }
  parts.push(svg('circle', { cx, cy, r: 1.6, fill: pal.hand }));

  return svg('svg', { viewBox: '0 0 100 100', class: 'watch-art', 'aria-hidden': 'true' }, ...parts);
}
