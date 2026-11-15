import { h } from '../util/dom';
import { ARCHIVE_URL } from '../data/movements';

interface Link {
  name: string;
  url: string;
  what: string;
}

/** Where Escapement's reference data comes from. */
const SOURCES: Link[] = [
  {
    name: 'Watch Movements Archive',
    url: ARCHIVE_URL,
    what: 'A database of thousands of movements, many of them vintage, built by members of the German watch forum UHRFORUM.de. Escapement’s archive entries (beat rate, jewels, size, power reserve, production years, identification tips) come from it, with the admin’s permission. Each entry links back to its page, where you’ll find photos and full notes.',
  },
  {
    name: 'Caliber Corner',
    url: 'https://calibercorner.com/',
    what: 'Spec sheets for modern calibers: the source for most beat rates and lift angles in Escapement’s own reference entries (ETA, Sellita, Seiko, Miyota, Rolex, TAG Heuer).',
  },
  {
    name: 'Omega Forums',
    url: 'https://omegaforums.net/',
    what: 'Watchmakers’ notes on Omega lift angles, including the 38° figure for co-axial calibers.',
  },
];

/** Further reading, not data sources. */
const MORE: Link[] = [
  {
    name: 'Ranfft DB',
    url: 'https://ranfft.org/',
    what: 'The community movement encyclopedia that continues Roland Ranfft’s reference. Linked from every movement; Escapement doesn’t copy its data.',
  },
];

const linkList = (links: Link[]) =>
  h(
    'ul',
    { class: 'link-list' },
    links.map((l) => h('li', null, h('a', { href: l.url, target: '_blank', rel: 'noopener' }, l.name, ' ↗'), h('p', { class: 'muted small' }, l.what))),
  );

export function linksView(root: HTMLElement): void {
  const credits = h('p', { class: 'muted small' }, 'Thank you to everyone who has contributed to these sites. Escapement’s reference library wouldn’t exist without your work.');
  root.append(
    h(
      'div',
      { class: 'page narrow' },
      h('header', { class: 'page-head' }, h('h1', null, 'Links & sources')),
      h('p', { class: 'muted' }, 'Escapement’s movement data stands on other people’s work. These are the sites it’s based on, and where to go for more.'),
      h('section', { class: 'panel' }, h('h2', null, 'Sources'), linkList(SOURCES), credits),
      h('section', { class: 'panel' }, h('h2', null, 'More information'), linkList(MORE)),
    ),
  );
}
