/**
 * Time checks: compare a watch with reference time now and then, and work out
 * its real-world drift. The only way to rate a quartz watch, and a good way to
 * see how a mechanical one does on the wrist.
 *
 * The user taps the moment the watch's seconds hand reaches 12. The watch then
 * reads a whole minute, so its offset is (nearest whole minute − reference).
 */
import { db, isTimegraphable, newId, type TimeCheck, type Watch } from '../db';
import { h, svg, toast } from '../util/dom';
import { fmtDate } from '../util/format';

const DAY = 86_400_000;
const MONTH_DAYS = 30.44;

export interface Drift {
  perDay: number;
  perMonth: number;
  days: number;
  checks: number;
  series: TimeCheck[];
}

/** Drift of the current series: checks since the most recent reset. */
export function driftOf(all: TimeCheck[]): Drift | null {
  const sorted = [...all].sort((a, b) => a.at - b.at);
  let start = 0;
  sorted.forEach((c, i) => {
    if (c.reset) start = i;
  });
  const series = sorted.slice(start);
  if (series.length < 2) return null;
  const xs = series.map((c) => (c.at - series[0].at) / DAY);
  const ys = series.map((c) => c.offset);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  if (sxx === 0) return null;
  const perDay = sxy / sxx;
  return { perDay, perMonth: perDay * MONTH_DAYS, days: xs[n - 1], checks: n, series };
}

const signed = (v: number, digits = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`;

export function fmtDrift(d: Drift, quartz: boolean): string {
  return quartz ? `${signed(d.perMonth)} s/month` : `${signed(d.perDay)} s/day`;
}

/** Rough verdict: quartz in s/month, mechanical in s/day. */
export function driftGrade(d: Drift, quartz: boolean): 'good' | 'ok' | 'bad' {
  if (quartz) {
    const m = Math.abs(d.perMonth);
    return m <= 15 ? 'good' : m <= 30 ? 'ok' : 'bad';
  }
  const p = d.perDay;
  return p >= -4 && p <= 6 ? 'good' : Math.abs(p) <= 15 ? 'ok' : 'bad';
}

// ---------------------------------------------------------------- reference time
interface Reference {
  /** Add to Date.now() to get reference time. */
  offsetMs: number;
  source: 'internet' | 'device';
  /** Half the best round trip: how far off the reference could be. */
  uncertaintyMs: number;
}

let cached: { ref: Reference; at: number } | null = null;

export async function referenceTime(): Promise<Reference> {
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.ref;
  let best: { offset: number; rtt: number } | null = null;
  for (let i = 0; i < 5; i++) {
    try {
      const t0 = Date.now();
      const p0 = performance.now();
      const res = await fetch(`/api/time?n=${i}-${t0}`, { cache: 'no-store' });
      const rtt = performance.now() - p0;
      if (!res.ok) throw new Error();
      const { now } = (await res.json()) as { now: number };
      const offset = now + rtt / 2 - (t0 + rtt);
      if (!best || rtt < best.rtt) best = { offset, rtt };
    } catch {
      break;
    }
  }
  const ref: Reference = best ? { offsetMs: best.offset, source: 'internet', uncertaintyMs: best.rtt / 2 } : { offsetMs: 0, source: 'device', uncertaintyMs: 0 };
  cached = { ref, at: Date.now() };
  return ref;
}

// ---------------------------------------------------------------- panel
export function timeCheckPanel(watch: Watch, onChange: () => void): HTMLElement {
  const quartz = !isTimegraphable(watch);
  const clockEl = h('div', { class: 'tc-clock' }, '--:--:--');
  const sourceEl = h('p', { class: 'muted small tc-source' }, 'Getting internet time…');
  const summary = h('div', { class: 'tc-summary' });
  const pending = h('div', { class: 'tc-pending', hidden: true });
  const history = h('div', { class: 'tc-history' });
  let ref: Reference = { offsetMs: 0, source: 'device', uncertaintyMs: 0 };
  let raf = 0;

  const now = () => Date.now() + ref.offsetMs;
  const tick = () => {
    if (!clockEl.isConnected && raf) return;
    const d = new Date(now());
    clockEl.replaceChildren(
      `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:`,
      h('strong', null, String(d.getSeconds()).padStart(2, '0')),
      h('span', { class: 'tc-tenths' }, `.${Math.floor(d.getMilliseconds() / 100)}`),
    );
    raf = requestAnimationFrame(tick);
  };

  void referenceTime().then((r) => {
    ref = r;
    sourceEl.textContent =
      r.source === 'internet' ? `Internet time, accurate to about ±${Math.max(0.05, r.uncertaintyMs / 1000).toFixed(2)} s.` : 'Using this device’s clock (internet time wasn’t reachable). Fine if your device syncs its clock automatically.';
  });

  const tapBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn primary tc-tap',
      onclick: () => {
        const at = now();
        // The watch shows a whole minute right now; find the nearest one.
        const minute = Math.round(at / 60_000) * 60_000;
        showPending(at, (minute - at) / 1000);
      },
    },
    'Tap as the seconds hand hits 12',
  );

  function showPending(at: number, offset: number) {
    let off = offset;
    const offEl = h('strong', { class: 'tc-offset' });
    const describe = () => {
      offEl.textContent = Math.abs(off) < 0.05 ? 'spot on' : `${Math.abs(off).toFixed(1)} s ${off > 0 ? 'ahead' : 'behind'}`;
    };
    describe();
    const reset = h('input', { type: 'checkbox' });
    const notes = h('input', { type: 'text', placeholder: 'Optional, e.g. after a week on the wrist' });
    const adj = (deltaMin: number) =>
      h(
        'button',
        {
          type: 'button',
          class: 'btn small',
          onclick: () => {
            off += deltaMin * 60;
            describe();
          },
        },
        deltaMin > 0 ? '+1 min' : '−1 min',
      );
    pending.hidden = false;
    pending.replaceChildren(
      h('p', null, 'Your watch is ', offEl, '.'),
      h('div', { class: 'actions' }, adj(-1), adj(1), h('span', { class: 'muted small' }, 'Only if the watch is more than 30 seconds off.')),
      h('label', { class: 'check' }, reset, 'I’ve just set the watch to the right time (start a new series)'),
      h('label', { class: 'field' }, h('span', null, 'Notes'), notes),
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn primary',
            onclick: async () => {
              const check: TimeCheck = { id: newId(), watchId: watch.id, at, offset: Math.round(off * 10) / 10, reset: reset.checked, source: ref.source, notes: notes.value.trim(), updatedAt: Date.now() };
              await db.checks.add(check);
              pending.hidden = true;
              toast('Time check saved');
              await renderHistory();
              onChange();
            },
          },
          'Save check',
        ),
        h('button', { type: 'button', class: 'btn', onclick: () => (pending.hidden = true) }, 'Discard'),
      ),
    );
  }

  async function renderHistory() {
    const checks = (await db.checks.where('watchId').equals(watch.id).toArray()).sort((a, b) => b.at - a.at);
    const d = driftOf(checks);
    summary.replaceChildren(
      d
        ? h(
            'div',
            { class: 'stat', 'data-grade': driftGrade(d, quartz) },
            h('div', { class: 'ro-label' }, quartz ? 'Drift' : 'Drift on the wrist'),
            h('div', { class: 'stat-value' }, fmtDrift(d, quartz)),
            h('div', { class: 'muted small' }, `${quartz ? `${signed(d.perDay, 2)} s/day` : `${signed(d.perMonth, 0)} s/month`} · ${d.checks} checks over ${d.days < 1 ? `${Math.round(d.days * 24)} h` : `${d.days.toFixed(d.days < 10 ? 1 : 0)} days`}`),
          )
        : h(
            'p',
            { class: 'muted small' },
            checks.length
              ? 'One more check, ideally a few days later, and the drift appears here.'
              : `Set the watch exactly, record a first check, then check again every few days${quartz ? ' or weeks' : ''}. The drift appears after two checks.`,
          ),
      d && d.days < 2 ? h('p', { class: 'muted small' }, 'Short series so far; the figure firms up after a few days.') : '',
    );
    history.replaceChildren(
      checks.length > 1 ? driftChart(checks) : '',
      checks.length
        ? h(
            'table',
            { class: 'table' },
            h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', { class: 'num' }, 'Offset'), h('th', { class: 'hide-sm' }, 'Notes'), h('th', null, ''))),
            h(
              'tbody',
              null,
              checks.map((c) =>
                h(
                  'tr',
                  null,
                  h('td', null, new Date(c.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }), c.reset ? h('span', { class: 'tc-badge' }, 'set') : ''),
                  h('td', { class: 'num' }, `${signed(c.offset)} s`),
                  h('td', { class: 'hide-sm notes' }, c.notes),
                  h(
                    'td',
                    null,
                    h(
                      'button',
                      {
                        class: 'icon-btn',
                        'aria-label': 'Delete check',
                        title: 'Delete check',
                        onclick: async () => {
                          if (!confirm('Delete this time check?')) return;
                          await db.checks.delete(c.id);
                          await renderHistory();
                          onChange();
                        },
                      },
                      '×',
                    ),
                  ),
                ),
              ),
            ),
          )
        : '',
    );
  }

  const panel = h(
    'section',
    { class: 'panel time-check' },
    h('header', { class: 'panel-head' }, h('h2', null, 'Time checks'), h('span', { class: 'muted small' }, quartz ? 'how this quartz watch keeps time' : 'how it keeps time on the wrist')),
    summary,
    h('div', { class: 'tc-live' }, clockEl, tapBtn),
    sourceEl,
    pending,
    history,
  );
  void renderHistory();
  raf = requestAnimationFrame(tick);
  return panel;
}

function driftChart(checks: TimeCheck[]): SVGElement {
  const data = [...checks].sort((a, b) => a.at - b.at);
  const W = 600;
  const H = 160;
  const pad = { l: 40, r: 10, t: 10, b: 22 };
  const t0 = data[0].at;
  const t1 = data[data.length - 1].at;
  const lo = Math.min(-2, ...data.map((c) => c.offset));
  const hi = Math.max(2, ...data.map((c) => c.offset));
  const x = (t: number) => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + ((hi - v) / (hi - lo)) * (H - pad.t - pad.b);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'history-chart tc-chart', role: 'img', 'aria-label': 'Offset over time' });
  root.appendChild(svg('line', { x1: pad.l, x2: W - pad.r, y1: y(0), y2: y(0), class: 'axis zero' }));
  for (const v of [lo, hi]) {
    const t = svg('text', { x: pad.l - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'tick-label' });
    t.textContent = `${v > 0 ? '+' : ''}${v.toFixed(0)}s`;
    root.appendChild(t);
  }
  // Draw each series (split at resets) as its own line.
  let seg: TimeCheck[] = [];
  const flush = () => {
    if (seg.length > 1) root.appendChild(svg('path', { d: seg.map((c, i) => `${i ? 'L' : 'M'}${x(c.at).toFixed(1)},${y(c.offset).toFixed(1)}`).join(' '), class: 'history-line' }));
    seg = [];
  };
  for (const c of data) {
    if (c.reset) flush();
    seg.push(c);
  }
  flush();
  for (const c of data) root.appendChild(svg('circle', { cx: x(c.at), cy: y(c.offset), r: 4, class: 'history-dot' }));
  const a = svg('text', { x: pad.l, y: H - 6, class: 'tick-label' });
  a.textContent = fmtDate(t0);
  root.appendChild(a);
  const b = svg('text', { x: W - pad.r, y: H - 6, class: 'tick-label', 'text-anchor': 'end' });
  b.textContent = fmtDate(t1);
  root.appendChild(b);
  return root;
}
