import { AI_MODELS, AiError, identifyWatch, loadAi, saveAi, type Identification } from '../ai/identify';
import { MOVEMENT_TYPES, type MovementSpecs, type Watch } from '../db';
import { h, photoUrl, resizeImage } from '../util/dom';
import { fmtBph, ranfftUrl } from '../util/format';

const MAX_PHOTOS = 4;

type Field = 'name' | 'brand' | 'reference' | 'movementType' | 'caliber' | 'bph' | 'liftAngle' | 'jewels' | 'size';

const FIELD_LABELS: Record<Field, string> = {
  name: 'Name',
  brand: 'Brand',
  reference: 'Reference',
  movementType: 'Movement type',
  caliber: 'Caliber',
  bph: 'Beat rate',
  liftAngle: 'Lift angle',
  jewels: 'Jewels (movement)',
  size: 'Size (movement)',
};

function suggested(id: Identification, f: Field): string | number | null {
  if (f === 'name') return id.name ?? ([id.brand, id.model, id.reference].filter(Boolean).join(' ') || null);
  return id[f];
}

const show = (f: Field, v: string | number | null) =>
  v === null || v === '' ? '—' : f === 'bph' ? `${fmtBph(Number(v))} bph` : f === 'liftAngle' ? `${v}°` : f === 'movementType' ? (MOVEMENT_TYPES[v as keyof typeof MOVEMENT_TYPES] ?? String(v)) : String(v);

/** Settings block for the API key and model; used here and on the Data page. */
export function aiSettingsBlock(onChange?: () => void): HTMLElement {
  const s = loadAi();
  const key = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'sk-ant-…', value: s.apiKey });
  const status = h('span', { class: 'muted small' }, s.apiKey ? 'Key saved in this browser.' : '');
  return h(
    'div',
    { class: 'ai-settings' },
    h(
      'div',
      { class: 'form-grid' },
      h('label', { class: 'field' }, h('span', null, 'Anthropic API key'), key),
      h(
        'label',
        { class: 'field' },
        h('span', null, 'Model'),
        h(
          'select',
          { onchange: (e: Event) => saveAi({ model: (e.target as HTMLSelectElement).value }) },
          AI_MODELS.map(([v, l]) => h('option', { value: v, selected: v === s.model }, l)),
        ),
      ),
    ),
    h(
      'div',
      { class: 'actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn small',
          onclick: () => {
            saveAi({ apiKey: key.value.trim() });
            status.textContent = key.value.trim() ? 'Key saved in this browser.' : 'Key removed.';
            onChange?.();
          },
        },
        'Save key',
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn small',
          onclick: () => {
            key.value = '';
            saveAi({ apiKey: '' });
            status.textContent = 'Key removed.';
            onChange?.();
          },
        },
        'Remove',
      ),
      status,
    ),
    h(
      'p',
      { class: 'muted small' },
      'Get a key at ',
      h('a', { href: 'https://console.anthropic.com/settings/keys', target: '_blank', rel: 'noopener' }, 'console.anthropic.com'),
      '. It’s stored only in this browser and sent only to Anthropic. Each identification is billed to your Anthropic account, usually a few cents. Photos you identify are sent to Anthropic for that request.',
    ),
  );
}

/**
 * "Identify with AI" panel for the watch form. Calls `apply` with the fields
 * the user ticked; the form re-renders with them.
 */
export function identifyPanel(
  getWatch: () => Watch,
  apply: (patch: Partial<Watch>, extraNotes: string, photo: Blob | null, specs: MovementSpecs) => void,
): HTMLElement {
  const photos: Blob[] = [];
  let busy = false;
  let controller: AbortController | null = null;

  const thumbs = h('div', { class: 'id-thumbs' });
  const hint = h('textarea', { rows: 2, placeholder: 'Anything you know, e.g. “my grandfather’s, 1970s, dial says Bell-Matic, Japan”' });
  const statusEl = h('p', { class: 'id-status muted small', hidden: true });
  const result = h('div', { class: 'id-result', hidden: true });
  const errorEl = h('div', { class: 'message error', hidden: true });
  const keyHost = h('div');

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      if (photos.length >= MAX_PHOTOS) break;
      try {
        photos.push(await resizeImage(f, 1568));
      } catch {
        /* skip unreadable */
      }
    }
    renderThumbs();
  };
  const camera = h('input', { type: 'file', accept: 'image/*', capture: 'environment', onchange: (e: Event) => void addFiles((e.target as HTMLInputElement).files).then(() => ((e.target as HTMLInputElement).value = '')) });
  const gallery = h('input', { type: 'file', accept: 'image/*', multiple: true, onchange: (e: Event) => void addFiles((e.target as HTMLInputElement).files).then(() => ((e.target as HTMLInputElement).value = '')) });
  const cameraBtn = h('label', { class: 'btn small file' }, 'Take photo', camera);
  const galleryBtn = h('label', { class: 'btn small file' }, 'Choose photos', gallery);

  function renderThumbs() {
    thumbs.replaceChildren(
      ...photos.map((p, i) =>
        h(
          'div',
          { class: 'id-thumb' },
          h('img', { src: photoUrl(p), alt: `Photo ${i + 1}` }),
          h(
            'button',
            {
              type: 'button',
              class: 'id-remove',
              'aria-label': 'Remove photo',
              onclick: () => {
                photos.splice(i, 1);
                renderThumbs();
              },
            },
            '×',
          ),
        ),
      ),
    );
    const full = photos.length >= MAX_PHOTOS;
    cameraBtn.classList.toggle('disabled', full);
    galleryBtn.classList.toggle('disabled', full);
    camera.disabled = gallery.disabled = full;
  }

  const goBtn = h('button', { type: 'button', class: 'btn primary', onclick: () => void run() }, 'Identify');

  function renderKey() {
    keyHost.replaceChildren(loadAi().apiKey ? '' : h('div', { class: 'id-key' }, h('p', { class: 'small' }, 'To identify watches, add your own Anthropic API key once:'), aiSettingsBlock(renderKey)));
  }

  async function run() {
    if (busy) {
      controller?.abort();
      return;
    }
    const settings = loadAi();
    errorEl.hidden = true;
    if (!settings.apiKey) {
      renderKey();
      errorEl.hidden = false;
      errorEl.textContent = 'Add your Anthropic API key first.';
      return;
    }
    busy = true;
    controller = new AbortController();
    goBtn.textContent = 'Cancel';
    goBtn.classList.remove('primary');
    statusEl.hidden = false;
    result.hidden = true;
    const w = getWatch();
    try {
      const id = await identifyWatch(
        { images: photos, hint: hint.value, known: { name: w.name, brand: w.brand, reference: w.reference, caliber: w.caliber } },
        settings,
        { signal: controller.signal, onStatus: (s) => (statusEl.textContent = s) },
      );
      renderResult(id);
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        errorEl.hidden = false;
        errorEl.textContent = err instanceof AiError ? err.message : `Something went wrong: ${(err as Error)?.message ?? err}`;
      }
    } finally {
      busy = false;
      controller = null;
      goBtn.textContent = 'Identify';
      goBtn.classList.add('primary');
      statusEl.hidden = true;
    }
  }

  function renderResult(id: Identification) {
    const w = getWatch();
    const current: Record<Field, string | number | null> = { name: w.name || null, brand: w.brand || null, reference: w.reference || null, movementType: w.movementType ?? null, caliber: w.caliber || null, bph: w.bph, liftAngle: w.liftAngle, jewels: null, size: null };
    const fields = (Object.keys(FIELD_LABELS) as Field[]).filter((f) => suggested(id, f) !== null && String(suggested(id, f)) !== String(current[f] ?? ''));
    const ticks = new Map<Field, HTMLInputElement>();
    const usePhoto = h('input', { type: 'checkbox', checked: !w.photo && photos.length > 0 });
    const addNotes = h('input', { type: 'checkbox', checked: true });

    const list = (title: string, items: Array<Node | string>) => (items.length ? h('div', { class: 'id-list' }, h('h4', null, title), h('ul', null, items.map((i) => h('li', null, i)))) : '');

    result.hidden = false;
    result.replaceChildren(
      h('div', { class: 'id-head' }, h('span', { class: `conf conf-${id.confidence}` }, `${id.confidence} confidence`), id.years && h('span', { class: 'muted small' }, id.years)),
      h('p', { class: 'id-summary' }, id.summary),
      (id.caliber ?? '') && h('p', { class: 'small' }, h('a', { href: ranfftUrl(id.brand ?? '', id.caliber ?? ''), target: '_blank', rel: 'noopener' }, `Check caliber ${id.caliber} on Ranfft DB ↗`)),
      fields.length
        ? h(
            'table',
            { class: 'table id-table' },
            h('thead', null, h('tr', null, h('th', null, 'Use'), h('th', null, 'Field'), h('th', null, 'Now'), h('th', null, 'Suggested'))),
            h(
              'tbody',
              null,
              fields.map((f) => {
                const cb = h('input', { type: 'checkbox', checked: current[f] === null || current[f] === '' || (f === 'liftAngle' && current[f] === 52) });
                ticks.set(f, cb);
                return h('tr', null, h('td', null, cb), h('td', null, FIELD_LABELS[f]), h('td', { class: 'muted' }, show(f, current[f])), h('td', null, h('strong', null, show(f, suggested(id, f)))));
              }),
            ),
          )
        : h('p', { class: 'muted small' }, 'Nothing new to fill in: the details you have match.'),
      list('Worth knowing', id.cautions),
      list(
        'Could also be',
        id.alternatives.map((a) => `${a.name}: ${a.reason}`),
      ),
      list('To confirm it', id.nextSteps),
      list(
        'Sources',
        id.sources.map((s) => h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.title || s.url)),
      ),
      h(
        'div',
        { class: 'id-apply' },
        photos.length > 0 && h('label', { class: 'check' }, usePhoto, w.photo ? 'Replace the watch photo with the first photo' : 'Use the first photo as the watch photo'),
        h('label', { class: 'check' }, addNotes, 'Add the summary and sources to notes'),
        h(
          'div',
          { class: 'actions' },
          h(
            'button',
            {
              type: 'button',
              class: 'btn primary',
              onclick: () => {
                const patch: Partial<Watch> = {};
                const specs: MovementSpecs = {};
                for (const [f, cb] of ticks) {
                  if (!cb.checked) continue;
                  const v = suggested(id, f);
                  if (f === 'jewels') specs.jewels = Number(v);
                  else if (f === 'size') specs.size = String(v);
                  else if (f === 'bph' || f === 'liftAngle') (patch as Record<string, number>)[f] = Number(v);
                  else (patch as Record<string, string>)[f] = String(v);
                }
                // Documented beat rate and lift angle describe the movement too.
                if (id.bph) specs.bph = id.bph;
                if (id.liftAngle) specs.liftAngle = id.liftAngle;
                if (id.brand) specs.maker = id.brand;
                const notes = addNotes.checked
                  ? [
                      `Identified with AI (${id.confidence} confidence): ${id.summary}`,
                      id.years ? `Production: ${id.years}` : '',
                      id.cautions.length ? `Worth knowing: ${id.cautions.join(' ')}` : '',
                      id.sources.length ? `Sources:\n${id.sources.map((s) => `- ${s.url}`).join('\n')}` : '',
                    ]
                      .filter(Boolean)
                      .join('\n')
                  : '';
                apply(patch, notes, usePhoto.checked && photos.length ? photos[0] : null, specs);
                result.hidden = true;
              },
            },
            'Apply to this watch',
          ),
          h('button', { type: 'button', class: 'btn', onclick: () => (result.hidden = true) }, 'Dismiss'),
        ),
      ),
    );
  }

  renderKey();
  return h(
    'details',
    { class: 'panel identify' },
    h('summary', null, h('span', { class: 'id-title' }, 'Identify with AI'), h('span', { class: 'muted small' }, 'Photos of the dial, caseback or movement → brand, reference, caliber')),
    h(
      'div',
      { class: 'id-body' },
      h('p', { class: 'muted small' }, 'Up to four photos. The dial, the caseback (inside and out), the movement and any numbers between the lugs help most. Claude reads the markings and checks them against sources online.'),
      h('div', { class: 'actions' }, cameraBtn, galleryBtn),
      thumbs,
      h('label', { class: 'field' }, h('span', null, 'What you know'), hint),
      keyHost,
      h('div', { class: 'actions' }, goBtn, statusEl),
      errorEl,
      result,
    ),
  );
}
