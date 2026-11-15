/**
 * Face designer for the watch form: pick the case, dial, hands, markers,
 * bezel and strap of the drawn face, with a live preview. Anything left
 * alone keeps following the watch automatically.
 */

import type { Watch } from '../db';
import { h } from '../util/dom';
import { BEZELS, DIAL_SWATCHES, HAND_SWATCHES, MARKERS, METALS, SECONDS, SHAPES, STRAPS, STRAP_SWATCHES, TEXTURES, autoFace, resolveFace, watchArt, type FaceDesign } from './watch-art';

type Key = keyof FaceDesign;

export function faceDesigner(w: Watch, onChange: () => void): { el: HTMLElement; refresh: () => void } {
  const preview = h('div', { class: 'fd-preview' });
  const controls = h('div', { class: 'fd-controls' });
  const resetBtn = h('button', { type: 'button', class: 'btn small' }, 'Reset to automatic');

  const set = <K extends Key>(key: K, value: FaceDesign[K]) => {
    const auto = autoFace(w)[key];
    const face = { ...(w.face ?? {}) } as Partial<FaceDesign>;
    // Choosing what the watch would get anyway clears the override, so it
    // keeps following the watch (e.g. if its movement type changes later).
    if (value === auto) delete face[key];
    else face[key] = value;
    w.face = Object.keys(face).length ? face : undefined;
    refresh();
    onChange();
  };
  const isSet = (key: Key) => w.face?.[key] !== undefined;

  const row = (label: string, key: Key, body: HTMLElement) =>
    h('div', { class: `fd-row${isSet(key) ? ' custom' : ''}` }, h('span', { class: 'fd-label' }, label), body);

  const choice = <K extends Key>(label: string, key: K, options: Array<[FaceDesign[K], string]>) => {
    const cur = resolveFace(w)[key];
    return row(
      label,
      key,
      h(
        'div',
        { class: 'fd-chips', role: 'group', 'aria-label': label },
        options.map(([v, text]) => h('button', { type: 'button', class: `fd-chip${v === cur ? ' active' : ''}`, 'aria-pressed': String(v === cur), onclick: () => set(key, v) }, text)),
      ),
    );
  };

  const colour = (label: string, key: 'dial' | 'hands' | 'secondsColour' | 'strapColour', swatches: string[]) => {
    const cur = resolveFace(w)[key].toLowerCase();
    const picker = h('input', { type: 'color', value: cur, 'aria-label': `${label}: any colour`, oninput: (e: Event) => set(key, (e.target as HTMLInputElement).value) });
    return row(
      label,
      key,
      h(
        'div',
        { class: 'fd-swatches' },
        swatches.map((c) => h('button', { type: 'button', class: `fd-swatch${c.toLowerCase() === cur ? ' active' : ''}`, style: `background:${c}`, title: c, 'aria-label': c, onclick: () => set(key, c) })),
        h('label', { class: 'fd-picker', title: 'Any colour' }, picker),
      ),
    );
  };

  const toggle = (label: string, key: 'date' | 'powerReserve' | 'preferArt', hint?: string) => {
    const cur = resolveFace(w)[key];
    return h('label', { class: 'check fd-toggle' }, h('input', { type: 'checkbox', checked: cur, onchange: (e: Event) => set(key, (e.target as HTMLInputElement).checked) }), label, hint ? h('span', { class: 'muted small' }, ` ${hint}`) : '');
  };

  type Tab = 'case' | 'dial' | 'hands' | 'strap';
  const TABS: Array<[Tab, string, Key[]]> = [
    ['case', 'Case', ['shape', 'metal', 'bezel']],
    ['dial', 'Dial', ['dial', 'texture', 'markers', 'text', 'date', 'powerReserve']],
    ['hands', 'Hands', ['hands', 'seconds', 'secondsColour']],
    ['strap', 'Strap', ['strap', 'strapColour']],
  ];
  let tab: Tab = 'case';
  const tabsEl = h('div', { class: 'fd-tabs', role: 'tablist' });
  const side = h('div', { class: 'fd-side-toggles' });

  function refresh() {
    preview.replaceChildren(watchArt(w));
    const f = resolveFace(w);
    tabsEl.replaceChildren(
      ...TABS.map(([id, label, keys]) =>
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            class: `fd-tab${id === tab ? ' active' : ''}`,
            'aria-selected': String(id === tab),
            onclick: () => {
              tab = id;
              refresh();
            },
          },
          label,
          keys.some(isSet) ? h('span', { class: 'fd-dot', title: 'Has your choices' }) : '',
        ),
      ),
    );
    const textInput = h('input', {
      type: 'text',
      value: f.text,
      maxlength: 20,
      placeholder: 'e.g. CHRONOMETER',
      onchange: (e: Event) => set('text', (e.target as HTMLInputElement).value.trim().toUpperCase()),
    });
    const rows: Record<Tab, Array<HTMLElement | ''>> = {
      case: [choice('Shape', 'shape', SHAPES), choice('Metal', 'metal', METALS), choice('Bezel', 'bezel', BEZELS)],
      dial: [
        colour('Colour', 'dial', DIAL_SWATCHES),
        choice('Finish', 'texture', TEXTURES),
        choice('Markers', 'markers', MARKERS),
        row('Text', 'text', textInput),
        h('div', { class: 'fd-toggles' }, toggle('Date window', 'date'), toggle('Power reserve', 'powerReserve')),
      ],
      hands: [colour('Hands', 'hands', HAND_SWATCHES), choice('Seconds', 'seconds', SECONDS), f.seconds !== 'none' ? colour('Seconds hand', 'secondsColour', HAND_SWATCHES) : ''],
      strap: [choice('Style', 'strap', STRAPS), f.strap !== 'bracelet' ? colour('Colour', 'strapColour', STRAP_SWATCHES) : h('p', { class: 'muted small' }, 'The bracelet takes the case metal.')],
    };
    controls.replaceChildren(tabsEl, h('div', { class: 'fd-panel', role: 'tabpanel' }, ...rows[tab]));
    side.replaceChildren(w.photo ? toggle('Use instead of the photo', 'preferArt') : '');
    resetBtn.disabled = !w.face;
  }

  resetBtn.onclick = () => {
    w.face = undefined;
    refresh();
    onChange();
  };

  refresh();
  const el = h(
    'details',
    { class: 'panel face-designer', open: !w.photo || !!w.face?.preferArt || undefined },
    h('summary', null, h('span', { class: 'id-title' }, 'Watch face'), h('span', { class: 'muted small' }, w.photo ? 'A drawn face, if you’d rather not show the photo' : 'Shown until you add a photo')),
    h('div', { class: 'fd-body' }, h('div', { class: 'fd-side' }, preview, side, resetBtn), controls),
  );
  return { el, refresh };
}
