import { AudioEngine, listInputs, type EngineUpdate } from '../audio/engine';
import { AUTO_BANK, SNIPPET_BIN_MS, SNIPPET_PRE_MS } from '../audio/detector';
import { placementGuide } from './placement';
import { AutoLock, type LockState } from '../analysis/autolock';
import { TickAligner } from '../analysis/align';
import type { SimParams } from '../audio/synth';
import { amplitudeFrom, amplitudeFromLift, analyze, downsample, isValidReading, MIN_SAVE_QUALITY, MIN_SAVE_SEC, STANDARD_BPH, type Analysis, type AmplitudeResult } from '../analysis/analyze';
import { liftFromEnvelope } from '../analysis/lift';
import { PositionTest, SETTLE_SEC, STEP_SEC } from './position-test';
import { blankWatch, db, isTimegraphable, newId, POSITIONS, WIND_STATES, type Measurement, type Position, type Watch, type WindState } from '../db';
import { loadPrefs, savePrefs } from '../prefs';
import { drawTrace, drawWaveform } from '../ui/canvas';
import { downloadBlob, encodeWav, h, select, toast } from '../util/dom';
import { beatErrorGrade, fmtBph, fmtDuration, fmtHz, fmtMs, fmtRate, gradeLabel, rateGrade } from '../util/format';

const LIVE_WINDOW_SEC = 20;
const MAX_SEC = 180;
const SPANS = [2, 5, 10, 20, 50];

type State = 'idle' | 'starting' | 'running' | 'stopped';
type Mode = 'single' | 'test';

/** Healthy amplitude is roughly 250–310° dial up; under 200° usually means a service is due. */
function amplitudeGrade(a: number): 'good' | 'ok' | 'bad' {
  if (a >= 250 && a <= 330) return 'good';
  if (a >= 200 && a <= 345) return 'ok';
  return 'bad';
}

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
  let lifts: Array<number | null> = [];
  let aligner = new TickAligner(SNIPPET_BIN_MS);
  let snippets: number[][] = [];
  let liveAmp: AmplitudeResult | null = null;
  let fullAmp: AmplitudeResult | null = null;
  let mode: Mode = query.get('mode') === 'test' ? 'test' : 'single';
  let stepLockedAt: number | null = null;
  let finishingStep = false;
  let recording = false;
  let autolock: AutoLock | null = null;
  let lock: LockState | null = null;
  let streamSnips: number[][][] = [];
  let refractory = 50;
  let evalCount = 0;
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
  const modeBtns = (
    [
      ['single', 'Single reading'],
      ['test', 'Six-position test'],
    ] as Array<[Mode, string]>
  ).map(([m, label]) =>
    h(
      'button',
      {
        type: 'button',
        class: `seg${m === mode ? ' active' : ''}`,
        'aria-pressed': String(m === mode),
        onclick: () => void setMode(m),
      },
      label,
    ),
  );
  const modeSwitch = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Measuring mode' }, modeBtns);

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

  const triggerSlider = slider('Trigger level', 2, 20, 0.5, prefs.sensitivity, (v) => `×${v.toFixed(1)}`, (v) => {
    prefs.sensitivity = v;
    savePrefs({ sensitivity: v });
    engine.setDetector({ sensitivity: v });
  });
  triggerSlider.hidden = prefs.autoTrigger;
  const lockStatus = h('p', { class: 'lock-status' });
  const denoiseBox = h('input', {
    type: 'checkbox',
    checked: prefs.denoise,
    onchange: (e: Event) => {
      prefs.denoise = (e.target as HTMLInputElement).checked;
      savePrefs({ denoise: prefs.denoise });
      engine.setDenoise(prefs.denoise);
    },
  });
  const denoiseRow = h(
    'label',
    { class: 'check denoise-row', title: 'Spectral noise reduction ahead of the tick detector' },
    denoiseBox,
    h('span', null, h('strong', null, 'Noise reduction'), ' · helps with steady hum, buzz or whine (fans, chargers, mains). Leave it off for plain hiss, where it can make things worse.'),
  );
  const autoBox = h('input', {
    type: 'checkbox',
    checked: prefs.autoTrigger,
    onchange: (e: Event) => {
      prefs.autoTrigger = (e.target as HTMLInputElement).checked;
      savePrefs({ autoTrigger: prefs.autoTrigger });
      triggerSlider.hidden = prefs.autoTrigger;
      renderLockStatus();
      if (state === 'running') void restart();
    },
  });

  const recordBtn = h('button', { type: 'button', class: 'btn small', disabled: true, onclick: () => void recordClip() }, 'Record 10 s clip');

  const signalPanel = h(
    'section',
    { class: 'panel' },
    h('header', { class: 'panel-head' }, h('h2', null, 'Signal'), h('label', { class: 'check', title: 'Automatically find the best trigger level and filter' }, autoBox, 'Auto-tune')),
    meter,
    h('div', { class: 'meter-legend' }, h('span', null, h('i', { class: 'sw fill' }), 'level'), h('span', null, h('i', { class: 'sw noise' }), 'noise'), h('span', null, h('i', { class: 'sw thr' }), 'trigger')),
    lockStatus,
    denoiseRow,
    triggerSlider,
    deviceField,
    h('dl', { class: 'stats' }, h('div', null, h('dt', null, 'Ticks'), stTicks), h('div', null, h('dt', null, 'Clean beats'), stQuality), h('div', null, h('dt', null, 'Jitter'), stJitter), h('div', null, h('dt', null, 'Elapsed'), stElapsed)),
    h(
      'div',
      { class: 'record-row' },
      recordBtn,
      h('span', { class: 'muted small' }, 'Saves the raw input as a WAV file, handy for tuning detection on your setup.'),
    ),
    h('p', { class: 'small' }, h('a', { href: '/lab' }, 'New pickup or mic? Check it in Pickup Lab →')),
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
  const test = new PositionTest({
    getWatches: () => watches,
    getWatchId: () => watchId,
    onSaved: async (id) => {
      watchId = id;
      savePrefs({ lastWatch: id });
      await loadWatches();
    },
    onChange: () => renderState(),
  });
  test.el.hidden = mode !== 'test';

  const help = h(
    'details',
    { class: 'panel help' },
    h('summary', null, 'How to get a clean reading'),
    h(
      'ul',
      null,
      h('li', null, 'Find a quiet room. Lay the watch dial-up on a soft cloth with the caseback (or the lugs) touching your phone or laptop microphone.'),
      h('li', null, 'Better still, use a piezo contact pickup clipped to the case. See “Where to clip the pickup” below.'),
      h('li', null, 'Press Start. When dots form two tidy lines, give it 30–60 seconds, then press Stop and save.'),
      h('li', null, 'Amplitude needs the right lift angle for accuracy. Set it on the watch (52° suits most movements; check the caliber on Ranfft DB).'),
      h('li', null, 'For a full picture, use the six-position test: it measures each position in turn and works out the average rate and the spread between positions.'),
      h('li', null, 'Leave Auto-tune on: it tries every filter and trigger level at once and locks onto the cleanest beat. Setting the beat rate, if you know it, makes locking faster and more reliable.'),
      h('li', null, 'Nothing locks with the pickup clipped on? The input may simply be too quiet. A piezo pickup on a computer’s mic jack often needs the input level at 100 and Mic Boost at +20 dB (Windows: Sound settings → Recording → Properties → Levels). Pickup Lab checks this for you.'),
      h('li', null, 'Leave Noise reduction off unless there’s a steady hum or whine: on plain hiss it adds false ticks.'),
      h('li', null, 'With Auto-tune off: scattered dots? Raise the trigger level. No ticks? Lower it, or move the mic closer.'),
      h('li', null, 'Choose the beat rate manually if auto-detect picks half the real rate (that happens when only every other tick is heard).'),
    ),
  );

  root.append(
    h(
      'div',
      { class: 'measure' },
      modeSwitch,
      toolbar,
      message,
      test.el,
      readouts,
      tracePanel,
      h('div', { class: 'two-col' }, wavePanel, signalPanel),
      simPanel,
      savePanel,
      help,
      placementGuide(),
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
    const opts: Array<[string, string]> = [['', 'No watch (saved to the Log)'], ...watches.filter(isTimegraphable).map((w): [string, string] => [w.id, w.name])];
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
    if (w && !isTimegraphable(w)) {
      showMessage(`${w.name} is a quartz watch, which a timegrapher can’t read. Use the quartz test or time checks on its page instead.`, 'info');
      watchId = '';
      return applyWatchBph();
    }
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
    if (autolock) {
      for (const t of u.ticks) {
        autolock.add(t.d, t.time, t.lift, t.envelope);
        const s = (streamSnips[t.d] ??= []);
        s.push(t.envelope);
        if (s.length > 12) s.shift();
      }
      autolock.trim(MAX_SEC);
      followStream();
    } else {
      for (const t of u.ticks) {
        const a = aligner.align(t.time, t.envelope);
        if (!a) continue;
        times.push(a.time);
        lifts.push(t.lift);
        snippets.push(t.envelope);
      }
      if (snippets.length > 12) snippets = snippets.slice(-12);
      if (times.length && times[times.length - 1] - times[0] > MAX_SEC) {
        const cutoff = times[times.length - 1] - MAX_SEC;
        let k = 0;
        while (k < times.length && times[k] < cutoff) k++;
        times = times.slice(k);
        lifts = lifts.slice(k);
      }
    }
    const db_ = (v: number) => (v > 0 ? 20 * Math.log10(v) : -120);
    const pct = (v: number) => `${Math.max(0, Math.min(100, ((db_(v) + 80) / 80) * 100))}%`;
    meterFill.style.width = pct(u.level);
    meterNoise.style.left = pct(u.noise);
    meterThr.style.left = pct(u.threshold);
    if (u.ticks.length) dirty = true;
  }

  /** In auto mode, point times/snippets at the currently chosen detector stream. */
  function followStream() {
    if (!autolock) return;
    const idx = lock?.index ?? 0;
    times = autolock.streams[idx];
    lifts = autolock.lifts[idx];
    snippets = streamSnips[idx] ?? [];
  }

  function liftAngle(): number {
    return watches.find((w) => w.id === watchId)?.liftAngle || 52;
  }

  /** Amplitude from the lift times of ticks in the last `windowSec` seconds. */
  function amplitudeOver(windowSec: number, bph: number): AmplitudeResult | null {
    if (!times.length) return null;
    const cutoff = times[times.length - 1] - windowSec;
    const ls: number[] = [];
    for (let i = times.length - 1; i >= 0 && times[i] >= cutoff; i--) {
      const l = lifts[i];
      if (l !== null && l !== undefined) ls.push(l);
    }
    const perTick = amplitudeFrom(ls, bph, liftAngle());
    if (perTick) return perTick;
    // Too noisy to time the clicks on single ticks: try the averaged beat.
    const avg = autolock ? autolock.template(lock?.index ?? 0) : aligner.average;
    const tl = avg ? liftFromEnvelope(avg, SNIPPET_BIN_MS) : null;
    const a = tl ? amplitudeFromLift(tl.lift, bph, liftAngle()) : null;
    return a ? { amplitude: a, spread: 0, samples: ls.length, averaged: true } : null;
  }

  async function setMode(m: Mode) {
    if (m === mode) return;
    if (state === 'running' || state === 'starting') await stop(false);
    mode = m;
    modeBtns.forEach((b, i) => {
      const on = (i === 0 ? 'single' : 'test') === m;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    test.el.hidden = m !== 'test';
    savePanel.hidden = true;
    renderState();
  }

  async function recordClip() {
    if (recording || state !== 'running') return;
    recording = true;
    const secs = 10;
    let left = secs;
    recordBtn.disabled = true;
    recordBtn.textContent = `Recording… ${left} s`;
    const tick = window.setInterval(() => {
      left = Math.max(0, left - 1);
      recordBtn.textContent = `Recording… ${left} s`;
    }, 1000);
    try {
      const clip = await engine.record(secs);
      const d = new Date();
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
      const w = watches.find((x) => x.id === watchId);
      const tag = [w?.name, bphSetting ? `${bphSetting}bph` : ''].filter(Boolean).join('-').replace(/[^a-z0-9-]+/gi, '_');
      downloadBlob(encodeWav(clip.samples, clip.sampleRate), `escapement-clip-${stamp}${tag ? `-${tag}` : ''}.wav`);
      toast('Clip saved to your downloads');
    } catch (err) {
      toast(`Recording failed: ${(err as Error)?.message ?? err}`);
    } finally {
      clearInterval(tick);
      recording = false;
      recordBtn.textContent = 'Record 10 s clip';
      recordBtn.disabled = state !== 'running';
    }
  }

  /** In a six-position test: count locked-on time and finish the step when enough is in. */
  function progressTest() {
    if (mode !== 'test' || state !== 'running' || finishingStep || test.done) return;
    if (!live) {
      stepLockedAt = null;
      test.setProgress('Waiting for the beat…', 0);
      return;
    }
    const now = performance.now();
    stepLockedAt ??= now;
    const t = (now - stepLockedAt) / 1000;
    if (t < SETTLE_SEC) {
      test.setProgress(`Locked on, letting it settle… ${Math.ceil(SETTLE_SEC - t)} s`, t / (SETTLE_SEC + STEP_SEC));
      return;
    }
    if (t < SETTLE_SEC + STEP_SEC) {
      test.setProgress(`Measuring… ${Math.floor(t - SETTLE_SEC)} of ${STEP_SEC} s`, t / (SETTLE_SEC + STEP_SEC));
      return;
    }
    void finishStep();
  }

  async function finishStep() {
    finishingStep = true;
    const position = test.current!;
    const bph = analysisBph() ?? live?.bph ?? null;
    const a = analyze(times, { bph, windowSec: STEP_SEC });
    const amp = a ? amplitudeOver(STEP_SEC, a.bph) : null;
    clearInterval(timer);
    await engine.stop();
    state = 'idle';
    finishingStep = false;
    if (a) {
      test.complete({ position, analysis: a, amplitude: amp?.amplitude ?? null });
      toast(test.done ? 'All positions done' : 'Position done. Move the watch for the next one.');
    } else {
      showMessage('Couldn’t get a clean reading in that position. Try it again.', 'error');
    }
    test.setRunning(false);
    renderState();
  }

  /** Beat rate to analyse with: the user's setting, or what auto-lock found. */
  function analysisBph(): number | null {
    if (bphSetting) return bphSetting;
    if (autolock) return lock?.locked ? lock.bph : null;
    return null;
  }

  function renderLockStatus() {
    lockStatus.hidden = !prefs.autoTrigger;
    if (!prefs.autoTrigger) return;
    const running = state === 'running';
    lockStatus.dataset.locked = String(Boolean(running && lock?.locked));
    if (!running || !autolock) {
      lockStatus.textContent = `Auto-tune listens through ${AUTO_BANK.length} filter and trigger combinations at once and keeps whichever hears a clean, steady beat.`;
    } else if (!lock?.locked) {
      lockStatus.textContent = lock && lock.score > 0.05 ? `Searching for the beat… best match so far ${Math.round(lock.score * 100)}%` : 'Searching for the beat…';
    } else {
      const b = AUTO_BANK[lock.index];
      lockStatus.textContent = `Locked on · ${b.highpassHz / 1000} kHz filter · trigger ×${b.sensitivity} · ${Math.round(lock.score * 100)}% match`;
    }
  }

  async function start() {
    if (mode === 'test' && test.done) test.reset();
    state = 'starting';
    times = [];
    lifts = [];
    aligner = new TickAligner(SNIPPET_BIN_MS);
    snippets = [];
    live = full = null;
    liveAmp = fullAmp = null;
    stepLockedAt = null;
    autolock = prefs.autoTrigger ? new AutoLock(AUTO_BANK.length) : null;
    lock = null;
    streamSnips = [];
    refractory = 50;
    evalCount = 0;
    savePanel.hidden = true;
    showMessage(null);
    renderState();
    engine.onUpdate = onUpdate;
    try {
      await engine.start(prefs.source === 'sim' ? { kind: 'sim', params: prefs.sim } : { kind: 'mic', deviceId: prefs.deviceId || undefined }, {
        auto: prefs.autoTrigger,
        denoise: prefs.denoise,
        detector: { sensitivity: prefs.sensitivity },
      });
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
    if (mode === 'test') test.setRunning(true);
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
    if (mode === 'test') {
      // Stopping mid-position abandons that position; it stays up next.
      state = 'idle';
      test.setRunning(false);
      renderLockStatus();
      renderState();
      return;
    }
    state = 'stopped';
    followStream();
    full = analyze(times, { bph: analysisBph(), windowSec: MAX_SEC });
    fullAmp = full ? amplitudeOver(MAX_SEC, full.bph) : null;
    update(false);
    renderLockStatus();
    renderState();
    if (showSave) void renderSave();
  }

  function update(recompute = true) {
    if (recompute && state === 'running') {
      if (autolock) {
        // Full search is heavier, so run it every third update (~0.75 s).
        if (evalCount++ % 3 === 0) {
          lock = autolock.evaluate(bphSetting || null);
          engine.select(lock.index);
          // Once locked, ignore anything within ~half a beat of a tick: kills echoes.
          const want = lock.locked && lock.bph ? Math.round(0.45 * (3600 / lock.bph) * 1000) : 50;
          if (want !== refractory) {
            refractory = want;
            engine.setRefractory(want);
          }
          renderLockStatus();
        }
        followStream();
      }
      if (!autolock || lock?.locked) {
        live = analyze(times, { bph: analysisBph(), windowSec: LIVE_WINDOW_SEC });
        full = analyze(times, { bph: live?.bph ?? analysisBph(), windowSec: MAX_SEC });
        liveAmp = live ? amplitudeOver(LIVE_WINDOW_SEC, live.bph) : null;
      } else {
        live = full = null;
        liveAmp = null;
      }
      progressTest();
    }
    const r = state === 'stopped' ? full : live;
    const amp = state === 'stopped' ? fullAmp : liveAmp;
    if (r && amp) {
      roAmp.value.textContent = String(Math.round(amp.amplitude));
      roAmp.el.dataset.grade = amplitudeGrade(amp.amplitude);
      roAmp.sub.textContent = `lift angle ${liftAngle()}°${amp.averaged ? ' · from averaged ticks' : amp.spread > 30 ? ' · unsteady' : ''}`;
    } else {
      roAmp.value.textContent = '—';
      delete roAmp.el.dataset.grade;
      roAmp.sub.textContent = r ? 'Can’t separate the clicks yet' : ' ';
    }
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
      roBph.sub.textContent = `${fmtHz(r.bph)} · ${bphSetting ? 'set' : 'detected'}`;
      stQuality.textContent = `${Math.round(r.quality * 100)}%`;
      stJitter.textContent = `${r.jitter.toFixed(2)} ms`;
    } else {
      for (const ro of [roRate, roBE, roBph]) {
        ro.value.textContent = '—';
        delete ro.el.dataset.grade;
      }
      const sub = state === 'running' ? (autolock ? 'Searching for the beat…' : 'Listening…') : ' ';
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
    const msg = state === 'running' ? (times.length < 8 ? 'Listening for ticks…' : autolock && !lock?.locked ? 'Searching for the beat…' : 'Locking on…') : state === 'starting' ? 'Starting…' : 'Press Start, then hold the watch against the microphone';
    drawTrace(traceCanvas, full?.points ?? [], { spanMs: prefs.traceSpan, windowSec: null, message: msg });
    drawWaveform(waveCanvas, snippets, SNIPPET_BIN_MS, SNIPPET_PRE_MS);
  }

  function renderState() {
    const active = state === 'running' || state === 'starting';
    const pos = test.current;
    startBtn.textContent =
      state === 'starting' ? 'Starting…' : active ? 'Stop' : mode === 'test' ? (pos ? `Start: ${POSITIONS[pos]}` : 'New test') : state === 'stopped' ? 'Measure again' : 'Start';
    recordBtn.disabled = state !== 'running' || recording;
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
  /**
   * Every valid reading is saved as soon as it stops, to the chosen watch or,
   * with none chosen, to the log as unassigned. The panel then edits it.
   */
  async function renderSave() {
    savePanel.hidden = false;
    const r = full;
    if (!r) {
      savePanel.replaceChildren(
        h('header', { class: 'panel-head' }, h('h2', null, 'No reading')),
        h('p', { class: 'muted' }, 'There weren’t enough clean ticks to calculate a result. Move the microphone closer, lower the trigger level, or set the beat rate manually, then try again.'),
      );
      return;
    }
    if (!isValidReading(r)) {
      const why = r.duration < MIN_SAVE_SEC ? `only ${Math.round(r.duration)} s long` : `only ${Math.round(r.quality * 100)}% clean beats`;
      savePanel.replaceChildren(
        h('header', { class: 'panel-head' }, h('h2', null, 'Not saved')),
        h('p', { class: 'muted' }, `This reading wasn’t saved automatically: it was ${why}. Readings of at least ${MIN_SAVE_SEC} s with ${Math.round(MIN_SAVE_QUALITY * 100)}% clean beats save on their own.`),
        h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => void autoSave(r) }, 'Save anyway')),
      );
      return;
    }
    await autoSave(r);
  }

  async function autoSave(r: Analysis) {
    const target = watches.find((w) => w.id === watchId && isTimegraphable(w));
    const rec: Measurement = {
      id: newId(),
      watchId: target?.id ?? '',
      takenAt: Date.now(),
      position: loadPrefs().lastPosition,
      wind: 'unknown',
      durationSec: r.duration,
      bph: r.bph,
      rate: r.rate,
      beatError: r.beatError,
      amplitude: fullAmp?.amplitude ?? null,
      jitter: r.jitter,
      ticks: r.ticks,
      quality: r.quality,
      notes: '',
      trace: downsample(r.points, 800),
    };
    await db.measurements.add(rec);
    toast(target ? `Saved to ${target.name}` : 'Saved to the log');
    renderSaved(rec, r);
  }

  function renderSaved(rec: Measurement, r: Analysis) {
    const update = (patch: Partial<Measurement>) => {
      Object.assign(rec, patch);
      void db.measurements.update(rec.id, patch);
    };
    const title = h('h2');
    const where = h('p', { class: 'small' });
    const nameInput = h('input', { type: 'text', placeholder: 'e.g. Seiko SPB143' });
    const createBtn = h('button', { class: 'btn small', type: 'button' }, 'Create and assign');
    const newRow = h('div', { class: 'battery-row', hidden: true }, h('label', { class: 'field grow' }, h('span', null, 'New watch name'), nameInput), createBtn);
    const showWhere = () => {
      const w = watches.find((x) => x.id === rec.watchId);
      title.textContent = w ? `Saved to ${w.name}` : 'Saved to the log';
      where.replaceChildren(w ? h('a', { href: `#/watches/${w.id}` }, 'View this watch’s history →') : 'Not linked to a watch yet: pick one below, or assign it later in the Log. ', h('a', { href: '#/log' }, ' Open the Log →'));
    };
    createBtn.onclick = async () => {
      const name = nameInput.value.trim();
      if (!name) return void nameInput.focus();
      const w = { ...blankWatch(), name, bph: r.bph };
      await db.watches.add(w);
      await loadWatches();
      watchId = w.id;
      savePrefs({ lastWatch: w.id });
      update({ watchId: w.id });
      newRow.hidden = true;
      renderSaved(rec, r);
    };
    const watchOpts: Array<[string, string]> = [['', 'No watch (log only)'], ...watches.filter(isTimegraphable).map((w): [string, string] => [w.id, w.name]), ['__new', '+ New watch…']];
    const notes = h('input', { type: 'text', value: rec.notes, placeholder: 'Optional, e.g. after a day on the wrist', onchange: (e: Event) => update({ notes: (e.target as HTMLInputElement).value.trim() }) });
    showWhere();
    savePanel.replaceChildren(
      h('header', { class: 'panel-head' }, title, h('span', { class: 'muted small' }, 'changes save as you make them')),
      h(
        'div',
        { class: 'summary' },
        h('div', null, h('strong', null, fmtRate(r.rate)), ' s/d'),
        h('div', null, h('strong', null, fmtMs(r.beatError)), ' ms beat error'),
        h('div', null, h('strong', null, fmtBph(r.bph)), ' bph'),
        fullAmp && h('div', null, h('strong', null, String(Math.round(fullAmp.amplitude))), '° amplitude'),
        h('div', null, h('strong', null, fmtDuration(r.duration)), ` · ${r.ticks} ticks`),
      ),
      where,
      h(
        'div',
        { class: 'form-grid' },
        h(
          'label',
          { class: 'field' },
          h('span', null, 'Watch'),
          select(watchOpts, rec.watchId, (v) => {
            newRow.hidden = v !== '__new';
            if (v === '__new') return void nameInput.focus();
            update({ watchId: v });
            if (v) {
              watchId = v;
              savePrefs({ lastWatch: v });
            }
            showWhere();
          }),
        ),
        h(
          'label',
          { class: 'field' },
          h('span', null, 'Position'),
          select(Object.entries(POSITIONS) as Array<[Position, string]>, rec.position, (v) => {
            update({ position: v as Position });
            savePrefs({ lastPosition: v as Position });
          }),
        ),
        h('label', { class: 'field' }, h('span', null, 'Wind'), select(Object.entries(WIND_STATES) as Array<[WindState, string]>, rec.wind, (v) => update({ wind: v as WindState }))),
        h('label', { class: 'field wide' }, h('span', null, 'Notes'), notes),
      ),
      newRow,
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          {
            class: 'btn danger small',
            onclick: async () => {
              if (!confirm('Delete this reading?')) return;
              await db.measurements.delete(rec.id);
              savePanel.replaceChildren(h('header', { class: 'panel-head' }, h('h2', null, 'Deleted')), h('p', { class: 'muted' }, 'The reading was removed.'));
            },
          },
          'Delete this reading',
        ),
      ),
    );
  }

  // ---------- go ----------
  const onResize = () => (dirty = true);
  window.addEventListener('resize', onResize);
  void loadWatches();
  void loadDevices();
  update(false);
  renderState();
  renderLockStatus();
  draw();

  return () => {
    disposed = true;
    clearInterval(timer);
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    void engine.stop();
  };
}
