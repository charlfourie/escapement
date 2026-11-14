import { h, toast } from '../util/dom';
import { getSyncState, onSyncState, signIn, signOut, syncNow, type SyncState } from './sync';

const ago = (t: number | null) => {
  if (!t) return 'not yet';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** Sync button for the top bar; only shown when signed in. Syncing only happens when it's pressed. */
export function syncChip(): HTMLElement {
  const el = h('button', { type: 'button', class: 'sync-chip', hidden: true, onclick: () => void syncNow() }) as HTMLButtonElement;
  onSyncState((s) => {
    el.hidden = !s.login;
    const label: Partial<Record<SyncState['status'], string>> = {
      idle: s.pending ? `Sync ${s.pending} change${s.pending === 1 ? '' : 's'}` : 'Sync',
      syncing: 'Syncing…',
      error: 'Sync failed, retry',
      offline: 'Offline',
    };
    el.textContent = label[s.status] ?? 'Sync';
    el.dataset.status = s.status;
    el.dataset.pending = s.pending ? '1' : '';
    el.disabled = s.status === 'syncing';
    el.title = s.error ?? `Sync with your online collection · last synced ${ago(s.lastSync)}`;
    el.setAttribute('aria-label', `${el.textContent}. Last synced ${ago(s.lastSync)}`);
  });
  return el;
}

/** "Online collection" panel for the Data page. */
export function syncPanel(): HTMLElement {
  const body = h('div', { class: 'sync-body' });
  const panel = h('section', { class: 'panel' }, h('h2', null, 'Online collection'), body);

  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const flag = q.get('sync');
  if (flag === 'signed-in') toast('Signed in. Syncing your collection…');
  if (flag === 'denied') toast('That GitHub account isn’t allowed here.');
  if (flag === 'failed') toast('Sign-in didn’t complete. Try again.');

  const render = (s: SyncState) => {
    if (s.status === 'unavailable') {
      body.replaceChildren(h('p', { class: 'muted' }, 'Online sync isn’t available here (it needs the hosted version of Escapement).'));
      return;
    }
    if (s.status === 'not-configured') {
      body.replaceChildren(h('p', { class: 'muted' }, 'Online sync isn’t set up on this deployment yet. It needs a GitHub sign-in app and a private storage space; see the README.'));
      return;
    }
    if (!s.login) {
      body.replaceChildren(
        h('p', null, 'Keep your watches, photos and readings in sync between your devices, backed up in a private online store only you can sign in to.'),
        h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => signIn() }, 'Sign in with GitHub')),
      );
      return;
    }
    const statusText: Record<string, string> = {
      idle: s.pending ? `${s.pending} change${s.pending === 1 ? '' : 's'} waiting to sync` : 'Nothing waiting to sync',
      syncing: 'Syncing…',
      offline: 'Offline. Press Sync once you’re back online.',
      error: `Sync paused: ${s.error ?? 'unknown error'}`,
    };
    body.replaceChildren(
      h(
        'dl',
        { class: 'lab-kv sync-kv' },
        h('div', null, h('dt', null, 'Signed in as'), h('dd', null, s.login)),
        h('div', null, h('dt', null, 'Status'), h('dd', { 'data-status': s.status }, statusText[s.status] ?? s.status)),
        h('div', null, h('dt', null, 'Last synced'), h('dd', null, ago(s.lastSync))),
      ),
      h('p', { class: 'muted small' }, 'Syncing only happens when you press Sync, here or in the top bar. Changes wait on this device until then, and everything still works offline.'),
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn', disabled: s.status === 'syncing', onclick: () => void syncNow() }, 'Sync now'),
        h(
          'button',
          {
            class: 'btn',
            onclick: async () => {
              if (!confirm('Sign out on this device? Your data stays here and online.')) return;
              await signOut();
              toast('Signed out');
            },
          },
          'Sign out',
        ),
      ),
    );
  };
  const off = onSyncState(render);
  // Stop listening once the panel leaves the page.
  const obs = new MutationObserver(() => {
    if (!panel.isConnected) {
      off();
      obs.disconnect();
    }
  });
  queueMicrotask(() => obs.observe(document.body, { childList: true, subtree: true }));
  render(getSyncState());
  return panel;
}
