# Escapement

**A free, open-source timegrapher that runs in your browser.** Hold a mechanical watch to your microphone and Escapement listens to its ticks. It measures how many seconds a day the watch gains or loses, and keeps a log for every watch in your collection.

No app to install, no account, no server. Your data stays in your browser.

## Features

- **Live timegrapher:** rate (s/day), beat error (ms), amplitude (°) and beat rate (auto-detected: 14,400–36,000 bph)
- **Six-position test:** guided dial up / dial down / crown up, down, left, right, with 5 s to settle and 30 s per position; gives the average rate, positional delta, amplitude and worst beat error, saved as one set
- **Noise handling:** each tick is timed by matching it against the average beat shape (all three clicks vote), which keeps rate and beat error right in noise where timing from the first click alone drifts by several s/day. An optional **noise reduction** toggle (spectral, learns the steady background) rescues readings buried in fan or coil whine and steady hum; leave it off for plain hiss, where it can do worse.
- **Auto-tune:** listens through 12 filter and trigger combinations at once and locks onto whichever hears a clean, steady beat. No fiddling with sliders, even on a noisy phone mic.
- **Paper-trace view:** the classic timegrapher dot plot. Flat means accurate, a slope means gaining or losing, and two separate lines mean beat error.
- **Tick waveform:** see the unlock, impulse and drop clicks of each beat
- **Your collection:** add watches with photos, caliber, beat rate and service dates
- **Every test saved, and a Log:** every valid reading (at least 10 s with 60% clean beats), six-position set and quartz test saves itself as soon as it ends: to the watch you chose, or to the **Log** as unassigned if you didn't choose one, to file later. Position, wind, notes and the watch stay editable, and any test can be deleted. The Log lists every timegrapher reading, six-position test, quartz test and time check across the collection, filterable by watch and type, with CSV export.
- **Measurement history:** each reading keeps its position (dial up, crown down…), wind state and notes. Each watch gets a rate-over-time chart with the COSC band, a positional delta, and the stored trace for every reading.
- **Your data, your device:** stored in IndexedDB, with JSON backup/restore and CSV export for spreadsheets
- **Identify with AI, free:** snap the caseback, movement and dial (or pick photos) and add what you know. Escapement suggests brand, reference, calibre, beat rate, lift angle and the production date decoded from the serial, with sources and caveats, and you choose what to apply. Two routes, neither billed: copy a ready-made request into the Claude or Gemini app you already use and paste the reply back (the chat can search the web), or tap once with your own free Gemini API key from Google AI Studio (no billing; the free tier can't search the web). The key stays in your browser.
- **Quartz watches and time checks:** every watch has a movement type. A timegrapher can't read quartz (or Spring Drive), so those watches get **time checks** instead: tap as the seconds hand hits 12 and Escapement compares it with internet time from the server. A few checks since you last set the watch give its drift in s/month. Mechanical watches get time checks too, which show how they keep time on the wrist.
- **Acoustic quartz test:** a quartz watch's seconds hand is stepped by a tiny motor, and each step clicks. Escapement times those clicks for 5–20 minutes, checks the computer's sound-card clock against internet time as it goes (a sound card can be off by 25–130 s a month, more than the watch), and reports the rate in s/month with an honest ±. A low battery or low solar charge shows up as 2-second steps and is flagged. A one-off 30-minute **calibration** pins the sound card down for every later test.
- **Battery log:** record battery (or rechargeable cell) changes on quartz, solar and kinetic watches; cards warn when a battery is getting old or a test heard 2-second steps.
- **Movement library:** one entry per caliber, built as you add watches: specs (maker, beat rate, lift angle, jewels, size) from you or from AI identification, plus your own timing results across every watch with that movement. Each entry links to [Ranfft DB](https://ranfft.org), the community movement encyclopedia, for reference. Escapement doesn't copy Ranfft's data.
- **Simulated watch:** try everything without a watch. Set rate, beat error, amplitude and noise, and listen to it tick.

## Online collection (optional)

Escapement is local-first: everything lives in your browser and works offline. On a hosted deployment, you can also sign in with GitHub to keep your watches, photos and readings **in sync across devices**, backed up in a **private** Vercel Blob store. Only one GitHub account, the owner's, can sign in.

To set it up on your own Vercel deployment:

1. **Create a private Blob store** in the Vercel project (Storage → Create → Blob, access *Private*). Connecting it adds the storage credentials.
2. **Create a GitHub OAuth app** (GitHub → Settings → Developer settings → OAuth Apps → New):
   - Homepage URL: `https://<your-app>.vercel.app`
   - Authorization callback URL: `https://<your-app>.vercel.app/api/auth/callback`
3. **Add environment variables** to the Vercel project, then redeploy:

   | Variable | Value |
   | --- | --- |
   | `GITHUB_CLIENT_ID` | from the OAuth app |
   | `GITHUB_CLIENT_SECRET` | from the OAuth app (generate a client secret) |
   | `OWNER_GITHUB` | your GitHub username, the only account allowed in |
   | `SESSION_SECRET` | a long random string, e.g. `openssl rand -base64 48` |

How it works: small Vercel Functions in `api/` handle sign-in (a signed, HttpOnly session cookie; no database) and sync. Each record is a JSON document in the private store, and deletions leave a tombstone so they reach other devices. The app tracks local changes with IndexedDB hooks and keeps them on the device until you press **Sync** (in the top bar or on the Data page); a sync pushes them and pulls whatever changed online since the last sync. Sync never runs on a timer, because each one lists the Blob store and that counts against Vercel Blob's advanced-operation quota. The newer version wins.

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

**Amplitude** comes from the lift time: each beat is split into its sub-clicks (unlock, impulse, drop), each timed at half its own peak, and the gap from unlock to drop gives `A = LA / (2·sin(π·t/T))` with the movement's lift angle LA. The median over the window is shown. When the unlock click is too faint to time on single beats, amplitude is read from the **average of a few hundred aligned beats** instead (noise falls by about √n): each tick's envelope snippet starts 24 ms before the loud click, because on real vintage watches the unlock came 13–14 ms before the drop at under a tenth of its height.

**Quartz:** with a 400 ms dead time, the same detector bank hears the stepping motor; a fit of `t = a + b·n + c·s` (s = ±1 for the motor's alternating polarity) gives the watch's second. Every 3 s the browser asks `/api/time` for the server's clock, timing the round trip on the sound card's clock (interpolated with `getOutputTimestamp`), and a robust line through (server − sound card) gives the sound card's error in ppm, which is subtracted. Calibrations are stored per output device and combined by inverse variance.

**Audio dropouts:** on a busy computer the browser's audio can stall for a moment: the sound card's clock pauses while real time goes on, and every later click shifts. The quartz test watches the gap between the sound card's clock and the computer's several times a second; a jump that holds is a dropout. Both the rate fit and the clock fit then give each unbroken stretch its own offset and share only the slope, so a test survives stalls instead of reporting nonsense. Clock corrections outside what a real sound card can do (±400 ppm) are never applied, the test uses bigger audio buffers to make stalls rarer, and **Download diagnostics** on the result saves the raw timings for troubleshooting.

**Shape-matched timing:** the detector stamps each tick where its first click crosses a threshold, but in noise that quiet first click is sometimes missed and the stamp lands on the next click, a few ms late. So every tick is then aligned by normalised cross-correlation (0.1 ms envelope bins, parabolic sub-bin interpolation) against a running template of the beat. Ticks that don't resemble a beat are dropped.

**Noise reduction** (optional) is an STFT spectral subtraction ahead of the detectors: 2048-sample frames (fine enough to separate 50 Hz harmonics), 75% overlap, a per-bin background tracker that falls fast and rises slowly, and gain `max(floor, 1 − α·noise/power)`. It is exactly transparent when off.

Ticks are timestamped on the audio thread against the sample clock, so timing isn't affected by UI jank. Each tick gets a beat index *n* and a side (tic/toc). Escapement then fits

```
t = a + b·n + c·s        s = ±½ for tic/toc
rate       = 86400 · (P / b − 1)   s/day     (P = nominal beat period)
beat error = |c|                    ms
```

with robust outlier rejection, so a bump on the table or a missed tick doesn't throw the reading off.

## Getting a clean reading

- Use a quiet room, with the watch dial-up on a soft cloth and the case touching the microphone.
- A cheap **piezo contact pickup** clipped to the case works far better than a built-in mic. Clip it to the case side at 9 (or a lug), sensor pad on bare metal; not the crown, strap or crystal. Measure and Pickup Lab show a diagram.
- **Turn the input up.** A piezo pickup on a computer's mic jack is very quiet. On a real setup (a PC's rear mic jack), the noise sat at −82 dBFS and the ticks barely rose above the sound card's own floor. Setting the input to 100 with **Microphone Boost +20 dB** took single ticks from 3× to 10× the background, and auto-tune went from no lock to a solid one. +30 dB was no better (the noise rose too). A Hi-Z instrument input (a USB audio interface's guitar input) suits a piezo best.
- Use the rear jack on a desktop: the front-panel jack picked up far more hiss and buzz.
- Leave **Noise reduction** off unless there's a steady hum or whine; on plain hiss it adds false ticks.
- Wait until the dots form two tidy lines, then let it run 30–60 seconds.
- No ticks at all? Check the watch is running: an automatic left still stops after a day or two. Give it a few gentle swings.
- Quartz clicks are quieter: if the case side doesn't work, press the sensor pad to the centre of the caseback.
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
  views/      measure, watches, watch detail/form, movements, data
  sync/       online sync engine and its UI
  lab/        Pickup Lab page
  db.ts       Dexie schema
api/          Vercel Functions: GitHub sign-in, sync, photos (private Blob)
scripts/      offline clip analyser
tests/        detector, analysis, API and sync tests
```

## Pickup Lab

A companion page at **/lab** for checking a pickup or microphone before measuring a watch. It lists every input the browser can see and shows whether the browser left voice processing on. It draws the live level, spectrum and waveform, and runs three short tests:

1. **Background noise:** the noise floor and mains hum.
2. **Tap test:** proves the pickup is actually feeding this input.
3. **Watch test:** locks onto a running watch and reports signal-to-noise, clean beats, rate, beat error, amplitude and the best filter.

You get a verdict and advice for each input, with a table to compare them. **Use this input in Escapement** carries the winner over to the main app.

## Tuning on real recordings

The **Record 10 s clip** button in the Signal panel (and **Record 60 s** in Pickup Lab, for quartz) saves the raw input as a WAV file. Analyse it offline with exactly the app's pipeline:

```bash
npm run analyze-clip -- escapement-clip.wav [--bph 28800] [--lift 52] [--nr]
npm run analyze-clip -- quartz-clip.wav --quartz
```

It prints what each auto-tune detector heard, which one locked, and the resulting rate, beat error and amplitude (per tick and from the averaged beat). With `--quartz` it finds the stepping motor's clicks, the step length and the rate against the sound card's clock. Recordings of awkward watches are very welcome as issues.

## Roadmap

- [x] Rate, beat error, auto beat rate, paper trace
- [x] Watch collection and measurement log, export/import
- [x] Amplitude (unlock→drop timing with per-watch lift angle)
- [x] Guided six-position test with averaged rate and delta
- [x] Clip recorder and offline analyser
- [x] Pickup Lab for testing inputs
- [x] Tested on real watches with a contact pickup (two vintage 21,600 bph automatics/hand-winders and a solar quartz)
- [x] Acoustic quartz test with sound-card clock calibration, battery log
- [ ] Service-due hints from amplitude trend
- [ ] Installable PWA / offline
- [x] Optional online collection: GitHub sign-in, manual sync of watches, photos and readings across devices (local-first stays the default)
- [ ] Public share page for chosen watches

## Licence

MIT © Charl Fourie
