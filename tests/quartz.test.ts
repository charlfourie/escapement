import { describe, expect, it } from 'vitest';
import { analyzeQuartz, ppmToMonth, quartzRate } from '../src/analysis/quartz';
import { DropoutDetector } from '../src/audio/dropouts';
import { bestClock, combineClock, fitClock, MAX_CLOCK_PPM, plausibleClock, type ClockSample } from '../src/analysis/clock';

function rng(seed: number) {
  let s = seed >>> 0;
  const u = () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0) / 4294967296);
  return { u, g: () => Math.sqrt(-2 * Math.log(Math.max(1e-12, u()))) * Math.cos(2 * Math.PI * u()) };
}

/** Clicks of a quartz watch heard through a sound card. */
function clicks(opts: { ppm: number; seconds: number; step?: number; jitterMs?: number; polarityMs?: number; missEvery?: number; noisePerMin?: number; seed?: number }) {
  const { g, u } = rng(opts.seed ?? 7);
  const step = opts.step ?? 1;
  const period = step / (1 + opts.ppm * 1e-6);
  const out: number[] = [];
  for (let k = 0; k * period < opts.seconds; k++) {
    if (opts.missEvery && k % opts.missEvery === 3) continue;
    out.push(0.37 + k * period + (k % 2 ? 1 : -1) * ((opts.polarityMs ?? 0) / 2000) + g() * ((opts.jitterMs ?? 0.9) / 1000));
  }
  const noise = Math.round(((opts.noisePerMin ?? 0) * opts.seconds) / 60);
  for (let i = 0; i < noise; i++) out.push(u() * opts.seconds);
  return out.sort((a, b) => a - b);
}

describe('analyzeQuartz', () => {
  it('measures the rate of a slightly fast watch over 10 minutes, through missed clicks and knocks', () => {
    const r = analyzeQuartz(clicks({ ppm: 5.7, seconds: 600, polarityMs: 0.6, missEvery: 17, noisePerMin: 3 }))!;
    expect(r.stepSec).toBe(1);
    expect(r.missed).toBeGreaterThan(20);
    expect(r.rejected).toBeGreaterThan(10);
    expect(Math.abs(r.rawPpm - 5.7)).toBeLessThan(4 * r.rawSigmaPpm + 0.05);
    // ~0.9 ms per click over 10 min: about ±0.2 ppm (±0.5 s/month).
    expect(ppmToMonth(r.rawSigmaPpm)).toBeLessThan(1);
    expect(r.jitter).toBeGreaterThan(0.6);
    expect(r.jitter).toBeLessThan(1.3);
    expect(r.polarity).toBeGreaterThan(0.3);
  });

  it('finds the beat under heavy noise with a third of the clicks missing (like a loose clip)', () => {
    const real = clicks({ ppm: -12, seconds: 400, jitterMs: 0.4, seed: 11 }).filter((_, i) => i % 3 !== 1);
    const { u } = rng(12);
    const noise = Array.from({ length: 1200 }, () => u() * 400);
    const r = analyzeQuartz([...real, ...noise].sort((a, b) => a - b))!;
    expect(r.stepSec).toBe(1);
    expect(r.ticks).toBeGreaterThan(real.length * 0.95);
    expect(r.jitter).toBeLessThan(1);
    expect(Math.abs(r.rawPpm + 12)).toBeLessThan(4 * r.rawSigmaPpm + 0.1);
  });

  it('follows a watch far off rate without slipping a step', () => {
    const r = analyzeQuartz(clicks({ ppm: -400, seconds: 900, jitterMs: 0.5 }))!;
    expect(r.missed).toBe(0);
    expect(Math.abs(r.rawPpm + 400)).toBeLessThan(1);
  });

  it('spots the 2-second steps of a low battery', () => {
    const r = analyzeQuartz(clicks({ ppm: 2, seconds: 120, step: 2 }))!;
    expect(r.stepSec).toBe(2);
    expect(Math.abs(r.rawPpm - 2)).toBeLessThan(4 * r.rawSigmaPpm + 1);
  });

  it('waits for enough clicks and ignores pure noise', () => {
    expect(analyzeQuartz(clicks({ ppm: 0, seconds: 5 }))).toBeNull();
    const { u } = rng(3);
    const noise = Array.from({ length: 80 }, () => u() * 60).sort((a, b) => a - b);
    expect(analyzeQuartz(noise)).toBeNull();
  });

  it('takes the sound card clock error out of the rate', () => {
    // Sound card 20 ppm fast: a perfect watch looks 20 ppm slow.
    const r = analyzeQuartz(clicks({ ppm: -20, seconds: 300, jitterMs: 0.3 }))!;
    const q = quartzRate(r, { ppm: -20, sigma: 1 });
    expect(Math.abs(q.ppm)).toBeLessThan(0.5);
    expect(q.sigmaMonth).toBeGreaterThan(ppmToMonth(1) * 0.99);
  });
});

/**
 * Audio that stalls: during a dropout the sound card's clock stops while real
 * time goes on, so every later click (and clock sample) shifts by the stall.
 */
function stall(times: number[], stalls: Array<[number, number]>): { times: number[]; breaks: number[] } {
  const breaks: number[] = [];
  let shift = 0;
  const out: number[] = [];
  let si = 0;
  for (const t of times) {
    while (si < stalls.length && t >= stalls[si][0]) {
      shift += stalls[si][1];
      breaks.push(stalls[si][0] - shift + stalls[si][1]);
      si++;
    }
    const [at, len] = stalls[si - 1] ?? [-1, 0];
    if (si > 0 && t < at + len) continue; // lost while stalled
    out.push(t - shift);
  }
  return { times: out, breaks };
}

describe('audio dropouts', () => {
  const stalls: Array<[number, number]> = [
    [61.3, 1.7],
    [140.2, 2.37],
    [222.8, 0.83],
    [270.5, 2.21],
  ];

  it('quartz rate survives dropouts when they are known', () => {
    const { times, breaks } = stall(clicks({ ppm: -17, seconds: 320, jitterMs: 0.8, seed: 21 }), stalls);
    const blind = analyzeQuartz(times);
    // Without knowing about the dropouts only one stretch's clicks fit.
    expect(blind!.ticks).toBeLessThan(times.length * 0.4);
    const r = analyzeQuartz(times, { breaks })!;
    expect(r.stretches).toBe(5);
    expect(r.span).toBeGreaterThan(280);
    expect(Math.abs(r.rawPpm + 17)).toBeLessThan(4 * r.rawSigmaPpm + 0.2);
  });

  it('clock fit survives dropouts and rejects impossible clocks', () => {
    const { u, g } = rng(31);
    const samples: ClockSample[] = [];
    let shift = 0;
    let si = 0;
    const breaks: number[] = [];
    for (let t = 0; t < 600; t += 3) {
      while (si < stalls.length && t >= stalls[si][0]) {
        shift += stalls[si][1];
        breaks.push(stalls[si][0] - shift + stalls[si][1]);
        si++;
      }
      samples.push({ audio: 5 + t * (1 - 12e-6) - shift, ref: 1.8e9 + t + g() * 0.004, rtt: 0.2 + u() * 0.05 });
    }
    const naive = fitClock(samples)!;
    expect(Math.abs(naive.ppm)).toBeGreaterThan(MAX_CLOCK_PPM);
    expect(bestClock(naive, []).source).toBe('none');
    const f = fitClock(samples, { breaks })!;
    expect(Math.abs(f.ppm - 12)).toBeLessThan(4 * f.sigma + 0.5);
    expect(plausibleClock(f)).toBe(true);
  });
});

describe('clock calibration', () => {
  function samples(ppm: number, seconds: number, every: number, seed = 5): ClockSample[] {
    const { u, g } = rng(seed);
    const out: ClockSample[] = [];
    for (let t = 0; t < seconds; t += every) {
      const rtt = 0.2 + u() * 0.1 + (u() < 0.1 ? 0.5 : 0);
      // Route asymmetry jitters the midpoint by a few ms.
      out.push({ audio: 12 + t, ref: 1.8e9 + t * (1 + ppm * 1e-6) + g() * 0.004 + (rtt > 0.4 ? 0.1 : 0), rtt });
    }
    return out;
  }

  it('finds a sound card running 23 ppm fast', () => {
    const f = fitClock(samples(23, 600, 3))!;
    expect(Math.abs(f.ppm - 23)).toBeLessThan(4 * f.sigma);
    expect(f.sigma).toBeLessThan(2.5);
    // A 30-minute calibration run: well under 1 ppm.
    expect(fitClock(samples(-31, 1800, 3, 9))!.sigma).toBeLessThan(0.8);
  });

  it('needs a long enough run', () => {
    expect(fitClock(samples(23, 40, 10))).toBeNull();
  });

  it('combines calibrations and widens the error when they disagree', () => {
    expect(combineClock([{ ppm: 10, sigma: 1 }, { ppm: 12, sigma: 1 }])).toEqual({ ppm: 11, sigma: Math.sqrt(0.5) * Math.sqrt(2) });
    const tight = combineClock([{ ppm: 10, sigma: 1 }, { ppm: 10.5, sigma: 1 }])!;
    expect(tight.sigma).toBeCloseTo(Math.sqrt(0.5));
    expect(bestClock(null, []).source).toBe('none');
    expect(bestClock({ ppm: 3, sigma: 1, samples: 10, span: 300 }, [{ ppm: 4, sigma: 1, at: 0, span: 600 }]).source).toBe('both');
  });
});

describe('dropout detector', () => {
  it('ignores timestamp jitter and one-off spikes, and catches real stalls', () => {
    const d = new DropoutDetector();
    const { g } = rng(41);
    let stalled = 0;
    for (let i = 0; i < 2400; i++) {
      const real = i * 0.25;
      if (i === 800) stalled += 1.3;
      if (i === 1700) stalled += 0.04;
      const audio = real * (1 + 20e-6) - stalled;
      const spike = i % 97 === 0 ? 0.03 : 0;
      d.feed(audio, 100 + real + g() * 0.002 + spike);
    }
    expect(d.dropouts).toHaveLength(2);
    expect(d.dropouts[0].gap).toBeCloseTo(1.3, 1);
    expect(d.dropouts[0].at).toBeCloseTo(200 - 1.3, 0);
    expect(d.dropouts[1].gap).toBeCloseTo(0.04, 1);
  });
});

describe('quartz analysis speed', () => {
  it('handles a 20-minute run with heavy noise quickly (it runs every second in the page)', () => {
    const real = clicks({ ppm: 3, seconds: 1200, jitterMs: 0.4, seed: 51 });
    const { u } = rng(52);
    const noise = Array.from({ length: 6000 }, () => u() * 1200);
    const all = [...real, ...noise].sort((a, b) => a - b);
    const t0 = performance.now();
    const r = analyzeQuartz(all)!;
    const ms = performance.now() - t0;
    expect(Math.abs(r.rawPpm - 3)).toBeLessThan(4 * r.rawSigmaPpm + 0.05);
    expect(ms).toBeLessThan(400);
  });
});
