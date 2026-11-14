/**
 * Pickup Lab: a companion page for checking a pickup or microphone before
 * measuring watches. Lists the inputs the browser can see, shows what audio
 * processing the browser applied, draws live level / spectrum / waveform,
 * and runs three short tests (noise, tap, watch) that end in a verdict.
 */
import '../styles.css';
import { placementGuide } from '../views/placement';
import './lab.css';
import { AudioEngine, listInputs, type EngineUpdate } from '../audio/engine';
import { AUTO_BANK } from '../audio/detector';
import { amplitudeFrom, analyze, type Analysis } from '../analysis/analyze';
import { AutoLock, type LockState } from '../analysis/autolock';
import { loadPrefs, savePrefs } from '../prefs';
import { downloadBlob, encodeWav, h, toast } from '../util/dom';
import { fmtBph, fmtMs, fmtRate } from '../util/format';

const SIM_ID = '__sim';
const NOISE_SEC = 5;
const TAP_SEC = 6;
const WATCH_SEC = 15;
const STORE = 'escapement:lab';

type Grade = 'excellent' | 'good' | 'usable' | 'poor' | 'none';
const GRADE_LABEL: Record<Grade, string> = {
  excellent: 'Excellent',
  good: 'Good',
  usable: 'Usable',
  poor: 'Too noisy',
  none: 'Not hearing the watch',
};

interface LabResult {
  deviceId: string;
  label: string;
  at: number;
  noiseDb: number | null;
  humDb: number | null;
  tapDb: number | null;
  snrDb: number | null;
  clean: number | null;
  bph: number | null;
  rate: number | null;
  beatError: number | null;
  amplitude: number | null;
  filter: string | null;
  processing: string[];
  grade: Grade | null;
}

const dB = (v: number) => (v > 0 ? 20 * Math.log10(v) : -160);
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(navigator.userAgent);

function loadResults(): LabResult[] {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '[]');
  } catch {
    return [];
  }
}
function saveResults(rs: LabResult[]) {
  try {
    localStorage.setItem(STORE, JSON.stringify(rs.slice(-20)));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------- state
const engine = new AudioEngine();
let analyser: AnalyserNode | null = null;
let timeBuf: Float32Array<ArrayBuffer> = new Float32Array(2048);
let freqBuf: Float32Array<ArrayBuffer> = new Float32Array(4096);
let lock: AutoLock | null = null;
let lockState: LockState | null = null;
let peaks: number[][] = [];
let noiseReports: number[] = [];
let lastUpdate = 0;
let evalTimer = 0;
let raf = 0;
let currentId = '';
let currentLabel = '';
let result: LabResult | null = null;
let busy: 'noise' | 'tap' | 'watch' | null = null;
let rmsSmooth = -120;
let peakHold = -120;
let peakHoldAt = 0;
/** Frames of level and spectrum gathered while a test runs. */
let collect: { rms: number[]; peak: number[]; spectra: Float32Array[] } | null = null;

// ---------------------------------------------------------------- elements
const inputsList = h('div', { class: 'lab-inputs' });
const allowBtn = h('button', { class: 'btn primary', onclick: () => void refreshInputs(true) }, 'Allow microphone and list inputs');
const settingsEl = h('div', { class: 'lab-settings' });
const levelFill = h('div', { class: 'lab-level-fill' });
const levelPeak = h('div', { class: 'lab-level-peak' });
const levelText = h('div', { class: 'lab-level-text' }, '—');
const clipWarn = h('span', { class: 'lab-clip', hidden: true }, 'Clipping');
const spectrum = h('canvas', { class: 'lab-canvas', 'aria-label': 'Live spectrum' });
const scope = h('canvas', { class: 'lab-canvas short', 'aria-label': 'Live waveform' });
const liveStatus = h('p', { class: 'lock-status' }, 'Pick an input to start listening.');
const testsEl = h('div', { class: 'lab-tests' });
const verdictEl = h('div', { class: 'lab-verdict' });
const compareEl = h('div', { class: 'table-wrap' });
const recordBtn = h('button', { class: 'btn small', disabled: true, onclick: () => void record() }, 'Record 10 s clip');

function card(title: string, subtitle: string, ...children: Node[]) {
  return h('section', { class: 'panel' }, h('header', { class: 'panel-head' }, h('h2', null, title), h('span', { class: 'muted small' }, subtitle)), ...children);
}

const tips = h(
  'details',
  { class: 'panel help' },
  h('summary', null, 'Connecting a pickup to a phone'),
  h(
    'ul',
    null,
    h('li', null, 'A piezo pickup needs a mic input. The simplest is a small USB sound card with a pink mic jack, plugged into the phone through a USB-C (OTG) adapter. A guitar pickup with a 6.35 mm plug also needs a 6.35 → 3.5 mm adapter.'),
    h('li', null, 'Plain USB-C headphone adapters usually only accept a mic through a 4-ring (TRRS) plug. A 2- or 3-ring guitar plug won’t reach the mic contact, so the phone keeps using its built-in mic.'),
    isIOS && h('li', null, 'On iPhone and iPad the browser can’t pick between inputs. Plugging in a USB sound card makes it the input automatically; check that the level jumps when you tap the pickup.'),
    isAndroid && h('li', null, 'On Android the sound card shows up as “USB audio” (or similar) in the list after you allow the microphone. If it doesn’t, unplug and replug it, then refresh the list.'),
    h('li', null, 'If the level barely moves with the watch on, the pickup may need more gain: some sound cards have a gain knob or a setting in the phone’s audio menu.'),
  ),
);

document.getElementById('app')!.append(
  h(
    'header',
    { class: 'topbar' },
    h('a', { class: 'brand', href: '/#/measure' }, logo(), h('span', null, 'Pickup Lab')),
    h('nav', { class: 'nav' }, h('a', { href: '/#/measure' }, '← Escapement')),
  ),
  h(
    'main',
    { id: 'view' },
    h(
      'div',
      { class: 'page lab' },
      h('header', { class: 'page-head' }, h('h1', null, 'Pickup Lab')),
      h('p', { class: 'lab-intro' }, 'Check that your pickup works with this phone or computer, find the best input, and see how clean the signal is before you measure a watch.'),
      card('1 · Inputs', 'what this browser can hear', h('div', { class: 'actions' }, allowBtn), inputsList, settingsEl),
      card(
        '2 · Live signal',
        'raw input, before any filtering',
        h('div', { class: 'lab-level' }, h('div', { class: 'lab-level-bar' }, levelFill, levelPeak), levelText, clipWarn),
        h('h3', { class: 'lab-h3' }, 'Spectrum'),
        spectrum,
        h('p', { class: 'hint' }, 'Watch ticks show up as broad energy in the shaded 2–8 kHz band. A spike at 50 Hz (and 100, 150…) is mains hum.'),
        h('h3', { class: 'lab-h3' }, 'Waveform'),
        scope,
        h(
          'label',
          { class: 'check denoise-row' },
          h('input', {
            type: 'checkbox',
            checked: loadPrefs().denoise,
            onchange: (e: Event) => {
              const on = (e.target as HTMLInputElement).checked;
              savePrefs({ denoise: on });
              engine.setDenoise(on);
            },
          }),
          h('span', null, h('strong', null, 'Noise reduction'), ' for the tick detector (shared with Escapement). Try the watch test with it on and off: it helps with steady hum, buzz or whine, not with plain hiss.'),
        ),
        liveStatus,
      ),
      placementGuide({ open: true }),
      card('3 · Tests', 'run them in order, about 30 s in total', testsEl),
      card('4 · Verdict', 'for the selected input', verdictEl, h('div', { class: 'actions' }, recordBtn, h('span', { class: 'muted small' }, 'A clip helps tune detection for your exact setup.'))),
      card('Compare inputs', 'results kept in this browser', compareEl),
      tips,
    ),
  ),
);

function logo() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 32 32');
  s.setAttribute('class', 'logo');
  s.innerHTML =
    '<circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<path d="M6 17h5l2-5 3 10 3-12 2 7h5" fill="none" stroke="var(--tic)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
  return s;
}

// ---------------------------------------------------------------- inputs
async function refreshInputs(ask: boolean) {
  if (ask) {
    try {
      // A short permission request so device labels become visible.
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch (err) {
      toast(window.isSecureContext ? 'Microphone access was blocked. Allow it in the site settings.' : 'The microphone needs HTTPS.');
      void err;
    }
  }
  const devices = await listInputs().catch(() => []);
  const labelled = devices.some((d) => d.label);
  allowBtn.textContent = labelled ? 'Refresh the list' : 'Allow microphone and list inputs';
  const items: Array<{ id: string; label: string; note?: string }> = devices.map((d, i) => ({
    id: d.deviceId,
    label: d.label || `Input ${i + 1}`,
    note: d.deviceId === 'default' ? 'system default' : /usb/i.test(d.label) ? 'USB' : undefined,
  }));
  items.push({ id: SIM_ID, label: 'Simulated pickup', note: 'demo, no hardware' });
  inputsList.replaceChildren(
    ...items.map((it) =>
      h(
        'button',
        {
          type: 'button',
          class: `lab-input${it.id === currentId ? ' active' : ''}`,
          onclick: () => void selectInput(it.id, it.label),
        },
        h('span', { class: 'lab-input-name' }, it.label),
        it.note && h('span', { class: 'lab-badge' }, it.note),
      ),
    ),
  );
  if (!devices.length && !ask) inputsList.prepend(h('p', { class: 'muted small' }, 'Press the button to see your inputs.'));
}

async function selectInput(id: string, label: string) {
  if (busy) return;
  currentId = id;
  currentLabel = label;
  result = null;
  void refreshInputs(false);
  await startListening();
}

async function startListening() {
  stopLoops();
  liveStatus.textContent = 'Starting…';
  const sim = currentId === SIM_ID;
  const prefs = loadPrefs();
  try {
    await engine.start(sim ? { kind: 'sim', params: { ...prefs.sim, noise: 0.006 } } : { kind: 'mic', deviceId: currentId === 'default' ? undefined : currentId }, { auto: true, denoise: prefs.denoise, detector: {} });
  } catch (err) {
    liveStatus.textContent = `Couldn’t open this input: ${(err as Error)?.message ?? err}`;
    return;
  }
  const ctx = engine.context!;
  analyser = ctx.createAnalyser();
  analyser.fftSize = 8192;
  analyser.smoothingTimeConstant = 0.5;
  engine.input!.connect(analyser);
  timeBuf = new Float32Array(analyser.fftSize);
  freqBuf = new Float32Array(analyser.frequencyBinCount);
  resetLock();
  engine.onUpdate = onUpdate;
  renderSettings();
  renderTests();
  renderVerdict();
  recordBtn.disabled = false;
  evalTimer = window.setInterval(evaluate, 750);
  raf = requestAnimationFrame(frame);
}

function resetLock() {
  lock = new AutoLock(AUTO_BANK.length);
  lockState = null;
  peaks = AUTO_BANK.map(() => []);
  noiseReports = [];
  engine.setRefractory(50);
}

function stopLoops() {
  clearInterval(evalTimer);
  cancelAnimationFrame(raf);
}

function renderSettings() {
  const track = engine.track;
  if (!track) {
    settingsEl.replaceChildren(h('p', { class: 'muted small' }, 'Simulated pickup: no browser processing involved.'));
    return;
  }
  const st = track.getSettings() as MediaTrackSettings & { latency?: number };
  // Newer browsers may report echo cancellation as a mode string ("all", "remote-only", "none").
  const flag = (v: unknown): boolean | undefined => (v === undefined ? undefined : typeof v === 'string' ? v !== 'none' : Boolean(v));
  const flags: Array<[string, boolean | undefined]> = [
    ['Echo cancellation', flag(st.echoCancellation)],
    ['Noise suppression', flag(st.noiseSuppression)],
    ['Auto gain', flag(st.autoGainControl)],
  ];
  const on = flags.filter(([, v]) => v === true).map(([k]) => k);
  settingsEl.replaceChildren(
    h(
      'dl',
      { class: 'lab-kv' },
      h('div', null, h('dt', null, 'Device'), h('dd', null, track.label || currentLabel)),
      h('div', null, h('dt', null, 'Sample rate'), h('dd', null, st.sampleRate ? `${st.sampleRate / 1000} kHz` : `${(engine.context?.sampleRate ?? 0) / 1000} kHz`)),
      h('div', null, h('dt', null, 'Channels'), h('dd', null, st.channelCount ? String(st.channelCount) : '—')),
      ...flags.map(([k, v]) => h('div', null, h('dt', null, k), h('dd', { 'data-flag': v === true ? 'bad' : 'good' }, v === undefined ? 'not reported' : v ? 'ON' : 'off'))),
    ),
    on.length
      ? h('p', { class: 'message error' }, `This browser kept ${on.join(', ').toLowerCase()} switched on for this input. That can erase ticks. Try another browser (Chrome works best) or another input.`)
      : h('p', { class: 'muted small' }, 'Voice processing is off, so the raw signal comes through.'),
  );
}

// ---------------------------------------------------------------- live
function onUpdate(u: EngineUpdate) {
  if (!lock) return;
  for (const t of u.ticks) {
    lock.add(t.d, t.time, t.lift, t.envelope);
    peaks[t.d].push(t.peak);
  }
  noiseReports.push(u.noise);
  if (noiseReports.length > 400) noiseReports.splice(0, noiseReports.length - 400);
  lock.trim(60);
  for (let i = 0; i < peaks.length; i++) if (peaks[i].length > lock.streams[i].length) peaks[i] = peaks[i].slice(peaks[i].length - lock.streams[i].length);
  lastUpdate = performance.now();
}

function evaluate() {
  if (!lock) return;
  lockState = lock.evaluate(null);
  engine.select(lockState.index);
  const want = lockState.locked && lockState.bph ? Math.round(0.45 * (3600 / lockState.bph) * 1000) : 50;
  engine.setRefractory(want);
  const times = lock.streams[lockState.index];
  const rate = times.length > 1 ? (times.filter((t) => t > times[times.length - 1] - 5).length / 5).toFixed(1) : '0';
  if (lockState.locked && lockState.bph) {
    const b = AUTO_BANK[lockState.index];
    liveStatus.dataset.locked = 'true';
    liveStatus.textContent = `Hearing a watch: ${fmtBph(lockState.bph)} bph · ${b.highpassHz / 1000} kHz filter works best · ${Math.round(lockState.score * 100)}% match`;
  } else {
    liveStatus.dataset.locked = 'false';
    liveStatus.textContent = Number(rate) > 0 ? `Hearing clicks (${rate}/s) but no steady beat yet.` : 'No clicks detected. Is the pickup connected and touching the watch?';
  }
}

function frame() {
  raf = requestAnimationFrame(frame);
  if (!analyser) return;
  analyser.getFloatTimeDomainData(timeBuf);
  analyser.getFloatFrequencyData(freqBuf);
  let sum = 0;
  let pk = 0;
  for (let i = 0; i < timeBuf.length; i++) {
    const x = timeBuf[i];
    sum += x * x;
    const a = x < 0 ? -x : x;
    if (a > pk) pk = a;
  }
  const rms = dB(Math.sqrt(sum / timeBuf.length));
  const peak = dB(pk);
  rmsSmooth = rmsSmooth * 0.8 + rms * 0.2;
  const now = performance.now();
  if (peak > peakHold || now - peakHoldAt > 1500) {
    peakHold = peak;
    peakHoldAt = now;
  }
  const pct = (v: number) => `${Math.max(0, Math.min(100, ((v + 100) / 100) * 100))}%`;
  levelFill.style.width = pct(rmsSmooth);
  levelPeak.style.left = pct(peakHold);
  levelText.textContent = `RMS ${rmsSmooth.toFixed(0)} dBFS · peak ${peakHold.toFixed(0)} dBFS`;
  clipWarn.hidden = pk < 0.99;
  if (collect) {
    collect.rms.push(rms);
    collect.peak.push(peak);
    if (collect.spectra.length < 400) collect.spectra.push(freqBuf.slice());
  }
  drawSpectrum();
  drawScope();
}

function css(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function prep(c: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth;
  const ht = c.clientHeight;
  if (c.width !== Math.round(w * dpr)) c.width = Math.round(w * dpr);
  if (c.height !== Math.round(ht * dpr)) c.height = Math.round(ht * dpr);
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, ht);
  return { ctx, w, h: ht };
}

function drawSpectrum() {
  const { ctx, w, h: ht } = prep(spectrum);
  const sr = engine.context?.sampleRate ?? 48000;
  const fMin = 20;
  const fMax = Math.min(20000, sr / 2);
  const x = (f: number) => (Math.log(f / fMin) / Math.log(fMax / fMin)) * w;
  const y = (d: number) => ht - ((d + 140) / 120) * ht;
  ctx.fillStyle = css('--grid');
  ctx.globalAlpha = 0.6;
  ctx.fillRect(x(2000), 0, x(8000) - x(2000), ht);
  ctx.globalAlpha = 1;
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillStyle = css('--muted');
  ctx.textAlign = 'center';
  for (const f of [50, 100, 500, 1000, 2000, 5000, 10000]) {
    if (f > fMax) continue;
    ctx.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x(f), ht - 3);
  }
  ctx.strokeStyle = css('--tic');
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  const binHz = sr / 2 / freqBuf.length;
  let started = false;
  for (let i = 1; i < freqBuf.length; i++) {
    const f = i * binHz;
    if (f < fMin || f > fMax) continue;
    const px = x(f);
    const py = y(Math.max(-140, freqBuf[i]));
    if (!started) {
      ctx.moveTo(px, py);
      started = true;
    } else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

function drawScope() {
  const { ctx, w, h: ht } = prep(scope);
  const n = Math.min(timeBuf.length, Math.round((engine.context?.sampleRate ?? 48000) * 0.05));
  let pk = 1e-6;
  for (let i = timeBuf.length - n; i < timeBuf.length; i++) pk = Math.max(pk, Math.abs(timeBuf[i]));
  const scale = Math.max(pk, 0.01);
  ctx.strokeStyle = css('--grid');
  ctx.beginPath();
  ctx.moveTo(0, ht / 2 + 0.5);
  ctx.lineTo(w, ht / 2 + 0.5);
  ctx.stroke();
  ctx.strokeStyle = css('--toc');
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const v = timeBuf[timeBuf.length - n + i] / scale;
    const px = (i / (n - 1)) * w;
    const py = ht / 2 - v * (ht / 2 - 4);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.fillStyle = css('--muted');
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText(`last 50 ms · auto-scaled to ${dB(scale).toFixed(0)} dBFS`, 6, 12);
}

// ---------------------------------------------------------------- tests
function ensureResult(): LabResult {
  result ??= {
    deviceId: currentId,
    label: currentLabel,
    at: Date.now(),
    noiseDb: null,
    humDb: null,
    tapDb: null,
    snrDb: null,
    clean: null,
    bph: null,
    rate: null,
    beatError: null,
    amplitude: null,
    filter: null,
    processing: [],
    grade: null,
  };
  return result;
}

async function runFor(kind: 'noise' | 'tap' | 'watch', seconds: number, label: (left: number) => string) {
  busy = kind;
  renderTests();
  const progress = testsEl.querySelector<HTMLElement>(`[data-test="${kind}"] .lab-progress`)!;
  collect = { rms: [], peak: [], spectra: [] };
  const end = performance.now() + seconds * 1000;
  while (performance.now() < end) {
    progress.textContent = label(Math.ceil((end - performance.now()) / 1000));
    await new Promise((r) => setTimeout(r, 200));
  }
  const data = collect;
  collect = null;
  busy = null;
  return data;
}

async function noiseTest() {
  const data = await runFor('noise', NOISE_SEC, (s) => `Listening to the quiet… ${s} s`);
  const r = ensureResult();
  r.noiseDb = median(data.rms);
  // Mains hum: strongest of 50/60 Hz and harmonics vs. the 200–1000 Hz floor.
  const sr = engine.context?.sampleRate ?? 48000;
  const avg = new Float32Array(freqBuf.length);
  for (const s of data.spectra) for (let i = 0; i < avg.length; i++) avg[i] += s[i] / data.spectra.length;
  const binHz = sr / 2 / avg.length;
  const at = (f: number) => {
    const i = Math.round(f / binHz);
    return Math.max(avg[i - 1] ?? -160, avg[i] ?? -160, avg[i + 1] ?? -160);
  };
  const floor: number[] = [];
  for (let i = Math.round(200 / binHz); i < Math.round(1000 / binHz); i++) floor.push(avg[i]);
  const hum = Math.max(...[50, 100, 150, 60, 120, 180].map(at));
  r.humDb = hum - median(floor);
  finish();
}

async function tapTest() {
  const data = await runFor('tap', TAP_SEC, (s) => `Tap the pickup gently now… ${s} s`);
  const r = ensureResult();
  r.tapDb = Math.max(...data.peak);
  finish();
}

async function watchTest() {
  resetLock();
  await runFor('watch', WATCH_SEC, (s) => `Listening to the watch… ${s} s${lockState?.locked ? ' · locked on' : ''}`);
  const r = ensureResult();
  evaluate();
  const st = lockState!;
  const times = lock!.streams[st.index];
  const a: Analysis | null = st.locked ? analyze(times, { bph: st.bph }) : null;
  const noise = median(noiseReports);
  const pk = median(peaks[st.index].slice(-Math.max(8, Math.round(times.length * 0.8))));
  // Only meaningful once locked: otherwise the 'peaks' may be noise bursts, not ticks.
  r.snrDb = st.locked && Number.isFinite(pk) && noise > 0 ? dB(pk / noise) : null;
  r.clean = a ? a.quality : null;
  r.bph = a?.bph ?? null;
  r.rate = a?.rate ?? null;
  r.beatError = a?.beatError ?? null;
  r.filter = st.locked ? `${AUTO_BANK[st.index].highpassHz / 1000} kHz, ×${AUTO_BANK[st.index].sensitivity}` : null;
  r.amplitude = a ? (amplitudeFrom(lock!.lifts[st.index].filter((x): x is number => x !== null), a.bph, 52)?.amplitude ?? null) : null;
  const ticksHeard = times.length > 10;
  r.grade = !ticksHeard ? 'none' : !a ? 'poor' : (r.snrDb ?? 0) >= 25 && a.quality >= 0.9 ? 'excellent' : (r.snrDb ?? 0) >= 15 && a.quality >= 0.75 ? 'good' : 'usable';
  finish();
}

function finish() {
  const r = ensureResult();
  r.at = Date.now();
  const track = engine.track;
  if (track) {
    const st = track.getSettings();
    const on = (v: unknown) => (typeof v === 'string' ? v !== 'none' : v === true);
    r.processing = [on(st.echoCancellation) && 'echo cancellation', on(st.noiseSuppression) && 'noise suppression', on(st.autoGainControl) && 'auto gain'].filter((x): x is string => Boolean(x));
  }
  const all = loadResults().filter((x) => x.deviceId !== r.deviceId || x.label !== r.label);
  all.push(r);
  saveResults(all);
  renderTests();
  renderVerdict();
  renderCompare();
}

function renderTests() {
  const r = result;
  const ready = engine.running && !busy;
  const test = (key: 'noise' | 'tap' | 'watch', title: string, how: string, btn: string, run: () => Promise<void>, out: string | null) =>
    h(
      'div',
      { class: 'lab-test', 'data-test': key },
      h('div', null, h('h3', { class: 'lab-h3' }, title), h('p', { class: 'muted small' }, how)),
      h('div', { class: 'lab-test-side' }, h('button', { class: 'btn small', disabled: !ready, onclick: () => void run() }, busy === key ? 'Running…' : btn), h('p', { class: 'lab-progress small' }, busy === key ? '' : out ?? '')),
    );
  testsEl.replaceChildren(
    test(
      'noise',
      'a · Background noise',
      'Pickup connected but not touching anything, room quiet.',
      `Measure ${NOISE_SEC} s`,
      noiseTest,
      r?.noiseDb != null ? `Noise floor ${r.noiseDb.toFixed(0)} dBFS · hum ${r.humDb != null && r.humDb > 15 ? `strong (+${r.humDb.toFixed(0)} dB)` : 'low'}` : null,
    ),
    test(
      'tap',
      'b · Tap test',
      'Tap the pickup lightly with a fingernail a few times. Proves it’s connected to this input.',
      `Start ${TAP_SEC} s`,
      tapTest,
      r?.tapDb != null ? (r.noiseDb != null && r.tapDb - r.noiseDb < 15 ? `Barely moved (peak ${r.tapDb.toFixed(0)} dBFS). Probably not this input.` : `Taps heard, peak ${r.tapDb.toFixed(0)} dBFS ✓`) : null,
    ),
    test(
      'watch',
      'c · Watch test',
      'Clip the pickup to the watch (a lug or the case edge), lay it on a cloth, hands off.',
      `Listen ${WATCH_SEC} s`,
      watchTest,
      r?.grade ? `${GRADE_LABEL[r.grade]}${r.snrDb != null ? ` · SNR ${r.snrDb.toFixed(0)} dB` : ''}${r.clean != null ? ` · ${Math.round(r.clean * 100)}% clean beats` : ''}` : null,
    ),
  );
}

function renderVerdict() {
  const r = result;
  if (!engine.running) {
    verdictEl.replaceChildren(h('p', { class: 'muted' }, 'Choose an input above to begin.'));
    return;
  }
  if (!r?.grade) {
    verdictEl.replaceChildren(h('p', { class: 'muted' }, 'Run the watch test (c) for a verdict. Tests a and b help explain a poor result.'));
    return;
  }
  const advice: string[] = [];
  if (r.processing.length) advice.push(`The browser kept ${r.processing.join(', ')} on. Try Chrome, or another input.`);
  if (r.grade === 'none') {
    advice.push('No clicks reached this input.');
    if (r.tapDb != null && r.noiseDb != null && r.tapDb - r.noiseDb < 15) advice.push('Taps didn’t register either, so the pickup probably isn’t feeding this input. Check the adapter, or pick the USB device in the list.');
    else advice.push('Check the clip sits firmly on a lug or the case edge, and that the watch is running.');
  }
  if (r.grade === 'poor') advice.push('Clicks come through but not as a steady beat. Clamp the pickup more firmly, keep hands and cables still, and try a quieter surface.');
  if (r.humDb != null && r.humDb > 15) advice.push('There’s strong mains hum. Try battery power (unplug the charger) or a shorter cable. Escapement filters most of it out, but less is better.');
  if (r.snrDb != null && r.snrDb < 15 && r.grade !== 'none') advice.push('The watch is quiet relative to the noise. More gain on the sound card, or firmer contact, will help.');
  if (r.grade === 'excellent' || r.grade === 'good') advice.push('This input is ready for measuring.');

  verdictEl.replaceChildren(
    h('div', { class: 'lab-grade', 'data-grade': r.grade }, GRADE_LABEL[r.grade]),
    h(
      'dl',
      { class: 'lab-kv' },
      h('div', null, h('dt', null, 'Signal to noise'), h('dd', null, r.snrDb != null ? `${r.snrDb.toFixed(0)} dB` : '—')),
      h('div', null, h('dt', null, 'Clean beats'), h('dd', null, r.clean != null ? `${Math.round(r.clean * 100)}%` : '—')),
      h('div', null, h('dt', null, 'Beat rate'), h('dd', null, r.bph ? `${fmtBph(r.bph)} bph` : '—')),
      h('div', null, h('dt', null, 'Rate'), h('dd', null, r.rate != null ? `${fmtRate(r.rate)} s/d` : '—')),
      h('div', null, h('dt', null, 'Beat error'), h('dd', null, r.beatError != null ? `${fmtMs(r.beatError)} ms` : '—')),
      h('div', null, h('dt', null, 'Amplitude'), h('dd', null, r.amplitude != null ? `${Math.round(r.amplitude)}° (at 52°)` : '—')),
      h('div', null, h('dt', null, 'Best filter'), h('dd', null, r.filter ?? '—')),
    ),
    h('ul', { class: 'lab-advice' }, advice.map((a) => h('li', null, a))),
    r.deviceId !== SIM_ID && (r.grade === 'excellent' || r.grade === 'good' || r.grade === 'usable')
      ? h(
          'div',
          { class: 'actions' },
          h(
            'a',
            {
              class: 'btn primary',
              href: '/#/measure',
              onclick: () => {
                savePrefs({ source: 'mic', deviceId: r.deviceId === 'default' ? '' : r.deviceId, autoTrigger: true });
              },
            },
            'Use this input in Escapement',
          ),
        )
      : '',
  );
}

function renderCompare() {
  const rs = loadResults().sort((a, b) => b.at - a.at);
  if (!rs.length) {
    compareEl.replaceChildren(h('p', { class: 'muted small' }, 'Test more than one input (built-in mic, USB sound card…) to compare them here.'));
    return;
  }
  compareEl.replaceChildren(
    h(
      'table',
      { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, 'Input'), h('th', null, 'Verdict'), h('th', { class: 'num' }, 'SNR'), h('th', { class: 'num' }, 'Clean'), h('th', { class: 'num hide-sm' }, 'Noise'), h('th', { class: 'hide-sm' }, 'Tested'))),
      h(
        'tbody',
        null,
        rs.map((r) =>
          h(
            'tr',
            null,
            h('td', null, r.label),
            h('td', null, r.grade ? h('span', { class: 'lab-grade small', 'data-grade': r.grade }, GRADE_LABEL[r.grade]) : '—'),
            h('td', { class: 'num' }, r.snrDb != null ? `${r.snrDb.toFixed(0)} dB` : '—'),
            h('td', { class: 'num' }, r.clean != null ? `${Math.round(r.clean * 100)}%` : '—'),
            h('td', { class: 'num hide-sm' }, r.noiseDb != null ? `${r.noiseDb.toFixed(0)} dBFS` : '—'),
            h('td', { class: 'hide-sm muted' }, new Date(r.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })),
          ),
        ),
      ),
    ),
    h('div', { class: 'actions' }, h('button', { class: 'btn small', onclick: () => (saveResults([]), renderCompare()) }, 'Clear results')),
  );
}

async function record() {
  if (!engine.running) return;
  recordBtn.disabled = true;
  recordBtn.textContent = 'Recording… 10 s';
  try {
    const clip = await engine.record(10);
    const safe = currentLabel.replace(/[^a-z0-9]+/gi, '_').slice(0, 30);
    downloadBlob(encodeWav(clip.samples, clip.sampleRate), `escapement-lab-${safe}-${Date.now()}.wav`);
    toast('Clip saved to your downloads');
  } catch (err) {
    toast(`Recording failed: ${(err as Error)?.message ?? err}`);
  } finally {
    recordBtn.disabled = !engine.running;
    recordBtn.textContent = 'Record 10 s clip';
  }
}

// Stale-signal guard: if the worklet stops reporting (device unplugged), say so.
setInterval(() => {
  if (engine.running && lastUpdate && performance.now() - lastUpdate > 2000) liveStatus.textContent = 'No audio is arriving from this input. Was it unplugged?';
}, 1000);

void refreshInputs(false);
renderTests();
renderVerdict();
renderCompare();
