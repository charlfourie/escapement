import { describe, expect, it } from 'vitest';
import { SpectralDenoiser } from '../src/audio/denoise';
import { AUTO_BANK, TickDetector } from '../src/audio/detector';
import { TickSynth, type SimParams } from '../src/audio/synth';
import { analyze } from '../src/analysis/analyze';
import { AutoLock } from '../src/analysis/autolock';

const SR = 48000;

/** The app's pipeline: optional noise reduction → detector bank → auto-lock with shape matching. */
function measure(audio: Float32Array, denoise: boolean) {
  const den = new SpectralDenoiser(SR);
  den.enabled = denoise;
  const bank = AUTO_BANK.map((b) => new TickDetector(SR, b));
  const lock = new AutoLock(bank.length);
  const buf = new Float32Array(128);
  for (let off = 0, blk = 0; off + 128 <= audio.length; off += 128, blk++) {
    den.process(audio.subarray(off, off + 128), buf);
    bank.forEach((d, i) => d.process(buf).forEach((t) => lock.add(i, t.time, t.lift, t.envelope)));
    if (blk % 280 === 0) {
      const st = lock.evaluate(null);
      const want = st.locked && st.bph ? Math.round(0.45 * (3600 / st.bph) * 1000) : 50;
      bank.forEach((d) => d.setSettings({ refractoryMs: want }));
    }
  }
  const st = lock.evaluate(null);
  return st.locked ? analyze(lock.streams[st.index], { bph: st.bph, windowSec: 20 }) : null;
}

function render(p: Partial<SimParams>, seed: number, seconds = 22) {
  const audio = new Float32Array(seconds * SR);
  new TickSynth(SR, p, seed).render(audio);
  return audio;
}

describe('noise handling', () => {
  it('noise reduction is transparent when off, with a fixed delay', () => {
    const d = new SpectralDenoiser(SR);
    d.enabled = false;
    const x = new Float32Array(SR).map((_, i) => Math.sin(i * 0.37) * 0.3 + ((i * 7919) % 101) / 400);
    const y = new Float32Array(x.length);
    for (let o = 0; o < x.length; o += 128) d.process(x.subarray(o, o + 128), y.subarray(o, o + 128));
    let err = 0;
    for (let i = 3 * 2048; i < x.length; i++) err = Math.max(err, Math.abs(y[i] - x[i - d.latency]));
    expect(d.latency).toBe(2048);
    expect(err).toBeLessThan(1e-5);
  });

  it('shape-matched timing keeps rate and beat error right in hiss', () => {
    // At this noise level, timing from the first click alone flips between
    // sub-clicks and gets the rate wrong by several s/day.
    for (const seed of [104729, 209458, 314187]) {
      const r = measure(render({ bph: 28800, rate: 4.5, beatError: 0.6, amplitude: 265, noise: 0.02 }, seed), false)!;
      expect(r).not.toBeNull();
      expect(Math.abs(r.rate - 4.5)).toBeLessThan(1.5);
      expect(Math.abs(r.beatError! - 0.6)).toBeLessThan(0.2);
    }
  }, 120000);

  it('noise reduction rescues a reading buried in fan / coil whine', () => {
    const audio = render({ bph: 21600, rate: -2.7, beatError: 0.45, amplitude: 258, noise: 0.003 }, 104729);
    for (let i = 0; i < audio.length; i++) {
      const t = i / SR;
      audio[i] += 0.018 * (2.2 * Math.sin(2 * Math.PI * 3150 * t) + 1.6 * Math.sin(2 * Math.PI * 5200 * t + 1) + 1.1 * Math.sin(2 * Math.PI * 7400 * t));
    }
    const r = measure(audio, true)!;
    expect(r).not.toBeNull();
    expect(r.bph).toBe(21600);
    expect(Math.abs(r.rate + 2.7)).toBeLessThan(1.5);
    expect(Math.abs(r.beatError! - 0.45)).toBeLessThan(0.2);
  }, 120000);
});
