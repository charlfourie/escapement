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

  // Horizontal ms grid
  const step = span <= 5 ? 1 : span <= 10 ? 2 : span <= 25 ? 5 : 10;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let v = -span / 2; v <= span / 2 + 1e-9; v += step) {
    const y = pad.t + ph / 2 - (v / span) * ph;
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
    const wrapped = ((((p.dev + span / 2) % span) + span) % span) - span / 2;
    const x = pad.l + ((p.t - x0) / xSpan) * pw;
    // dev is how late a tick is; a gaining watch ticks early, and timegraphers draw that sloping up.
    const y = pad.t + ph / 2 + (wrapped / span) * ph;
    ctx.fillStyle = p.odd ? toc : tic;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
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
export function drawWaveform(canvas: HTMLCanvasElement, snippets: number[][], binMs: number, preMs: number): void {
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
  const n = snippets[0]?.length ?? Math.round(24 / binMs);
  const totalMs = n * binMs;
  for (let ms = 0; ms <= totalMs - preMs; ms += 5) {
    const x = pad.l + ((ms + preMs) / totalMs) * pw;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, pad.t);
    ctx.lineTo(Math.round(x) + 0.5, pad.t + ph);
    ctx.stroke();
    ctx.fillText(`${ms}ms`, x, pad.t + ph + 5);
  }
  if (!snippets.length) return;

  snippets.forEach((s, idx) => {
    const peak = Math.max(...s) || 1;
    ctx.globalAlpha = idx === snippets.length - 1 ? 1 : 0.18;
    ctx.strokeStyle = accent;
    ctx.lineWidth = idx === snippets.length - 1 ? 1.5 : 1;
    ctx.beginPath();
    s.forEach((v, i) => {
      const x = pad.l + (i / (s.length - 1)) * pw;
      const y = pad.t + ph - (v / peak) * ph;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
}
