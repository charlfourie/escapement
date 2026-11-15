/**
 * Welcome: what Escapement is, shown on a first visit and from the footer.
 * The hero is the product's own picture: a watch with the pickup clipped on,
 * its cable running into a paper trace that draws itself live.
 */

import { blankWatch, type Watch } from '../db';
import { savePrefs } from '../prefs';
import { liveFace, reducedMotion } from '../ui/ticker';
import { h, svg } from '../util/dom';
import { watchArt } from './watch-art';

export const WELCOMED_KEY = 'escapement:welcomed';

const demoWatch = (over: Partial<Watch>): Watch => ({ ...blankWatch(), id: 'welcome', name: '', brand: 'Escapement', movementType: 'automatic', bph: 21600, ...over });

/** The hero picture: watch, clip, cable and a live paper trace. */
function heroArt(): SVGElement {
  const W = 640;
  const H = 360;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'welcome-hero-art', role: 'img', 'aria-label': 'A watch with a pickup clipped to its case, its ticks drawn as two lines of dots on a timegrapher trace' });

  // Trace panel first, so the cable runs over its edge.
  const tx = 318;
  const ty = 50;
  const tw = 306;
  const th = 260;
  root.append(svg('rect', { x: tx, y: ty, width: tw, height: th, rx: 14, fill: 'var(--panel)', stroke: 'var(--line)' }));
  for (let i = 1; i < 5; i++) root.append(svg('line', { x1: tx + 12, x2: tx + tw - 12, y1: ty + ((th - 40) * i) / 5, y2: ty + ((th - 40) * i) / 5, stroke: 'var(--grid)', 'stroke-width': 1 }));
  for (let i = 1; i < 8; i++) root.append(svg('line', { y1: ty + 12, y2: ty + th - 46, x1: tx + (tw * i) / 8, x2: tx + (tw * i) / 8, stroke: 'var(--grid)', 'stroke-width': 1 }));
  const dots = svg('g', {});
  root.append(dots);

  // Cable from the clip, round the bottom, into the trace.
  root.append(svg('path', { d: `M 40 180 C 8 182, 10 318, 120 326 S 280 312, ${tx} 268`, fill: 'none', stroke: 'var(--muted)', 'stroke-width': 3, 'stroke-linecap': 'round', opacity: 0.7 }));

  // The watch, live.
  const face = watchArt(demoWatch({ brand: 'Escapement' }));
  face.setAttribute('x', '44');
  face.setAttribute('y', '58');
  face.setAttribute('width', '244');
  face.setAttribute('height', '244');
  root.append(face);

  // The clip on the case side at 9.
  root.append(
    svg('rect', { x: 40, y: 164, width: 32, height: 32, rx: 6, fill: 'color-mix(in srgb, var(--tic) 24%, var(--bg))', stroke: 'var(--tic)', 'stroke-width': 2 }),
    svg('rect', { x: 46, y: 170, width: 10, height: 20, rx: 3, fill: 'var(--tic)', opacity: 0.55 }),
  );

  // Readout under the trace, matching what the dots draw.
  const read = svg('text', { x: tx + 18, y: ty + th - 18, fill: 'var(--muted)', 'font-size': 14, 'font-family': 'var(--mono)', style: 'white-space: pre' }, document.createTextNode('+4 s/d    0.6 ms    278°'));
  root.append(read);

  // Two lines of dots, tick and tock, a beat error apart, drifting gently
  // upward: a watch gaining a few seconds a day. One dot per beat.
  const cols = 120;
  const beatHz = 6;
  const yOf = (k: number) => {
    const tock = k % 2 === 1;
    const base = ty + th * 0.48 - k * 0.32;
    return base + (tock ? 34 : 0) + Math.sin(k * 1.7) * 1.3;
  };
  const xOf = (k: number) => tx + 16 + ((tw - 32) * (k % cols)) / cols;
  const drawUpTo = (n: number) => {
    // Restart the sweep each time it fills, like the paper rolling on.
    const start = Math.floor(n / cols) * cols;
    const want = n - start;
    if (dots.childElementCount > want) dots.replaceChildren();
    for (let k = dots.childElementCount; k < want; k++) {
      const kk = start + k;
      dots.append(svg('circle', { cx: xOf(kk), cy: yOf(k), r: 2.6, fill: kk % 2 ? 'var(--toc)' : 'var(--tic)' }));
    }
  };
  if (reducedMotion()) drawUpTo(cols - 1);
  else {
    const t0 = performance.now();
    liveFace(root, () => drawUpTo(Math.floor(((performance.now() - t0) / 1000) * beatHz) + 30));
  }
  return root;
}

/** Small pictures for the sections below. */
const mini = {
  clip(): SVGElement {
    return svg(
      'svg',
      { viewBox: '0 0 120 80', class: 'welcome-mini', 'aria-hidden': 'true' },
      svg('circle', { cx: 70, cy: 40, r: 26, fill: 'var(--panel-2)', stroke: 'var(--muted)', 'stroke-width': 2 }),
      svg('rect', { x: 34, y: 30, width: 18, height: 20, rx: 4, fill: 'color-mix(in srgb, var(--tic) 24%, var(--bg))', stroke: 'var(--tic)', 'stroke-width': 2 }),
      svg('path', { d: 'M 34 40 C 18 40, 14 64, 4 70', fill: 'none', stroke: 'var(--muted)', 'stroke-width': 2.5, 'stroke-linecap': 'round' }),
      svg('line', { x1: 70, y1: 40, x2: 70, y2: 22, stroke: 'var(--tic)', 'stroke-width': 2.5, 'stroke-linecap': 'round' }),
      svg('line', { x1: 70, y1: 40, x2: 82, y2: 46, stroke: 'var(--tic)', 'stroke-width': 2.5, 'stroke-linecap': 'round' }),
    );
  },
  spectrum(): SVGElement {
    const bars = [8, 12, 10, 16, 22, 34, 46, 52, 44, 38, 30, 24, 18, 12, 9, 7];
    return svg(
      'svg',
      { viewBox: '0 0 120 80', class: 'welcome-mini', 'aria-hidden': 'true' },
      svg('rect', { x: 34, y: 8, width: 64, height: 64, rx: 4, fill: 'color-mix(in srgb, var(--tic) 8%, transparent)' }),
      ...bars.map((v, i) => svg('rect', { x: 8 + i * 6.6, y: 72 - v, width: 4.6, height: v, rx: 1, fill: i >= 4 && i <= 13 ? 'var(--tic)' : 'var(--muted)', opacity: i >= 4 && i <= 13 ? 0.9 : 0.5 })),
    );
  },
  trace(): SVGElement {
    const dots: SVGElement[] = [];
    for (let k = 0; k < 28; k++) dots.push(svg('circle', { cx: 8 + k * 3.8, cy: (k % 2 ? 50 : 30) - k * 0.35, r: 1.7, fill: k % 2 ? 'var(--toc)' : 'var(--tic)' }));
    return svg('svg', { viewBox: '0 0 120 80', class: 'welcome-mini', 'aria-hidden': 'true' }, ...dots);
  },
  quartz(): SVGElement {
    const ticks: SVGElement[] = [];
    for (let k = 0; k < 9; k++) ticks.push(svg('line', { x1: 10 + k * 12.5, x2: 10 + k * 12.5, y1: 58, y2: k % 2 ? 34 : 26, stroke: 'var(--tic)', 'stroke-width': 2.5, 'stroke-linecap': 'round' }));
    return svg(
      'svg',
      { viewBox: '0 0 120 80', class: 'welcome-mini', 'aria-hidden': 'true' },
      svg('line', { x1: 6, x2: 114, y1: 62, y2: 62, stroke: 'var(--line)', 'stroke-width': 2 }),
      ...ticks,
    );
  },
};

export function welcomeView(root: HTMLElement): void {
  try {
    localStorage.setItem(WELCOMED_KEY, '1');
  } catch {
    /* storage unavailable */
  }

  const faces = h(
    'div',
    { class: 'welcome-faces' },
    ...[
      demoWatch({ id: 'w-a', brand: 'Rotary', movementType: 'manual', name: 'Cushion dress' }),
      demoWatch({ id: 'w-b', brand: 'Citizen', movementType: 'solar', name: 'Eco-Drive', caliber: 'Eco-Drive' }),
      demoWatch({ id: 'w-c', brand: 'Seiko', movementType: 'automatic', bph: 21600 }),
    ].map((w) => watchArt(w)),
  );

  const section = (title: string, text: string, art: SVGElement | HTMLElement) => h('div', { class: 'welcome-feature' }, art, h('div', null, h('h3', null, title), h('p', null, text)));

  root.append(
    h(
      'div',
      { class: 'page welcome' },
      h(
        'section',
        { class: 'welcome-hero' },
        h(
          'div',
          { class: 'welcome-hero-text' },
          h('h1', null, 'Listen to your watches.'),
          h(
            'p',
            { class: 'welcome-lede' },
            'Escapement is a timegrapher in your browser. Clip a pickup to a watch and it measures how fast it runs, how evenly it ticks and how far its balance swings. Quartz watches too. Every result is kept, watch by watch.',
          ),
          h(
            'div',
            { class: 'actions' },
            h(
              'a',
              {
                class: 'btn primary',
                href: '#/measure',
                onclick: () => savePrefs({ source: 'sim' }),
              },
              'Try it with a simulated watch',
            ),
            h('a', { class: 'btn', href: '#/watches/new' }, 'Add your first watch'),
          ),
          h('p', { class: 'small muted' }, 'Have a pickup or microphone? ', h('a', { href: '/lab' }, 'Check it in Pickup Lab'), ' first.'),
        ),
        h('div', { class: 'welcome-hero-art-wrap' }, heroArt()),
      ),

      h('h2', { class: 'welcome-h2' }, 'Getting started'),
      h(
        'ol',
        { class: 'welcome-steps' },
        h('li', null, mini.clip(), h('h3', null, 'Clip the pickup to the case'), h('p', null, 'A cheap piezo contact pickup on the case side hears the ticks and ignores the room. A phone or laptop mic works in a quiet room.')),
        h('li', null, mini.spectrum(), h('h3', null, 'Check the signal'), h('p', null, 'Pickup Lab finds the best input, shows the noise and tells you if the level needs turning up.')),
        h('li', null, mini.trace(), h('h3', null, 'Measure'), h('p', null, 'Two tidy lines of dots mean a clean reading. Stop when you’re happy: it’s saved to the watch and to the Log.')),
      ),

      h('h2', { class: 'welcome-h2' }, 'What it measures'),
      h(
        'div',
        { class: 'welcome-features' },
        section('Mechanical watches', 'Rate in seconds a day, beat error and amplitude, live as it listens. The six-position test turns the watch through dial up, dial down and four crown positions for the full picture.', mini.trace()),
        section('Quartz watches', 'The seconds hand’s motor clicks once a second. Timed for ten minutes against internet time, that gives the rate in seconds a month, and a low battery shows up as 2-second steps.', mini.quartz()),
        section('Your collection', 'Photos or a drawn face for each watch, its history, battery changes and time checks. Identify a vintage piece from photos of the caseback, free, with the AI chat you already use.', faces),
      ),

      h(
        'p',
        { class: 'welcome-foot muted' },
        'Free and open source. Your watches and readings stay in this browser unless you turn on sync. ',
        h('a', { href: 'https://github.com/charlfourie/escapement', target: '_blank', rel: 'noopener' }, 'Source on GitHub'),
      ),
    ),
  );
}
