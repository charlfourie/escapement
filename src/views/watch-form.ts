import { STANDARD_BPH } from '../analysis/analyze';
import { blankWatch, db, type Watch } from '../db';
import { dialGlyph, h, photoUrl, resizeImage, select, toast } from '../util/dom';
import { fmtBph, fmtHz } from '../util/format';
import { identifyPanel } from './identify-panel';

export function watchFormView(root: HTMLElement, id: string | null): void {
  void (async () => {
    const existing = id ? await db.watches.get(id) : undefined;
    if (id && !existing) {
      root.append(h('div', { class: 'page' }, h('p', null, 'That watch doesn’t exist. ', h('a', { href: '#/watches' }, 'Back to watches'))));
      return;
    }
    const w: Watch = existing ? { ...existing } : blankWatch();
    const formHost = h('div');

    const renderForm = () => {

    const text = (key: 'name' | 'brand' | 'reference' | 'caliber' | 'notes', label: string, placeholder = '', required = false) =>
      h(
        'label',
        { class: 'field' },
        h('span', null, label),
        h('input', { type: 'text', value: w[key], placeholder, required, oninput: (e: Event) => (w[key] = (e.target as HTMLInputElement).value) }),
      );
    const date = (key: 'purchaseDate' | 'lastService', label: string) =>
      h('label', { class: 'field' }, h('span', null, label), h('input', { type: 'date', value: w[key], oninput: (e: Event) => (w[key] = (e.target as HTMLInputElement).value) }));

    const preview = h('div', { class: 'photo-preview' });
    const renderPreview = () => preview.replaceChildren(w.photo ? h('img', { src: photoUrl(w.photo), alt: '' }) : dialGlyph());
    renderPreview();
    const removeBtn = h(
      'button',
      {
        type: 'button',
        class: 'btn small',
        onclick: () => {
          w.photo = null;
          renderPreview();
          removeBtn.hidden = true;
        },
      },
      'Remove photo',
    );
    removeBtn.hidden = !w.photo;
    const fileInput = h('input', {
      type: 'file',
      accept: 'image/*',
      onchange: async (e: Event) => {
        const f = (e.target as HTMLInputElement).files?.[0];
        if (!f) return;
        try {
          w.photo = await resizeImage(f);
          renderPreview();
          removeBtn.hidden = false;
        } catch {
          toast('Couldn’t read that image');
        }
      },
    });

    const form = h(
      'form',
      {
        class: 'panel form',
        onsubmit: async (e: Event) => {
          e.preventDefault();
          if (!w.name.trim()) return;
          w.name = w.name.trim();
          w.updatedAt = Date.now();
          await db.watches.put(w);
          toast(existing ? 'Watch updated' : 'Watch added');
          location.hash = `#/watches/${w.id}`;
        },
      },
      h(
        'div',
        { class: 'form-photo' },
        preview,
        h('label', { class: 'btn small file' }, w.photo ? 'Change photo' : 'Add photo', fileInput),
        removeBtn,
      ),
      h(
        'div',
        { class: 'form-grid' },
        text('name', 'Name', 'e.g. Speedmaster Professional', true),
        text('brand', 'Brand', 'e.g. Omega'),
        text('reference', 'Reference', 'e.g. 310.30.42.50.01.001'),
        text('caliber', 'Caliber', 'e.g. 3861'),
        h(
          'label',
          { class: 'field' },
          h('span', null, 'Beat rate'),
          select<number>([[0, 'Unknown (auto-detect)'], ...[...new Set([...STANDARD_BPH, ...(w.bph ? [w.bph] : [])])].sort((x, y) => x - y).map((b): [number, string] => [b, `${fmtBph(b)} bph · ${fmtHz(b)}`])], w.bph ?? 0, (v) => (w.bph = Number(v) || null)),
        ),
        h(
          'label',
          { class: 'field' },
          h('span', null, 'Lift angle (°)'),
          h('input', { type: 'number', min: 30, max: 70, step: 1, value: w.liftAngle, oninput: (e: Event) => (w.liftAngle = Number((e.target as HTMLInputElement).value) || 52) }),
          h('small', { class: 'muted' }, 'Used for amplitude. 52° fits most movements.'),
        ),
        date('purchaseDate', 'Purchased'),
        date('lastService', 'Last serviced'),
        h(
          'label',
          { class: 'field wide' },
          h('span', null, 'Notes'),
          h('textarea', { rows: 3, oninput: (e: Event) => (w.notes = (e.target as HTMLTextAreaElement).value) }, w.notes),
        ),
      ),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, existing ? 'Save changes' : 'Add watch'), h('a', { class: 'btn', href: existing ? `#/watches/${w.id}` : '#/watches' }, 'Cancel')),
    );

    formHost.replaceChildren(form);
    };

    const panel = identifyPanel(
      () => w,
      (patch, notes, photo) => {
        Object.assign(w, patch);
        if (notes) w.notes = w.notes.trim() ? `${w.notes.trim()}\n\n${notes}` : notes;
        if (photo) w.photo = photo;
        renderForm();
        toast('Details added. Review them, then save.');
        formHost.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
    );
    renderForm();
    root.append(h('div', { class: 'page narrow' }, h('header', { class: 'page-head' }, h('h1', null, existing ? `Edit ${existing.name}` : 'Add a watch')), panel, formHost));
  })();
}
