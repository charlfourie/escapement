/// AudioWorklet processor: runs the tick detector on the audio thread so
/// timestamps are sample-accurate and unaffected by main-thread jank.

import { TickDetector, type DetectorSettings, type TickEvent } from './detector';
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
  processorOptions?: { detector?: Partial<DetectorSettings>; sim?: SimParams | null };
}

class TickProcessor extends AudioWorkletProcessor {
  private detector: TickDetector;
  private synth: TickSynth | null;
  private buffer = new Float32Array(128);
  private pending: TickEvent[] = [];
  private lastPost = 0;

  constructor(options: Options) {
    super();
    const opts = options.processorOptions ?? {};
    this.detector = new TickDetector(sampleRate, opts.detector);
    this.synth = opts.sim ? new TickSynth(sampleRate, opts.sim) : null;
    this.port.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m?.type === 'detector') this.detector.setSettings(m.settings);
      else if (m?.type === 'sim' && this.synth) this.synth.setParams(m.params);
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

    const ticks = this.detector.process(input);
    if (ticks.length) this.pending.push(...ticks);

    if (currentFrame - this.lastPost >= sampleRate * 0.05) {
      this.port.postMessage({
        type: 'update',
        ticks: this.pending,
        level: this.detector.readLevel(),
        noise: this.detector.noiseFloor,
        threshold: this.detector.threshold,
      });
      this.pending = [];
      this.lastPost = currentFrame;
    }
    return true;
  }
}

registerProcessor('escapement-ticks', TickProcessor);
