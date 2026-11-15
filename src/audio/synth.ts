/**
 * Simulated mechanical watch. Produces the three clicks of each beat
 * (unlock, impulse, drop) with configurable rate, beat error and amplitude.
 * Used for the demo mode and for tests.
 */

export interface SimParams {
  bph: number;
  /** Seconds per day the simulated watch gains (+) or loses (−). */
  rate: number;
  /** Beat error in milliseconds. */
  beatError: number;
  /** Balance amplitude in degrees. */
  amplitude: number;
  /** Lift angle in degrees. */
  liftAngle: number;
  /** Background noise level (linear, ~0–0.05). */
  noise: number;
}

export const DEFAULT_SIM: SimParams = {
  bph: 28800,
  rate: 6,
  beatError: 0.4,
  amplitude: 275,
  liftAngle: 52,
  noise: 0.004,
};

/** Time from unlock to drop for a given amplitude (seconds). */
export function liftTime(amplitudeDeg: number, liftAngleDeg: number, bph: number): number {
  const period = 7200 / bph; // full oscillation = two beats
  const ratio = Math.min(1, liftAngleDeg / (2 * amplitudeDeg));
  return (period / Math.PI) * Math.asin(ratio);
}

interface Click {
  start: number;
  amp: number;
  freq: number;
}

const CLICK_LEN = 0.003;
const CLICK_TAU = 0.0003;

export class TickSynth {
  private params: SimParams;
  private frame = 0;
  private baseTime = 0.2;
  private beat = 0;
  private clicks: Click[] = [];
  private seed: number;

  constructor(
    readonly sampleRate: number,
    params: Partial<SimParams> = {},
    seed = 0x9e3779b9,
  ) {
    this.params = { ...DEFAULT_SIM, ...params };
    this.seed = seed >>> 0;
  }

  setParams(p: Partial<SimParams>): void {
    this.params = { ...this.params, ...p };
  }

  private rand(): number {
    // mulberry32
    let t = (this.seed = (this.seed + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private gauss(): number {
    const u = Math.max(1e-12, this.rand());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.rand());
  }

  private scheduleBeat(): number {
    const p = this.params;
    const nominal = 3600 / p.bph;
    const period = nominal / (1 + p.rate / 86400);
    const odd = this.beat % 2 === 1;
    const t0 = this.baseTime + (odd ? p.beatError / 1000 : 0) + this.gauss() * 0.00002;
    const tl = liftTime(p.amplitude, p.liftAngle, p.bph);
    const v = 0.85 + this.rand() * 0.3;
    this.clicks.push(
      { start: t0, amp: 0.45 * v, freq: 5200 },
      { start: t0 + tl * 0.4, amp: 0.55 * v, freq: 3800 },
      { start: t0 + tl, amp: 1.0 * v, freq: 4500 },
    );
    this.baseTime += period;
    this.beat++;
    return t0;
  }

  render(out: Float32Array): void {
    const sr = this.sampleRate;
    const blockStart = this.frame / sr;
    const blockEnd = (this.frame + out.length) / sr;
    const level = 0.25;

    while (this.baseTime < blockEnd + 0.001) this.scheduleBeat();

    for (let i = 0; i < out.length; i++) out[i] = this.gauss() * this.params.noise;

    for (const c of this.clicks) {
      if (c.start >= blockEnd || c.start + CLICK_LEN <= blockStart) continue;
      const i0 = Math.max(0, Math.ceil((c.start - blockStart) * sr));
      const i1 = Math.min(out.length, Math.ceil((c.start + CLICK_LEN - blockStart) * sr));
      for (let i = i0; i < i1; i++) {
        const dt = blockStart + i / sr - c.start;
        out[i] += level * c.amp * Math.sin(2 * Math.PI * c.freq * dt) * Math.exp(-dt / CLICK_TAU);
      }
    }
    this.clicks = this.clicks.filter((c) => c.start + CLICK_LEN > blockEnd);
    this.frame += out.length;
  }
}

/**
 * Simulated quartz watch: one stepping-motor click per step. Alternate steps
 * sound slightly different, as on a real movement (the drive pulse
 * alternates polarity). Used for the quartz test's demo mode.
 */
export interface QuartzSimParams {
  /** Rate in parts per million (+ = fast). 1 ppm ≈ 2.6 s a month. */
  ppm: number;
  /** 1 normally, 2 for a low battery. */
  stepSec: 1 | 2;
  /** Background noise level (linear). */
  noise: number;
}

export const DEFAULT_QSIM: QuartzSimParams = { ppm: 4, stepSec: 1, noise: 0.004 };

export class QuartzSynth {
  private params: QuartzSimParams;
  private frame = 0;
  private next = 0.3;
  private step = 0;
  private clicks: Click[] = [];
  private seed: number;

  constructor(
    readonly sampleRate: number,
    params: Partial<QuartzSimParams> = {},
    seed = 0x51ed270b,
  ) {
    this.params = { ...DEFAULT_QSIM, ...params };
    this.seed = seed >>> 0;
  }

  setParams(p: Partial<QuartzSimParams>): void {
    this.params = { ...this.params, ...p };
  }

  private rand(): number {
    let t = (this.seed = (this.seed + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private gauss(): number {
    const u = Math.max(1e-12, this.rand());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.rand());
  }

  render(out: Float32Array): void {
    const sr = this.sampleRate;
    const blockStart = this.frame / sr;
    const blockEnd = (this.frame + out.length) / sr;
    const p = this.params;
    while (this.next < blockEnd + 0.001) {
      const odd = this.step % 2 === 1;
      const t0 = this.next + this.gauss() * 0.00005;
      const v = odd ? 0.75 : 1;
      this.clicks.push({ start: t0, amp: 0.5 * v, freq: 3600 }, { start: t0 + 0.0012, amp: 0.3 * v, freq: 2300 });
      this.next += p.stepSec / (1 + p.ppm * 1e-6);
      this.step++;
    }
    for (let i = 0; i < out.length; i++) out[i] = this.gauss() * p.noise;
    for (const c of this.clicks) {
      if (c.start >= blockEnd || c.start + 0.006 <= blockStart) continue;
      const i0 = Math.max(0, Math.ceil((c.start - blockStart) * sr));
      const i1 = Math.min(out.length, Math.ceil((c.start + 0.006 - blockStart) * sr));
      for (let i = i0; i < i1; i++) {
        const dt = blockStart + i / sr - c.start;
        out[i] += c.amp * Math.sin(2 * Math.PI * c.freq * dt) * Math.exp(-dt / 0.0007);
      }
    }
    this.clicks = this.clicks.filter((c) => c.start + 0.006 > blockEnd);
    this.frame += out.length;
  }
}
