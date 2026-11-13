import { AudioEngine, listInputs, type EngineUpdate } from '../audio/engine';
import { SNIPPET_BIN_MS, SNIPPET_PRE_MS } from '../audio/detector';
import type { SimParams } from '../audio/synth';
import { analyze, downsample, STANDARD_BPH, type Analysis } from '../analysis/analyze';
import { blankWatch, db, newId, POSITIONS, WIND_STATES, type Position, type Watch, type WindState } from '../db';
import { loadPrefs, savePrefs } from '../prefs';
import { drawTrace, drawWaveform } from '../ui/canvas';
import { h, select, toast } from '../util/dom';
import { beatErrorGrade, fmtBph, fmtDuration, fmtHz, fmtMs, fmtRate, gradeLabel, rateGrade } from '../util/format';

const LIVE_WINDOW_SEC = 20;
const MAX_SEC = 180;
const SPANS = [2, 5, 10, 20, 50];

type State = 'idle' | 'starting' | 'running' | 'stopped';

function readout(label: string, unit: string) {
  const value = h('span', { class: 'ro-value' }, '—');
  const sub = h('div', { class: 'ro-sub' }, ' ');
  const el = h('div', { class: 'readout' }, h('div', { class: 'ro-label' }, label), h('div', { class: 'ro-main' }, value, h('span', { class: 'ro-unit' }, unit)), sub);
  return { el, value, sub };
}

function slider(label: string, min: number, max: number, step: number, value: number, fmt: (v: number) => string, oninput: (v: number) => void) {
  const out = h('output', null, fmt(value));
  const input = h('input', {
    type: 'range',
    min,
    max,
    step,
    value,
    oninput: (e: Event) => {
      const v = Number((e.target as HTMLInputElement).value);
      out.textContent = fmt(v);
      oninput(v);
    },
  });
  return h('label', { class: 'slider' }, h('span', { class: 'slider-head' }, h('span', null, label), out), input);
}

export function measureView(root: HTMLElement, query: URLSearchParams): () => void {
  const prefs = loadPrefs();
  const engine = new AudioEngine();
  let watches: Watch[] = [];
  let watchId = query.get('watch') ?? prefs.lastWatch;
  let bphSetting = 0; // 0 = auto
  let state: State = 'idle';
  let times: number[] = [];
  let snippets: number[][] = [];
  let startedAt = 0;
  let live: Analysis | null = null;
  let full: Analysis | null = null;
  let timer = 0;
  let raf = 0;
  let dirty = true;
  let disposed = false;

  // ---------- toolbar ----------
  const watchSelWrap = h('div', { class: 'field' });
  const bphSel = select<number>([[0, 'Auto-detect'], ...STANDARD_BPH.map((b): [number, string] => [b, `${fmtBph(b)} bph · ${fmtHz(b)}`])], 0, (v) => {
    bphSetting = Number(v);
    dirty = true;
  });
  const sourceSel = select<'mic' | 'sim'>(
    [
      ['mic', 'Microphone'],
      ['sim', 'Simulated watch'],
    ],
    prefs.source,
    (v) => {
      prefs.source = v as 'mic' | 'sim';
      savePrefs({ source: prefs.source });
      simPanel.hidden = prefs.source !== 'sim';
      deviceField.hidden = prefs.source !== 'mic';
      if (state === 'running') void restart();
    },
  );
  const startBtn = h('button', { class: 'btn primary start', onclick: () => (state === 'running' || state === 'starting' ? void stop() : void start()) }, 'Start');

  const toolbar = h(
    'div',
    { class: 'toolbar' },
    h('label', { class: 'field' }, h('span', null, 'Watch'), watchSelWrap),
    h('label', { class: 'field' }, h('span', null, 'Beat rate'), bphSel),
    h('label', { class: 'field' }, h('span', null, 'Input'), sourceSel),
    startBtn,
  );

  // ---------- readouts ----------
  const roRate = readout('Rate', 's/d');
  const roBE = readout('Beat error', 'ms');
  const roBph = readout('Beat rate', 'bph');
  const roAmp = readout('Amplitude', '°');
  roAmp.sub.textContent = 'Coming in the next phase';
  roAmp.el.classList.add('pending');
  const readouts = h('div', { class: 'readouts' }, roRate.el, roBE.el, roBph.el, roAmp.el);

  // ---------- trace ----------
  const traceCanvas = h('canvas', { class: 'trace', 'aria-label': 'Timegrapher trace' });
  const spanBtns = SPANS.map((s) =>
    h(
      'button',
      {
        class: `chip${s === prefs.traceSpan ? ' active' : ''}`,
        onclick: () => {
          prefs.traceSpan = s;
          savePrefs({ traceSpan: s });
          spanBtns.forEach((b, i) => b.classList.toggle('active', SPANS[i] === s));
          dirty = true;
        },
      },
      `±${s / 2}`,
    ),
  );
  const tracePanel = h(
    'section',
    { class: 'panel' },
    h(
      'header',
      { class: 'panel-head' },
      h('h2', null, 'Trace'),
      h('div', { class: 'legend' }, h('span', { class: 'dot tic' }), 'tic', h('span', { class: 'dot toc' }), 'toc'),
      h('div', { class: 'chips', title: 'Vertical range (ms)' }, spanBtns, h('span', { class: 'chip-label' }, 'ms')),
    ),
    traceCanvas,
    h('p', { class: 'hint' }, 'Flat line = accurate. Sloping up = gaining, down = losing. Two separate lines = beat error.'),
  );

  // ---------- signal ----------
  const waveCanvas = h('canvas', { class: 'wave', 'aria-label': 'Tick waveform' });
  const meterFill = h('div', { class: 'meter-fill' });
  const meterNoise = h('div', { class: 'meter-mark noise', title: 'Noise floor' });
  const meterThr = h('div', { class: 'meter-mark thr', title: 'Trigger level' });
  const meter = h('div', { class: 'meter' }, meterFill, meterNoise, meterThr);
  const stTicks = h('dd', null, '0');
  const stQuality = h('dd', null, '—');
  const stJitter = h('dd', null, '—');
  const stElapsed = h('dd', null, '0:00');
  const deviceSel = h('select', {
    onchange: (e: Event) => {
      prefs.deviceId = (e.target as HTMLSelectElement).value;
      savePrefs({ deviceId: prefs.deviceId });
      if (state === 'running') void restart();
    },
  });
  const deviceField = h('label', { class: 'field' }, h('span', null, 'Microphone'), deviceSel);
  deviceField.hidden = prefs.source !== 'mic';

  const signalPanel = h(
    'section',
    { class: 'panel' },
    h('header', { class: 'panel-head' }, h('h2', null, 'Signal')),
    meter,
    h('div', { class: 'meter-legend' }, h('span', null, h('i', { class: 'sw fill' }), 'level'), h('span', null, h('i', { class: 'sw noise' }), 'noise'), h('span', null, h('i', { class: 'sw thr' }), 'trigger')),
    slider('Trigger level', 2, 20, 0.5, prefs.sensitivity, (v) => `×${v.toFixed(1)}`, (v) => {
      prefs.sensitivity = v;
      savePrefs({ sensitivity: v });
      engine.setDetector({ sensitivity: v });
    }),
    deviceField,
    h('dl', { class: 'stats' }, h('div', null, h('dt', null, 'Ticks'), stTicks), h('div', null, h('dt', null, 'Clean beats'), stQuality), h('div', null, h('dt', null, 'Jitter'), stJitter), h('div', null, h('dt', null, 'Elapsed'), stElapsed)),
  );
  const wavePanel = h(
    'section',
    { class: 'panel' },
    h('header', { class: 'panel-head' }, h('h2', null, 'Tick'), h('span', { class: 'muted small' }, 'unlock · impulse · drop')),
    waveCanvas,
  );

  // ---------- simulator ----------
  const setSim = (patch: Partial<SimParams>) => {
    prefs.sim = { ...prefs.sim, ...patch };
    savePrefs({ sim: prefs.sim });
    engine.setSim(patch);
  };
  const listenBox = h('input', {
    type: 'checkbox',
    checked: prefs.listen,
    onchange: (e: Event) => {
      prefs.listen = (e.target as HTMLInputElement).checked;
      savePrefs({ listen: prefs.listen });
      engine.setMonitor(prefs.listen);
    },
  });
  const simPanel = h(
    'section',
    { class: 'panel sim' },
    h('header', { class: 'panel-head' }, h('h2', null, 'Simulated watch'), h('label', { class: 'check' }, listenBox, 'Listen')),
    h(
      'div',
      { class: 'sim-grid' },
      h(
        'label',
        { class: 'field' },
        h('span', null, 'Beat rate'),
        select<number>(STANDARD_BPH.map((b): [number, string] => [b, `${fmtBph(b)} bph`]), prefs.sim.bph, (v) => {
          setSim({ bph: Number(v) });
          if (state === 'running') void restart();
        }),
      ),
      slider('Rate', -60, 60, 0.5, prefs.sim.rate, (v) => `${fmtRate(v)} s/d`, (v) => setSim({ rate: v })),
      slider('Beat error', 0, 4, 0.1, prefs.sim.beatError, (v) => `${v.toFixed(1)} ms`, (v) => setSim({ beatError: v })),
      slider('Amplitude', 160, 320, 5, prefs.sim.amplitude, (v) => `${v}°`, (v) => setSim({ amplitude: v })),
      slider('Noise', 0, 0.03, 0.001, prefs.sim.noise, (v) => (v * 1000).toFixed(0), (v) => setSim({ noise: v })),
    ),
  );
  simPanel.hidden = prefs.source !== 'sim';

  // ---------- messages / save ----------
  const message = h('div', { class: 'message', hidden: true });
  const savePanel = h('section', { class: 'panel save', hidden: true });

  const help = h(
    'details',
    { class: 'panel help' },
    h('summary', null, 'How to get a clean reading'),
    h(
      'ul',
      null,
      h('li', null, 'Find a quiet room. Lay the watch dial-up on a soft cloth with the caseback (or the lugs) touching your phone or laptop microphone.'),
      h('li', null, 'Better still, use a cheap piezo contact mic pressed against the case. It ignores room noise.'),
      h('li', null, 'Press Start. When dots form two tidy lines, give it 30–60 seconds, then press Stop and save.'),
      h('li', null, 'Scattered dots? Raise the trigger level. No ticks? Lower it, or move the mic closer.'),
      h('li', null, 'Choose the beat rate manually if auto-detect picks half the real rate (that happens when only every other tick is heard).'),
    ),
  );

  root.append(
    h(
      'div',
      { class: 'measure' },
      toolbar,
      message,
      readouts,
      tracePanel,
      h('div', { class: 'two-col' }, wavePanel, signalPanel),
      simPanel,
      savePanel,
      help,
    ),
  );

  // ---------- data ----------
  async function loadWatches() {
    watches = await db.watches.orderBy('name').toArray();
    if (watchId && !watches.some((w) => w.id === watchId)) watchId = '';
    renderWatchSelect();
    applyWatchBph();
  }

  function renderWatchSelect() {
    const opts: Array<[string, string]> = [['', watches.length ? 'Quick test (no watch)' : 'Quick test'], ...watches.map((w): [string, string] => [w.id, w.name])];
    watchSelWrap.replaceChildren(
      select(opts, watchId, (v) => {
        watchId = v;
        savePrefs({ lastWatch: v });
        applyWatchBph();
      }),
    );
  }

  function applyWatchBph() {
    const w = watches.find((x) => x.id === watchId);
    bphSetting = w?.bph ?? 0;
    bphSel.value = String(bphSetting);
  }

  async function loadDevices() {
    const devices = await listInputs().catch(() => []);
    deviceSel.replaceChildren(
      h('option', { value: '' }, 'Default microphone'),
      ...devices.filter((d) => d.deviceId && d.deviceId !== 'default').map((d, i) => h('option', { value: d.deviceId, selected: d.deviceId === prefs.deviceId }, d.label || `Microphone ${i + 1}`)),
    );
  }

  // ---------- engine ----------
  function onUpdate(u: EngineUpdate) {
    for (const t of u.ticks) {
      times.push(t.time);
      snippets.push(t.envelope);
    }
    if (snippets.length > 12) snippets = snippets.slice(-12);
    if (times.length && times[times.length - 1] - times[0] > MAX_SEC) {
      const cutoff = times[times.length - 1] - MAX_SEC;
      times = times.filter((t) => t >= cutoff);
    }
    const db_ = (v: number) => (v > 0 ? 20 * Math.log10(v) : -120);
    const pct = (v: number) => `${Math.max(0, Math.min(100, ((db_(v) + 80) / 80) * 100))}%`;
    meterFill.style.width = pct(u.level);
    meterNoise.style.left = pct(u.noise);
    meterThr.style.left = pct(u.threshold);
    if (u.ticks.length) dirty = true;
  }

  async function start() {
    state = 'starting';
    times = [];
    snippets = [];
    live = full = null;
    savePanel.hidden = true;
    showMessage(null);
    renderState();
    engine.onUpdate = onUpdate;
    try {
      await engine.start(prefs.source === 'sim' ? { kind: 'sim', params: prefs.sim } : { kind: 'mic', deviceId: prefs.deviceId || undefined }, { sensitivity: prefs.sensitivity });
    } catch (err) {
      state = 'idle';
      renderState();
      showMessage(describeError(err), 'error');
      return;
    }
    if (disposed) return void engine.stop();
    engine.setMonitor(prefs.source === 'sim' && prefs.listen);
    if (prefs.source === 'mic') void loadDevices();
    startedAt = performance.now();
    state = 'running';
    renderState();
    timer = window.setInterval(update, 250);
  }

  async function restart() {
    await stop(false);
    await start();
  }

  async function stop(showSave = true) {
    clearInterval(timer);
    await engine.stop();
    if (state !== 'running' && state !== 'starting') return;
    state = 'stopped';
    full = analyze(times, { bph: bphSetting || null, windowSec: MAX_SEC });
    update(false);
    renderState();
    if (showSave) renderSave();
  }

  function update(recompute = true) {
    if (recompute && state === 'running') {
      live = analyze(times, { bph: bphSetting || null, windowSec: LIVE_WINDOW_SEC });
      full = analyze(times, { bph: live?.bph ?? (bphSetting || null), windowSec: MAX_SEC });
    }
    const r = state === 'stopped' ? full : live;
    if (r) {
      const g = rateGrade(r.rate);
      roRate.value.textContent = fmtRate(r.rate);
      roRate.el.dataset.grade = g;
      roRate.sub.textContent = gradeLabel[g];
      roBE.value.textContent = fmtMs(r.beatError);
      roBE.el.dataset.grade = beatErrorGrade(r.beatError);
      roBE.sub.textContent = r.beatError === null ? 'Only one tick side heard' : r.beatError <= 0.6 ? 'In beat' : 'Slightly out of beat';
      if (r.beatError !== null && r.beatError > 1.5) roBE.sub.textContent = 'Out of beat';
      roBph.value.textContent = fmtBph(r.bph);
      roBph.sub.textContent = `${fmtHz(r.bph)} · ${r.bphDetected ? 'detected' : 'set'}`;
      stQuality.textContent = `${Math.round(r.quality * 100)}%`;
      stJitter.textContent = `${r.jitter.toFixed(2)} ms`;
    } else {
      for (const ro of [roRate, roBE, roBph]) {
        ro.value.textContent = '—';
        delete ro.el.dataset.grade;
      }
      const sub = state === 'running' ? 'Listening…' : ' ';
      roRate.sub.textContent = sub;
      roBE.sub.textContent = ' ';
      roBph.sub.textContent = ' ';
      stQuality.textContent = '—';
      stJitter.textContent = '—';
    }
    stTicks.textContent = String(times.length);
    if (state === 'running') stElapsed.textContent = fmtDuration((performance.now() - startedAt) / 1000);
    dirty = true;
  }

  function draw() {
    if (disposed) return;
    raf = requestAnimationFrame(draw);
    if (!dirty) return;
    dirty = false;
    const msg = state === 'running' ? (times.length < 8 ? 'Listening for ticks…' : 'Locking on…') : state === 'starting' ? 'Starting…' : 'Press Start, then hold the watch against the microphone';
    drawTrace(traceCanvas, full?.points ?? [], { spanMs: prefs.traceSpan, windowSec: null, message: msg });
    drawWaveform(waveCanvas, snippets, SNIPPET_BIN_MS, SNIPPET_PRE_MS);
  }

  function renderState() {
    const active = state === 'running' || state === 'starting';
    startBtn.textContent = state === 'starting' ? 'Starting…' : active ? 'Stop' : state === 'stopped' ? 'Measure again' : 'Start';
    startBtn.classList.toggle('stop', active);
    startBtn.disabled = state === 'starting';
    root.querySelector('.measure')?.classList.toggle('is-running', active);
    dirty = true;
  }

  function showMessage(text: string | null, kind: 'error' | 'info' = 'info') {
    message.hidden = !text;
    message.className = `message ${kind}`;
    message.textContent = text ?? '';
  }

  function describeError(err: unknown): string {
    const name = (err as { name?: string })?.name;
    if (!window.isSecureContext) return 'The microphone only works over HTTPS (or on localhost). Try the simulated watch, or open Escapement over https.';
    if (name === 'NotAllowedError') return 'Microphone access was blocked. Allow it in your browser’s site settings, or try the simulated watch.';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone found. Plug one in, pick another input, or try the simulated watch.';
    return `Could not start audio: ${(err as Error)?.message ?? err}`;
  }

  // ---------- save ----------
  function renderSave() {
    savePanel.hidden = false;
    const r = full;
    if (!r) {
      savePanel.replaceChildren(
        h('header', { class: 'panel-head' }, h('h2', null, 'No reading')),
        h('p', { class: 'muted' }, 'There weren’t enough clean ticks to calculate a result. Move the microphone closer, lower the trigger level, or set the beat rate manually, then try again.'),
      );
      return;
    }

    let targetId = watchId || (watches[0]?.id ?? '__new');
    let position: Position = 'DU';
    let wind: WindState = 'unknown';
    const nameInput = h('input', { type: 'text', placeholder: 'e.g. Seiko SPB143', required: true });
    const nameField = h('label', { class: 'field' }, h('span', null, 'New watch name'), nameInput);
    nameField.hidden = targetId !== '__new';
    const notes = h('input', { type: 'text', placeholder: 'Optional, e.g. after a day on the wrist' });

    const watchOpts: Array<[string, string]> = [...watches.map((w): [string, string] => [w.id, w.name]), ['__new', '+ New watch…']];
    const saveBtn = h('button', { class: 'btn primary', onclick: () => void doSave() }, 'Save measurement');

    async function doSave() {
      let target = watches.find((w) => w.id === targetId);
      if (targetId === '__new') {
        const name = nameInput.value.trim();
        if (!name) {
          nameInput.focus();
          return;
        }
        target = { ...blankWatch(), name, bph: r!.bph };
        await db.watches.add(target);
      }
      if (!target) return;
      saveBtn.disabled = true;
      await db.measurements.add({
        id: newId(),
        watchId: target.id,
        takenAt: Date.now(),
        position,
        wind,
        durationSec: r!.duration,
        bph: r!.bph,
        rate: r!.rate,
        beatError: r!.beatError,
        amplitude: null,
        jitter: r!.jitter,
        ticks: r!.ticks,
        quality: r!.quality,
        notes: notes.value.trim(),
        trace: downsample(r!.points, 800),
      });
      watchId = target.id;
      savePrefs({ lastWatch: watchId });
      await loadWatches();
      savePanel.replaceChildren(
        h('header', { class: 'panel-head' }, h('h2', null, 'Saved')),
        h('p', null, `${fmtRate(r!.rate)} s/d in ${POSITIONS[position].toLowerCase()} saved to ${target.name}. `, h('a', { href: `#/watches/${target.id}` }, 'View history →')),
      );
      toast(`Saved to ${target.name}`);
    }

    savePanel.replaceChildren(
      h('header', { class: 'panel-head' }, h('h2', null, 'Save this reading')),
      h(
        'div',
        { class: 'summary' },
        h('div', null, h('strong', null, fmtRate(r.rate)), ' s/d'),
        h('div', null, h('strong', null, fmtMs(r.beatError)), ' ms beat error'),
        h('div', null, h('strong', null, fmtBph(r.bph)), ' bph'),
        h('div', null, h('strong', null, fmtDuration(r.duration)), ` · ${r.ticks} ticks`),
      ),
      h(
        'div',
        { class: 'form-grid' },
        h(
          'label',
          { class: 'field' },
          h('span', null, 'Watch'),
          select(watchOpts, targetId, (v) => {
            targetId = v;
            nameField.hidden = v !== '__new';
          }),
        ),
        nameField,
        h('label', { class: 'field' }, h('span', null, 'Position'), select(Object.entries(POSITIONS) as Array<[Position, string]>, position, (v) => (position = v as Position))),
        h('label', { class: 'field' }, h('span', null, 'Wind'), select(Object.entries(WIND_STATES) as Array<[WindState, string]>, wind, (v) => (wind = v as WindState))),
        h('label', { class: 'field wide' }, h('span', null, 'Notes'), notes),
      ),
      h('div', { class: 'actions' }, saveBtn, h('button', { class: 'btn', onclick: () => (savePanel.hidden = true) }, 'Discard')),
    );
  }

  // ---------- go ----------
  const onResize = () => (dirty = true);
  window.addEventListener('resize', onResize);
  void loadWatches();
  void loadDevices();
  update(false);
  renderState();
  draw();

  return () => {
    disposed = true;
    clearInterval(timer);
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    void engine.stop();
  };
}
