import { AiError, buildChatPrompt, GEMINI_MODELS, identifyWithGemini, loadAi, parseAnswer, saveAi, type AiProvider, type Identification } from '../ai/identify';
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

/** Settings for identification: the default route and the optional Gemini key. Used here and on the Data page. */
export function aiSettingsBlock(onChange?: () => void): HTMLElement {
  const s = loadAi();
  const key = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'AIza…', value: s.geminiKey });
  const status = h('span', { class: 'muted small' }, s.geminiKey ? 'Key saved in this browser.' : '');
  const saveKey = (v: string) => {
    saveAi({ geminiKey: v });
    status.textContent = v ? 'Key saved in this browser.' : 'Key removed.';
    onChange?.();
  };
  return h(
    'div',
    { class: 'ai-settings' },
    h(
      'div',
      { class: 'form-grid' },
      h('label', { class: 'field' }, h('span', null, 'Gemini API key (free)'), key),
      h(
        'label',
        { class: 'field' },
        h('span', null, 'Gemini model'),
        h(
          'select',
          { onchange: (e: Event) => saveAi({ geminiModel: (e.target as HTMLSelectElement).value }) },
          GEMINI_MODELS.map(([v, l]) => h('option', { value: v, selected: v === s.geminiModel }, l)),
        ),
      ),
    ),
    h(
      'div',
      { class: 'actions' },
      h('button', { type: 'button', class: 'btn small', onclick: () => saveKey(key.value.trim()) }, 'Save key'),
      h('button', { type: 'button', class: 'btn small', onclick: () => ((key.value = ''), saveKey('')) }, 'Remove'),
      status,
    ),
    h(
      'p',
      { class: 'muted small' },
      'Create a free key at ',
      h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener' }, 'aistudio.google.com/apikey'),
      ' without setting up billing, so it never costs anything. It’s separate from a Gemini subscription. The free tier allows a limited number of requests a day, can’t search the web, and Google may use what you send to improve its products. The key is stored only in this browser and sent only to Google.',
    ),
  );
}

const CHAT_APPS: Array<[string, string]> = [
  ['Open Claude', 'https://claude.ai/new'],
  ['Open Gemini', 'https://gemini.google.com/app'],
];

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
  let provider: AiProvider = loadAi().provider;

  const thumbs = h('div', { class: 'id-thumbs' });
  const hint = h('textarea', { rows: 2, placeholder: 'Anything you know, e.g. “my grandfather’s, 1970s, dial says Bell-Matic, Japan”' });
  const statusEl = h('p', { class: 'id-status muted small', hidden: true });
  const result = h('div', { class: 'id-result', hidden: true });
  const errorEl = h('div', { class: 'message error', hidden: true });
  const routeHost = h('div', { class: 'id-route' });

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

  const input = () => {
    const w = getWatch();
    return { images: photos, hint: hint.value, known: { name: w.name, brand: w.brand, reference: w.reference, caliber: w.caliber } };
  };
  const showError = (err: unknown) => {
    errorEl.hidden = false;
    errorEl.textContent = err instanceof AiError ? err.message : `Something went wrong: ${(err as Error)?.message ?? err}`;
  };

  // Route switch.
  const routeTabs = h(
    'div',
    { class: 'segmented id-tabs', role: 'tablist' },
    ...([
      ['chat', 'In your chat app'],
      ['gemini', 'Gemini key (one tap)'],
    ] as Array<[AiProvider, string]>).map(([v, label]) =>
      h(
        'button',
        {
          type: 'button',
          role: 'tab',
          class: v === provider ? 'seg active' : 'seg',
          'aria-selected': String(v === provider),
          onclick: () => {
            provider = v;
            saveAi({ provider: v });
            routeTabs.querySelectorAll('button').forEach((b, i) => {
              const on = (i === 0 ? 'chat' : 'gemini') === v;
              b.classList.toggle('active', on);
              b.setAttribute('aria-selected', String(on));
            });
            errorEl.hidden = true;
            renderRoute();
          },
        },
        label,
      ),
    ),
  );

  function chatRoute(): HTMLElement {
    const copied = h('p', { class: 'small muted', hidden: true });
    const fallback = h('textarea', { class: 'id-prompt', rows: 6, readonly: true, hidden: true });
    const reply = h('textarea', { rows: 4, placeholder: 'Paste the whole reply here' });
    const copyBtn = h(
      'button',
      {
        type: 'button',
        class: 'btn primary',
        onclick: async () => {
          errorEl.hidden = true;
          const i = input();
          if (!i.images.length && !i.hint.trim() && !Object.values(i.known).some((v) => v?.trim())) {
            showError(new AiError('Add a photo or a few notes first, so the request says what to look for.'));
            return;
          }
          const text = buildChatPrompt(i, photos.length);
          fallback.value = text;
          try {
            await navigator.clipboard.writeText(text);
            fallback.hidden = true;
            copied.hidden = false;
            copied.textContent = photos.length
              ? `Copied. Paste it into a new chat, attach the same ${photos.length === 1 ? 'photo' : `${photos.length} photos`}, and send.`
              : 'Copied. Paste it into a new chat, attach your photos (dial, caseback, movement), and send.';
          } catch {
            fallback.hidden = false;
            fallback.select();
            copied.hidden = false;
            copied.textContent = 'Copy the request below, paste it into a new chat with your photos, and send.';
          }
        },
      },
      '1 · Copy request',
    );
    const readBtn = h(
      'button',
      {
        type: 'button',
        class: 'btn primary',
        onclick: () => {
          errorEl.hidden = true;
          try {
            renderResult(parseAnswer(reply.value));
          } catch (err) {
            showError(err);
          }
        },
      },
      'Read reply',
    );
    return h(
      'div',
      null,
      h('p', { class: 'muted small' }, 'Free with the Claude or Gemini app you already use, and the chat can search the web to confirm details. Nothing here needs a key.'),
      h('div', { class: 'actions' }, copyBtn, ...CHAT_APPS.map(([label, url]) => h('a', { class: 'btn small', href: url, target: '_blank', rel: 'noopener' }, `${label} ↗`))),
      copied,
      fallback,
      h('label', { class: 'field' }, h('span', null, '2 · Paste the reply'), reply),
      h('div', { class: 'actions' }, readBtn),
    );
  }

  const goBtn = h('button', { type: 'button', class: 'btn primary', onclick: () => void runGemini() }, 'Identify');

  function geminiRoute(): HTMLElement {
    const s = loadAi();
    return h(
      'div',
      null,
      s.geminiKey
        ? h('p', { class: 'muted small' }, 'Uses your free Gemini key. The free tier can’t search the web, so double-check the calibre on Ranfft DB.')
        : h('div', { class: 'id-key' }, h('p', { class: 'small' }, 'Add your free Gemini API key once:'), aiSettingsBlock(renderRoute)),
      h('div', { class: 'actions' }, goBtn, statusEl),
    );
  }

  function renderRoute() {
    routeHost.replaceChildren(provider === 'chat' ? chatRoute() : geminiRoute());
  }

  async function runGemini() {
    if (busy) {
      controller?.abort();
      return;
    }
    errorEl.hidden = true;
    const settings = loadAi();
    if (!settings.geminiKey) {
      renderRoute();
      showError(new AiError('Add your free Gemini API key first.'));
      return;
    }
    busy = true;
    controller = new AbortController();
    goBtn.textContent = 'Cancel';
    goBtn.classList.remove('primary');
    statusEl.hidden = false;
    statusEl.textContent = 'Looking closely at the photos…';
    result.hidden = true;
    try {
      renderResult(await identifyWithGemini(input(), settings, { signal: controller.signal }));
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') showError(err);
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
      id.dated ? h('p', { class: 'small' }, h('strong', null, 'Dated: '), id.dated) : '',
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
                      id.dated ? `Dated: ${id.dated}` : '',
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

  renderRoute();
  return h(
    'details',
    { class: 'panel identify' },
    h('summary', null, h('span', { class: 'id-title' }, 'Identify with AI'), h('span', { class: 'muted small' }, 'Photos of the dial, caseback or movement → brand, reference, caliber')),
    h(
      'div',
      { class: 'id-body' },
      h('p', { class: 'muted small' }, 'Up to four photos. The caseback (with its serial number) and the movement matter most: that’s where the calibre and the production date are stamped. Add the dial too.'),
      h('div', { class: 'actions' }, cameraBtn, galleryBtn),
      thumbs,
      h('label', { class: 'field' }, h('span', null, 'What you know'), hint),
      routeTabs,
      routeHost,
      errorEl,
      result,
    ),
  );
}
