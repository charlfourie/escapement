import { db, POSITIONS, WIND_STATES, type Measurement, type Movement, type Watch } from '../db';
import { h, toast } from '../util/dom';
import { aiSettingsBlock } from './identify-panel';

interface ExportFile {
  app: 'escapement';
  version: 1;
  exportedAt: string;
  watches: Array<Omit<Watch, 'photo'> & { photo: string | null }>;
  measurements: Measurement[];
  /** Added in v0.2; older backups don't have it. */
  movements?: Movement[];
}

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });

const dataUrlToBlob = async (u: string) => (await fetch(u)).blob();

function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

async function exportJson() {
  const watches = await db.watches.toArray();
  const file: ExportFile = {
    app: 'escapement',
    version: 1,
    exportedAt: new Date().toISOString(),
    watches: await Promise.all(watches.map(async (w) => ({ ...w, photo: w.photo ? await blobToDataUrl(w.photo) : null }))),
    measurements: await db.measurements.toArray(),
    movements: await db.movements.toArray(),
  };
  download(`escapement-backup-${stamp()}.json`, JSON.stringify(file), 'application/json');
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function exportCsv() {
  const watches = new Map((await db.watches.toArray()).map((w) => [w.id, w]));
  const ms = await db.measurements.orderBy('takenAt').toArray();
  const header = ['watch', 'brand', 'reference', 'caliber', 'taken_at', 'position', 'wind', 'rate_s_per_day', 'beat_error_ms', 'amplitude_deg', 'bph', 'duration_s', 'ticks', 'clean_beats', 'jitter_ms', 'notes'];
  const rows = ms.map((m) => {
    const w = watches.get(m.watchId);
    return [w?.name, w?.brand, w?.reference, w?.caliber, new Date(m.takenAt).toISOString(), POSITIONS[m.position], WIND_STATES[m.wind], m.rate.toFixed(2), m.beatError?.toFixed(2), m.amplitude, m.bph, m.durationSec.toFixed(1), m.ticks, m.quality.toFixed(3), m.jitter.toFixed(3), m.notes];
  });
  download(`escapement-measurements-${stamp()}.csv`, [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n'), 'text/csv');
}

async function importJson(file: File): Promise<string> {
  const data = JSON.parse(await file.text()) as ExportFile;
  if (data?.app !== 'escapement' || !Array.isArray(data.watches) || !Array.isArray(data.measurements)) throw new Error('Not a Escapement backup file');
  const watches: Watch[] = await Promise.all(data.watches.map(async (w) => ({ ...w, photo: w.photo ? await dataUrlToBlob(w.photo) : null })));
  const movements = Array.isArray(data.movements) ? data.movements : [];
  await db.transaction('rw', db.watches, db.measurements, db.movements, async () => {
    await db.watches.bulkPut(watches);
    await db.measurements.bulkPut(data.measurements);
    await db.movements.bulkPut(movements);
  });
  return `Imported ${watches.length} watches, ${data.measurements.length} measurements and ${movements.length} movements`;
}

export function dataView(root: HTMLElement): void {
  const counts = h('p', { class: 'muted' }, '…');
  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    onchange: async (e: Event) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (!f) return;
      try {
        toast(await importJson(f));
        void refresh();
      } catch (err) {
        toast((err as Error).message || 'Import failed');
      }
      (e.target as HTMLInputElement).value = '';
    },
  });

  async function refresh() {
    const [w, m, mv] = await Promise.all([db.watches.count(), db.measurements.count(), db.movements.count()]);
    let usage = '';
    try {
      const est = await navigator.storage?.estimate?.();
      if (est?.usage) usage = ` · about ${(est.usage / 1024 / 1024).toFixed(1)} MB used`;
    } catch {
      /* ignore */
    }
    counts.textContent = `${w} watch${w === 1 ? '' : 'es'}, ${m} measurement${m === 1 ? '' : 's'} and ${mv} movement${mv === 1 ? '' : 's'} stored in this browser${usage}.`;
  }

  root.append(
    h(
      'div',
      { class: 'page narrow' },
      h('header', { class: 'page-head' }, h('h1', null, 'Your data')),
      h(
        'section',
        { class: 'panel' },
        h('h2', null, 'Stored on this device'),
        h('p', null, 'Escapement has no accounts and no server. Your watches and measurements live in this browser’s storage (IndexedDB). Export a backup now and then, or to move to another device.'),
        counts,
      ),
      h(
        'section',
        { class: 'panel' },
        h('h2', null, 'Export'),
        h(
          'div',
          { class: 'actions' },
          h('button', { class: 'btn primary', onclick: () => void exportJson() }, 'Full backup (.json)'),
          h('button', { class: 'btn', onclick: () => void exportCsv() }, 'Measurements (.csv)'),
        ),
        h('p', { class: 'muted small' }, 'The JSON backup includes photos and traces. The CSV is one row per measurement, ready for a spreadsheet.'),
      ),
      h(
        'section',
        { class: 'panel' },
        h('h2', null, 'AI identification'),
        h('p', null, 'When you add or edit a watch, “Identify with AI” can work out the brand, reference and caliber from photos. It uses your own Anthropic API key.'),
        aiSettingsBlock(),
      ),
      h(
        'section',
        { class: 'panel' },
        h('h2', null, 'Import'),
        h('p', null, 'Restore a Escapement backup. Matching watches and measurements are updated. Nothing gets deleted.'),
        h('label', { class: 'btn file' }, 'Choose backup file…', fileInput),
      ),
    ),
  );
  void refresh();
}
