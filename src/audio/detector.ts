/**
 * Tick detector: turns raw microphone samples into timestamped tick events.
 *
 * Pipeline per sample:
 *   2× high-pass biquad  →  rectify  →  peak-hold envelope  →  adaptive threshold
 *
 * Pure TypeScript with no DOM dependencies, so it runs inside the AudioWorklet
 * and in unit tests alike.
 */

export interface TickEvent {
  /** Seconds since the stream started (sub-sample accurate). */
  time: number;
  /** Peak envelope level during the tick. */
  peak: number;
  /** Envelope snippet: starts SNIPPET_PRE_MS before onset, SNIPPET_BIN_MS per bin, SNIPPET_MS long. */
  envelope: number[];
  /**
   * Seconds from the unlock click to the drop click (the balance's lift),
   * or null when the clicks couldn't be told apart. Amplitude comes from this.
   */
  lift: number | null;
}

export interface DetectorSettings {
  /** Trigger threshold as a multiple of the tracked noise floor. Lower = more sensitive. */
  sensitivity: number;
  /** Dead time after a trigger, so the 3 sub-clicks of one beat count once. */
  refractoryMs: number;
  /** High-pass cutoff; watch ticks live mostly above 2 kHz, rumble and voice below. */
  highpassHz: number;
}

export const DEFAULT_DETECTOR: DetectorSettings = {
  sensitivity: 6,
  refractoryMs: 50,
  highpassHz: 2000,
};

/**
 * Auto mode runs one detector per combination of filter and trigger level in
 * parallel; the analysis keeps whichever stream produces the cleanest beat.
 */
export const AUTO_HIGHPASS = [1500, 3000, 6000];
export const AUTO_SENSITIVITY = [3, 5, 8, 13];
export const AUTO_BANK: Array<Pick<DetectorSettings, 'highpassHz' | 'sensitivity'>> = AUTO_HIGHPASS.flatMap((highpassHz) =>
  AUTO_SENSITIVITY.map((sensitivity) => ({ highpassHz, sensitivity })),
);

/** Emitted envelope snippet: 2 ms before onset, 22 ms after. */
export const SNIPPET_PRE_MS = 4;
export const SNIPPET_MS = 28;
export const SNIPPET_BIN_MS = 0.1;
/** Look-back/look-ahead captured around a trigger to find the true first click. */
const LOOKBACK_MS = 16;
const LOOKAHEAD_MS = 24;
/** The onset is the first point above this fraction of the beat's peak. */
const ONSET_FRACTION = 0.2;
/** Each sub-click is timed where it crosses this fraction of its own peak. */
const CLICK_EDGE = 0.5;
/** A click has ended once the envelope falls below this fraction of its peak… */
const CLICK_END = 0.45;
/** …and a new one starts when it rises this much above the trough since. */
const CLICK_RISE = 1.8;
/** The drop must be at least this loud relative to the beat's loudest click. */
const DROP_MIN = 0.3;
const LIFT_MIN_MS = 0.8;
const LIFT_MAX_MS = 25;

class Biquad {
  private b0 = 0;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(freq: number, sampleRate: number, q = Math.SQRT1_2) {
    // RBJ cookbook high-pass
    const w0 = (2 * Math.PI * freq) / sampleRate;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = (1 + cos) / 2 / a0;
    this.b1 = -(1 + cos) / a0;
    this.b2 = (1 + cos) / 2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  step(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

const coef = (tauSec: number, sampleRate: number) => 1 - Math.exp(-1 / (tauSec * sampleRate));

export class TickDetector {
  private settings: DetectorSettings;
  private readonly hp1: Biquad;
  private readonly hp2: Biquad;
  /** Separate filters for the timing signal (see process()). */
  private readonly hpT1: Biquad;
  private readonly hpT2: Biquad;
  private envT = 0;
  private noiseT = 0;

  private env = 0;
  private noise = 0;
  private levelMax = 0;

  private readonly releaseMul: number;
  private readonly noiseDown: number;
  private readonly noiseUp: number;
  private readonly noiseWarm: number;

  private frame = 0;
  private holdUntil = 0;
  private readonly warmupUntil: number;

  private readonly ring: Float32Array;
  private ringPos = 0;
  private capture: number[] | null = null;
  private captureOnset = 0;
  private captureNoise = 0;
  private capturePeak = 0;
  private readonly captureLength: number;
  private readonly binSamples: number;

  constructor(
    readonly sampleRate: number,
    settings: Partial<DetectorSettings> = {},
  ) {
    this.settings = { ...DEFAULT_DETECTOR, ...settings };
    this.hp1 = new Biquad(this.settings.highpassHz, sampleRate);
    this.hp2 = new Biquad(this.settings.highpassHz, sampleRate);
    this.hpT1 = new Biquad(this.settings.highpassHz, sampleRate);
    this.hpT2 = new Biquad(this.settings.highpassHz, sampleRate);

    this.releaseMul = Math.exp(-1 / (0.0015 * sampleRate)); // 1.5 ms envelope release
    this.noiseDown = coef(0.05, sampleRate); // floor follows quiet quickly…
    this.noiseUp = coef(2, sampleRate); // …and ignores ticks
    this.noiseWarm = coef(0.05, sampleRate);
    this.warmupUntil = Math.round(0.4 * sampleRate);

    const pre = Math.max(1, Math.round((LOOKBACK_MS / 1000) * sampleRate));
    this.ring = new Float32Array(pre);
    this.captureLength = pre + Math.round((LOOKAHEAD_MS / 1000) * sampleRate);
    this.binSamples = Math.max(1, Math.round((SNIPPET_BIN_MS / 1000) * sampleRate));
  }

  setSettings(partial: Partial<DetectorSettings>): void {
    // highpassHz is fixed at construction; the rest applies immediately.
    this.settings = { ...this.settings, ...partial, highpassHz: this.settings.highpassHz };
  }

  get noiseFloor(): number {
    return this.noise;
  }

  get threshold(): number {
    return Math.max(this.noise * this.settings.sensitivity, 1e-5);
  }

  /** Peak envelope since the last call (for level meters). */
  readLevel(): number {
    const l = this.levelMax;
    this.levelMax = 0;
    return l;
  }

  /**
   * `input` decides *whether* there's a tick. If `timing` is given (the same
   * audio, unprocessed and time-aligned), it decides *when*: onset, envelope
   * snippet and lift are measured on it. That lets noise reduction help find
   * ticks without its frame-by-frame gains nudging their timing.
   */
  process(input: Float32Array, timing?: Float32Array): TickEvent[] {
    const events: TickEvent[] = [];
    const refractory = Math.round((this.settings.refractoryMs / 1000) * this.sampleRate);
    const ring = this.ring;

    for (let i = 0; i < input.length; i++) {
      const x = this.hp2.step(this.hp1.step(input[i]));
      const r = x < 0 ? -x : x;
      this.env = r > this.env ? r : this.env * this.releaseMul;
      const e = this.env;

      if (this.frame < this.warmupUntil) {
        this.noise += (e - this.noise) * this.noiseWarm;
      } else {
        this.noise += (e - this.noise) * (e < this.noise ? this.noiseDown : this.noiseUp);
      }
      if (e > this.levelMax) this.levelMax = e;

      let te = e;
      if (timing) {
        const xt = this.hpT2.step(this.hpT1.step(timing[i]));
        const rt = xt < 0 ? -xt : xt;
        this.envT = rt > this.envT ? rt : this.envT * this.releaseMul;
        te = this.envT;
        if (this.frame < this.warmupUntil) this.noiseT += (te - this.noiseT) * this.noiseWarm;
        else this.noiseT += (te - this.noiseT) * (te < this.noiseT ? this.noiseDown : this.noiseUp);
      }

      ring[this.ringPos] = te;
      this.ringPos = (this.ringPos + 1) % ring.length;

      if (this.capture) {
        this.capture.push(te);
        if (te > this.capturePeak) this.capturePeak = te;
        if (this.capture.length >= this.captureLength) events.push(this.finishCapture());
      } else if (this.frame >= this.holdUntil && this.frame >= this.warmupUntil) {
        const thr = this.threshold;
        if (e > thr) {
          // Absolute frame of the first sample in the capture buffer.
          this.captureOnset = this.frame - ring.length + 1;
          this.captureNoise = timing ? this.noiseT : this.noise;
          this.holdUntil = this.frame + refractory;
          this.capturePeak = te;
          const snippet: number[] = [];
          for (let k = 0; k < ring.length; k++) snippet.push(ring[(this.ringPos + k) % ring.length]);
          this.capture = snippet;
        }
      }
      this.frame++;
    }
    return events;
  }

  /**
   * Refine the onset: a trigger can fire on the impulse or drop click when the
   * quieter unlock click sits just under the threshold. Looking back for the
   * first point above a fraction of the beat's peak keeps every beat timed
   * from the same sub-click, which is what makes beat error stable.
   */
  private finishCapture(): TickEvent {
    const raw = this.capture!;
    this.capture = null;
    const level = Math.max(this.capturePeak * ONSET_FRACTION, this.captureNoise * 3);
    let k = 0;
    while (k < raw.length && raw[k] <= level) k++;
    if (k >= raw.length) k = this.ring.length - 1;
    const prev = k > 0 ? raw[k - 1] : 0;
    let frac = raw[k] !== prev ? (level - prev) / (raw[k] - prev) : 1;
    if (!(frac >= 0)) frac = 0;
    if (frac > 1) frac = 1;
    const onsetFrame = this.captureOnset + k - 1 + frac;

    const pre = Math.round((SNIPPET_PRE_MS / 1000) * this.sampleRate);
    const len = Math.round((SNIPPET_MS / 1000) * this.sampleRate);
    const from = Math.max(0, k - pre);
    const to = Math.min(raw.length, from + len);
    const bins: number[] = [];
    for (let i = from; i < to; i += this.binSamples) {
      let m = 0;
      for (let j = i; j < Math.min(to, i + this.binSamples); j++) if (raw[j] > m) m = raw[j];
      bins.push(m);
    }
    return { time: onsetFrame / this.sampleRate, peak: this.capturePeak, envelope: bins, lift: this.measureLift(raw, k, level) };
  }

  /**
   * Split the beat into its sub-clicks (unlock, impulse, drop) and time the
   * gap from the first to the last loud one. Each click is timed at the same
   * fraction of its own peak, so loudness differences don't bias the gap.
   */
  private measureLift(raw: number[], start: number, level: number): number | null {
    type Click = { start: number; peakIdx: number; peak: number };
    const clicks: Click[] = [];
    let cur: Click = { start, peakIdx: start, peak: raw[start] };
    let inClick = true;
    let trough = Infinity;
    for (let i = start + 1; i < raw.length; i++) {
      const e = raw[i];
      if (inClick) {
        if (e > cur.peak) {
          cur.peak = e;
          cur.peakIdx = i;
        }
        if (e < cur.peak * CLICK_END) {
          clicks.push(cur);
          inClick = false;
          trough = e;
        }
      } else {
        if (e < trough) trough = e;
        if (e > level && e > trough * CLICK_RISE) {
          cur = { start: i, peakIdx: i, peak: e };
          inClick = true;
        }
      }
    }
    if (inClick) clicks.push(cur);
    if (clicks.length < 2) return null;

    const edge = (c: Click) => {
      const thr = c.peak * CLICK_EDGE;
      let j = c.peakIdx;
      while (j > 0 && raw[j - 1] > thr && raw[j - 1] <= raw[j]) j--;
      const a = j > 0 ? raw[j - 1] : 0;
      const b = raw[j];
      const frac = b !== a ? Math.min(1, Math.max(0, (thr - a) / (b - a))) : 1;
      return (j - 1 + frac) / this.sampleRate;
    };

    const loudest = Math.max(...clicks.map((c) => c.peak));
    const unlock = edge(clicks[0]);
    for (let n = clicks.length - 1; n >= 1; n--) {
      if (clicks[n].peak < loudest * DROP_MIN) continue;
      const gap = edge(clicks[n]) - unlock;
      if (gap * 1000 >= LIFT_MIN_MS && gap * 1000 <= LIFT_MAX_MS) return gap;
    }
    return null;
  }
}
