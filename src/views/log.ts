/**
 * The Log: every saved test across the whole collection, newest first.
 * Timegrapher readings, six-position sets, quartz tests and time checks,
 * with filters, assigning unassigned readings to a watch, and CSV export.
 */

import { ppmToDay, quartzGrade } from '../analysis/quartz';
import { db, isTimegraphable, POSITIONS, WIND_STATES, type Measurement, type QuartzTest, type TimeCheck, type Watch } from '../db';
import { h, select, toast } from '../util/dom';
import { fmtDateTime, fmtDuration, fmtMs, fmtRate, rateGrade } from '../util/format';

type Kind = 'reading' | 'set' | 'quartz' | 'check';

const KIND_LABEL: Record<Kind, string> = {
  reading: 'Timegrapher',
  set: 'Six-position test',
  quartz: 'Quartz test',
  check: 'Time check',
};

interface Entry {
  kind: Kind;
  key: string;
  at: number;
  watchId: string;
  /** Measurements in this entry (one, or a six-position set). */
  ms?: Measurement[];
  q?: QuartzTest;
  check?: TimeCheck;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const signed = (v: number, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;

function entries(ms: Measurement[], qs: QuartzTest[], cs: TimeCheck[]): Entry[] {
  const out: Entry[] = [];
  const sets = new Map<string, Measurement[]>();
  for (const m of ms) {
    if (m.testId) sets.set(m.testId, [...(sets.get(m.testId) ?? []), m]);
    else out.push({ kind: 'reading', key: m.id, at: m.takenAt, watchId: m.watchId, ms: [m] });
  }
  for (const [id, set] of sets) {
    set.sort((a, b) => a.takenAt - b.takenAt);
    out.push({ kind: 'set', key: id, at: set[0].takenAt, watchId: set[0].watchId, ms: set });
  }
  for (const q of qs) out.push({ kind: 'quartz', key: q.id, at: q.at, watchId: q.watchId, q });
  for (const c of cs) out.push({ kind: 'check', key: c.id, at: c.at, watchId: c.watchId, check: c });
  return out.sort((a, b) => b.at - a.at);
}

/** Result, details and notes for one entry, as plain values (shared by the table and CSV). */
function describe(e: Entry) {
  if (e.kind === 'reading') {
    const m = e.ms![0];
    return {
      value: m.rate,
      unit: 's/day',
      sigma: null as number | null,
      result: `${fmtRate(m.rate)} s/d`,
      grade: rateGrade(m.rate),
      details: [`BE ${fmtMs(m.beatError)} ms`, m.amplitude !== null ? `${Math.round(m.amplitude)}°` : '', POSITIONS[m.position], m.wind !== 'unknown' ? WIND_STATES[m.wind] : '', fmtDuration(m.durationSec)].filter(Boolean).join(' · '),
      notes: m.notes,
      beatError: m.beatError,
      amplitude: m.amplitude,
      bph: m.bph,
      duration: m.durationSec,
      position: POSITIONS[m.position],
    };
  }
  if (e.kind === 'set') {
    const set = e.ms!;
    const rates = set.map((m) => m.rate);
    const avg = mean(rates);
    const amps = set.map((m) => m.amplitude).filter((a): a is number => a !== null);
    const bes = set.map((m) => m.beatError).filter((b): b is number => b !== null);
    return {
      value: avg,
      unit: 's/day',
      sigma: null,
      result: `${fmtRate(avg)} s/d avg`,
      grade: rateGrade(avg),
      details: [`${set.length} position${set.length === 1 ? '' : 's'}`, set.length > 1 ? `Δ ${(Math.max(...rates) - Math.min(...rates)).toFixed(1)} s/d` : '', bes.length ? `max BE ${fmtMs(Math.max(...bes))} ms` : '', amps.length ? `${Math.round(mean(amps))}°` : ''].filter(Boolean).join(' · '),
      notes: set[0].notes.replace(/^6-position test( · )?/, ''),
      beatError: bes.length ? Math.max(...bes) : null,
      amplitude: amps.length ? mean(amps) : null,
      bph: set[0].bph,
      duration: set.reduce((a, m) => a + m.durationSec, 0),
      position: 'six positions',
    };
  }
  if (e.kind === 'quartz') {
    const q = e.q!;
    return {
      value: q.perMonth,
      unit: 's/month',
      sigma: q.sigmaMonth,
      result: `${signed(q.perMonth)} s/mo ± ${q.sigmaMonth.toFixed(1)}`,
      grade: quartzGrade(q.perMonth),
      details: [`${signed(ppmToDay(q.ppm), 2)} s/d`, q.stepSec === 2 ? '2 s steps: low battery/charge' : '1 s steps', `${Math.round(q.durationSec / 60)} min`, q.clock.source === 'none' ? 'clock not corrected' : 'clock corrected'].join(' · '),
      notes: q.notes,
      beatError: null,
      amplitude: null,
      bph: null,
      duration: q.durationSec,
      position: '',
    };
  }
  const c = e.check!;
  return {
    value: c.offset,
    unit: 's offset',
    sigma: null,
    result: `${signed(c.offset)} s`,
    grade: '',
    details: [c.reset ? 'set to time' : 'check', c.source === 'internet' ? 'internet time' : 'device clock'].join(' · '),
    notes: c.notes,
    beatError: null,
    amplitude: null,
    bph: null,
    duration: null,
    position: '',
  };
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function logView(root: HTMLElement): void {
  let kind: Kind | 'all' = 'all';
  let watchFilter = 'all';
  let all: Entry[] = [];
  let watches: Watch[] = [];

  const filtersEl = h('div', { class: 'log-filters form-grid' });
  const countsEl = h('p', { class: 'muted small' });
  const tableEl = h('div', { class: 'table-wrap' });

  const load = async () => {
    const [w, ms, qs, cs] = await Promise.all([db.watches.orderBy('name').toArray(), db.measurements.toArray(), db.qtests.toArray(), db.checks.toArray()]);
    watches = w;
    all = entries(ms, qs, cs);
    renderFilters();
    renderTable();
  };

  const visible = () => all.filter((e) => (kind === 'all' || e.kind === kind) && (watchFilter === 'all' || (watchFilter === '' ? !watches.some((w) => w.id === e.watchId) : e.watchId === watchFilter)));

  function renderFilters() {
    const unassigned = all.filter((e) => !watches.some((w) => w.id === e.watchId)).length;
    filtersEl.replaceChildren(
      h(
        'label',
        { class: 'field' },
        h('span', null, 'Type'),
        select(
          [['all', 'All tests'], ...(Object.entries(KIND_LABEL) as Array<[Kind, string]>)],
          kind,
          (v) => {
            kind = v as Kind | 'all';
            renderTable();
          },
        ),
      ),
      h(
        'label',
        { class: 'field' },
        h('span', null, 'Watch'),
        select(
          [['all', 'All watches'], ...(unassigned ? ([['', `Unassigned (${unassigned})`]] as Array<[string, string]>) : []), ...watches.map((w): [string, string] => [w.id, w.name])],
          watchFilter,
          (v) => {
            watchFilter = v;
            renderTable();
          },
        ),
      ),
    );
  }

  function renderTable() {
    const rows = visible();
    const byKind = (k: Kind) => rows.filter((e) => e.kind === k).length;
    countsEl.textContent = rows.length
      ? `${rows.length} test${rows.length === 1 ? '' : 's'}: ${(Object.keys(KIND_LABEL) as Kind[])
          .map((k) => [k, byKind(k)] as const)
          .filter(([, n]) => n)
          .map(([k, n]) => `${n} ${KIND_LABEL[k].toLowerCase()}${n === 1 ? '' : 's'}`)
          .join(', ')}`
      : '';
    if (!rows.length) {
      tableEl.replaceChildren(
        h('p', { class: 'muted' }, all.length ? 'No tests match these filters.' : 'No tests yet. Every valid reading on Measure, six-position test and quartz test is saved here automatically.'),
      );
      return;
    }
    tableEl.replaceChildren(
      h(
        'table',
        { class: 'table log-table' },
        h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Watch'), h('th', { class: 'hide-sm' }, 'Test'), h('th', { class: 'num' }, 'Result'), h('th', { class: 'hide-sm' }, 'Details'), h('th', { class: 'hide-sm' }, 'Notes'), h('th', null, ''))),
        h('tbody', null, rows.map(row)),
      ),
    );
  }

  function row(e: Entry): HTMLElement {
    const d = describe(e);
    const w = watches.find((x) => x.id === e.watchId);
    const watchCell = w
      ? h('a', { href: `#/watches/${w.id}` }, w.name)
      : e.ms
        ? select(
            [['', 'Unassigned: choose…'], ...watches.filter(isTimegraphable).map((x): [string, string] => [x.id, x.name])],
            '',
            async (v) => {
              if (!v) return;
              await Promise.all(e.ms!.map((m) => db.measurements.update(m.id, { watchId: v })));
              toast(`Assigned to ${watches.find((x) => x.id === v)?.name}`);
              void load();
            },
            { class: 'log-assign' },
          )
        : h('span', { class: 'muted' }, 'Deleted watch');
    return h(
      'tr',
      null,
      h('td', { class: 'nowrap c-date' }, fmtDateTime(e.at), h('span', { class: 'show-sm muted small' }, KIND_LABEL[e.kind])),
      h('td', { class: 'c-watch' }, watchCell),
      h('td', { class: 'hide-sm' }, KIND_LABEL[e.kind]),
      h('td', { class: 'num c-res' }, d.grade ? h('span', { class: 'rate-pill', 'data-grade': d.grade }, d.result) : d.result),
      h('td', { class: 'hide-sm muted small' }, d.details),
      h('td', { class: 'hide-sm notes' }, d.notes),
      h(
        'td',
        { class: 'c-del' },
        h(
          'button',
          {
            class: 'icon-btn',
            title: 'Delete',
            'aria-label': 'Delete',
            onclick: async () => {
              if (!confirm(`Delete this ${KIND_LABEL[e.kind].toLowerCase()}?`)) return;
              if (e.ms) await db.measurements.bulkDelete(e.ms.map((m) => m.id));
              else if (e.q) await db.qtests.delete(e.q.id);
              else if (e.check) await db.checks.delete(e.check.id);
              void load();
            },
          },
          '×',
        ),
      ),
    );
  }

  function exportCsv() {
    const rows = visible();
    const header = ['date', 'watch', 'brand', 'caliber', 'test', 'result', 'unit', 'uncertainty', 'beat_error_ms', 'amplitude_deg', 'bph', 'position', 'duration_s', 'details', 'notes'];
    const lines = rows.map((e) => {
      const d = describe(e);
      const w = watches.find((x) => x.id === e.watchId);
      return [new Date(e.at).toISOString(), w?.name ?? '', w?.brand ?? '', w?.caliber ?? '', KIND_LABEL[e.kind], d.value.toFixed(2), d.unit, d.sigma?.toFixed(2) ?? '', d.beatError?.toFixed(2) ?? '', d.amplitude === null ? '' : Math.round(d.amplitude), d.bph ?? '', d.position, d.duration === null ? '' : d.duration.toFixed(0), d.details, d.notes];
    });
    const blob = new Blob([[header, ...lines].map((r) => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `escapement-log-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  root.append(
    h(
      'div',
      { class: 'page' },
      h('header', { class: 'page-head' }, h('h1', null, 'Log'), h('button', { class: 'btn', onclick: exportCsv }, 'Export CSV')),
      h('p', { class: 'muted' }, 'Every saved test across your collection. Readings taken without a watch chosen land here as unassigned; pick the watch to file them.'),
      h('section', { class: 'panel' }, filtersEl, countsEl, tableEl),
    ),
  );
  void load();
}
