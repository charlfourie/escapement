import workletUrl from './tick-processor.ts?worker&url';
import type { DetectorSettings } from './detector';
import type { BankTick } from './tick-processor';
import type { SimParams } from './synth';

export type Source = { kind: 'mic'; deviceId?: string } | { kind: 'sim'; params: SimParams };

export interface Clip {
  sampleRate: number;
  samples: Float32Array;
}

export interface EngineUpdate {
  ticks: BankTick[];
  level: number;
  noise: number;
  threshold: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private stream: MediaStream | null = null;
  private monitor: GainNode | null = null;
  private source: AudioNode | null = null;
  onUpdate: ((u: EngineUpdate) => void) | null = null;
  private clipWaiter: { resolve: (c: Clip) => void; reject: (e: Error) => void } | null = null;

  /** The raw input signal, for analysers (mic source, or the simulator's output). */
  get input(): AudioNode | null {
    return this.source;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  /** The live microphone track, to inspect what the browser actually applied. */
  get track(): MediaStreamTrack | null {
    return this.stream?.getAudioTracks()[0] ?? null;
  }

  get running(): boolean {
    return this.ctx !== null;
  }

  async start(source: Source, opts: { auto: boolean; detector: Partial<DetectorSettings> }): Promise<void> {
    await this.stop();
    // Create and resume inside the click handler so browsers allow audio.
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    void ctx.resume();
    this.ctx = ctx;
    try {
      await ctx.audioWorklet.addModule(workletUrl);
      if (source.kind === 'mic') {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: source.deviceId ? { exact: source.deviceId } : undefined,
            // Voice processing would erase the ticks — turn it all off.
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 1,
          },
        });
      }
      const node = new AudioWorkletNode(ctx, 'escapement-ticks', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: { detector: opts.detector, auto: opts.auto, sim: source.kind === 'sim' ? source.params : null },
      });
      node.port.onmessage = (e: MessageEvent) => {
        if (e.data?.type === 'update') this.onUpdate?.(e.data as EngineUpdate);
        else if (e.data?.type === 'clip' && this.clipWaiter) {
          this.clipWaiter.resolve({ sampleRate: e.data.sampleRate, samples: e.data.samples });
          this.clipWaiter = null;
        }
      };
      if (this.stream) {
        const src = ctx.createMediaStreamSource(this.stream);
        src.connect(node);
        this.source = src;
      } else {
        this.source = node; // simulated input: the worklet's output is the signal
      }
      const monitor = ctx.createGain();
      monitor.gain.value = 0;
      node.connect(monitor).connect(ctx.destination);
      this.node = node;
      this.monitor = monitor;
      await ctx.resume();
    } catch (err) {
      await this.stop();
      throw err;
    }
  }

  setDetector(settings: Partial<DetectorSettings>): void {
    this.node?.port.postMessage({ type: 'detector', settings });
  }

  /** Dead time after each tick, for all detectors (cuts echoes once locked). */
  setRefractory(ms: number): void {
    this.node?.port.postMessage({ type: 'refractory', ms });
  }

  /** Which detector feeds the level meter. */
  select(index: number): void {
    this.node?.port.postMessage({ type: 'select', index });
  }

  /** Record the raw input for `seconds` and resolve with the samples. */
  record(seconds: number): Promise<Clip> {
    if (!this.node) return Promise.reject(new Error('Not running'));
    this.clipWaiter?.reject(new Error('Superseded'));
    return new Promise((resolve, reject) => {
      this.clipWaiter = { resolve, reject };
      this.node!.port.postMessage({ type: 'record', seconds });
    });
  }

  setSim(params: Partial<SimParams>): void {
    this.node?.port.postMessage({ type: 'sim', params });
  }

  setMonitor(on: boolean): void {
    if (this.monitor && this.ctx) this.monitor.gain.setTargetAtTime(on ? 0.6 : 0, this.ctx.currentTime, 0.02);
  }

  async stop(): Promise<void> {
    this.clipWaiter?.reject(new Error('Stopped before the clip finished'));
    this.clipWaiter = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.node?.disconnect();
    this.node = null;
    this.source = null;
    this.monitor = null;
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx && ctx.state !== 'closed') await ctx.close().catch(() => {});
  }
}

export async function listInputs(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === 'audioinput');
}
