import { h } from '../util/dom';

/**
 * "Where to clip the pickup": a top and a side view of a watch with numbered
 * spots, and the matching notes. Shared by Measure and Pickup Lab.
 */

const GOOD = 'var(--good)';
const BAD = 'var(--bad)';

function marker(x: number, y: number, n: number, good: boolean): string {
  const c = good ? GOOD : BAD;
  return `<circle cx="${x}" cy="${y}" r="11" fill="var(--bg)" stroke="${c}" stroke-width="1.5"/><text x="${x}" y="${y + 4.5}" text-anchor="middle" font-size="13" font-weight="600" fill="${c}">${n}</text>`;
}

const part = 'fill="var(--panel-2)" stroke="var(--muted)" stroke-width="1"';
const clip = `fill="color-mix(in srgb, var(--good) 22%, transparent)" stroke="${GOOD}" stroke-width="1.5"`;

const TOP = `
<svg viewBox="0 0 340 400" class="placement-svg" role="img" aria-label="Top view of a watch with the pickup clipped to the case side at 9 o'clock">
  <rect x="142" y="20" width="56" height="84" rx="4" ${part}/>
  <rect x="142" y="296" width="56" height="84" rx="4" ${part}/>
  <rect x="128" y="94" width="14" height="30" rx="3" ${part}/>
  <rect x="198" y="94" width="14" height="30" rx="3" ${part}/>
  <rect x="128" y="276" width="14" height="30" rx="3" ${part}/>
  <rect x="198" y="276" width="14" height="30" rx="3" ${part}/>
  <rect x="246" y="190" width="14" height="20" rx="3" ${part}/>
  <circle cx="170" cy="200" r="78" ${part}/>
  <circle cx="170" cy="200" r="64" fill="var(--bg)" stroke="var(--line)" stroke-width="1"/>
  <line x1="170" y1="200" x2="170" y2="156" stroke="var(--tic)" stroke-width="3" stroke-linecap="round"/>
  <line x1="170" y1="200" x2="202" y2="212" stroke="var(--tic)" stroke-width="3" stroke-linecap="round"/>
  <rect x="58" y="184" width="36" height="32" rx="4" ${clip}/>
  <path d="M58 200 L30 200 L30 250" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round"/>
  ${marker(76, 162, 1, true)}
  ${marker(108, 314, 2, true)}
  ${marker(284, 200, 3, false)}
  ${marker(226, 340, 4, false)}
  ${marker(206, 168, 5, false)}
</svg>`;

const SIDE = `
<svg viewBox="0 0 340 130" class="placement-svg" role="img" aria-label="Side view: the watch rests dial up on a folded cloth, with the clip on the case side">
  <path d="M110 52 Q180 34 250 52" fill="none" stroke="var(--muted)" stroke-width="1.5"/>
  <rect x="100" y="52" width="160" height="26" rx="6" ${part}/>
  <rect x="125" y="78" width="110" height="8" rx="4" ${part}/>
  <rect x="60" y="90" width="240" height="18" rx="4" fill="var(--panel-2)" stroke="var(--line)" stroke-width="1"/>
  <rect x="66" y="48" width="34" height="34" rx="4" ${clip}/>
  <path d="M66 65 Q40 65 34 40" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round"/>
  ${marker(22, 28, 7, true)}
  ${marker(316, 99, 6, true)}
</svg>`;

const NOTES: Array<[boolean, string, string]> = [
  [true, 'Best: the case side at 9', 'Metal on metal, opposite the crown. Put the jaw with the sensor pad (usually the rubber one) against bare metal and close it firmly.'],
  [true, 'Good: a lug', 'Easy to grip, slightly weaker signal. Try it if the case side is curved or polished.'],
  [false, 'Avoid: the crown', 'Clamping it can pull the stem out or change the time.'],
  [false, 'Avoid: the strap or bracelet', 'Leather, rubber and loose links soak up the ticks.'],
  [false, 'Avoid: the crystal', 'Weak signal, and the jaw can scratch it.'],
  [true, 'Rest it dial up on a folded cloth', 'Keeps desk and keyboard vibration out.'],
  [true, 'Keep the cable slack', 'A tugged or swinging cable adds rubbing noise. Wait a few seconds after touching anything.'],
];

export function placementGuide(opts: { open?: boolean } = {}): HTMLElement {
  const figure = h('div', { class: 'placement-figure' });
  figure.innerHTML = TOP + SIDE; // static markup, no user data
  return h(
    'details',
    { class: 'panel help placement', open: opts.open || undefined },
    h('summary', null, 'Where to clip the pickup'),
    h(
      'div',
      { class: 'placement-body' },
      figure,
      h(
        'ol',
        { class: 'placement-notes' },
        ...NOTES.map(([good, title, text], i) =>
          h('li', { class: good ? 'good' : 'bad' }, h('span', { class: 'placement-num' }, String(i + 1)), h('div', null, h('strong', null, title), h('p', null, text))),
        ),
      ),
    ),
    h(
      'p',
      { class: 'small muted' },
      'Quartz watches click much more quietly. If the ticks are faint at the case side, lay the watch dial down on the cloth and press the sensor pad to the centre of the caseback. For the six-position test, leave the pickup on and turn the watch with it.',
    ),
  );
}
