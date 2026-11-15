/**
 * The watch page's drawn face, made to behave like the watch:
 * - "Watch time" shows what the real watch says now (from its time checks and
 *   measured drift), not the true time.
 * - Pull the crown and drag the hands to set them. The seconds hand stops
 *   only if the movement hacks; push the crown in and the hands carry on from
 *   where you set them.
 */
import type { Measurement, QuartzTest, TimeCheck, Watch } from '../db';
import { findMovement } from '../data/movements';
import { hackingFor, watchOffset, type WatchOffset } from '../data/face-time';
import { h } from '../util/dom';
import { fmtDate } from '../util/format';
import { watchArt } from './watch-art';

const MIN = 60_000;
const KEY = (id: string) => `escapement:face:${id}`;

interface Saved {
  mode: 'real' | 'watch';
  /** Hands moved by hand, ms. */
  manual: number;
}

function load(id: string): Saved {
  try {
    return { mode: 'real', manual: 0, ...JSON.parse(localStorage.getItem(KEY(id)) ?? '{}') };
  } catch {
    return { mode: 'real', manual: 0 };
  }
}
function save(id: string, s: Saved) {
  try {
    localStorage.setItem(KEY(id), JSON.stringify(s));
  } catch {
    /* private mode: fine, it just won't stick */
  }
}

/** "1 min 4 s fast" */
function fmtOffset(sec: number): string {
  const a = Math.abs(sec);
  if (a < 0.5) return 'spot on';
  const m = Math.floor(a / 60);
  const s = Math.round(a - m * 60);
  const parts = [m && `${m} min`, s && `${s} s`].filter(Boolean).join(' ');
  return `${parts} ${sec > 0 ? 'fast' : 'slow'}`;
}

const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;

export function interactiveFace(w: Watch, data: { checks: TimeCheck[]; quartz: QuartzTest[]; readings: Measurement[] }): HTMLElement {
  const state = load(w.id);
  const ref = findMovement(w.caliber, w.brand);
  const hack = hackingFor(w, ref);
  const off: WatchOffset | null = watchOffset(data.checks, data.quartz, data.readings);
  if (!off) state.mode = 'real';

  let crownOut = false;
  let pulledAt = 0;
  let paused: number | null = null; // shown time, frozen while a hacking crown is out
  const watchSec = (ms: number) => (state.mode === 'watch' && off ? off.at(ms) : 0);
  const shown = (ms: number) => ms + watchSec(ms) * 1000 + state.manual;

  const art = watchArt(w, { clock: (now) => new Date(paused ?? shown(now.getTime())) }) as SVGSVGElement & { crown?: SVGElement };
  const crown = art.crown!;
  art.classList.add('face-live');

  const caption = h('p', { class: 'small muted face-caption' });
  const modeBtns = h('div', { class: 'fd-chips face-modes', role: 'group', 'aria-label': 'Time shown' });
  const crownBtn = h('button', { type: 'button', class: 'btn small' });
  const resetBtn = h('button', { type: 'button', class: 'link-btn small' }, 'Undo hand-setting');

  const render = () => {
    const now = Date.now();
    modeBtns.replaceChildren(
      ...(['real', 'watch'] as const).map((m) =>
        h(
          'button',
          {
            type: 'button',
            class: `fd-chip${state.mode === m ? ' active' : ''}`,
            'aria-pressed': String(state.mode === m),
            disabled: m === 'watch' && !off,
            title: m === 'watch' && !off ? 'Record a time check after setting the watch to see its own time' : undefined,
            onclick: () => {
              if (crownOut) pushIn();
              state.mode = m;
              save(w.id, state);
              render();
            },
          },
          m === 'real' ? 'Real time' : 'Watch time',
        ),
      ),
    );
    crownBtn.textContent = crownOut ? 'Push the crown in' : 'Pull the crown';
    crown.classList.toggle('out', crownOut);
    art.classList.toggle('setting', crownOut);

    const lines: Array<string | HTMLElement> = [];
    if (crownOut) lines.push(`Drag the minute hand to set the time. ${hack.why}`);
    else if (state.mode === 'watch' && off) {
      const basis =
        off.basis === 'checks'
          ? `${off.checks} time checks`
          : off.basis === 'quartz'
            ? 'its latest quartz test'
            : 'its timegrapher average';
      lines.push(`Showing what your watch says: ${fmtOffset(off.at(now))}. Set ${fmtDate(off.since)}, drifting ${signed(off.perDay)} s/day (from ${basis}).`);
    } else if (!off) lines.push('Pull the crown to set the hands. Record time checks and “Watch time” shows what your watch actually says.');
    else lines.push('Pull the crown to set the hands, or switch to the time your watch actually says.');
    if (state.manual && !crownOut) lines.push(' ', `Hands set ${fmtOffset(state.manual / 1000).replace('fast', 'ahead').replace('slow', 'behind')} by you. `, resetBtn);
    caption.replaceChildren(...lines);
  };

  const pullOut = () => {
    crownOut = true;
    pulledAt = Date.now();
    paused = hack.hacks ? shown(pulledAt) : null;
    render();
  };
  const pushIn = () => {
    if (hack.hacks && paused !== null) {
      // The seconds were stopped: the watch is now behind by the time it was out.
      state.manual -= Date.now() - pulledAt;
    }
    paused = null;
    crownOut = false;
    save(w.id, state);
    render();
  };
  const toggleCrown = () => (crownOut ? pushIn() : pullOut());

  crown.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleCrown();
  });
  crownBtn.onclick = toggleCrown;
  resetBtn.onclick = () => {
    state.manual = 0;
    save(w.id, state);
    render();
  };

  // Dragging the hands: turn around the centre; whole minutes, so the seconds hand isn't disturbed.
  let lastTurn: number | null = null;
  let acc = 0;
  const turnAt = (e: PointerEvent) => {
    const m = art.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return Math.atan2(p.x - 50, -(p.y - 50)) / (2 * Math.PI);
  };
  art.addEventListener('pointerdown', (e) => {
    if (!crownOut) return;
    lastTurn = turnAt(e);
    acc = 0;
    art.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  art.addEventListener('pointermove', (e) => {
    if (lastTurn === null) return;
    const t = turnAt(e);
    if (t === null) return;
    let d = t - lastTurn;
    if (d > 0.5) d -= 1;
    if (d < -0.5) d += 1;
    lastTurn = t;
    acc += d * 60;
    const whole = Math.trunc(acc);
    if (whole) {
      acc -= whole;
      state.manual += whole * MIN;
      if (paused !== null) paused += whole * MIN;
    }
  });
  const end = () => {
    lastTurn = null;
  };
  art.addEventListener('pointerup', end);
  art.addEventListener('pointercancel', end);
  // Keyboard: with the crown out, arrow keys move the minute hand.
  art.setAttribute('tabindex', '0');
  art.setAttribute('aria-label', `${w.name}: drawn watch face`);
  art.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleCrown();
      return;
    }
    if (!crownOut) return;
    const step = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const mins = step * (e.shiftKey ? 60 : 1);
    state.manual += mins * MIN;
    if (paused !== null) paused += mins * MIN;
  });

  render();
  return h('div', { class: 'face-clock' }, h('div', { class: 'thumb large empty' }, art), h('div', { class: 'face-controls' }, modeBtns, crownBtn), caption);
}
