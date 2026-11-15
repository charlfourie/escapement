/**
 * Analyse a recorded clip offline with the same pipeline as the app.
 *
 *   npm run analyze-clip -- path/to/clip.wav [--bph 28800] [--lift 52] [--nr]
 *   npm run analyze-clip -- path/to/clip.wav --quartz
 *
 * Prints what each auto-tune detector heard, which one locks, and the
 * resulting rate, beat error and amplitude. Use it to tune detection on
 * real recordings from the "Record 10 s clip" button.
 */
import { readFileSync } from 'node:fs';
import { AUTO_BANK, TickDetector } from '../src/audio/detector';
import { amplitudeFrom, amplitudeFromLift, analyze } from '../src/analysis/analyze';
import { liftFromEnvelope } from '../src/analysis/lift';
import { analyzeQuartz, pickQuartzStream, ppmToMonth } from '../src/analysis/quartz';
import { SNIPPET_BIN_MS } from '../src/audio/detector';
import { AutoLock, quickScore } from '../src/analysis/autolock';
import { SpectralDenoiser } from '../src/audio/denoise';

function readWav(path: string): { sampleRate: number; samples: Float32Array } {
  const b = readFileSync(path);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Not a WAV file');
  let off = 12;
  let fmt = 1, channels = 1, sampleRate = 48000, bits = 16;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = v.getUint32(off + 4, true);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = v.getUint16(body, true);
      channels = v.getUint16(body + 2, true);
      sampleRate = v.getUint32(body + 4, true);
      bits = v.getUint16(body + 14, true);
    } else if (id === 'data') {
      const frames = Math.floor(size / (channels * (bits / 8)));
      const out = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        const p = body + i * channels * (bits / 8);
        out[i] = fmt === 3 && bits === 32 ? v.getFloat32(p, true) : bits === 16 ? v.getInt16(p, true) / 32768 : bits === 24 ? ((v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getInt8(p + 2) << 16)) / 8388608) : v.getInt32(p, true) / 2147483648;
      }
      return { sampleRate, samples: out };
    }
    off = body + size + (size % 2);
  }
  throw new Error('No audio data found');
}

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : null;
};
if (!file) {
  console.error('Usage: npm run analyze-clip -- clip.wav [--bph 28800] [--lift 52]');
  process.exit(1);
}
const { sampleRate, samples } = readWav(file);
const bphSetting = opt('bph');
const liftAngle = opt('lift') ?? 52;
const nr = args.includes('--nr');
const denoiser = new SpectralDenoiser(sampleRate);
denoiser.enabled = nr;
const cleaned = new Float32Array(128);
const peak = samples.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
console.log(`${file}: ${(samples.length / sampleRate).toFixed(1)} s at ${sampleRate} Hz, peak ${(20 * Math.log10(peak || 1e-9)).toFixed(1)} dBFS${nr ? ' · noise reduction on' : ''}`);

if (args.includes('--quartz')) {
  // Quartz: one click a step, so a long dead time after each click.
  const qbank = AUTO_BANK.map((b) => new TickDetector(sampleRate, { ...b, refractoryMs: 400 }));
  const qlock = new AutoLock(qbank.length);
  for (let off = 0; off + 128 <= samples.length; off += 128) {
    const chunk = samples.subarray(off, off + 128);
    denoiser.process(chunk, cleaned);
    qbank.forEach((det, d) => det.process(cleaned).forEach((t) => qlock.add(d, t.time, null, t.envelope)));
  }
  console.log('\nQuartz streams:');
  qlock.streams.forEach((s, i) => {
    const r = analyzeQuartz(s);
    const b = AUTO_BANK[i];
    console.log(`    ${String(b.highpassHz / 1000).padStart(3)} kHz ×${String(b.sensitivity).padEnd(2)}  ${String(s.length).padStart(4)} clicks  ${r ? `${r.ticks} on the beat, jitter ${r.jitter.toFixed(2)} ms, ${r.stepSec} s steps` : '—'}`);
  });
  const best = pickQuartzStream(qlock.streams, 0);
  if (!best) console.log('\nNo steady quartz steps found.');
  else {
    const r = best.result;
    console.log(`\nStream ${best.index}: ${r.stepSec === 2 ? '2-SECOND STEPS (low battery or low charge) · ' : ''}${r.ticks} clicks over ${r.span.toFixed(1)} s, ${r.missed} missed, ${r.rejected} rejected`);
    console.log(`Rate vs this sound card: ${r.rawPpm >= 0 ? '+' : ''}${r.rawPpm.toFixed(2)} ppm = ${ppmToMonth(r.rawPpm).toFixed(1)} s/month ± ${ppmToMonth(r.rawSigmaPpm).toFixed(1)} (timing only; the sound card's own clock error is not removed offline)`);
    console.log(`Jitter ${r.jitter.toFixed(3)} ms · alternate-step offset ${r.polarity.toFixed(3)} ms`);
  }
  process.exit(0);
}

const bank = AUTO_BANK.map((b) => new TickDetector(sampleRate, b));
const lock = new AutoLock(bank.length);
let refractory = 50;
let state = lock.current;
for (let off = 0, block = 0; off < samples.length; off += 128, block++) {
  const chunk = samples.subarray(off, off + 128);
  if (chunk.length < 128) break;
  denoiser.process(chunk, cleaned);
  bank.forEach((det, d) => det.process(cleaned).forEach((t) => lock.add(d, t.time, t.lift, t.envelope)));
  if (block % Math.round((0.75 * sampleRate) / 128) === 0) {
    state = lock.evaluate(bphSetting);
    const want = state.locked && state.bph ? Math.round(0.45 * (3600 / state.bph) * 1000) : 50;
    if (want !== refractory) {
      refractory = want;
      bank.forEach((det) => det.setSettings({ refractoryMs: want }));
    }
  }
}
state = lock.evaluate(bphSetting);
const dur = samples.length / sampleRate;

console.log('\nDetector streams:');
lock.streams.forEach((s, i) => {
  const b = AUTO_BANK[i];
  const q = state.bph ? quickScore(s, state.bph) : 0;
  console.log(`  ${i === state.index ? '→' : ' '} ${String(b.highpassHz / 1000).padStart(3)} kHz ×${String(b.sensitivity).padEnd(2)}  ${String(s.length).padStart(4)} ticks (${(s.length / dur).toFixed(1)}/s)  pre-screen ${q.toFixed(2)}`);
});

console.log(`\nLock: ${state.locked ? 'yes' : 'NO'} · stream ${state.index} · ${state.bph ?? '?'} bph · score ${(state.score * 100).toFixed(0)}%`);
const times = lock.streams[state.index];
const r = analyze(times, { bph: state.bph ?? bphSetting });
if (!r) {
  console.log('No reading: not enough clean ticks.');
} else {
  const amp = amplitudeFrom(lock.lifts[state.index].filter((x): x is number => x !== null), r.bph, liftAngle);
  console.log(`Rate ${r.rate >= 0 ? '+' : ''}${r.rate.toFixed(1)} s/d · beat error ${r.beatError?.toFixed(2) ?? '—'} ms · ${r.bph} bph`);
  console.log(`Amplitude ${amp ? `${Math.round(amp.amplitude)}° (spread ${amp.spread.toFixed(0)}°, ${amp.samples} ticks, lift angle ${liftAngle}°)` : '— (clicks not separable)'}`);
  const tpl = lock.template(state.index);
  const tl = tpl ? liftFromEnvelope(tpl, SNIPPET_BIN_MS) : null;
  const ta = tl ? amplitudeFromLift(tl.lift, r.bph, liftAngle) : null;
  console.log(`Amplitude from averaged ticks: ${ta ? `${Math.round(ta)}° (lift ${(tl!.lift * 1000).toFixed(2)} ms, unlock at ${(tl!.unlockLevel * 100).toFixed(0)}% of the drop, ${tl!.unlockSigma.toFixed(0)}σ)` : '—'}`);
  console.log(`Clean beats ${(r.quality * 100).toFixed(0)}% · jitter ${r.jitter.toFixed(3)} ms · ${r.ticks} ticks over ${r.duration.toFixed(1)} s`);
}
