# Escapement

**A free, open-source timegrapher that runs in your browser.** Hold a mechanical watch to your microphone and Escapement listens to its ticks. It measures how many seconds a day the watch gains or loses, and keeps a log for every watch in your collection.

No app to install, no account, no server. Your data stays in your browser.

## Features

- **Live timegrapher:** rate (s/day), beat error (ms) and beat rate (auto-detected: 14,400–36,000 bph)
- **Paper-trace view:** the classic timegrapher dot plot. Flat means accurate, a slope means gaining or losing, and two separate lines mean beat error.
- **Tick waveform:** see the unlock, impulse and drop clicks of each beat
- **Your collection:** add watches with photos, caliber, beat rate and service dates
- **Measurement log:** save each reading with its position (dial up, crown down…), wind state and notes. Each watch gets a rate-over-time chart with the COSC band, a positional delta, and the stored trace for every reading.
- **Your data, your device:** stored in IndexedDB, with JSON backup/restore and CSV export for spreadsheets
- **Simulated watch:** try everything without a watch. Set rate, beat error, amplitude and noise, and listen to it tick.

## How it works

```
mic ─► AudioWorklet ──────────────────────────────────────────► main thread
       2× high-pass (2 kHz)                                    beat-rate detection
       envelope + adaptive noise floor                         beat index assignment
       trigger → look back to the first click (sub-sample)     least-squares fit
       = timestamp per tick                                    = rate, beat error, trace
```

Ticks are timestamped on the audio thread against the sample clock, so timing isn't affected by UI jank. Each tick gets a beat index *n* and a side (tic/toc). Escapement then fits

```
t = a + b·n + c·s        s = ±½ for tic/toc
rate       = 86400 · (P / b − 1)   s/day     (P = nominal beat period)
beat error = |c|                    ms
```

with robust outlier rejection, so a bump on the table or a missed tick doesn't throw the reading off.

## Getting a clean reading

- Use a quiet room, with the watch dial-up on a soft cloth and the case touching the microphone.
- A cheap **piezo contact mic** pressed against the case works far better than a built-in mic.
- Wait until the dots form two tidy lines, then let it run 30–60 seconds.
- Scattered dots: raise the trigger level. No ticks: lower it.
- Microphone access needs HTTPS (or `localhost`).

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # analysis tests against the simulated watch
npm run build      # type-check + production build into dist/
```

Stack: Vite, TypeScript (no framework), Web Audio `AudioWorklet`, Dexie (IndexedDB). It deploys as a static site to Vercel, Netlify or GitHub Pages.

```
src/
  audio/      detector (worklet-safe), simulated watch, worklet, engine
  analysis/   beat-rate detection, fit, trace
  ui/         canvas trace + waveform, SVG history chart
  views/      measure, watches, watch detail/form, data
  db.ts       Dexie schema
tests/        detector + analysis tests
```

## Roadmap

- [x] Rate, beat error, auto beat rate, paper trace
- [x] Watch collection and measurement log, export/import
- [ ] Amplitude (unlock→drop timing with per-watch lift angle)
- [ ] Guided six-position test with averaged rate and delta
- [ ] Service-due hints from amplitude trend
- [ ] Installable PWA / offline

## Licence

MIT © Charl Fourie
