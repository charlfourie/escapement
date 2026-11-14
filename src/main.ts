import './styles.css';
import { h } from './util/dom';
import { measureView } from './views/measure';
import { watchesView } from './views/watches';
import { watchFormView } from './views/watch-form';
import { watchDetailView } from './views/watch-detail';
import { dataView } from './views/data';
import { movementDetailView, movementsView } from './views/movements';
import { initSync } from './sync/sync';
import { syncChip } from './sync/ui';

/** Set to your public repo URL to show a source link in the footer. */
const REPO_URL = 'https://github.com/charlfourie/escapement';

type Cleanup = void | (() => void);
type Route = [RegExp, (root: HTMLElement, m: RegExpMatchArray, q: URLSearchParams) => Cleanup, string];

const routes: Route[] = [
  [/^\/?(measure)?$/, (r, _m, q) => measureView(r, q), 'measure'],
  [/^\/watches\/new$/, (r) => watchFormView(r, null), 'watches'],
  [/^\/watches\/([^/]+)\/edit$/, (r, m) => watchFormView(r, m[1]), 'watches'],
  [/^\/watches\/([^/]+)$/, (r, m) => watchDetailView(r, m[1]), 'watches'],
  [/^\/watches$/, (r) => watchesView(r), 'watches'],
  [/^\/movements\/(.+)$/, (r, m) => movementDetailView(r, m[1]), 'movements'],
  [/^\/movements$/, (r) => movementsView(r), 'movements'],
  [/^\/data$/, (r) => dataView(r), 'data'],
];

const logo = () => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 32 32');
  s.setAttribute('class', 'logo');
  s.innerHTML =
    '<circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<path d="M6 17h5l2-5 3 10 3-12 2 7h5" fill="none" stroke="var(--tic)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
  return s;
};

const navLinks = [
  ['measure', '#/measure', 'Measure'],
  ['watches', '#/watches', 'Watches'],
  ['movements', '#/movements', 'Movements'],
  ['data', '#/data', 'Data'],
] as const;

const nav = h('nav', { class: 'nav' }, navLinks.map(([key, href, label]) => h('a', { href, 'data-key': key }, label)));
const view = h('main', { id: 'view' });

document.getElementById('app')!.append(
  h('header', { class: 'topbar' }, h('a', { class: 'brand', href: '#/measure' }, logo(), h('span', null, 'Escapement')), h('div', { class: 'topbar-right' }, syncChip(), nav)),
  view,
  h(
    'footer',
    { class: 'footer' },
    h('span', null, 'Escapement: an open-source timegrapher for your browser.'),
    REPO_URL && h('a', { href: REPO_URL, target: '_blank', rel: 'noopener' }, 'Source on GitHub'),
  ),
);

let cleanup: Cleanup;

function route() {
  if (typeof cleanup === 'function') cleanup();
  cleanup = undefined;
  view.replaceChildren();
  const raw = location.hash.replace(/^#/, '') || '/measure';
  const [path, qs] = raw.split('?');
  const query = new URLSearchParams(qs ?? '');
  for (const [re, render, key] of routes) {
    const m = path.match(re);
    if (m) {
      nav.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.key === key));
      cleanup = render(view, m, query);
      window.scrollTo(0, 0);
      return;
    }
  }
  view.append(h('div', { class: 'page' }, h('p', null, 'Page not found. ', h('a', { href: '#/measure' }, 'Go to Measure'))));
}

window.addEventListener('hashchange', route);
route();
void initSync();

// New data from another device: redraw read-only pages. Pages where you might
// be measuring or typing (Measure, the watch form) are left alone.
window.addEventListener('escapement:synced', () => {
  const path = location.hash.replace(/^#/, '').split('?')[0] || '/measure';
  if (/^\/?(measure)?$/.test(path) || /\/(new|edit)$/.test(path)) return;
  const y = window.scrollY;
  route();
  window.scrollTo(0, y);
});
