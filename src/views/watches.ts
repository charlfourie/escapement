import { db, isTimegraphable, MOVEMENT_TYPES, type Measurement, type TimeCheck, type Watch } from '../db';
import { driftGrade, driftOf, fmtDrift } from './time-check';
import { applyCrop, dialGlyph, h, photoUrl } from '../util/dom';
import { watchArt } from './watch-art';
import { fmtDate, fmtMs, fmtRate, rateGrade } from '../util/format';

export function watchThumb(w: Watch, cls = 'thumb'): HTMLElement {
  if (!w.photo) return h('div', { class: `${cls} empty` }, watchArt(w));
  const img = h('img', { src: photoUrl(w.photo), alt: '' });
  applyCrop(img, w.photoCrop);
  return h('div', { class: cls }, img);
}

export function watchesView(root: HTMLElement): void {
  const grid = h('div', { class: 'watch-grid' });
  root.append(
    h(
      'div',
      { class: 'page' },
      h('header', { class: 'page-head' }, h('h1', null, 'Your watches'), h('a', { class: 'btn primary', href: '#/watches/new' }, '+ Add watch')),
      grid,
    ),
  );

  void (async () => {
    const [watches, measurements, checks] = await Promise.all([db.watches.orderBy('name').toArray(), db.measurements.orderBy('takenAt').reverse().toArray(), db.checks.toArray()]);
    const checksBy = new Map<string, TimeCheck[]>();
    for (const c of checks) checksBy.set(c.watchId, [...(checksBy.get(c.watchId) ?? []), c]);
    const byWatch = new Map<string, Measurement[]>();
    for (const m of measurements) {
      if (!byWatch.has(m.watchId)) byWatch.set(m.watchId, []);
      byWatch.get(m.watchId)!.push(m);
    }

    if (!watches.length) {
      grid.replaceWith(
        h(
          'div',
          { class: 'empty-state' },
          dialGlyph(),
          h('h2', null, 'No watches yet'),
          h('p', null, 'Add the watches in your collection to track how each one keeps time.'),
          h('div', { class: 'actions' }, h('a', { class: 'btn primary', href: '#/watches/new' }, 'Add your first watch'), h('a', { class: 'btn', href: '#/measure' }, 'Try a quick test')),
        ),
      );
      return;
    }

    grid.replaceChildren(
      ...watches.map((w) => {
        const ms = byWatch.get(w.id) ?? [];
        const latest = ms[0];
        const drift = driftOf(checksBy.get(w.id) ?? []);
        const quartz = !isTimegraphable(w);
        const meta = [w.brand, w.reference].filter(Boolean).join(' · ');
        return h(
          'a',
          { class: 'watch-card', href: `#/watches/${w.id}` },
          watchThumb(w),
          h(
            'div',
            { class: 'watch-card-body' },
            h('h3', null, w.name),
            meta && h('p', { class: 'muted small' }, meta),
            w.caliber && h('p', { class: 'muted small' }, `Cal. ${w.caliber}`),
            quartz && drift
              ? h('div', { class: 'latest' }, h('span', { class: 'rate-pill', 'data-grade': driftGrade(drift, true) }, fmtDrift(drift, true)), h('span', { class: 'muted small' }, `${MOVEMENT_TYPES[w.movementType!]} · ${drift.checks} checks`))
              : quartz
                ? h('div', { class: 'latest muted small' }, `${MOVEMENT_TYPES[w.movementType!]} · no time checks yet`)
                : latest
              ? h(
                  'div',
                  { class: 'latest' },
                  h('span', { class: `rate-pill`, 'data-grade': rateGrade(latest.rate) }, `${fmtRate(latest.rate)} s/d`),
                  h('span', { class: 'muted small' }, `${fmtMs(latest.beatError)} ms · ${fmtDate(latest.takenAt)}`),
                )
              : h('div', { class: 'latest muted small' }, 'Not measured yet'),
            !(quartz && !ms.length) && h('p', { class: 'muted small count' }, `${ms.length} measurement${ms.length === 1 ? '' : 's'}`),
          ),
        );
      }),
    );
  })();
}
