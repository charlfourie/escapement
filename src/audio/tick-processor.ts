/// AudioWorklet processor: runs the tick detector(s) on the audio thread so
/// timestamps are sample-accurate and unaffected by main-thread jank.

import { AUTO_BANK, TickDetector, type DetectorSettings, type TickEvent } from './detector';
import { TickSynth, type SimParams } from './synth';

// AudioWorkletGlobalScope globals (not in the DOM lib).
declare const sampleRate: number;
declare const currentFrame: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}

interface Options {
  processorOptions?: { detector?: Partial<DetectorSettings>; auto?: boolean; sim?: SimParams | null };
}

/** A tick tagged with the index of the detector that heard it. */
export type BankTick = TickEvent & { d: number };

class TickProcessor extends AudioWorkletProcessor {
  private bank: TickDetector[];
  private auto: boolean;
  private selected = 0;
  private synth: TickSynth | null;
  private buffer = new Float32Array(128);
  private pending: BankTick[] = [];
  private lastPost = 0;
  /** Raw-input recording for the clip recorder. */
  private rec: Float32Array | null = null;
  private recPos = 0;

  constructor(options: Options) {
    super();
    const opts = options.processorOptions ?? {};
    this.auto = Boolean(opts.auto);
    this.bank = this.auto
      ? AUTO_BANK.map((b) => new TickDetector(sampleRate, { ...opts.detector, ...b }))
      : [new TickDetector(sampleRate, opts.detector)];
    this.synth = opts.sim ? new TickSynth(sampleRate, opts.sim) : null;
    this.port.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m?.type === 'detector' && !this.auto) this.bank[0].setSettings(m.settings);
      else if (m?.type === 'refractory') this.bank.forEach((d) => d.setSettings({ refractoryMs: m.ms }));
      else if (m?.type === 'select' && m.index >= 0 && m.index < this.bank.length) this.selected = m.index;
      else if (m?.type === 'sim' && this.synth) this.synth.setParams(m.params);
      else if (m?.type === 'record') {
        this.rec = new Float32Array(Math.round(Math.min(30, Math.max(1, Number(m.seconds) || 10)) * sampleRate));
        this.recPos = 0;
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    let input: Float32Array | undefined;
    const out = outputs[0]?.[0];

    if (this.synth) {
      const n = out?.length ?? 128;
      if (this.buffer.length !== n) this.buffer = new Float32Array(n);
      this.synth.render(this.buffer);
      input = this.buffer;
      if (out) out.set(this.buffer); // lets the user listen to the simulated watch
    } else {
      input = inputs[0]?.[0];
    }
    if (!input) return true;

    if (this.rec) {
      const n = Math.min(input.length, this.rec.length - this.recPos);
      this.rec.set(input.subarray(0, n), this.recPos);
      this.recPos += n;
      if (this.recPos >= this.rec.length) {
        const samples = this.rec;
        this.rec = null;
        this.port.postMessage({ type: 'clip', sampleRate, samples }, [samples.buffer]);
      }
    }

    for (let d = 0; d < this.bank.length; d++) {
      for (const t of this.bank[d].process(input)) this.pending.push({ ...t, d });
    }

    if (currentFrame - this.lastPost >= sampleRate * 0.05) {
      const sel = this.bank[this.selected];
      let level = 0;
      this.bank.forEach((det, i) => {
        const l = det.readLevel();
        if (i === this.selected) level = l;
      });
      this.port.postMessage({ type: 'update', ticks: this.pending, level, noise: sel.noiseFloor, threshold: sel.threshold });
      this.pending = [];
      this.lastPost = currentFrame;
    }
    return true;
  }
}

registerProcessor('escapement-ticks', TickProcessor);
