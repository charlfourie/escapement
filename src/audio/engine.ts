import workletUrl from './tick-processor.ts?worker&url';
import type { DetectorSettings } from './detector';
import { DropoutDetector } from './dropouts';
import type { BankTick } from './tick-processor';
import type { QuartzSimParams, SimParams } from './synth';

export type Source = { kind: 'mic'; deviceId?: string } | { kind: 'sim'; params: SimParams } | { kind: 'qsim'; params: QuartzSimParams };

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
  /** Context time (currentTime clock) at which tick times start counting. */
  private origin = 0;
  private dropoutDetector = new DropoutDetector();
  /**
   * Moments the audio stalled: the sound card's timeline paused (or jumped)
   * against the computer's clock. `at` is on the output clock (audioNow()).
   */
  get dropouts(): Array<{ at: number; gap: number }> {
    return this.dropoutDetector.dropouts;
  }

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

  /**
   * The sound card's clock right now, in seconds, interpolated between audio
   * callbacks (currentTime alone moves in steps of 10 ms or more).
   */
  audioNow(): number | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const ts = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null;
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0) {
      return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
    }
    return ctx.currentTime;
  }

  /**
   * Check the sound card's clock against the computer's: a jump in the gap
   * between them means the audio stalled. Call a few times a second.
   */
  pollDropouts(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const ts = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null;
    const precise = !!ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0;
    const audio = precise ? ts!.contextTime! : ctx.currentTime;
    // getOutputTimestamp is good to a couple of ms; currentTime only to a buffer.
    this.dropoutDetector.feed(audio, (precise ? ts!.performanceTime! : performance.now()) / 1000, precise ? 0.015 : 0.05);
  }

  /** Convert a time on the output clock (audioNow, dropouts) to tick time. */
  toTickTime(audioTime: number): number {
    const ctx = this.ctx;
    const lag = ctx ? (ctx.baseLatency || 0) + ((ctx as AudioContext & { outputLatency?: number }).outputLatency || 0) : 0;
    return audioTime + lag - this.origin;
  }

  /** Details for a diagnostics report. */
  describe(): Record<string, unknown> {
    const ctx = this.ctx;
    return {
      sampleRate: ctx?.sampleRate,
      baseLatency: ctx?.baseLatency,
      outputLatency: (ctx as (AudioContext & { outputLatency?: number }) | null)?.outputLatency,
      outputTimestamp: !!ctx && typeof ctx.getOutputTimestamp === 'function',
      origin: this.origin,
      track: this.stream?.getAudioTracks()[0]?.getSettings(),
    };
  }

  get running(): boolean {
    return this.ctx !== null;
  }

  async start(source: Source, opts: { auto: boolean; denoise?: boolean; detector: Partial<DetectorSettings>; latency?: 'interactive' | 'playback' }): Promise<void> {
    await this.stop();
    this.dropoutDetector = new DropoutDetector();
    this.origin = 0;
    // Create and resume inside the click handler so browsers allow audio.
    // 'playback' uses bigger buffers: more delay, but fewer dropouts on a busy computer.
    const ctx = new AudioContext({ latencyHint: opts.latency ?? 'interactive' });
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
        processorOptions: { detector: opts.detector, auto: opts.auto, denoise: Boolean(opts.denoise), sim: source.kind === 'sim' ? source.params : null, qsim: source.kind === 'qsim' ? source.params : null },
      });
      node.port.onmessage = (e: MessageEvent) => {
        if (e.data?.type === 'update') this.onUpdate?.(e.data as EngineUpdate);
        else if (e.data?.type === 'origin') this.origin = Number(e.data.time) || 0;
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

  /** Switch noise reduction on or off while running. */
  setDenoise(on: boolean): void {
    this.node?.port.postMessage({ type: 'denoise', on });
  }

  /** Which detector feeds the level meter. */
  select(index: number): void {
    this.node?.port.postMessage({ type: 'select', index });
  }

  /** Record the raw input for `seconds` (up to 120) and resolve with the samples. */
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
