import { COSC } from '../analysis/analyze';
import type { Measurement } from '../db';
import { POSITIONS } from '../db';
import { fmtDate, fmtRate } from '../util/format';
import { svg } from '../util/dom';

/** Rate over time for one watch, with the COSC band shaded. */
export function historyChart(measurements: Measurement[], width = 640): SVGElement {
  const data = [...measurements].sort((a, b) => a.takenAt - b.takenAt);
  const W = Math.max(300, Math.round(width));
  const H = 230;
  const pad = { l: 46, r: 14, t: 14, b: 28 };
  const pw = W - pad.l - pad.r;
  const ph = H - pad.t - pad.b;

  const rates = data.map((m) => m.rate);
  const lo = Math.min(-10, ...rates.map((r) => r - 3));
  const hi = Math.max(10, ...rates.map((r) => r + 3));
  const y = (v: number) => pad.t + ((hi - v) / (hi - lo)) * ph;
  const t0 = data[0]?.takenAt ?? 0;
  const t1 = data[data.length - 1]?.takenAt ?? 1;
  const x = (t: number) => (t1 === t0 ? pad.l + pw / 2 : pad.l + ((t - t0) / (t1 - t0)) * pw);

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'history-chart', role: 'img', 'aria-label': 'Rate history' });

  root.appendChild(svg('rect', { x: pad.l, y: y(COSC.max), width: pw, height: y(COSC.min) - y(COSC.max), class: 'cosc-band' }));
  const coscLabel = svg('text', { x: W - pad.r - 4, y: y(COSC.min) - 6, class: 'band-label', 'text-anchor': 'end' });
  coscLabel.textContent = 'COSC −4/+6';
  root.appendChild(coscLabel);

  const step = hi - lo > 60 ? 20 : hi - lo > 30 ? 10 : 5;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    root.appendChild(svg('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: v === 0 ? 'axis zero' : 'axis' }));
    const t = svg('text', { x: pad.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'tick-label' });
    t.textContent = v === 0 ? '0' : fmtRate(v).replace('.0', '');
    root.appendChild(t);
  }

  if (data.length > 1) {
    const d = data.map((m, i) => `${i ? 'L' : 'M'}${x(m.takenAt).toFixed(1)},${y(m.rate).toFixed(1)}`).join(' ');
    root.appendChild(svg('path', { d, class: 'history-line' }));
  }
  for (const m of data) {
    const c = svg('circle', { cx: x(m.takenAt), cy: y(m.rate), r: 4, class: 'history-dot' });
    const title = svg('title');
    title.textContent = `${fmtDate(m.takenAt)} · ${POSITIONS[m.position]} · ${fmtRate(m.rate)} s/d`;
    c.appendChild(title);
    root.appendChild(c);
  }

  if (data.length) {
    const a = svg('text', { x: pad.l, y: H - 8, class: 'tick-label' });
    a.textContent = fmtDate(t0);
    root.appendChild(a);
    if (t1 !== t0) {
      const b = svg('text', { x: W - pad.r, y: H - 8, class: 'tick-label', 'text-anchor': 'end' });
      b.textContent = fmtDate(t1);
      root.appendChild(b);
    }
  }
  return root;
}
