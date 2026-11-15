type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown> | null;

/** Tiny hyperscript helper: h('div', { class: 'x', onclick }, 'text', child) */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2), v as EventListener);
      } else if (k === 'class') {
        el.className = String(v);
      } else if (k === 'style') {
        el.setAttribute('style', String(v));
      } else if (k === 'value' && 'value' in el) {
        (el as HTMLInputElement).value = String(v);
      } else if (k === 'checked' || k === 'selected' || k === 'disabled') {
        (el as unknown as Record<string, boolean>)[k] = Boolean(v);
      } else if (v === true) {
        el.setAttribute(k, '');
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }
  append(el, children);
  return el;
}

function append(el: Node, children: (Child | Child[])[]): void {
  for (const c of children) {
    if (Array.isArray(c)) append(el, c);
    else if (c === null || c === undefined || c === false) continue;
    else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function svg(tag: string, attrs: Record<string, string | number> = {}, ...children: Node[]): SVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  children.forEach((c) => el.appendChild(c));
  return el;
}

export function select<T extends string | number>(
  options: Array<[T, string]>,
  value: T,
  onchange: (v: string) => void,
  attrs: Record<string, unknown> = {},
): HTMLSelectElement {
  return h(
    'select',
    { ...attrs, onchange: (e: Event) => onchange((e.target as HTMLSelectElement).value) },
    options.map(([v, label]) => h('option', { value: String(v), selected: v === value }, label)),
  );
}

let toastTimer = 0;
export function toast(message: string): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status' });
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove('show'), 2600);
}

const photoUrls = new WeakMap<Blob, string>();
export function photoUrl(blob: Blob): string {
  let u = photoUrls.get(blob);
  if (!u) {
    u = URL.createObjectURL(blob);
    photoUrls.set(blob, u);
  }
  return u;
}

/** Downscale an image file to a JPEG of at most `max` px on the long side. */
export async function resizeImage(file: File, max = 900): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode image'))), 'image/jpeg', 0.85));
}

/** Simple dial glyph used when a watch has no photo. */
export function dialGlyph(): SVGElement {
  const ticks: Node[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r1 = i % 3 === 0 ? 30 : 33;
    ticks.push(
      svg('line', {
        x1: 50 + Math.sin(a) * r1,
        y1: 50 - Math.cos(a) * r1,
        x2: 50 + Math.sin(a) * 37,
        y2: 50 - Math.cos(a) * 37,
      }),
    );
  }
  return svg(
    'svg',
    { viewBox: '0 0 100 100', class: 'dial-glyph', 'aria-hidden': 'true' },
    svg('circle', { cx: 50, cy: 50, r: 42 }),
    ...ticks,
    svg('line', { x1: 50, y1: 50, x2: 50, y2: 26, class: 'hand' }),
    svg('line', { x1: 50, y1: 50, x2: 66, y2: 58, class: 'hand' }),
  );
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Mono 16-bit PCM WAV. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/** Frame a cover-fitted photo on a focus point, zoomed around it. */
export function applyCrop(img: HTMLElement, crop?: { x: number; y: number; zoom: number }): void {
  const x = Math.round((crop?.x ?? 0.5) * 1000) / 10;
  const y = Math.round((crop?.y ?? 0.5) * 1000) / 10;
  img.style.objectPosition = `${x}% ${y}%`;
  img.style.transformOrigin = `${x}% ${y}%`;
  img.style.transform = crop && crop.zoom > 1 ? `scale(${crop.zoom})` : '';
}
