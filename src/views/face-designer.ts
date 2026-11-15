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
    h('div', { class: `fd-row${isSet(key) ? ' custom' : ''}` }, h('span', { class: 'fd-label' }, label, isSet(key) ? h('span', { class: 'fd-dot', title: 'Your choice' }) : ''), body);

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

  function refresh() {
    preview.replaceChildren(watchArt(w));
    const f = resolveFace(w);
    const textInput = h('input', {
      type: 'text',
      value: f.text,
      maxlength: 20,
      placeholder: 'e.g. AUTOMATIC, CHRONOMETER',
      onchange: (e: Event) => set('text', (e.target as HTMLInputElement).value.trim().toUpperCase()),
    });
    controls.replaceChildren(
      choice('Case', 'shape', SHAPES),
      choice('Metal', 'metal', METALS),
      colour('Dial', 'dial', DIAL_SWATCHES),
      choice('Dial finish', 'texture', TEXTURES),
      choice('Markers', 'markers', MARKERS),
      colour('Hands', 'hands', HAND_SWATCHES),
      choice('Seconds', 'seconds', SECONDS),
      f.seconds !== 'none' ? colour('Seconds hand', 'secondsColour', HAND_SWATCHES) : '',
      choice('Bezel', 'bezel', BEZELS),
      choice('Strap', 'strap', STRAPS),
      f.strap !== 'bracelet' ? colour('Strap colour', 'strapColour', STRAP_SWATCHES) : '',
      row('Dial text', 'text', textInput),
      h('div', { class: 'fd-toggles' }, toggle('Date window', 'date'), toggle('Power reserve', 'powerReserve'), w.photo ? toggle('Show this face instead of the photo', 'preferArt') : ''),
    );
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
    h('summary', null, h('span', { class: 'id-title' }, 'Watch face'), h('span', { class: 'muted small' }, w.photo ? 'The drawn face, for when you’d rather not show the photo' : 'Shown until you add a photo. Pick anything; the rest follows the watch.')),
    h('div', { class: 'fd-body' }, h('div', { class: 'fd-side' }, preview, h('p', { class: 'muted small' }, 'Live: it shows the real time, and the seconds hand moves the way this movement does.'), resetBtn), controls),
  );
  return { el, refresh };
}
