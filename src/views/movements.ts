import { STANDARD_BPH } from '../analysis/analyze';
import { db, movementId, type Measurement, type Movement, type Watch } from '../db';
import { h, toast } from '../util/dom';
import { fmtBph, fmtDate, fmtRate, rateGrade, ranfftUrl } from '../util/format';
import { ARCHIVE_URL, escapementNote, findMovement, loadArchive, REFERENCE_MOVEMENTS, referenceByIdAsync, type RefMovement } from '../data/movements';
import { MOVEMENT_TYPES, upsertMovement } from '../db';

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

interface MovementStats {
  watches: Watch[];
  readings: Measurement[];
  avgRate: number | null;
  avgBE: number | null;
}

async function loadAll(): Promise<{ movements: Movement[]; stats: Map<string, MovementStats> }> {
  const [movements, watches, readings] = await Promise.all([db.movements.orderBy('caliber').toArray(), db.watches.toArray(), db.measurements.toArray()]);
  const stats = new Map<string, MovementStats>();
  for (const m of movements) stats.set(m.id, { watches: [], readings: [], avgRate: null, avgBE: null });
  const watchMovement = new Map<string, string>();
  for (const w of watches) {
    const id = movementId(w.caliber ?? '');
    const s = stats.get(id);
    if (!s) continue;
    s.watches.push(w);
    watchMovement.set(w.id, id);
  }
  for (const r of readings) {
    const id = watchMovement.get(r.watchId);
    if (id) stats.get(id)!.readings.push(r);
  }
  for (const s of stats.values()) {
    s.avgRate = mean(s.readings.map((r) => r.rate));
    s.avgBE = mean(s.readings.map((r) => r.beatError).filter((v): v is number => v !== null));
  }
  return { movements, stats };
}

const ranfftLink = (m: Movement, text = 'Ranfft DB ↗') => h('a', { href: ranfftUrl(m.maker, m.caliber), target: '_blank', rel: 'noopener', title: `Look up ${m.caliber} on Ranfft DB` }, text);

export function movementsView(root: HTMLElement): void {
  const host = h('div');
  const refHost = h('div');
  root.append(
    h(
      'div',
      { class: 'page' },
      h('header', { class: 'page-head' }, h('h1', null, 'Movements')),
      h('p', { class: 'muted' }, 'Your movements, built from the calibers of your watches with your timing results across every watch that uses each one. Below them, a reference library of thousands of calibers: beat rate, lift angle where it’s documented, and more.'),
      host,
      refHost,
    ),
  );

  void (async () => {
    const [{ movements, stats }, watches] = await Promise.all([loadAll(), db.watches.toArray()]);
    if (!movements.length) {
      host.replaceChildren(
        h('section', { class: 'panel' }, h('h2', null, 'Your movements'), h('p', { class: 'muted' }, 'None yet. Give a watch a caliber (or let “Identify with AI” find it) and its movement appears here.')),
      );
    } else {
      host.replaceChildren(
      h(
        'section',
        { class: 'panel' },
        h('h2', null, 'Your movements'),
        h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            { class: 'table' },
            h(
              'thead',
              null,
              h(
                'tr',
                null,
                h('th', null, 'Caliber'),
                h('th', { class: 'hide-sm' }, 'Maker'),
                h('th', { class: 'num' }, 'bph'),
                h('th', { class: 'num hide-sm' }, 'Jewels'),
                h('th', { class: 'num' }, 'Watches'),
                h('th', { class: 'num' }, 'Readings'),
                h('th', { class: 'num' }, 'Avg s/d'),
                h('th', { class: 'hide-sm' }, ''),
              ),
            ),
            h(
              'tbody',
              null,
              movements.map((m) => {
                const s = stats.get(m.id)!;
                return h(
                  'tr',
                  null,
                  h('td', null, h('a', { href: `#/movements/${encodeURIComponent(m.id)}` }, h('strong', null, m.caliber))),
                  h('td', { class: 'hide-sm' }, m.maker || '—'),
                  h('td', { class: 'num' }, m.bph ? fmtBph(m.bph) : '—'),
                  h('td', { class: 'num hide-sm' }, m.jewels ?? '—'),
                  h('td', { class: 'num' }, s.watches.length),
                  h('td', { class: 'num' }, s.readings.length),
                  h('td', { class: 'num' }, s.avgRate === null ? '—' : h('span', { class: 'rate-pill', 'data-grade': rateGrade(s.avgRate) }, fmtRate(s.avgRate))),
                  h('td', { class: 'hide-sm' }, ranfftLink(m)),
                );
              }),
            ),
          ),
        ),
      ),
      );
    }
    refHost.replaceChildren(referenceLibrary(watches));
  })();
}

/** Searchable table: the sourced library plus Watch Movements Archive. */
function referenceLibrary(watches: Watch[]): HTMLElement {
  type Source = '' | 'lib' | 'wma';
  let source: Source = '';
  let query = '';
  let shown = PAGE;
  let all: RefMovement[] = REFERENCE_MOVEMENTS;
  const tbody = h('tbody');
  const count = h('span', { class: 'muted small' });
  const more = h('div', { class: 'ref-more' });
  const ownedIds = () => new Set(watches.map((w) => findMovement(w.caliber, w.brand)?.id).filter(Boolean));
  let owned = ownedIds();

  const matches = (m: RefMovement, q: string) =>
    [m.caliber, m.maker, ...(m.aliases ?? []), m.basedOn ?? ''].some((x) => x.toLowerCase().includes(q)) || (q.length > 2 && fullText(m).includes(q));

  const render = () => {
    const q = query.trim().toLowerCase();
    const rows = all.filter((m) => (!source || (source === 'wma') === !!m.archive) && (!q || matches(m, q)));
    count.textContent = `${rows.length.toLocaleString()} of ${all.length.toLocaleString()}`;
    tbody.replaceChildren(
      ...rows.slice(0, shown).map((m) =>
        h(
          'tr',
          null,
          h(
            'td',
            null,
            h('a', { href: `#/movements/${m.id}` }, h('strong', null, m.archive ? m.caliber : `${m.maker.split(/[ (]/)[0]} ${m.caliber}`)),
            owned.has(m.id) ? h('span', { class: 'ref-owned', title: 'One of your watches has this movement' }, ' ●') : '',
          ),
          h('td', { class: 'hide-sm' }, MOVEMENT_TYPES[m.type]),
          h('td', { class: 'num' }, m.bph ? `${fmtBph(m.bph)}${m.archive?.bphUnsure ? '?' : ''}` : '—'),
          h('td', { class: 'num' }, m.liftAngle ? `${m.liftAngle}°${m.coAxial ? ' *' : ''}` : '—'),
          h('td', { class: 'num hide-sm' }, m.archive?.jewels ?? m.jewels ?? '—'),
          h('td', { class: 'num hide-sm' }, m.powerReserveH ? `${m.powerReserveH} h` : '—'),
          h('td', { class: 'hide-sm muted' }, m.archive?.years ?? ''),
        ),
      ),
    );
    more.replaceChildren(
      rows.length > shown
        ? h('button', { type: 'button', class: 'btn small', onclick: () => ((shown += PAGE * 2), render()) }, `Show more (${(rows.length - shown).toLocaleString()} left)`)
        : '',
    );
  };

  const chip = (v: Source, label: string) =>
    h(
      'button',
      {
        type: 'button',
        class: `fd-chip${v === source ? ' active' : ''}`,
        onclick: (e: Event) => {
          source = v;
          shown = PAGE;
          chips.querySelectorAll('.fd-chip').forEach((c) => c.classList.toggle('active', c === e.currentTarget));
          render();
        },
      },
      label,
    );
  const chips = h('div', { class: 'fd-chips' }, chip('', 'All'), chip('lib', 'With lift angles'), chip('wma', 'Watch Movements Archive'));
  render();
  // The archive loads on demand.
  void loadArchive().then((arc) => {
    all = [...REFERENCE_MOVEMENTS, ...arc];
    owned = ownedIds();
    render();
  });
  return h(
    'section',
    { class: 'panel' },
    h('header', { class: 'panel-head' }, h('h2', null, 'Reference library'), count),
    h(
      'p',
      { class: 'muted small' },
      'Calibers and their specs. The first entries are Escapement’s own, each sourced, with lift angles where they’re documented (a wrong lift angle skews amplitude by about 6° per degree; * co-axial: amplitude only rough). The rest come from ',
      h('a', { href: ARCHIVE_URL, target: '_blank', rel: 'noopener' }, 'Watch Movements Archive'),
      ', a database by the UHRFORUM.de community, used with permission. A ? marks a beat rate the archive could only estimate. ',
      h('a', { href: '#/links' }, 'Links & sources'),
    ),
    h('div', { class: 'ref-filters' }, h('input', { type: 'search', placeholder: 'Search, e.g. 2824, NH35, Unitas, chronograph', oninput: (e: Event) => ((query = (e.target as HTMLInputElement).value), (shown = PAGE), render()) }), chips),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'table ref-table' },
        h('thead', null, h('tr', null, h('th', null, 'Caliber'), h('th', { class: 'hide-sm' }, 'Type'), h('th', { class: 'num' }, 'bph'), h('th', { class: 'num' }, 'Lift angle'), h('th', { class: 'num hide-sm' }, 'Jewels'), h('th', { class: 'num hide-sm' }, 'Reserve'), h('th', { class: 'hide-sm' }, 'Made'))),
        tbody,
      ),
    ),
    more,
  );
}

const PAGE = 60;
const ESCAPEMENTS = { lever: 'Lever', cylinder: 'Cylinder', pin: 'Pin lever', fork: 'Tuning fork', '': '' } as const;
const fullText = (m: RefMovement) => [m.features, m.archive?.country, m.archive?.years, m.archive?.escapement && ESCAPEMENTS[m.archive.escapement]].join(' ').toLowerCase();

/** Specs card for a reference movement. */
function referenceCard(r: RefMovement, title = 'Reference specs'): HTMLElement {
  const row = (k: string, v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? '' : h('div', null, h('dt', null, k), h('dd', null, String(v))));
  const a = r.archive;
  const beat = r.bph ? `${fmtBph(r.bph)} bph (${+(r.bph / 7200).toFixed(2)} Hz)${a?.bphUnsure ? ', estimated' : ''}` : a?.hz ? `${a.hz} (not a ticking escapement)` : 'Unknown';
  const size = a?.lignes ? `${a.lignes}${r.diameterMm ? ` (${r.diameterMm} mm)` : ''}` : r.diameterMm ? `${r.diameterMm} mm` : null;
  const note = escapementNote(r);
  return h(
    'section',
    { class: 'panel' },
    h('h2', null, title),
    h(
      'dl',
      { class: 'specs ref-specs' },
      row('Maker', r.maker),
      row('Type', MOVEMENT_TYPES[r.type]),
      row('Beat rate', beat),
      row('Lift angle', r.liftAngle ? `${r.liftAngle}°` : 'Not documented'),
      row('Escapement', a?.escapement ? ESCAPEMENTS[a.escapement] : null),
      row('Jewels', a?.jewels ?? r.jewels),
      row(a?.lignes ? 'Size' : 'Diameter', size),
      row('Height', r.heightMm ? `${r.heightMm} mm` : null),
      row('Power reserve', r.powerReserveH ? `${r.powerReserveH} hours` : null),
      row('Made', a?.years),
      row('Country', a?.country),
      row('Based on', r.basedOn),
      row('Features', r.features),
      row('Also known as', r.aliases?.length ? (a ? r.aliases.join(', ') : r.aliases.join(', ').toUpperCase()) : null),
    ),
    r.notes && h('p', { class: 'small' }, r.notes),
    a?.identification && h('p', { class: 'small' }, h('strong', null, 'Identifying it: '), a.identification),
    r.coAxial && h('p', { class: 'small warn-text' }, 'Co-axial escapement: Escapement reads its rate and beat error normally, but its amplitude only roughly.'),
    note && h('p', { class: 'small warn-text' }, note),
    !r.liftAngle && r.bph && r.type !== 'quartz' && h('p', { class: 'small muted' }, 'No lift angle on record: amplitude uses the watch’s own setting (52° by default). If you find the documented figure, set it on the watch.'),
    a
      ? h(
          'p',
          { class: 'small muted' },
          'From ',
          h('a', { href: r.source, target: '_blank', rel: 'noopener' }, 'Watch Movements Archive ↗'),
          ', a database by the UHRFORUM.de community. Photos and full notes are on the archive page.',
        )
      : h('p', { class: 'small muted' }, 'Source: ', h('a', { href: r.source, target: '_blank', rel: 'noopener' }, new URL(r.source).hostname.replace(/^www\./, '')), ' · ', h('a', { href: ranfftUrl(r.maker.split(/[ (/]/)[0], r.caliber), target: '_blank', rel: 'noopener' }, 'Ranfft DB ↗')),
  );
}

export function movementDetailView(root: HTMLElement, rawId: string): void {
  const id = decodeURIComponent(rawId);
  void (async () => {
    const m = await db.movements.get(id);
    if (!m) {
      const r = await referenceByIdAsync(id);
      if (!r) {
        root.append(h('div', { class: 'page' }, h('p', null, 'That movement isn’t in your library. ', h('a', { href: '#/movements' }, 'Back to movements'))));
        return;
      }
      await loadArchive();
      const watches = (await db.watches.toArray()).filter((w) => findMovement(w.caliber, w.brand)?.id === r.id);
      root.append(
        h(
          'div',
          { class: 'page narrow' },
          h('a', { class: 'back', href: '#/movements' }, '← All movements'),
          h('header', { class: 'page-head' }, h('div', null, h('h1', null, r.archive ? r.caliber : `Caliber ${r.caliber}`), h('p', { class: 'muted' }, r.archive ? [r.archive.country, r.archive.years].filter(Boolean).join(' · ') : r.maker))),
          referenceCard(r, 'Specs'),
          watches.length
            ? h('section', { class: 'panel' }, h('h2', null, 'Your watches with this movement'), h('ul', null, watches.map((w) => h('li', null, h('a', { href: `#/watches/${w.id}` }, w.name)))))
            : '',
          h(
            'div',
            { class: 'actions' },
            h(
              'button',
              {
                class: 'btn',
                onclick: async () => {
                  const mv = await upsertMovement(r.archive ? r.caliber : r.caliber, {});
                  if (mv) {
                    toast(`Added ${r.caliber} to your movements`);
                    location.hash = `#/movements/${encodeURIComponent(mv.id)}`;
                  }
                },
              },
              'Add to my movements',
            ),
          ),
        ),
      );
      return;
    }
    await loadArchive();
    const ref = findMovement(m.caliber, m.maker);
    const { stats } = await loadAll();
    const s = stats.get(id)!;

    const edit = { ...m };
    const field = (label: string, input: HTMLElement, hint?: string) => h('label', { class: 'field' }, h('span', null, label), input, hint && h('small', { class: 'muted' }, hint));
    const textInput = (key: 'maker' | 'size' | 'caliber', placeholder = '') =>
      h('input', { type: 'text', value: edit[key], placeholder, oninput: (e: Event) => (edit[key] = (e.target as HTMLInputElement).value) });
    const numInput = (key: 'liftAngle' | 'jewels', min: number, max: number) =>
      h('input', {
        type: 'number',
        min,
        max,
        step: 1,
        value: edit[key] ?? '',
        oninput: (e: Event) => {
          const v = (e.target as HTMLInputElement).value;
          edit[key] = v === '' ? null : Number(v);
        },
      });
    const bphOptions = [...new Set([...STANDARD_BPH, ...(edit.bph ? [edit.bph] : [])])].sort((a, b) => a - b);
    const bphSel = h(
      'select',
      { onchange: (e: Event) => (edit.bph = Number((e.target as HTMLSelectElement).value) || null) },
      h('option', { value: '0', selected: !edit.bph }, 'Unknown'),
      bphOptions.map((b) => h('option', { value: String(b), selected: b === edit.bph }, `${fmtBph(b)} bph`)),
    );

    const perWatch = s.watches.map((w) => {
      const rs = s.readings.filter((r) => r.watchId === w.id).sort((a, b) => b.takenAt - a.takenAt);
      return { w, count: rs.length, avg: mean(rs.map((r) => r.rate)), latest: rs[0] };
    });
    const rates = s.readings.map((r) => r.rate);

    root.append(
      h(
        'div',
        { class: 'page narrow' },
        h('a', { class: 'back', href: '#/movements' }, '← All movements'),
        h(
          'header',
          { class: 'page-head' },
          h('div', null, h('h1', null, `Caliber ${m.caliber}`), m.maker && h('p', { class: 'muted' }, m.maker)),
          h('a', { class: 'btn', href: ranfftUrl(m.maker, m.caliber), target: '_blank', rel: 'noopener' }, 'Look up on Ranfft DB ↗'),
        ),
        h(
          'div',
          { class: 'stat-row three' },
          h('div', { class: 'stat' }, h('div', { class: 'ro-label' }, 'Your watches'), h('div', { class: 'stat-value' }, String(s.watches.length))),
          h('div', { class: 'stat' }, h('div', { class: 'ro-label' }, 'Readings'), h('div', { class: 'stat-value' }, String(s.readings.length))),
          h(
            'div',
            { class: 'stat', 'data-grade': s.avgRate === null ? undefined : rateGrade(s.avgRate) },
            h('div', { class: 'ro-label' }, 'Average rate'),
            h('div', { class: 'stat-value' }, s.avgRate === null ? '—' : `${fmtRate(s.avgRate)} s/d`),
            rates.length > 1 && h('div', { class: 'muted small' }, `${fmtRate(Math.min(...rates))} … ${fmtRate(Math.max(...rates))}`),
          ),
        ),
        ref ? referenceCard(ref, `Reference: ${ref.maker} ${ref.caliber}`) : '',
        perWatch.length > 0 &&
          h(
            'section',
            { class: 'panel' },
            h('h2', null, 'Watches with this movement'),
            h(
              'table',
              { class: 'table' },
              h('thead', null, h('tr', null, h('th', null, 'Watch'), h('th', { class: 'num' }, 'Readings'), h('th', { class: 'num' }, 'Avg s/d'), h('th', { class: 'hide-sm' }, 'Latest'))),
              h(
                'tbody',
                null,
                perWatch.map((p) =>
                  h(
                    'tr',
                    null,
                    h('td', null, h('a', { href: `#/watches/${p.w.id}` }, p.w.name)),
                    h('td', { class: 'num' }, p.count),
                    h('td', { class: 'num' }, p.avg === null ? '—' : h('span', { class: 'rate-pill', 'data-grade': rateGrade(p.avg) }, fmtRate(p.avg))),
                    h('td', { class: 'hide-sm muted' }, p.latest ? fmtDate(p.latest.takenAt) : 'Not measured'),
                  ),
                ),
              ),
            ),
          ),
        h(
          'form',
          {
            class: 'panel',
            onsubmit: async (e: Event) => {
              e.preventDefault();
              edit.maker = edit.maker.trim();
              edit.size = edit.size.trim();
              edit.updatedAt = Date.now();
              await db.movements.put(edit);
              toast('Movement saved');
            },
          },
          h('h2', null, 'Specs'),
          h('p', { class: 'muted small' }, 'Fill these in from the movement itself, a service sheet or Ranfft DB. The beat rate and lift angle help the timegrapher.'),
          h(
            'div',
            { class: 'form-grid' },
            field('Maker', textInput('maker', 'e.g. Seiko, ETA, Valjoux')),
            field('Beat rate', bphSel),
            field('Lift angle (°)', numInput('liftAngle', 30, 70), 'Leave empty if undocumented'),
            field('Jewels', numInput('jewels', 0, 100)),
            field('Size', textInput('size', 'e.g. 25.6 mm or 11½\'\'\'')),
            h(
              'label',
              { class: 'field wide' },
              h('span', null, 'Notes'),
              h('textarea', { rows: 3, oninput: (e: Event) => (edit.notes = (e.target as HTMLTextAreaElement).value) }, edit.notes),
            ),
          ),
          h(
            'div',
            { class: 'actions' },
            h('button', { class: 'btn primary', type: 'submit' }, 'Save specs'),
            h(
              'button',
              {
                type: 'button',
                class: 'btn danger',
                onclick: async () => {
                  if (!confirm(`Remove caliber ${m.caliber} from your movement library? Your watches and readings stay.`)) return;
                  await db.movements.delete(m.id);
                  toast('Movement removed');
                  location.hash = '#/movements';
                },
              },
              'Remove from library',
            ),
          ),
        ),
      ),
    );
  })();
}
