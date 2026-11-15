/**
 * Acoustic quartz test, and the sound-card clock calibration it relies on.
 *
 * Listens to the stepping motor for 5–20 minutes. Meanwhile it asks the
 * server for the time every few seconds, to measure how far the sound card's
 * clock is off (that error is bigger than a quartz watch's own). The rate is
 * reported with its uncertainty, and a low battery shows up as 2-second steps.
 */

import { AudioEngine, listInputs, type EngineUpdate } from '../audio/engine';
import { AUTO_BANK } from '../audio/detector';
import { DEFAULT_QSIM } from '../audio/synth';
import { AutoLock } from '../analysis/autolock';
import { bestClock, fitClock, forgetClock, plausibleClock, savedClock, saveClock, type ClockFit, type ClockSample } from '../analysis/clock';
import { pickQuartzStream, ppmToDay, quartzGrade, quartzRate, type QuartzResult } from '../analysis/quartz';
import { db, newId, type QuartzTest, type Watch } from '../db';
import { loadPrefs, savePrefs } from '../prefs';
import { h, toast } from '../util/dom';
import { placementGuide } from './placement';

const LENGTHS = [5, 10, 20] as const;
const CALIBRATE_MIN = 30;
const CLOCK_EVERY_MS = 3000;
const SPEC_MONTH = 15;

const fmtSigned = (v: number, digits = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** The sound card's clock belongs to the output device; key saved calibrations by it. */
async function clockKey(): Promise<string> {
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    const out = devs.find((d) => d.kind === 'audiooutput' && d.deviceId === 'default') ?? devs.find((d) => d.kind === 'audiooutput');
    return out?.label ? `out:${out.label}` : 'out:default';
  } catch {
    return 'out:default';
  }
}

export function lowStepMessage(w: Pick<Watch, 'movementType'>): string {
  if (w.movementType === 'solar') return 'The seconds hand is moving in 2-second steps: the charge is low. Leave it in bright daylight (not on a hot windowsill) for a few hours, then test again.';
  if (w.movementType === 'kinetic') return 'The seconds hand is moving in 2-second steps: the charge is low. Wear it or swing it for a few minutes; if it keeps happening, the storage cell may be worn out.';
  return 'The seconds hand is moving in 2-second steps: the battery is nearly flat. Replace it soon; a flat battery left in can leak and damage the movement.';
}

export function quartzTestView(root: HTMLElement, watchId: string | null): () => void {
  const calibrateOnly = watchId === null;
  const prefs = loadPrefs();
  const engine = new AudioEngine();
  let watch: Watch | undefined;
  let source: 'mic' | 'qsim' = prefs.source === 'sim' ? 'qsim' : 'mic';
  let minutes: number = calibrateOnly ? CALIBRATE_MIN : 10;
  let state: 'idle' | 'starting' | 'running' | 'done' = 'idle';
  let lock: AutoLock | null = null;
  let chosen = -1;
  let result: QuartzResult | null = null;
  let samples: ClockSample[] = [];
  let ownClock: ClockFit | null = null;
  let key = 'out:default';
  let startedAt = 0;
  let runSec = 0;
  let audioStart = 0;
  let timer = 0;
  let clockTimer = 0;
  let dropTimer = 0;
  let wakeLock: { release(): Promise<void> } | null = null;
  let clockFailures = 0;

  // ---------- elements ----------
  const ro = (label: string) => {
    const value = h('div', { class: 'ro-value' }, '—');
    const sub = h('div', { class: 'ro-sub muted small' });
    const el = h('div', { class: 'readout' }, h('div', { class: 'ro-label' }, label), value, sub);
    return { el, value, sub };
  };
  const roRate = ro('Rate');
  const roTime = ro('Elapsed');
  const roClicks = ro('Clicks');
  const roTiming = ro('Click timing');
  const roClock = ro('Sound card clock');
  const progress = h('div', { class: 'q-progress-fill' });
  const statusEl = h('p', { class: 'lock-status' });
  const alertEl = h('div', { class: 'message warn', hidden: true });
  const dropEl = h('div', { class: 'message warn', hidden: true });
  const resultPanel = h('section', { class: 'panel save', hidden: true });
  const startBtn = h('button', { class: 'btn primary', onclick: () => void (state === 'running' || state === 'starting' ? finish(false) : start()) }, 'Start');
  const deviceSel = h('select', { onchange: (e: Event) => savePrefs({ deviceId: (e.target as HTMLSelectElement).value }) });
  const deviceField = h('label', { class: 'field' }, h('span', null, 'Input'), deviceSel);
  const savedEl = h('p', { class: 'small muted' });

  const lengthBtns = LENGTHS.map((m) =>
    h(
      'button',
      {
        type: 'button',
        class: `seg${m === minutes ? ' active' : ''}`,
        onclick: () => {
          if (state === 'running') return;
          minutes = m;
          lengthBtns.forEach((b, i) => b.classList.toggle('active', LENGTHS[i] === m));
        },
      },
      `${m} min`,
    ),
  );
  const sourceSel = h(
    'select',
    {
      onchange: (e: Event) => {
        source = (e.target as HTMLSelectElement).value as 'mic' | 'qsim';
        savePrefs({ source: source === 'qsim' ? 'sim' : 'mic' });
        deviceField.hidden = source !== 'mic';
      },
    },
    h('option', { value: 'mic', selected: source === 'mic' }, 'Microphone / pickup'),
    h('option', { value: 'qsim', selected: source === 'qsim' }, 'Simulated quartz watch (+4 ppm)'),
  );
  deviceField.hidden = source !== 'mic';

  async function loadDevices() {
    const devices = await listInputs().catch(() => []);
    deviceSel.replaceChildren(
      h('option', { value: '' }, 'Default input'),
      ...devices.filter((d) => d.deviceId && d.deviceId !== 'default').map((d, i) => h('option', { value: d.deviceId, selected: d.deviceId === loadPrefs().deviceId }, d.label || `Microphone ${i + 1}`)),
    );
  }

  async function renderSaved() {
    key = await clockKey();
    const saved = savedClock(key);
    const c = bestClock(null, saved).correction;
    savedEl.replaceChildren(
      c
        ? h(
            'span',
            null,
            `This computer’s sound card is calibrated: ${fmtSigned(c.ppm, 1)} ppm ± ${c.sigma.toFixed(1)} (from ${saved.length} run${saved.length === 1 ? '' : 's'}). `,
            h(
              'button',
              {
                type: 'button',
                class: 'link-btn',
                onclick: () => {
                  if (!confirm('Forget the saved clock calibration for this computer?')) return;
                  forgetClock(key);
                  void renderSaved();
                },
              },
              'Forget',
            ),
          )
        : h('span', null, 'This computer’s sound card isn’t calibrated yet. Each test measures it as it goes; ', h('a', { href: '#/quartz/calibrate' }, 'a 30-minute calibration'), ' makes every later test more precise.'),
    );
  }

  // ---------- diagnostics ----------
  let diag: Record<string, unknown> | null = null;
  function diagnostics(): Record<string, unknown> {
    const breaks = tickBreaks();
    return {
      app: 'escapement',
      kind: calibrateOnly ? 'clock-calibration' : 'quartz-test',
      at: new Date().toISOString(),
      userAgent: navigator.userAgent,
      source,
      minutes,
      engine: engine.describe(),
      dropouts: engine.dropouts,
      breaksTickTime: breaks,
      clockSamples: samples,
      clockFit: ownClock,
      savedClock: savedClock(key),
      chosenStream: chosen,
      streamCounts: lock?.streams.map((x) => x.length),
      ticks: chosen >= 0 && lock ? lock.streams[chosen] : [],
      result,
    };
  }
  function downloadDiagnostics() {
    const blob = new Blob([JSON.stringify(diag ?? diagnostics())], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `escapement-quartz-diagnostics-${Date.now()}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const diagBtn = () => h('button', { class: 'btn small', onclick: downloadDiagnostics, title: 'Timings, clock checks and dropouts from this run, to help fix problems' }, 'Download diagnostics');

  // ---------- running ----------
  function onUpdate(u: EngineUpdate) {
    if (!lock) return;
    for (const t of u.ticks) lock.add(t.d, t.time, null, t.envelope);
  }

  async function sampleClock() {
    if (state !== 'running') return;
    const a0 = engine.audioNow();
    try {
      const r = await fetch('/api/time', { cache: 'no-store' });
      const a1 = engine.audioNow();
      if (!r.ok || a0 === null || a1 === null) throw new Error();
      const { now } = (await r.json()) as { now: number };
      if (typeof now === 'number') samples.push({ audio: (a0 + a1) / 2, ref: now / 1000, rtt: a1 - a0 });
      clockFailures = 0;
    } catch {
      clockFailures++;
    }
    ownClock = fitClock(samples, { breaks: engine.dropouts.map((d) => d.at) });
  }

  function analyse() {
    if (!lock) return;
    const elapsed = (engine.audioNow() ?? 0) - audioStart;
    if (!calibrateOnly) {
      // Choose the detector that hears the steps best (with some stickiness),
      // then fit the whole run on it.
      const breaks = tickBreaks();
      const pick = pickQuartzStream(lock.streams, 120, breaks);
      if (pick && (chosen < 0 || pick.index === chosen || pick.score > (pickScore(chosen) ?? 0) * 1.15)) chosen = pick.index;
      const all = chosen >= 0 ? pickQuartzStream([lock.streams[chosen]], 0, breaks) : null;
      result = all?.result ?? null;
    }
    render(elapsed);
    if (elapsed >= minutes * 60) void finish(true);
  }

  function pickScore(i: number): number | null {
    if (!lock || i < 0) return null;
    return pickQuartzStream([lock.streams[i]], 120, tickBreaks())?.score ?? null;
  }

  /** Audio dropouts, on the tick timeline. */
  function tickBreaks(): number[] {
    return engine.dropouts.map((d) => engine.toTickTime(d.at));
  }

  function renderDropouts() {
    const n = engine.dropouts.length;
    const total = engine.dropouts.reduce((a, d) => a + Math.abs(d.gap), 0);
    dropEl.hidden = n === 0;
    dropEl.textContent = `The computer’s audio stalled ${n} time${n === 1 ? '' : 's'} (${total.toFixed(1)} s in all). The test allows for it, measuring between the stalls, but each one costs precision. Keep this tab in front, close heavy apps, and don’t let the computer sleep.`;
  }

  function clockState() {
    const { correction, source: src } = bestClock(ownClock, source === 'qsim' ? [] : savedClock(key));
    return { correction: source === 'qsim' ? null : correction, src: source === 'qsim' ? ('none' as const) : src };
  }

  function render(elapsed: number) {
    const total = minutes * 60;
    progress.style.width = `${Math.min(100, (elapsed / total) * 100)}%`;
    roTime.value.textContent = mmss(elapsed);
    roTime.sub.textContent = `of ${minutes} min`;

    // Clock
    const { correction, src } = clockState();
    renderDropouts();
    const drops = engine.dropouts.length ? ` · ${engine.dropouts.length} dropouts` : '';
    if (ownClock && !plausibleClock(ownClock)) {
      roClock.value.textContent = 'Unreliable';
      roClock.sub.textContent = `not used: audio stalls or a slow connection${drops}`;
    } else if (ownClock) {
      roClock.value.textContent = `${fmtSigned(ownClock.ppm, 1)} ppm`;
      roClock.sub.textContent = `± ${ownClock.sigma.toFixed(1)} · ${ownClock.samples} internet checks${drops}`;
    } else if (clockFailures > 3) {
      roClock.value.textContent = 'No internet time';
      roClock.sub.textContent = savedClock(key).length ? 'Using the saved calibration' : 'Rate won’t be corrected';
    } else {
      roClock.value.textContent = 'Checking…';
      roClock.sub.textContent = `${samples.length} internet checks so far`;
    }
    if (source === 'qsim') roClock.sub.textContent += ' · not needed for the simulator';

    if (calibrateOnly) {
      statusEl.textContent = ownClock
        ? `Measuring this computer’s sound card against internet time. Keep this tab open and in front; ${mmss(Math.max(0, total - elapsed))} to go.`
        : 'Measuring this computer’s sound card against internet time. The first estimate appears after a minute.';
      return;
    }

    // Watch
    if (!result) {
      roRate.value.textContent = '—';
      roRate.sub.textContent = 'Listening for steady steps…';
      roClicks.value.textContent = '0';
      roClicks.sub.textContent = '';
      roTiming.value.textContent = '—';
      roTiming.sub.textContent = '';
      statusEl.textContent = elapsed > 20 ? 'No steady once-a-second clicks yet. Check the pickup is pressed to the caseback or the case side, and the input level in Pickup Lab.' : 'Listening for the seconds hand’s motor…';
      alertEl.hidden = true;
      return;
    }
    const q = quartzRate(result, correction);
    roRate.value.textContent = `${fmtSigned(q.perMonth)} s/mo`;
    roRate.el.dataset.grade = q.sigmaMonth < SPEC_MONTH ? quartzGrade(q.perMonth, SPEC_MONTH) : '';
    roRate.sub.textContent = `± ${q.sigmaMonth.toFixed(1)} · ${fmtSigned(ppmToDay(q.ppm), 2)} s/day${src === 'none' ? ' · clock not corrected' : ''}`;
    roClicks.value.textContent = String(result.ticks);
    roClicks.sub.textContent = `${result.missed} missed · ${result.rejected} ignored`;
    roTiming.value.textContent = `${result.jitter.toFixed(2)} ms`;
    roTiming.sub.textContent = `${result.stepSec} s steps`;
    alertEl.hidden = result.stepSec !== 2;
    if (watch && result.stepSec === 2) alertEl.textContent = lowStepMessage(watch);
    statusEl.textContent =
      q.sigmaMonth > SPEC_MONTH
        ? 'Hearing the steps. The uncertainty shrinks as the test runs; leave the watch still.'
        : `Hearing the steps cleanly. Good to within ±${q.sigmaMonth.toFixed(1)} s a month so far.`;
  }

  async function start() {
    if (state !== 'idle' && state !== 'done') return;
    state = 'starting';
    resultPanel.hidden = true;
    startBtn.textContent = 'Stop';
    statusEl.textContent = 'Starting…';
    lock = new AutoLock(AUTO_BANK.length);
    chosen = -1;
    result = null;
    samples = [];
    ownClock = null;
    clockFailures = 0;
    engine.onUpdate = onUpdate;
    try {
      // Calibration only needs the clock running, so no microphone is asked for.
      const src =
        calibrateOnly || source === 'qsim'
          ? ({ kind: 'qsim', params: calibrateOnly ? { ...DEFAULT_QSIM, noise: 0 } : DEFAULT_QSIM } as const)
          : ({ kind: 'mic', deviceId: loadPrefs().deviceId || undefined } as const);
      await engine.start(src, { auto: true, denoise: loadPrefs().denoise, detector: {}, latency: 'playback' });
      // One click per step: a long dead time stops echoes counting twice.
      engine.setRefractory(400);
    } catch (err) {
      state = 'idle';
      startBtn.textContent = 'Start';
      statusEl.textContent = (err as Error)?.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in the browser and try again.' : `Couldn’t start: ${(err as Error)?.message ?? err}`;
      return;
    }
    if (source === 'mic' && !calibrateOnly) void loadDevices();
    state = 'running';
    startedAt = Date.now();
    audioStart = engine.audioNow() ?? 0;
    try {
      wakeLock = await (navigator as unknown as { wakeLock?: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen') ?? null;
    } catch {
      wakeLock = null;
    }
    void sampleClock();
    clockTimer = window.setInterval(() => void sampleClock(), CLOCK_EVERY_MS);
    dropTimer = window.setInterval(() => engine.pollDropouts(), 250);
    // Re-analyse about once a second, but never spend more than ~15% of the
    // time on it, so a long, noisy run can't make the page unresponsive.
    const loop = () => {
      if (state !== 'running') return;
      const t0 = performance.now();
      analyse();
      const took = performance.now() - t0;
      timer = window.setTimeout(loop, Math.max(1000, took * 6));
    };
    loop();
  }

  async function finish(completed: boolean) {
    if (state !== 'running' && state !== 'starting') return;
    analyse();
    state = 'done';
    clearTimeout(timer);
    clearInterval(clockTimer);
    clearInterval(dropTimer);
    diag = diagnostics();
    void wakeLock?.release().catch(() => {});
    wakeLock = null;
    const elapsed = (engine.audioNow() ?? audioStart) - audioStart;
    runSec = Math.round((Date.now() - startedAt) / 1000);
    await engine.stop();
    startBtn.textContent = 'Start again';
    if (ownClock && source === 'mic') saveClock(key, ownClock);
    if (calibrateOnly && ownClock) saveClock(key, ownClock);
    void renderSaved();
    showResult(elapsed, completed);
  }

  function showResult(elapsed: number, completed: boolean) {
    resultPanel.hidden = false;
    if (calibrateOnly) {
      resultPanel.replaceChildren(
        h('header', { class: 'panel-head' }, h('h2', null, ownClock ? 'Calibration saved' : 'Not enough data')),
        plausibleClock(ownClock)
          ? h('p', null, `This computer’s sound card runs ${fmtSigned(ownClock!.ppm, 1)} ppm (± ${ownClock!.sigma.toFixed(1)}) against internet time. Quartz tests on this computer now correct for it.`)
          : ownClock
            ? h('p', null, `The result (${fmtSigned(ownClock.ppm, 0)} ppm ± ${ownClock.sigma.toFixed(0)}) isn’t something a real sound card does, so it wasn’t saved. Audio stalls or a slow connection are the usual causes; try again with the tab in front.`)
            : h('p', null, 'The calibration needs a few minutes of internet time checks. Keep the tab open and in front, and check you’re online.'),
        h('div', { class: 'actions' }, diagBtn()),
      );
      return;
    }
    if (!result || elapsed < 60) {
      resultPanel.replaceChildren(
        h('header', { class: 'panel-head' }, h('h2', null, 'No result')),
        h('p', null, result ? 'Stopped before a minute: too short for a quartz rate. Run at least 5 minutes.' : 'No steady once-a-second clicks were heard. See “Where to clip the pickup” below, and check the input level in Pickup Lab.'),
        h('div', { class: 'actions' }, diagBtn()),
      );
      return;
    }
    const { correction, src } = clockState();
    const q = quartzRate(result, correction);
    const r = result;
    // Every valid test is saved straight away; the panel then edits it.
    const rec: QuartzTest | null = watch
      ? {
          id: newId(),
          watchId: watch.id,
          at: Date.now(),
          durationSec: runSec,
          ticks: r.ticks,
          stepSec: r.stepSec,
          ppm: q.ppm,
          perMonth: q.perMonth,
          sigmaMonth: q.sigmaMonth,
          rawPpm: r.rawPpm,
          jitter: r.jitter,
          clock: { source: src, ppm: correction?.ppm ?? null, sigma: correction?.sigma ?? null },
          dropouts: engine.dropouts.length,
          notes: source === 'qsim' ? 'Simulated watch' : '',
          updatedAt: Date.now(),
        }
      : null;
    if (rec) {
      void db.qtests.add(rec);
      toast(`Saved to ${watch!.name}`);
    }
    const notes = h('input', {
      type: 'text',
      value: rec?.notes ?? '',
      placeholder: 'Optional, e.g. dial up, after a week on the wrist',
      onchange: (e: Event) => {
        if (!rec) return;
        rec.notes = (e.target as HTMLInputElement).value.trim();
        void db.qtests.update(rec.id, { notes: rec.notes, updatedAt: Date.now() });
      },
    });
    resultPanel.replaceChildren(
      h('header', { class: 'panel-head' }, h('h2', null, `${completed ? 'Test complete' : 'Stopped early'}${watch ? `: saved to ${watch.name}` : ''}`)),
      h(
        'div',
        { class: 'q-summary' },
        h('div', null, h('strong', { 'data-grade': quartzGrade(q.perMonth, SPEC_MONTH) }, `${fmtSigned(q.perMonth)} s/month`), ` ± ${q.sigmaMonth.toFixed(1)}`),
        h('div', { class: 'muted small' }, `${fmtSigned(ppmToDay(q.ppm), 2)} s/day · ${r.ticks} clicks over ${mmss(r.span)}${r.stretches > 1 ? ` in ${r.stretches} stretches between audio dropouts` : ''} · timing ${r.jitter.toFixed(2)} ms`),
        h(
          'p',
          { class: 'small' },
          src === 'none'
            ? source === 'qsim'
              ? 'Simulated watch: its clicks come from the sound card’s own clock, so no correction is needed.'
              : 'The sound card’s clock couldn’t be checked against internet time, so this rate can be off by tens of seconds a month. Run it online, or calibrate this computer once.'
            : `Corrected for this computer’s sound card (${fmtSigned(correction!.ppm, 1)} ppm ± ${correction!.sigma.toFixed(1)}, ${src === 'saved' ? 'saved calibration' : src === 'both' ? 'this test plus saved calibration' : 'measured during this test'}).`,
        ),
        h('p', { class: 'small muted' }, `Typical quartz spec is ±${SPEC_MONTH} s a month; high-accuracy quartz is far tighter.`),
        r.stepSec === 2 && watch ? h('div', { class: 'message warn' }, lowStepMessage(watch)) : '',
      ),
      h('label', { class: 'field' }, h('span', null, 'Notes (saved as you type)'), notes),
      h(
        'div',
        { class: 'actions' },
        watch && h('a', { class: 'btn primary', href: `#/watches/${watch.id}` }, 'View this watch'),
        h('a', { class: 'btn', href: '#/log' }, 'Open the Log'),
        diagBtn(),
        rec &&
          h(
            'button',
            {
              class: 'btn danger small',
              onclick: async () => {
                if (!confirm('Delete this quartz test?')) return;
                await db.qtests.delete(rec.id);
                resultPanel.replaceChildren(h('header', { class: 'panel-head' }, h('h2', null, 'Deleted')), h('p', { class: 'muted' }, 'The test was removed.'));
              },
            },
            'Delete this test',
          ),
      ),
    );
  }

  // ---------- page ----------
  void (async () => {
    if (!calibrateOnly) {
      watch = await db.watches.get(watchId!);
      if (!watch) {
        root.append(h('div', { class: 'page' }, h('p', null, 'That watch doesn’t exist. ', h('a', { href: '#/watches' }, 'Back to watches'))));
        return;
      }
    }
    void renderSaved();
    if (source === 'mic' && !calibrateOnly) void loadDevices();
    root.append(
      h(
        'div',
        { class: 'page quartz-test' },
        h('a', { class: 'back', href: watch ? `#/watches/${watch.id}` : '#/watches' }, watch ? `← ${watch.name}` : '← Watches'),
        h('header', { class: 'page-head' }, h('h1', null, calibrateOnly ? 'Calibrate this computer' : 'Quartz test')),
        h(
          'p',
          { class: 'lab-intro' },
          calibrateOnly
            ? 'A sound card’s clock can be off by 10–50 parts per million: 25–130 seconds a month, more than a quartz watch’s own error. This run compares it with internet time for 30 minutes, without a watch or the microphone, and saves the result for every later quartz test on this computer.'
            : `Times the seconds hand’s motor click for ${LENGTHS.join(', ').replace(/, (\d+)$/, ' or $1')} minutes while checking this computer’s sound-card clock against internet time. Keep the watch still and the tab open.`,
        ),
        h(
          'section',
          { class: 'panel' },
          !calibrateOnly && h('div', { class: 'form-grid' }, h('label', { class: 'field' }, h('span', null, 'Source'), sourceSel), deviceField),
          !calibrateOnly && h('div', { class: 'segmented', role: 'group', 'aria-label': 'Test length' }, lengthBtns),
          h('div', { class: 'actions' }, startBtn),
          h('div', { class: 'q-progress' }, progress),
          statusEl,
          alertEl,
          dropEl,
          savedEl,
        ),
        h('div', { class: 'readouts q-readouts' }, ...(calibrateOnly ? [roTime.el, roClock.el] : [roRate.el, roTime.el, roClicks.el, roTiming.el, roClock.el])),
        resultPanel,
        !calibrateOnly && placementGuide(),
        h(
          'details',
          { class: 'panel help' },
          h('summary', null, 'How the quartz test works'),
          h(
            'ul',
            null,
            h('li', null, 'The seconds hand of a quartz watch is moved by a tiny motor once a second, and each step clicks. The test times hundreds of those clicks and fits a straight line through them: the slope is the watch’s second.'),
            h('li', null, 'Quartz watches are accurate to a few seconds a month, so the computer’s own clock matters. Every 3 seconds the test asks an internet time server for the time, and works out how fast this computer’s sound card runs. Calibrations are remembered, so later tests get more precise.'),
            h('li', null, 'Longer is better: 5 minutes gives a rough reading, 10 minutes a good one, 20 minutes the best. The ± shows how sure the result is.'),
            h('li', null, 'Quartz clicks are quiet. Press the pickup’s sensor pad to the centre of the caseback if the case side doesn’t work, and use Mic Boost (+20 dB) on a computer’s mic input.'),
            h('li', null, '2-second steps mean the battery is nearly flat (or, on solar and kinetic watches, the charge is low).'),
            h('li', null, 'Many quartz movements correct themselves in small bursts every 10 or 60 seconds. That evens out over minutes and only adds a little to the ±.'),
          ),
        ),
      ),
    );
    render(0);
    statusEl.textContent = calibrateOnly ? 'Press Start. No microphone needed.' : 'Clip the pickup on, then press Start.';
  })();

  return () => {
    clearTimeout(timer);
    clearInterval(clockTimer);
    clearInterval(dropTimer);
    void wakeLock?.release().catch(() => {});
    void engine.stop();
  };
}
