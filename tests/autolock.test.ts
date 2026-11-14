import { describe, expect, it } from 'vitest';
import { AUTO_BANK, TickDetector } from '../src/audio/detector';
import { TickSynth, type SimParams } from '../src/audio/synth';
import { analyze } from '../src/analysis/analyze';
import { AutoLock } from '../src/analysis/autolock';

const SR = 48000;

/** A hard recording: noisy, with a strong echo of every tick and random knocks. */
function hardRecording(params: Partial<SimParams>, seconds: number): Float32Array {
  const synth = new TickSynth(SR, params);
  const audio = new Float32Array(seconds * SR);
  synth.render(audio);
  const echo = Math.round(0.06 * SR);
  for (let i = audio.length - 1; i >= echo; i--) audio[i] += audio[i - echo] * 0.6;
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let k = 0; k < seconds * 1.5; k++) {
    const at = Math.floor(rnd() * (audio.length - 400));
    for (let j = 0; j < 400; j++) audio[at + j] += 0.2 * Math.sin(j * 0.9) * Math.exp(-j / 60);
  }
  return audio;
}

function runAuto(audio: Float32Array, bphSetting: number | null) {
  const bank = AUTO_BANK.map((b) => new TickDetector(SR, b));
  const lock = new AutoLock(bank.length);
  let refractory = 50;
  for (let off = 0, block = 0; off < audio.length; off += 128, block++) {
    const chunk = audio.subarray(off, off + 128);
    bank.forEach((det, d) => det.process(chunk).forEach((t) => lock.add(d, t.time, t.lift, t.envelope)));
    if (block % Math.round((0.5 * SR) / 128) === 0) {
      const st = lock.evaluate(bphSetting);
      // Mirror the app: once confidently locked, widen the dead time to cut echoes.
      const want = st.locked && st.score > 0.75 && st.bph ? Math.round(0.45 * (3600 / st.bph) * 1000) : 50;
      if (want !== refractory) {
        refractory = want;
        bank.forEach((det) => det.setSettings({ refractoryMs: want }));
      }
    }
  }
  const st = lock.evaluate(bphSetting);
  return { st, result: analyze(lock.streams[st.index], { bph: st.bph, windowSec: 10 }) };
}

describe('auto-lock', () => {
  it('finds the beat in a recording the fixed trigger cannot read', () => {
    const params = { bph: 21600, rate: -12, beatError: 1.1, noise: 0.006 };
    const audio = hardRecording(params, 24);

    // Fixed default detector: echoes and knocks spoil the reading.
    const fixed = new TickDetector(SR);
    const fixedTimes: number[] = [];
    for (let off = 0; off < audio.length; off += 128) fixed.process(audio.subarray(off, off + 128)).forEach((t) => fixedTimes.push(t.time));
    const f = analyze(fixedTimes);
    expect(!f || f.quality < 0.8 || Math.abs(f.rate + 12) > 1).toBe(true);

    const { st, result } = runAuto(audio, null);
    expect(st.locked).toBe(true);
    expect(st.bph).toBe(21600);
    expect(result!.rate).toBeCloseTo(-12, 0);
    expect(Math.abs(result!.beatError! - 1.1)).toBeLessThan(0.15);
  });

  it('locks on a clean 4 Hz watch', () => {
    const synth = new TickSynth(SR, { bph: 28800, rate: 4, beatError: 0.3 });
    const audio = new Float32Array(15 * SR);
    synth.render(audio);
    const { st, result } = runAuto(audio, null);
    expect(st.locked).toBe(true);
    expect(st.bph).toBe(28800);
    expect(result!.rate).toBeCloseTo(4, 0);
  });

  it('does not lock on noise alone', () => {
    const synth = new TickSynth(SR, { bph: 28800, noise: 0.02 });
    const audio = new Float32Array(10 * SR);
    synth.render(audio);
    // Remove the ticks: keep only noise by re-rendering with a silent watch.
    let seed = 3;
    for (let i = 0; i < audio.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      audio[i] = (seed / 4294967296 - 0.5) * 0.05;
    }
    const { st } = runAuto(audio, null);
    expect(st.locked).toBe(false);
  });
});
