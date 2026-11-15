import type { TracePoint } from '../analysis/analyze';

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Size the backing store to the element's CSS size × devicePixelRatio. */
function prep(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number; dpr: number } {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h, dpr };
}

export interface TraceOptions {
  /** Vertical window in ms; points wrap around like a paper timegrapher. */
  spanMs: number;
  /** Seconds of history visible; null = fit everything. */
  windowSec: number | null;
  message?: string;
  /**
   * Past the window, follow the newest ticks instead of wrapping: the chart
   * re-centres on them and the oldest dots slide off the edge.
   */
  follow?: boolean;
}

/**
 * The classic timegrapher "paper trace": each dot is one tick, plotted as its
 * deviation from a perfect beat. Flat = accurate, slope = gaining/losing,
 * two separated lines = beat error.
 */
export function drawTrace(canvas: HTMLCanvasElement, points: TracePoint[], opts: TraceOptions): void {
  const { ctx, w, h } = prep(canvas);
  const pad = { l: 44, r: 12, t: 10, b: 22 };
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;
  const grid = css('--grid');
  const muted = css('--muted');
  const span = opts.spanMs;

  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = muted;
  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;

  // Plotted upward as "ahead" (−dev): a gaining watch's ticks come early and climb.
  // Following: centre on the newest ticks once the trace outgrows the window.
  // Scroll only as far as needed to keep the newest ticks within 80% of the
  // edge, so it moves on smoothly from the normal view, like paper feeding.
  let centre = 0;
  if (opts.follow && points.length) {
    const recent = points.slice(-20).map((p) => -p.dev).sort((a, b) => a - b);
    const latest = recent[recent.length >> 1];
    const room = 0.4 * span;
    if (Math.abs(latest) > room) centre = latest - Math.sign(latest) * room;
  }
  const following = centre !== 0;
  const yOf = (ahead: number) => pad.t + ph / 2 - ((ahead - centre) / span) * ph;

  // Horizontal ms grid
  const step = span <= 5 ? 1 : span <= 10 ? 2 : span <= 25 ? 5 : 10;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let v = Math.ceil((centre - span / 2) / step - 1e-9) * step; v <= centre + span / 2 + 1e-9; v += step) {
    const y = yOf(v);
    ctx.globalAlpha = Math.abs(v) < 1e-9 ? 1 : 0.55;
    ctx.beginPath();
    ctx.moveTo(pad.l, Math.round(y) + 0.5);
    ctx.lineTo(w - pad.r, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillText(`${v > 0 ? '+' : ''}${+v.toFixed(1)}`, pad.l - 6, y);
  }

  const tMax = points.length ? points[points.length - 1].t : 0;
  const winSec = opts.windowSec ?? Math.max(5, tMax);
  const tMin = Math.max(0, tMax - winSec);
  const x0 = opts.windowSec ? tMin : 0;
  const xSpan = opts.windowSec ? winSec : Math.max(5, tMax);

  // Time ticks
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const tStep = xSpan > 60 ? 15 : xSpan > 20 ? 5 : 2;
  for (let t = Math.ceil(x0 / tStep) * tStep; t <= x0 + xSpan + 1e-9; t += tStep) {
    const x = pad.l + ((t - x0) / xSpan) * pw;
    ctx.fillText(`${t}s`, x, h - pad.b + 6);
  }

  if (!points.length) {
    if (opts.message) {
      ctx.fillStyle = muted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText(opts.message, pad.l + pw / 2, pad.t + ph / 2);
    }
    return;
  }

  const tic = css('--tic');
  const toc = css('--toc');
  const r = 1.8;
  for (const p of points) {
    if (p.t < tMin) continue;
    const x = pad.l + ((p.t - x0) / xSpan) * pw;
    let y: number;
    if (following) {
      y = yOf(-p.dev);
      if (y < pad.t - r || y > pad.t + ph + r) continue; // slid off the edge
    } else {
      // Past the window, wrap like timegrapher paper.
      const wrapped = ((((p.dev + span / 2) % span) + span) % span) - span / 2;
      y = pad.t + ph / 2 + (wrapped / span) * ph;
    }
    ctx.fillStyle = p.odd ? toc : tic;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/**
 * The trace without its strays: ticks that sit well off their own line (tic
 * or toc), judged against their neighbours, so a click from the room or a
 * mistimed tick doesn't scatter dots across the chart. Display only.
 */
export function cleanTrace(points: TracePoint[]): TracePoint[] {
  const out: TracePoint[] = [];
  for (const odd of [false, true]) {
    const side = points.filter((p) => p.odd === odd);
    const W = 9;
    side.forEach((p, i) => {
      const win = side.slice(Math.max(0, i - W), i + W + 1).map((q) => q.dev);
      const s = [...win].sort((a, b) => a - b);
      const m = s[s.length >> 1];
      const mad = [...win.map((v) => Math.abs(v - m))].sort((a, b) => a - b)[win.length >> 1];
      if (Math.abs(p.dev - m) <= Math.max(3 * 1.4826 * mad, 0.25)) out.push(p);
    });
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * The trace scale to draw at: the chosen one, or the next wider one if the
 * trace has drifted off it (a fast or slow watch climbs off the chart in a
 * minute at ±5 ms). Past the widest it wraps, like timegrapher paper.
 */
export function fitSpan(points: TracePoint[], chosen: number, spans: number[]): number {
  let max = 0;
  for (const p of points) max = Math.max(max, Math.abs(p.dev));
  const need = max * 2 * 1.12;
  return spans.find((s) => s >= chosen && s >= need) ?? Math.max(chosen, spans[spans.length - 1]);
}

/** Overlay of recent tick envelopes — shows the unlock / impulse / drop clicks. */
/** Recent ticks lined up on their loudest click and averaged: a steady tick shape before the learned one. */
export function alignedMean(snippets: number[][]): number[] | null {
  if (snippets.length < 3) return null;
  const n = snippets[0].length;
  const norm = snippets.filter((s) => s.length === n).map((s) => {
    const peak = Math.max(...s) || 1;
    return { s: s.map((v) => v / peak), at: s.indexOf(peak) };
  });
  const ats = norm.map((x) => x.at).sort((a, b) => a - b);
  const target = ats[ats.length >> 1];
  const out = new Array(n).fill(0);
  const cnt = new Array(n).fill(0);
  for (const { s, at } of norm) {
    const d = target - at;
    for (let i = 0; i < n; i++) {
      const j = i - d;
      if (j >= 0 && j < n) {
        out[i] += s[j];
        cnt[i]++;
      }
    }
  }
  return out.map((v, i) => (cnt[i] ? v / cnt[i] : 0));
}

export function drawWaveform(canvas: HTMLCanvasElement, snippets: number[][], binMs: number, preMs: number, average: number[] | null = null): void {
  const { ctx, w, h } = prep(canvas);
  const pad = { l: 10, r: 10, t: 8, b: 20 };
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;
  const muted = css('--muted');
  const accent = css('--tic');

  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = muted;
  ctx.strokeStyle = css('--grid');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const n = average?.length ?? snippets[0]?.length ?? Math.round(24 / binMs);
  const totalMs = n * binMs;
  for (let ms = 0; ms <= totalMs - preMs; ms += 5) {
    const x = pad.l + ((ms + preMs) / totalMs) * pw;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, pad.t);
    ctx.lineTo(Math.round(x) + 0.5, pad.t + ph);
    ctx.stroke();
    ctx.fillText(`${ms}ms`, x, pad.t + ph + 5);
  }
  if (!snippets.length && !average) return;

  // A light moving average for display (about ±0.3 ms), so hiss doesn't read as clicks.
  const smooth = (s: number[], k = Math.max(1, Math.round(0.3 / binMs))) =>
    s.map((_, i) => {
      let sum = 0;
      let c = 0;
      for (let j = Math.max(0, i - k); j <= Math.min(s.length - 1, i + k); j++) {
        sum += s[j];
        c++;
      }
      return sum / c;
    });
  const line = (s: number[], alpha: number, width: number) => {
    const peak = Math.max(...s) || 1;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = accent;
    ctx.lineWidth = width;
    ctx.beginPath();
    s.forEach((v, i) => {
      const x = pad.l + (i / (s.length - 1)) * pw;
      const y = pad.t + ph - (v / peak) * ph * 0.92;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  };
  // The recent ticks as a faint haze; the averaged beat (hundreds of ticks, lined up) on top.
  const raw = snippets.map((s) => smooth(s));
  if (average) {
    raw.forEach((s) => line(s, 0.13, 1));
    const avg = smooth(average);
    const peak = Math.max(...avg) || 1;
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t + ph);
    avg.forEach((v, i) => ctx.lineTo(pad.l + (i / (avg.length - 1)) * pw, pad.t + ph - (v / peak) * ph * 0.92));
    ctx.lineTo(pad.l + pw, pad.t + ph);
    ctx.fill();
    line(avg, 1, 1.8);
    // The latest tick over the average, lined up on its loudest click, so it's visibly live.
    const last = raw[raw.length - 1];
    if (last) {
      const d = avg.indexOf(Math.max(...avg)) - last.indexOf(Math.max(...last));
      const shifted = last.map((_, i) => last[Math.min(last.length - 1, Math.max(0, i - d))]);
      ctx.setLineDash([3, 2]);
      line(shifted, 0.75, 1.1);
      ctx.setLineDash([]);
    }
  } else raw.forEach((s, idx) => line(s, idx === raw.length - 1 ? 1 : 0.15, idx === raw.length - 1 ? 1.5 : 1));
  ctx.globalAlpha = 1;
}
