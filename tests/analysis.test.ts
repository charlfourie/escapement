import { describe, expect, it } from 'vitest';
import { TickDetector } from '../src/audio/detector';
import { TickSynth, liftTime, type SimParams } from '../src/audio/synth';
import { analyze, detectBph } from '../src/analysis/analyze';

const SR = 48000;

function record(params: Partial<SimParams>, seconds: number): number[] {
  const synth = new TickSynth(SR, params);
  const det = new TickDetector(SR);
  const buf = new Float32Array(128);
  const times: number[] = [];
  for (let i = 0; i < (seconds * SR) / 128; i++) {
    synth.render(buf);
    for (const t of det.process(buf)) times.push(t.time);
  }
  return times;
}

describe('analysis on a simulated watch', () => {
  const cases: Array<[Partial<SimParams>, string]> = [
    [{ bph: 28800, rate: 12, beatError: 0.8 }, 'modern 4 Hz, gaining'],
    [{ bph: 21600, rate: -25, beatError: 2.5 }, 'vintage 3 Hz, losing, out of beat'],
    [{ bph: 36000, rate: 2, beatError: 0.2 }, 'hi-beat 5 Hz'],
    [{ bph: 18000, rate: 45, beatError: 1.2, noise: 0.01 }, '2.5 Hz, noisy'],
  ];

  for (const [params, label] of cases) {
    it(label, () => {
      const times = record(params, 20);
      expect(detectBph(times)).toBe(params.bph);
      const r = analyze(times)!;
      expect(r).not.toBeNull();
      expect(r.bph).toBe(params.bph);
      expect(r.rate).toBeCloseTo(params.rate!, 0);
      expect(Math.abs(r.beatError! - params.beatError!)).toBeLessThan(0.1);
      expect(r.quality).toBeGreaterThan(0.95);
    });
  }

  it('survives spurious clicks and missed beats', () => {
    const clean = record({ bph: 28800, rate: -8, beatError: 0.5 }, 20);
    const messy = clean.filter((_, i) => i % 17 !== 3); // drop some beats
    for (let i = 0; i < 30; i++) messy.push(0.5 + Math.random() * 19); // random knocks
    messy.sort((a, b) => a - b);
    const r = analyze(messy, { bph: 28800 })!;
    expect(r.rate).toBeCloseTo(-8, 0);
    expect(Math.abs(r.beatError! - 0.5)).toBeLessThan(0.1);
  });

  it('lift time matches amplitude formula', () => {
    // 28800 bph, 52° lift, 280° amplitude ≈ 7.4 ms
    expect(liftTime(280, 52, 28800) * 1000).toBeCloseTo(7.4, 1);
  });
});

describe('amplitude', () => {
  const cases: Array<Partial<SimParams>> = [
    { bph: 28800, amplitude: 280 },
    { bph: 28800, amplitude: 200 },
    { bph: 21600, amplitude: 300, liftAngle: 50 },
    { bph: 18000, amplitude: 230, noise: 0.008 },
    { bph: 36000, amplitude: 260, liftAngle: 53 },
  ];
  for (const p of cases) {
    it(`${p.bph} bph at ${p.amplitude}°`, async () => {
      const { amplitudeFrom } = await import('../src/analysis/analyze');
      const synth = new TickSynth(SR, p);
      const det = new TickDetector(SR);
      const buf = new Float32Array(128);
      const lifts: number[] = [];
      for (let i = 0; i < (15 * SR) / 128; i++) {
        synth.render(buf);
        for (const t of det.process(buf)) if (t.lift !== null) lifts.push(t.lift);
      }
      const r = amplitudeFrom(lifts, p.bph!, p.liftAngle ?? 52)!;
      expect(r).not.toBeNull();
      expect(Math.abs(r.amplitude - p.amplitude!)).toBeLessThan(8);
      expect(r.spread).toBeLessThan(15);
    });
  }
});
