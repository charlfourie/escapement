import { db, upsertMovement, type Measurement, type Watch } from '../db';
import { caliberFor, findMovement, loadArchive, movementCandidates, REFERENCE_MOVEMENTS, type RefMovement } from '../data/movements';
import { h, toast } from '../util/dom';
import { fmtBph } from '../util/format';

/** Brands whose case numbers start with the caliber ("8200-S12345"). */
const CASE_NUMBER_BRANDS = ['citizen', 'seiko'];
const SHOW = 12;

/** The beat rate Escapement measured most often, else the watch's setting. */
function measuredBph(w: Watch, ms: Measurement[]): number | null {
  const n = new Map<number, number>();
  for (const m of ms) n.set(m.bph, (n.get(m.bph) ?? 0) + 1);
  const top = [...n].sort((a, b) => b[1] - a[1])[0];
  return top?.[0] ?? w.bph ?? null;
}

/**
 * "Find the movement": for a mechanical watch with no recognised caliber,
 * list the movements that could be in it (same maker, winding and beat rate)
 * with how to tell them apart. Choosing one sets the watch's caliber.
 */
export function movementFinder(w: Watch, ms: Measurement[], onChosen: () => void): HTMLElement {
  const body = h('div', null, h('p', { class: 'muted small' }, 'Looking for candidates…'));
  const panel = h('section', { class: 'panel finder' }, h('header', { class: 'panel-head' }, h('h2', null, 'Find the movement')), body);

  const choose = async (m: RefMovement) => {
    const caliber = caliberFor(m, w.brand);
    const patch: Partial<Watch> = { caliber, updatedAt: Date.now() };
    if (!w.movementType || w.movementType === 'other') patch.movementType = m.type;
    if (!w.bph && m.bph) patch.bph = m.bph;
    if (m.liftAngle && w.liftAngle === 52) patch.liftAngle = m.liftAngle;
    await db.watches.update(w.id, patch);
    await upsertMovement(caliber, {});
    toast(`${w.name}: caliber set to ${caliber}`);
    onChosen();
  };

  const row = (m: RefMovement) =>
    h(
      'li',
      { class: 'finder-row' },
      h(
        'div',
        null,
        h('a', { href: `#/movements/${m.id}` }, h('strong', null, m.archive ? m.caliber : `${m.maker.split(/[ (]/)[0]} ${m.caliber}`)),
        h(
          'span',
          { class: 'muted small' },
          ' ',
          [m.bph && `${fmtBph(m.bph)} bph`, m.archive?.years, m.archive?.jewels ?? m.jewels ? `${m.archive?.jewels ?? m.jewels} jewels` : '', m.features].filter(Boolean).join(' · '),
        ),
        m.archive?.identification && h('p', { class: 'small' }, m.archive.identification),
      ),
      h('button', { type: 'button', class: 'btn small', onclick: () => void choose(m) }, 'This is it'),
    );

  void loadArchive().then((archive) => {
    const bph = measuredBph(w, ms);
    const { byBrand, others } = movementCandidates({ brand: w.brand, type: w.movementType, bph }, [...REFERENCE_MOVEMENTS, ...archive]);
    const kind = w.movementType === 'automatic' ? 'automatic' : w.movementType === 'manual' ? 'hand-wound' : '';
    const at = bph ? ` at ${fmtBph(bph)} bph` : '';
    const measured = ms.length && bph ? `Escapement measured this watch at ${fmtBph(bph)} bph. ` : '';
    const unknownCal = w.caliber ? `“${w.caliber}” isn’t a caliber Escapement knows. ` : 'No caliber set yet. ';
    const tip = CASE_NUMBER_BRANDS.includes(w.brand.trim().toLowerCase())
      ? h('p', { class: 'small' }, `Quick check: ${w.brand} case numbers usually start with the caliber, so the caseback’s “8200-S12345” means caliber 8200.`)
      : '';

    // A searchable list for brands that fitted other makers' movements.
    const searchList = (pool: RefMovement[]) => {
      const list = h('ul', { class: 'finder-list' });
      const note = h('p', { class: 'muted small' });
      const run = (q: string) => {
        const k = q.trim().toLowerCase();
        const hits = k ? pool.filter((m) => [m.caliber, m.maker, ...(m.aliases ?? []), m.archive?.identification ?? ''].some((x) => x.toLowerCase().includes(k))) : [];
        list.replaceChildren(...hits.slice(0, SHOW).map(row));
        note.textContent = k ? (hits.length > SHOW ? `${hits.length} matches; showing ${SHOW}. Add more of what’s printed on the movement.` : hits.length ? '' : 'No match. Try just the number, or the maker’s name.') : '';
      };
      return h(
        'div',
        null,
        h('input', { type: 'search', class: 'finder-search', placeholder: 'e.g. ETA 2824, AS 1700, Unitas', oninput: (e: Event) => run((e.target as HTMLInputElement).value) }),
        note,
        list,
      );
    };

    if (byBrand.length) {
      body.replaceChildren(
        h('p', { class: 'muted' }, unknownCal, measured, `${byBrand.length} ${kind ? `${kind} ` : ''}${w.brand} movement${byBrand.length === 1 ? '' : 's'}${at} could be in it:`),
        tip,
        h('ul', { class: 'finder-list' }, byBrand.slice(0, SHOW).map(row)),
        byBrand.length > SHOW ? h('p', { class: 'muted small' }, `Showing ${SHOW} of ${byBrand.length}.`) : '',
        others.length ? h('details', null, h('summary', { class: 'small' }, 'Not one of these? Search other makers'), searchList(others)) : '',
      );
    } else {
      body.replaceChildren(
        h(
          'p',
          { class: 'muted' },
          unknownCal,
          measured,
          `${w.brand ? `The library has no ${w.brand} calibers: ${w.brand} probably fitted movements from other makers. ` : ''}${others.length.toLocaleString()} ${kind ? `${kind} ` : ''}movements${at} fit. Open the caseback and search for what’s printed on the movement:`,
        ),
        tip,
        searchList(others),
      );
    }
    body.append(h('p', { class: 'muted small' }, 'Or use “Identify with AI” on the ', h('a', { href: `#/watches/${w.id}/edit` }, 'edit page'), ' with a photo of the movement.'));
    // Nothing to find if the caliber turned out to be known after the archive loaded.
    if (findMovement(w.caliber, w.brand)) panel.remove();
  });
  return panel;
}
