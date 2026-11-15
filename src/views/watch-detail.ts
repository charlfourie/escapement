import { db, deleteWatch, isTimegraphable, movementId, MOVEMENT_TYPES, POSITIONS, WIND_STATES, watchMeasurements, type Measurement } from '../db';
import { timeCheckPanel } from './time-check';
import { batteryPanel, quartzTestsPanel } from './quartz-panel';
import { drawTrace } from '../ui/canvas';
import { historyChart } from '../ui/history-chart';
import { h, toast } from '../util/dom';
import { fmtBph, fmtDate, fmtDateTime, fmtDuration, fmtMs, fmtRate, rateGrade, ranfftUrl } from '../util/format';
import { watchThumb } from './watches';
import { escapementNote, findMovement, loadArchive } from '../data/movements';
import { movementFinder } from './movement-finder';
import { interactiveFace } from './face-clock';

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function watchDetailView(root: HTMLElement, id: string): void {
  void (async () => {
    const w = await db.watches.get(id);
    if (!w) {
      root.append(h('div', { class: 'page' }, h('p', null, 'That watch doesn’t exist. ', h('a', { href: '#/watches' }, 'Back to watches'))));
      return;
    }
    let ms = await watchMeasurements(id);
    const mech = isTimegraphable(w);

    const specs: Array<[string, string]> = (
      [
        ['Brand', w.brand],
        ['Reference', w.reference],
        ['Movement', w.movementType ? MOVEMENT_TYPES[w.movementType] : ''],
        ['Caliber', w.caliber],
        ['Beat rate', mech ? (w.bph ? `${fmtBph(w.bph)} bph` : 'Auto-detect') : ''],
        ['Lift angle', mech ? `${w.liftAngle}°` : ''],
        ['Purchased', w.purchaseDate && fmtDate(Date.parse(w.purchaseDate))],
        ['Last serviced', w.lastService && fmtDate(Date.parse(w.lastService))],
      ] as Array<[string, string]>
    ).filter(([, v]) => v);

    // The caliber's documented lift angle differs from the watch's: amplitude would be off.
    await loadArchive();
    const [checks, quartz] = await Promise.all([db.checks.where('watchId').equals(id).toArray(), db.qtests.where('watchId').equals(id).toArray()]);
    const ref = findMovement(w.caliber, w.brand);
    const liftHint = () => {
      const note = ref ? escapementNote(ref) : '';
      if (note && mech) return h('p', { class: 'small warn-text lift-hint' }, note);
      if (!mech || !ref?.liftAngle || ref.liftAngle === w.liftAngle) return '';
      const el = h(
        'p',
        { class: 'small warn-text lift-hint' },
        `The ${ref.maker} ${ref.caliber} has a documented lift angle of ${ref.liftAngle}°; this watch is set to ${w.liftAngle}°, which skews amplitude by roughly ${Math.round(Math.abs(ref.liftAngle - w.liftAngle) * 6)}°. `,
        h(
          'button',
          {
            class: 'link-btn',
            onclick: async () => {
              await db.watches.update(w.id, { liftAngle: ref.liftAngle!, updatedAt: Date.now() });
              w.liftAngle = ref.liftAngle!;
              el.replaceWith(h('p', { class: 'small muted' }, `Lift angle set to ${ref.liftAngle}°.`));
              toast('Lift angle updated');
            },
          },
          `Use ${ref.liftAngle}°`,
        ),
      );
      return el;
    };

    const statsEl = h('div', { class: 'stat-row' });
    const chartWrap = h('div', { class: 'chart-wrap' });
    const tableWrap = h('div', { class: 'table-wrap' });

    const render = () => {
      if (!ms.length) {
        statsEl.replaceChildren();
        chartWrap.replaceChildren(h('p', { class: 'muted' }, 'No measurements yet.'));
        tableWrap.replaceChildren();
        return;
      }
      const rates = ms.map((m) => m.rate);
      const recent = ms.slice(0, 6);
      const positions = new Map<string, number[]>();
      for (const m of recent) positions.set(m.position, [...(positions.get(m.position) ?? []), m.rate]);
      const posAvg = [...positions.values()].map(mean);
      const delta = posAvg.length > 1 ? Math.max(...posAvg) - Math.min(...posAvg) : null;
      const bes = ms.map((m) => m.beatError).filter((v): v is number => v !== null);
      const stat = (label: string, value: string, grade?: string, note?: string) =>
        h('div', { class: 'stat', 'data-grade': grade }, h('div', { class: 'ro-label' }, label), h('div', { class: 'stat-value' }, value), note && h('div', { class: 'muted small' }, note));
      statsEl.replaceChildren(
        stat('Latest', `${fmtRate(ms[0].rate)} s/d`, rateGrade(ms[0].rate), fmtDate(ms[0].takenAt)),
        stat('Average (last 6)', `${fmtRate(mean(recent.map((m) => m.rate)))} s/d`, rateGrade(mean(recent.map((m) => m.rate)))),
        stat('Positional delta', delta === null ? '—' : `${delta.toFixed(1)} s/d`, undefined, delta === null ? 'Measure in 2+ positions' : `${positions.size} positions`),
        stat('Beat error (avg)', bes.length ? `${mean(bes).toFixed(1)} ms` : '—'),
        stat('Range', `${fmtRate(Math.min(...rates))} … ${fmtRate(Math.max(...rates))}`, undefined, `${ms.length} readings`),
      );
      chartWrap.replaceChildren(historyChart(ms, chartWrap.clientWidth || 640));
      tableWrap.replaceChildren(table());
    };

    const table = () => {
      const tbody = h('tbody');
      for (const m of ms) {
        const traceRow = h('tr', { class: 'trace-row', hidden: true }, h('td', { colspan: 9 }, h('canvas', { class: 'trace small' })));
        const row = h(
          'tr',
          {
            class: 'clickable',
            title: 'Show trace',
            onclick: () => {
              traceRow.hidden = !traceRow.hidden;
              if (!traceRow.hidden) drawTrace(traceRow.querySelector('canvas')!, m.trace, { spanMs: 10, windowSec: null });
            },
          },
          h('td', null, fmtDateTime(m.takenAt)),
          h('td', null, POSITIONS[m.position]),
          h('td', { class: 'hide-sm' }, WIND_STATES[m.wind]),
          h('td', { class: 'num' }, h('span', { class: 'rate-pill', 'data-grade': rateGrade(m.rate) }, fmtRate(m.rate))),
          h('td', { class: 'num' }, fmtMs(m.beatError)),
          h('td', { class: 'num hide-sm' }, m.amplitude === null ? '—' : `${Math.round(m.amplitude)}°`),
          h('td', { class: 'num hide-sm' }, fmtDuration(m.durationSec)),
          h('td', { class: 'hide-sm notes' }, m.notes),
          h(
            'td',
            null,
            h(
              'button',
              {
                class: 'icon-btn',
                title: 'Delete measurement',
                'aria-label': 'Delete measurement',
                onclick: async (e: Event) => {
                  e.stopPropagation();
                  if (!confirm('Delete this measurement?')) return;
                  await db.measurements.delete(m.id);
                  ms = ms.filter((x: Measurement) => x.id !== m.id);
                  render();
                },
              },
              '×',
            ),
          ),
        );
        tbody.append(row, traceRow);
      }
      return h(
        'table',
        { class: 'table' },
        h(
          'thead',
          null,
          h('tr', null, h('th', null, 'Date'), h('th', null, 'Position'), h('th', { class: 'hide-sm' }, 'Wind'), h('th', { class: 'num' }, 's/d'), h('th', { class: 'num' }, 'BE ms'), h('th', { class: 'num hide-sm' }, 'Amp'), h('th', { class: 'num hide-sm' }, 'Length'), h('th', { class: 'hide-sm' }, 'Notes'), h('th', null, '')),
        ),
        tbody,
      );
    };

    root.append(
      h(
        'div',
        { class: 'page' },
        h('a', { class: 'back', href: '#/watches' }, '← All watches'),
        h(
          'header',
          { class: 'watch-head' },
          w.photo && !w.face?.preferArt ? watchThumb(w, 'thumb large') : interactiveFace(w, { checks, quartz, readings: ms }),
          h(
            'div',
            { class: 'watch-head-body' },
            h('h1', null, w.name),
            h('dl', { class: 'specs' }, specs.map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, v)))),
            w.caliber &&
              h(
                'p',
                { class: 'small movement-links' },
                h('a', { href: `#/movements/${encodeURIComponent(movementId(w.caliber))}` }, `Movement ${w.caliber} →`),
                h('a', { href: ranfftUrl(w.brand, w.caliber), target: '_blank', rel: 'noopener' }, 'Ranfft DB ↗'),
              ),
            liftHint(),
            w.notes && h('p', { class: 'muted notes-text' }, w.notes),
            h(
              'div',
              { class: 'actions' },
              mech && h('a', { class: 'btn primary', href: `#/measure?watch=${w.id}` }, 'Measure'),
              h('a', { class: 'btn', href: `#/watches/${w.id}/edit` }, 'Edit'),
              h(
                'button',
                {
                  class: 'btn danger',
                  onclick: async () => {
                    if (!confirm(`Delete ${w.name} and all its measurements?`)) return;
                    await deleteWatch(w.id);
                    toast(`${w.name} deleted`);
                    location.hash = '#/watches';
                  },
                },
                'Delete',
              ),
            ),
          ),
        ),
        // A mechanical watch without a known caliber: help find it.
        mech &&
          !ref &&
          movementFinder(w, ms, () => {
            root.replaceChildren();
            watchDetailView(root, id);
          }),
        // Quartz: acoustic tests and time checks are the measurement, plus the
        // battery log. Mechanical: timegrapher first, time checks after.
        !mech && quartzTestsPanel(w),
        !mech && timeCheckPanel(w, () => {}),
        !mech && batteryPanel(w, () => {}),
        (mech || ms.length > 0) && statsEl,
        (mech || ms.length > 0) && h('section', { class: 'panel' }, h('header', { class: 'panel-head' }, h('h2', null, 'Rate over time')), chartWrap),
        (mech || ms.length > 0) && h('section', { class: 'panel' }, h('header', { class: 'panel-head' }, h('h2', null, 'Measurements'), h('span', { class: 'muted small' }, 'Click a row to see its trace')), tableWrap),
        mech && timeCheckPanel(w, () => {}),
      ),
    );
    render();
  })();
}
