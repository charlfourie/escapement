/** Quartz tests and battery log panels for a quartz watch's page. */

import { ppmToDay, quartzGrade } from '../analysis/quartz';
import { db, watchQuartzTests, type BatteryChange, type QuartzTest, type Watch } from '../db';
import { h, toast } from '../util/dom';
import { fmtDateTime } from '../util/format';
import { lowStepMessage } from './quartz-test';

const fmtSigned = (v: number, digits = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`;

/** Typical life of the cell before it's worth replacing, years. */
function cellLife(w: Pick<Watch, 'movementType'>): number {
  return w.movementType === 'solar' || w.movementType === 'kinetic' ? 10 : 3;
}

export function cellName(w: Pick<Watch, 'movementType'>): string {
  return w.movementType === 'solar' ? 'Rechargeable cell' : w.movementType === 'kinetic' ? 'Storage cell' : 'Battery';
}

export interface BatteryStatus {
  last: BatteryChange | null;
  /** Age of the current cell in years, if a change is logged. */
  years: number | null;
  /** Old enough to think about replacing. */
  due: boolean;
}

export function batteryStatus(w: Watch): BatteryStatus {
  const last = w.batteries?.[0] ?? null;
  const t = last ? Date.parse(last.date) : NaN;
  const years = Number.isFinite(t) ? (Date.now() - t) / (365.25 * 86400e3) : null;
  return { last, years, due: years !== null && years >= cellLife(w) };
}

const fmtAge = (years: number) => (years < 1 ? `${Math.max(0, Math.round(years * 12))} months` : `${years.toFixed(years < 3 ? 1 : 0)} years`);

export function quartzTestsPanel(w: Watch): HTMLElement {
  const body = h('div');
  const panel = h(
    'section',
    { class: 'panel' },
    h(
      'header',
      { class: 'panel-head' },
      h('h2', null, 'Quartz tests'),
      h('div', { class: 'actions' }, h('a', { class: 'btn small', href: '#/quartz/calibrate' }, 'Calibrate computer'), h('a', { class: 'btn primary small', href: `#/quartz/${w.id}` }, 'Run quartz test')),
    ),
    body,
  );

  const render = (tests: QuartzTest[]) => {
    if (!tests.length) {
      body.replaceChildren(h('p', { class: 'muted' }, 'Times the seconds hand’s motor through the pickup for 5–20 minutes: a rate in seconds a month, without waiting days between time checks.'));
      return;
    }
    const latest = tests[0];
    body.replaceChildren(
      latest.stepSec === 2 ? h('div', { class: 'message warn' }, lowStepMessage(w)) : '',
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'table q-tests' },
          h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', { class: 'num' }, 's/month'), h('th', { class: 'num' }, '±'), h('th', { class: 'num hide-sm' }, 's/day'), h('th', { class: 'hide-sm' }, 'Steps'), h('th', { class: 'num hide-sm' }, 'Length'), h('th', { class: 'hide-sm' }, 'Notes'), h('th', null, ''))),
          h(
            'tbody',
            null,
            tests.map((t) =>
              h(
                'tr',
                null,
                h('td', null, fmtDateTime(t.at)),
                h('td', { class: 'num' }, h('span', { class: 'rate-pill', 'data-grade': quartzGrade(t.perMonth) }, fmtSigned(t.perMonth))),
                h('td', { class: 'num', title: t.clock.source === 'none' ? 'Sound card clock not corrected' : 'Corrected for the sound card clock' }, `${t.sigmaMonth.toFixed(1)}${t.clock.source === 'none' ? '*' : ''}`),
                h('td', { class: 'num hide-sm' }, fmtSigned(ppmToDay(t.ppm), 2)),
                h('td', { class: `hide-sm${t.stepSec === 2 ? ' warn' : ''}` }, t.stepSec === 2 ? '2 s: low' : '1 s'),
                h('td', { class: 'num hide-sm' }, `${Math.round(t.durationSec / 60)} min`),
                h('td', { class: 'hide-sm notes' }, t.notes),
                h(
                  'td',
                  null,
                  h(
                    'button',
                    {
                      class: 'icon-btn',
                      title: 'Delete test',
                      'aria-label': 'Delete test',
                      onclick: async () => {
                        if (!confirm('Delete this quartz test?')) return;
                        await db.qtests.delete(t.id);
                        void load();
                      },
                    },
                    '×',
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
      tests.some((t) => t.clock.source === 'none') ? h('p', { class: 'muted small' }, '* Not corrected for the computer’s sound-card clock: may be off by tens of seconds a month.') : '',
    );
  };
  const load = async () => render(await watchQuartzTests(w.id));
  void load();
  return panel;
}

export function batteryPanel(w: Watch, onChange: () => void): HTMLElement {
  const body = h('div');
  const name = cellName(w);
  const panel = h('section', { class: 'panel' }, h('header', { class: 'panel-head' }, h('h2', null, name), h('span', { class: 'muted small' }, 'changes, newest first')), body);

  const save = async (batteries: BatteryChange[]) => {
    const fresh = await db.watches.get(w.id);
    if (!fresh) return;
    fresh.batteries = batteries;
    fresh.updatedAt = Date.now();
    await db.watches.put(fresh);
    w.batteries = batteries;
    render();
    onChange();
  };

  const render = () => {
    const list = w.batteries ?? [];
    const st = batteryStatus(w);
    const date = h('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });
    const type = h('input', { type: 'text', placeholder: w.movementType === 'solar' ? 'e.g. MT920' : 'e.g. SR626SW', value: list[0]?.type ?? '' });
    const notes = h('input', { type: 'text', placeholder: 'Optional, e.g. done at the mall kiosk, new gasket' });
    body.replaceChildren(
      st.last && st.years !== null
        ? h(
            'p',
            null,
            `Current ${name.toLowerCase()}: ${st.last.type || 'type not noted'}, fitted ${fmtAge(st.years)} ago.`,
            st.due
              ? h('span', { class: 'warn-text' }, w.movementType === 'solar' || w.movementType === 'kinetic' ? ' Cells like this usually last 10–20 years; if it no longer holds a charge, have it replaced.' : ' Watch batteries usually last 2–5 years. Consider replacing it before it runs flat: a dead battery can leak.')
              : '',
          )
        : h('p', { class: 'muted' }, w.movementType === 'solar' ? 'Solar watches charge a rechargeable cell that lasts many years. Log it here if it’s ever replaced.' : 'Log battery changes to keep track of the battery’s age.'),
      list.length
        ? h(
            'ul',
            { class: 'battery-list' },
            list.map((b, i) =>
              h(
                'li',
                null,
                `${b.date} · ${b.type || '—'}${b.notes ? ` · ${b.notes}` : ''} `,
                h(
                  'button',
                  {
                    class: 'icon-btn',
                    title: 'Remove',
                    'aria-label': 'Remove entry',
                    onclick: () => {
                      if (confirm('Remove this entry?')) void save(list.filter((_, j) => j !== i));
                    },
                  },
                  '×',
                ),
              ),
            ),
          )
        : '',
      h(
        'div',
        { class: 'battery-row' },
        h('label', { class: 'field' }, h('span', null, 'Date'), date),
        h('label', { class: 'field' }, h('span', null, 'Type'), type),
        h('label', { class: 'field grow' }, h('span', null, 'Notes'), notes),
        h(
          'button',
          {
            class: 'btn',
            onclick: () => {
              if (!date.value) return;
              const entry: BatteryChange = { date: date.value, type: type.value.trim(), notes: notes.value.trim() };
              void save([entry, ...list].sort((a, b) => b.date.localeCompare(a.date))).then(() => toast(`${name} change logged`));
            },
          },
          'Log change',
        ),
      ),
    );
  };
  render();
  return panel;
}
