/**
 * Spectral noise reduction for the tick detector.
 *
 * Steady sounds (mains hum and buzz, preamp hiss, fans, fridges) sit at the
 * same level in each frequency band most of the time; ticks are brief bursts.
 * Per band we track the background level (the floor it keeps returning to)
 * and turn each band down by how much of it is background:
 *
 *   gain = max(floor, 1 − α · noise / power)
 *
 * Short-time FFT (2048-sample frames by default, fine enough to separate the
 * 50 Hz harmonics of mains buzz), 75% overlap, √Hann on both sides: with
 * every gain at 1 the output is exactly the input, delayed by one frame.
 * Ticks are still *timed* on the untouched signal (see TickDetector), so the
 * long frames don't blur timing. Runs in the AudioWorklet; pure TS, no DOM.
 */


/** Iterative radix-2 FFT, in place. `inverse` skips the 1/N scaling. */
class FFT {
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly rev: Uint16Array;

  constructor(readonly n: number) {
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    const bits = Math.log2(n);
    this.rev = new Uint16Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
  }

  run(re: Float64Array, im: Float64Array, inverse: boolean): void {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const j = this.rev[i];
      if (j > i) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    const sign = inverse ? 1 : -1;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const c = this.cos[k * step];
          const s = sign * this.sin[k * step];
          const a = start + k;
          const b = a + half;
          const tr = re[b] * c - im[b] * s;
          const ti = re[b] * s + im[b] * c;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }
}

export interface DenoiseSettings {
  /** Over-subtraction: how hard to push down what looks like background. */
  strength: number;
  /** Lowest gain any band can get (linear); keeps it from sounding hollow. */
  floor: number;
  /** FFT frame length (power of two). Longer frames separate mains-hum harmonics. */
  frame: number;
}

export const DEFAULT_DENOISE: DenoiseSettings = { strength: 2.5, floor: 0.06, frame: 2048 };

export class SpectralDenoiser {
  private readonly n: number;
  private readonly hopSize: number;
  private readonly fft: FFT;
  private readonly win: Float64Array;
  private readonly scale: number;
  private readonly frameBuf: Float32Array;
  private readonly acc: Float64Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly noise: Float64Array;
  private readonly up: number;
  private readonly down: number;
  private readonly warmUp: number;
  private readonly warmFrames: number;
  private frames = 0;
  /** Samples waiting for the next frame, and finished output waiting to go. */
  private pendingIn = 0;
  private readonly outQ: Float32Array;
  private outHead = 0;
  private outLen = 0;
  /** Raw input delayed by `latency`, to time ticks on the untouched signal. */
  private readonly rawQ: Float32Array;
  private rawPos = 0;
  settings: DenoiseSettings;
  /** When false, frames pass through untouched (still delayed). */
  enabled = true;
  /** Delay between input and output, in samples. */
  readonly latency: number;

  constructor(readonly sampleRate: number, settings: Partial<DenoiseSettings> = {}) {
    this.settings = { ...DEFAULT_DENOISE, ...settings };
    const n = (this.n = this.settings.frame);
    this.hopSize = n / 4; // 75% overlap
    this.fft = new FFT(n);
    this.win = new Float64Array(n);
    for (let i = 0; i < n; i++) this.win[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
    this.scale = 1 / 2; // √Hann² (= Hann) summed at 75% overlap = 2
    this.frameBuf = new Float32Array(n);
    this.acc = new Float64Array(n);
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
    this.noise = new Float64Array(n / 2 + 1).fill(-1);
    const framesPerSec = sampleRate / this.hopSize;
    // The floor falls quickly to quiet moments and rises slowly, so ticks
    // (a frame or two each) barely lift it.
    this.down = 1 - Math.exp(-1 / (0.05 * framesPerSec));
    this.up = 1 - Math.exp(-1 / (2 * framesPerSec));
    this.warmUp = 1 - Math.exp(-1 / (0.08 * framesPerSec));
    this.warmFrames = Math.round(0.5 * framesPerSec);
    this.latency = n;
    // Output queue starts with one hop of silence so every block can be served.
    this.outQ = new Float32Array(n * 2);
    this.outLen = this.hopSize;
    this.rawQ = new Float32Array(this.latency);
  }

  /** Denoise `input` into `out`; if `raw` is given, it gets the input delayed to match. */
  process(input: Float32Array, out: Float32Array, raw?: Float32Array): void {
    const { frameBuf, n, hopSize } = this;
    for (let i = 0; i < input.length; i++) {
      const x = input[i];
      if (raw) {
        raw[i] = this.rawQ[this.rawPos];
      }
      this.rawQ[this.rawPos] = x;
      this.rawPos = (this.rawPos + 1) % this.rawQ.length;
      frameBuf[n - hopSize + this.pendingIn] = x;
      if (++this.pendingIn === hopSize) {
        this.runFrame();
        frameBuf.copyWithin(0, hopSize);
        this.pendingIn = 0;
      }
    }
    for (let i = 0; i < out.length; i++) {
      out[i] = this.outLen > 0 ? this.outQ[this.outHead] : 0;
      if (this.outLen > 0) {
        this.outHead = (this.outHead + 1) % this.outQ.length;
        this.outLen--;
      }
    }
  }

  private runFrame(): void {
    const { frameBuf, re, im, win, acc, noise, n, hopSize } = this;
    for (let i = 0; i < n; i++) {
      re[i] = frameBuf[i] * win[i];
      im[i] = 0;
    }
    this.fft.run(re, im, false);
    if (this.enabled) {
      const warm = this.frames < this.warmFrames;
      const { strength, floor } = this.settings;
      for (let k = 0; k <= n / 2; k++) {
        const p = re[k] * re[k] + im[k] * im[k];
        if (noise[k] < 0) noise[k] = p;
        else noise[k] += (p - noise[k]) * (warm ? this.warmUp : p < noise[k] ? this.down : this.up);
        // The tracker sits near the quiet end of the background; scale it up
        // a little to approximate the mean before subtracting.
        const g = Math.max(floor, 1 - (strength * noise[k] * 1.5) / Math.max(p, 1e-20));
        re[k] *= g;
        im[k] *= g;
        if (k > 0 && k < n / 2) {
          re[n - k] *= g;
          im[n - k] *= g;
        }
      }
    }
    this.frames++;
    this.fft.run(re, im, true);
    for (let i = 0; i < n; i++) acc[i] += (re[i] / n) * win[i] * this.scale;
    // The first hop of the accumulator is now complete.
    const tail = (this.outHead + this.outLen) % this.outQ.length;
    for (let i = 0; i < hopSize; i++) this.outQ[(tail + i) % this.outQ.length] = acc[i];
    this.outLen += hopSize;
    acc.copyWithin(0, hopSize);
    acc.fill(0, n - hopSize);
  }
}
