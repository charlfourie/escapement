# Escapement

**A free, open-source timegrapher that runs in your browser.** Hold a mechanical watch to your microphone and Escapement listens to its ticks. It measures how many seconds a day the watch gains or loses, and keeps a log for every watch in your collection.

No app to install, no account, no server. Your data stays in your browser.

## Features

- **Live timegrapher:** rate (s/day), beat error (ms) and beat rate (auto-detected: 14,400–36,000 bph)
- **Auto-tune:** listens through 12 filter and trigger combinations at once and locks onto whichever hears a clean, steady beat. No fiddling with sliders, even on a noisy phone mic.
- **Paper-trace view:** the classic timegrapher dot plot. Flat means accurate, a slope means gaining or losing, and two separate lines mean beat error.
- **Tick waveform:** see the unlock, impulse and drop clicks of each beat
- **Your collection:** add watches with photos, caliber, beat rate and service dates
- **Measurement log:** save each reading with its position (dial up, crown down…), wind state and notes. Each watch gets a rate-over-time chart with the COSC band, a positional delta, and the stored trace for every reading.
- **Your data, your device:** stored in IndexedDB, with JSON backup/restore and CSV export for spreadsheets
- **Identify with AI:** snap the dial, caseback or movement (or pick photos), add what you know, and Claude reads the markings and checks them online, suggesting brand, reference, caliber, beat rate and lift angle with sources and caveats. You choose what to apply. Uses your own Anthropic API key, stored only in your browser (bring your own key, so there's no server).
- **Movement lookups:** every watch with a caliber links to its entry on [Ranfft DB](https://ranfft.org), the community movement encyclopedia.
- **Simulated watch:** try everything without a watch. Set rate, beat error, amplitude and noise, and listen to it tick.

## How it works

```
mic ─► AudioWorklet ──────────────────────────────────────────► main thread
       2× high-pass (2 kHz)                                    beat-rate detection
       envelope + adaptive noise floor                         beat index assignment
       trigger → look back to the first click (sub-sample)     least-squares fit
       = timestamp per tick                                    = rate, beat error, trace
```

In **auto-tune** mode the worklet runs 12 detectors in parallel (high-pass at 1.5, 3 and 6 kHz × four trigger levels). Every ¾ s each stream is scored at every plausible beat rate:

```
score = precision × recall / (1 + jitter / 1.5 ms)
```

A fast O(n) pre-screen picks the candidates worth a full fit. Precision punishes echoes and noise triggers, recall punishes missed beats, and jitter punishes coincidental grids. The best stream wins, with hysteresis so the lock doesn't flicker. Once locked, every detector's dead time widens to ~45% of a beat, which removes echoes from the case or the table.

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
- [ ] Optional online collection: sign-in protected sync of watches and results across devices (local-first stays the default)

## Licence

MIT © Charl Fourie
