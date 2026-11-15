import { STANDARD_BPH } from '../analysis/analyze';
import { blankWatch, db, isTimegraphable, MOVEMENT_TYPES, upsertMovement, type MovementSpecs, type MovementType, type Watch } from '../db';
import { applyCrop, h, photoUrl, resizeImage, select, toast } from '../util/dom';
import { fmtBph, fmtHz } from '../util/format';
import { identifyPanel } from './identify-panel';
import { faceDesigner } from './face-designer';
import { watchArt } from './watch-art';
import { findReference, REFERENCE_MOVEMENTS } from '../data/movements';

export function watchFormView(root: HTMLElement, id: string | null): void {
  void (async () => {
    const existing = id ? await db.watches.get(id) : undefined;
    if (id && !existing) {
      root.append(h('div', { class: 'page' }, h('p', null, 'That watch doesn’t exist. ', h('a', { href: '#/watches' }, 'Back to watches'))));
      return;
    }
    const w: Watch = existing ? { ...existing } : blankWatch();
    const formHost = h('div');
    /** Movement specs found by AI identification, stored with the movement on save. */
    let pendingSpecs: MovementSpecs = {};

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

    // Photo framing: drag to move the focus, slider to zoom. The preview has
    // the cards' 4:3 shape, so what you see is what the list shows.
    const preview = h('div', { class: 'photo-preview' });
    const zoom = h('input', { type: 'range', min: 1, max: 3, step: 0.05, 'aria-label': 'Zoom' });
    const cropRow = h(
      'div',
      { class: 'crop-row' },
      h('span', { class: 'muted small' }, 'Zoom'),
      zoom,
      h(
        'button',
        {
          type: 'button',
          class: 'btn small',
          onclick: () => {
            delete w.photoCrop;
            zoom.value = '1';
            renderPreview();
          },
        },
        'Reset',
      ),
    );
    const cropHint = h('p', { class: 'muted small crop-hint' }, 'Drag the photo to frame the watch.');
    let previewImg: HTMLImageElement | null = null;
    const crop = () => (w.photoCrop ??= { x: 0.5, y: 0.5, zoom: 1 });
    zoom.oninput = () => {
      crop().zoom = Number(zoom.value);
      if (previewImg) applyCrop(previewImg, w.photoCrop);
    };
    let drag: { px: number; py: number; x: number; y: number } | null = null;
    preview.addEventListener('pointerdown', (e: PointerEvent) => {
      if (!w.photo) return;
      const c = crop();
      drag = { px: e.clientX, py: e.clientY, x: c.x, y: c.y };
      preview.setPointerCapture(e.pointerId);
      preview.classList.add('dragging');
    });
    preview.addEventListener('pointermove', (e: PointerEvent) => {
      if (!drag || !previewImg) return;
      const r = preview.getBoundingClientRect();
      const c = crop();
      // Dragging right shows more of the left side, so the focus moves left.
      const k = 1.6 / c.zoom;
      c.x = Math.min(1, Math.max(0, drag.x - ((e.clientX - drag.px) / r.width) * k));
      c.y = Math.min(1, Math.max(0, drag.y - ((e.clientY - drag.py) / r.height) * k));
      applyCrop(previewImg, c);
    });
    const endDrag = () => {
      drag = null;
      preview.classList.remove('dragging');
    };
    preview.addEventListener('pointerup', endDrag);
    preview.addEventListener('pointercancel', endDrag);
    const renderPreview = () => {
      previewImg = w.photo ? h('img', { src: photoUrl(w.photo), alt: '', draggable: 'false' }) : null;
      if (previewImg) applyCrop(previewImg, w.photoCrop);
      preview.classList.toggle('croppable', Boolean(previewImg));
      preview.classList.toggle('drawn', !previewImg);
      preview.replaceChildren(previewImg ?? watchArt(w));
      zoom.value = String(w.photoCrop?.zoom ?? 1);
      cropRow.hidden = cropHint.hidden = !w.photo;
    };
    renderPreview();
    const removeBtn = h(
      'button',
      {
        type: 'button',
        class: 'btn small',
        onclick: () => {
          w.photo = null;
          delete w.photoCrop;
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
          delete w.photoCrop;
          renderPreview();
          removeBtn.hidden = false;
        } catch {
          toast('Couldn’t read that image');
        }
      },
    });

    // Caliber, with the reference library as suggestions. A known caliber
    // fills in the beat rate and lift angle (only where they're still unset).
    const refHint = h('small', { class: 'muted' });
    const showRef = () => {
      const ref = findReference(w.caliber);
      refHint.replaceChildren(
        ref
          ? h('span', null, `In the reference library: ${ref.maker} ${ref.caliber}, ${fmtBph(ref.bph)} bph${ref.liftAngle ? `, lift angle ${ref.liftAngle}°` : ''}${ref.coAxial ? ', co-axial' : ''}. `, h('a', { href: `#/movements/${ref.id}` }, 'Details'))
          : '',
      );
    };
    const applyRef = () => {
      const ref = findReference(w.caliber);
      if (!ref) return;
      const filled: string[] = [];
      if (!w.movementType) {
        w.movementType = ref.type;
        filled.push('movement type');
      }
      if (!w.bph) {
        w.bph = ref.bph;
        filled.push('beat rate');
      }
      if (ref.liftAngle && (w.liftAngle === 52 || !w.liftAngle) && w.liftAngle !== ref.liftAngle) {
        w.liftAngle = ref.liftAngle;
        filled.push('lift angle');
      }
      if (filled.length) {
        toast(`Filled ${filled.join(', ')} from the reference for ${ref.caliber}`);
        renderForm();
      }
    };
    const caliberField = () => {
      const input = h('input', {
        type: 'text',
        value: w.caliber,
        placeholder: 'e.g. 2824-2, NH35, 8215',
        list: 'ref-calibers',
        oninput: (e: Event) => {
          w.caliber = (e.target as HTMLInputElement).value;
          showRef();
        },
        onchange: applyRef,
      });
      showRef();
      return h(
        'label',
        { class: 'field' },
        h('span', null, 'Caliber'),
        input,
        h('datalist', { id: 'ref-calibers' }, REFERENCE_MOVEMENTS.map((m) => h('option', { value: m.caliber }, `${m.maker} · ${fmtBph(m.bph)} bph`))),
        refHint,
      );
    };

    const designer = faceDesigner(w, () => {
      if (!w.photo || w.face?.preferArt) renderPreview();
    });
    // Name, brand and type feed the automatic face: keep both previews current.
    let typingTimer = 0;
    const onFieldInput = () => {
      clearTimeout(typingTimer);
      typingTimer = window.setTimeout(() => {
        designer.refresh();
        if (!w.photo) renderPreview();
      }, 250);
    };

    const form = h(
      'form',
      {
        class: 'panel form',
        oninput: (e: Event) => {
          if (!(e.target as HTMLElement).closest('.face-designer')) onFieldInput();
        },
        onsubmit: async (e: Event) => {
          e.preventDefault();
          if (!w.name.trim()) return;
          w.name = w.name.trim();
          w.updatedAt = Date.now();
          await db.watches.put(w);
          if (w.caliber.trim()) await upsertMovement(w.caliber, { maker: w.brand.trim(), bph: w.bph, ...pendingSpecs });
          toast(existing ? 'Watch updated' : 'Watch added');
          location.hash = `#/watches/${w.id}`;
        },
      },
      h(
        'div',
        { class: 'form-photo' },
        preview,
        cropHint,
        cropRow,
        h('label', { class: 'btn small file' }, w.photo ? 'Change photo' : 'Add photo', fileInput),
        removeBtn,
      ),
      h(
        'div',
        { class: 'form-grid' },
        text('name', 'Name', 'e.g. Speedmaster Professional', true),
        text('brand', 'Brand', 'e.g. Omega'),
        text('reference', 'Reference', 'e.g. 310.30.42.50.01.001'),
        h(
          'label',
          { class: 'field' },
          h('span', null, 'Movement type'),
          select<string>([['', 'Not sure'], ...(Object.entries(MOVEMENT_TYPES) as Array<[MovementType, string]>)], w.movementType ?? '', (v) => {
            w.movementType = (v || undefined) as MovementType | undefined;
            renderForm(); // beat rate and lift angle only apply to mechanical watches
          }),
        ),
        caliberField(),
        isTimegraphable(w) &&
        h(
          'label',
          { class: 'field' },
          h('span', null, 'Beat rate'),
          select<number>([[0, 'Unknown (auto-detect)'], ...[...new Set([...STANDARD_BPH, ...(w.bph ? [w.bph] : [])])].sort((x, y) => x - y).map((b): [number, string] => [b, `${fmtBph(b)} bph · ${fmtHz(b)}`])], w.bph ?? 0, (v) => (w.bph = Number(v) || null)),
        ),
        isTimegraphable(w) &&
        h(
          'label',
          { class: 'field' },
          h('span', null, 'Lift angle (°)'),
          h('input', { type: 'number', min: 30, max: 70, step: 1, value: w.liftAngle, oninput: (e: Event) => (w.liftAngle = Number((e.target as HTMLInputElement).value) || 52) }),
          h('small', { class: 'muted' }, 'Used for amplitude. 52° fits most movements.'),
        ),
        !isTimegraphable(w) && h('p', { class: 'muted small wide' }, 'A timegrapher can’t read quartz watches. Track this one with time checks on its page instead.'),
        date('purchaseDate', 'Purchased'),
        date('lastService', 'Last serviced'),
        h(
          'label',
          { class: 'field wide' },
          h('span', null, 'Notes'),
          h('textarea', { rows: 3, oninput: (e: Event) => (w.notes = (e.target as HTMLTextAreaElement).value) }, w.notes),
        ),
      ),
      designer.el,
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, existing ? 'Save changes' : 'Add watch'), h('a', { class: 'btn', href: existing ? `#/watches/${w.id}` : '#/watches' }, 'Cancel')),
    );

    formHost.replaceChildren(form);
    };

    const panel = identifyPanel(
      () => w,
      (patch, notes, photo, specs) => {
        Object.assign(w, patch);
        pendingSpecs = { ...pendingSpecs, ...specs };
        if (notes) w.notes = w.notes.trim() ? `${w.notes.trim()}\n\n${notes}` : notes;
        if (photo) {
          w.photo = photo;
          delete w.photoCrop;
        }
        renderForm();
        toast('Details added. Review them, then save.');
        formHost.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
    );
    renderForm();
    root.append(h('div', { class: 'page narrow' }, h('header', { class: 'page-head' }, h('h1', null, existing ? `Edit ${existing.name}` : 'Add a watch')), panel, formHost));
  })();
}
