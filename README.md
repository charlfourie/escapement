<p align="center">
  <img src="docs/media/welcome.png" alt="Escapement's welcome page: 'Listen to your watches', with a drawn watch wired to a pickup and a live trace" width="100%">
</p>

<h1 align="center">Escapement</h1>

<p align="center">
  <b>A free, open-source timegrapher that runs in your browser.</b><br>
  Clip a pickup to a watch and Escapement listens to it tick: how fast it runs, how evenly it beats, how far its balance swings.<br>
  Quartz watches too. Every test is kept, watch by watch.
</p>

<p align="center">
  <a href="https://escapement-amber.vercel.app"><img alt="Try it live" src="https://img.shields.io/badge/try_it-live-7cf2a5?style=for-the-badge&labelColor=13201a"></a>
  <img alt="Version 0.6" src="https://img.shields.io/badge/version-0.6-7cf2a5?style=for-the-badge&labelColor=13201a">
  <img alt="No install" src="https://img.shields.io/badge/install-none-7cf2a5?style=for-the-badge&labelColor=13201a">
  <img alt="MIT licence" src="https://img.shields.io/badge/licence-MIT-7cf2a5?style=for-the-badge&labelColor=13201a">
</p>

<p align="center">
  <a href="#-measure-a-watch">Measure</a> ·
  <a href="#-your-collection">Collection</a> ·
  <a href="#-the-most-over-engineered-image-placeholder-ever">Placeholder</a> ·
  <a href="#-quartz-watches-too">Quartz</a> ·
  <a href="#-3000-movements">Movements</a> ·
  <a href="#-every-test-logged">Log</a> ·
  <a href="#-pickup-lab">Pickup Lab</a> ·
  <a href="#-getting-a-clean-reading">Tips</a> ·
  <a href="#-under-the-hood">How it works</a>
</p>

---

No app, no account, no hardware beyond an inexpensive clip-on pickup (or a quiet room and your laptop's mic). Your data stays in your browser, with optional sync across devices. Don't have a watch to hand? There's a **simulated watch** built in, so you can try everything right now. And every watch without a photo gets [the most over-engineered image placeholder ever](#-the-most-over-engineered-image-placeholder-ever).

> **A hobbyist's tool, not a bench timegrapher.** Escapement is for watch lovers keeping an eye on their own watches: is it gaining or losing, is it in beat, has its amplitude dropped since last month? It's not a replacement for a professional timegrapher on a watchmaker's bench. An inexpensive pickup and a computer's sound card can't match a purpose-built microphone and clock, so Escapement goes for a steady, honest reading, with a ± when the signal is noisy, over false precision. In a quiet setup the rate is repeatable to a second or two a day, and amplitude is the roughest figure. Treat the results as a good guide and a way to spot trends, and leave service decisions to a watchmaker.

## 🎧 Measure a watch

<p align="center"><img src="docs/media/measure.gif" alt="Measuring a simulated watch: the trace builds two neat lines sloping gently up while the readouts settle on +4.1 s/d, 0.8 ms and 262°" width="100%"></p>

Press **Start** and the classic paper trace draws itself, one dot per tick. Flat means accurate, a slope means gaining or losing, and two separate lines mean beat error.

- **Rate** in s/day, **beat error** in ms, **amplitude** in degrees, and the **beat rate** found for you (14,400 to 36,000 bph)
- **Auto-tune** listens through 12 filter and trigger combinations at once and locks onto whichever hears a clean beat. No sliders.
- **Built for noise:** every tick is shape-matched against the average beat, so a missed click doesn't throw the reading off. Optional noise reduction handles fans and hum.
- **Readouts that settle:** the numbers show a steady figure with an honest ± (tenths only when the signal earns them), hold through a brief loss of the beat instead of blanking, and still follow a real change within seconds. Stray ticks are kept off the trace (one tick to show them all), and the tick panel shows the averaged beat, with the unlock, impulse and drop clicks clearly separated.
- **Six-position test:** dial up, dial down and four crown positions, guided, with the average rate and positional delta

## ⌚ Your collection

<p align="center"><img src="docs/media/collection.png" alt="A grid of five watches, each with a drawn face showing the real time: a blue sunburst Citizen, a green Promaster, a rose-gold rectangular dress watch, a gold Rotary with small seconds and a black Seiko diver" width="100%"></p>

Add your watches with photos, calibre and service dates, and each gets its rate-over-time chart (with the COSC band), positional delta and the stored trace of every reading. No photo? See [below](#-the-most-over-engineered-image-placeholder-ever). Please do.

<p align="center"><img src="docs/media/watch.png" alt="A watch's page: specs, five stat cards and the rate-over-time chart climbing into the COSC band after a regulation" width="100%"></p>

**Identify with AI, free:** photograph the caseback, movement and dial, and Escapement suggests the brand, reference, calibre, beat rate, lift angle and production date, with sources. Copy the request into the Claude or Gemini app you already use, or use your own free Gemini key. Nothing is billed.

## 🎩 The most over-engineered image placeholder ever

<p align="center"><img src="docs/media/placeholders.gif" alt="A drawn watch face redesigning itself nine times: a worn gold Rotary, a Seiko diver, a rose-gold rectangular dress watch, a 1970s TV case, a pocket watch on a chain, a cushion Eco-Drive, an octagonal 28,800 bph watch, a champagne oval and a gliding Spring Drive" width="320"></p>

A watch without a photo needs a picture. It needed a small grey square. It got this:

| What the placeholder does | Strictly necessary? |
| --- | --- |
| Shows the real time, live | *No* |
| Seconds hand beats at the watch's own rate: 6 beats a second at 21,600 bph | *No* |
| Quartz steps once a second; Spring Drive glides | *Absolutely not* |
| Shows the time your watch actually says, from your time checks | *No* |
| A crown you can pull to set the hands, which hacks only if the real movement does | *Not remotely* |
| The dial ages with its movement: patina, tropical dials, old lume, a scratched acrylic crystal | *No* |
| 9 case shapes (pocket watch included, chain and all), 4 metals, any dial colour, 4 finishes, 5 marker styles, 3 bezels, 4 straps | *No* |
| Stands in for a photo of the watch | **Technically, yes** |

**It has a designer.** Of course it does. Nine case shapes: round, a proper pillow-shaped cushion, oval, square, a 1970s TV case, rectangular, tonneau, octagonal, and a pocket watch with a bow and a chain, picked automatically when the movement is too big for a wrist. Then the metal, dial colour and finish, markers, hands, small seconds, diver or coin-edge bezel, strap or bracelet, date window, power reserve and how old it should look, with a live preview. Anything you leave alone keeps following the watch, and the drawn face can stand in for a photo you do have.

<p align="center"><img src="docs/media/designer.gif" alt="The face designer: the preview changes case shape (round, cushion, rectangular, tonneau, octagonal), metal, dial colour, markers, finish, seconds and strap" width="80%"></p>

<p align="center"><img src="docs/media/shapes.png" alt="The same blue sunburst dial in nine cases: round, cushion, oval, square, TV, rectangular, tonneau, octagonal and a pocket watch on a chain" width="100%"></p>

**It knows what your watch says.** On a watch's page the face can show *Watch time*: not the real time, but what your actual watch reads right now, worked out from your time checks since you last set it and its measured drift. A Rotary at +7 s/day set 9 days ago reads a minute fast, so its drawing does too.

**It has a crown, and the crown is accurate.** Pull it and drag the hands to set them. The seconds hand stops only if the movement **hacks**: a Seiko 7S26 doesn't, so its drawing doesn't either, and its seconds keep running while you set it. Push the crown in and the hands carry on from where you left them, a little behind if the seconds were stopped. Like a real watch.

<p align="center"><img src="docs/media/watch-time.gif" alt="The Rotary's face switches to Watch time and jumps a minute fast, then the crown is pulled and the minute hand dragged round while the seconds hand keeps running" width="70%"></p>

**It ages.** The dial ages with its movement's production year from the reference library. A 1970s calibre gets some patina; one from before 1970 is well worn, with a yellowed or sun-faded "tropical" dial, aged lume and a hazy, lightly scratched acrylic crystal.

<p align="center"><img src="docs/media/ages.png" alt="Two watch faces at three ages: like new, some patina and well worn. The cream dial yellows; the black dial fades to a tropical brown with aged lume" width="80%"></p>

None of this measures anything.

## 🔋 Quartz watches too

<p align="center"><img src="docs/media/quartz-watch.png" alt="A solar Citizen Promaster: two quartz tests at +1.1 and +1.4 s/month, and time checks showing a drift of +1.3 s/month" width="100%"></p>

A timegrapher can't read quartz, so Escapement does it another way:

- **Acoustic quartz test:** the seconds hand's stepping motor clicks. Escapement times those clicks for 5 to 20 minutes and gives the rate in **s/month with an honest ±**. It checks your computer's sound-card clock against internet time as it goes, because the sound card can drift more than the watch.
- **Low battery or charge** shows up as 2-second steps, and gets flagged.
- **Time checks:** tap as the seconds hand hits 12, and Escapement compares it with internet time. A few checks give the drift. Mechanical watches get them too, for how they keep time on the wrist.
- **Battery log** for quartz, solar and kinetic watches

## 🔎 3,000 movements

<p align="center"><img src="docs/media/movements.png" alt="The reference library searched for Seiko: the 7S26 tagged Tested, then the NH35A, 4R35, 6R15 and 6R35 with 53° lift angles, followed by archive entries" width="100%"></p>

A searchable reference library of about **3,000 calibres**:

- **About 40 modern workhorses** (ETA, Sellita, Seiko, Miyota, Rolex, Omega and more), each with a cited source and its **lift angle**, which amplitude depends on. Lift angles are only listed where a source documents them, never guessed.
- **Nearly 3,000 more**, many of them vintage Swiss and German, from [Watch Movements Archive](https://watch-movements-archive.com/) by the UHRFORUM.de community, used with permission: beat rate, jewels, size, power reserve, production years and how to identify each one.
- Type a calibre in the watch form ("NH35", "ETA 2824", "Citizen 8200") and its beat rate, type and lift angle fill in.
- Movements you've measured are tagged **Tested**.

Don't know what's inside a watch? **Find the movement** narrows it down by the watch's brand, winding and the beat rate Escapement measured:

<p align="center"><img src="docs/media/finder.gif" alt="Finding a Rotary's movement: typing 'AS 1726' shows the match with its identification tip, and 'This is it' sets the watch's calibre" width="100%"></p>

## 📒 Every test logged

<p align="center"><img src="docs/media/log.png" alt="The Log: six-position test, timegrapher readings, quartz tests and time checks across five watches, with filters and CSV export" width="100%"></p>

Every valid reading, six-position set and quartz test saves itself the moment it ends, to the watch you chose or to the **Log** to file later. Filter by watch and type, edit notes, export to CSV, or back everything up as JSON.

## 🔌 Pickup Lab

<p align="center"><img src="docs/media/lab.png" alt="Pickup Lab hearing a simulated pickup: level meter, spectrum with the 2 to 8 kHz tick band shaded, waveform, and 'Hearing a watch: 28,800 bph, 99% match'" width="100%"></p>

A companion page at **/lab** for checking a pickup or mic before you measure. It lists every input the browser can see, draws the live level, spectrum and waveform, and runs three quick tests: background noise, a tap test to prove the pickup feeds this input, and a watch test. You get a verdict per input, a comparison table, and one tap to use the winner. It also shows exactly **where to clip the pickup**.

## 💡 Getting a clean reading

- An inexpensive **contact pickup** beats any built-in mic. Clip it to the case side at 9 (or a lug), sensor pad on bare metal. Not the crown, strap or crystal.
- **Turn the input up.** A piezo pickup on a computer's mic jack is often very quiet. Set the input level high and try the sound card's **microphone boost**; more boost isn't always better, since it raises the noise too. Pickup Lab shows when the level is right. A Hi-Z input (a USB audio interface's guitar input) suits a piezo best.
- Use the **rear jack** on a desktop: the front panel picks up far more hiss.
- A quiet room, the watch dial up on a soft cloth, cable slack. Wait for two tidy lines, then let it run 30 to 60 seconds.
- Leave **noise reduction** off unless there's a steady hum or whine.
- Quartz clicks are quieter: if the case side doesn't work, press the pad to the centre of the caseback.
- No ticks at all? An automatic left still stops after a day or two. Give it a few gentle swings.
- Microphone access needs HTTPS (or `localhost`).

## 🔬 Under the hood

<details>
<summary><b>How the timing works</b></summary>

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

**Shape-matched timing:** the detector stamps each tick where its first click crosses a threshold, but in noise that quiet first click is sometimes missed and the stamp lands on the next click, a few ms late. So every tick is then aligned by normalised cross-correlation (0.1 ms envelope bins, parabolic sub-bin interpolation) against a running template of the beat. Ticks that don't resemble a beat are dropped.

**Amplitude** comes from the lift time: each beat is split into its sub-clicks (unlock, impulse, drop), each timed at half its own peak, and the gap from unlock to drop gives `A = LA / (2·sin(π·t/T))` with the movement's lift angle LA. The median over the window is shown. When the unlock click is too faint to time on single beats, amplitude is read from the **average of a few hundred aligned beats** instead (noise falls by about √n): each tick's envelope snippet starts 24 ms before the loud click, because on real vintage watches the unlock came 13–14 ms before the drop at under a tenth of its height.

**Noise reduction** (optional) is an STFT spectral subtraction ahead of the detectors: 2048-sample frames (fine enough to separate 50 Hz harmonics), 75% overlap, a per-bin background tracker that falls fast and rises slowly, and gain `max(floor, 1 − α·noise/power)`. It is exactly transparent when off.

</details>

<details>
<summary><b>How the quartz test works</b></summary>

With a 400 ms dead time, the same detector bank hears the stepping motor; a fit of `t = a + b·n + c·s` (s = ±1 for the motor's alternating polarity) gives the watch's second. Every 3 s the browser asks `/api/time` for the server's clock, timing the round trip on the sound card's clock (interpolated with `getOutputTimestamp`), and a robust line through (server − sound card) gives the sound card's error in ppm, which is subtracted. Calibrations are stored per output device and combined by inverse variance.

**Audio dropouts:** on a busy computer the browser's audio can stall for a moment: the sound card's clock pauses while real time goes on, and every later click shifts. The quartz test watches the gap between the sound card's clock and the computer's several times a second; a jump that holds is a dropout. Both the rate fit and the clock fit then give each unbroken stretch its own offset and share only the slope, so a test survives stalls instead of reporting nonsense. Clock corrections outside what a real sound card can do (±400 ppm) are never applied, the test uses bigger audio buffers to make stalls rarer, and **Download diagnostics** on the result saves the raw timings for troubleshooting.

</details>

<details>
<summary><b>Online collection (optional sync)</b></summary>

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

</details>

<details>
<summary><b>Tuning on real recordings</b></summary>

The **Record 10 s clip** button in the Signal panel (and **Record 60 s** in Pickup Lab, for quartz) saves the raw input as a WAV file. Analyse it offline with exactly the app's pipeline:

```bash
npm run analyze-clip -- escapement-clip.wav [--bph 28800] [--lift 52] [--nr]
npm run analyze-clip -- quartz-clip.wav --quartz
```

It prints what each auto-tune detector heard, which one locked, and the resulting rate, beat error and amplitude (per tick and from the averaged beat). With `--quartz` it finds the stepping motor's clicks, the step length and the rate against the sound card's clock. Recordings of awkward watches are very welcome as issues.

</details>

<details>
<summary><b>The movement data</b></summary>

Escapement's own reference entries live in `src/data/movements.ts`, each with its source. The archive entries in `src/data/archive.json` are built by `scripts/import-archive.ts` from a crawl of Watch Movements Archive (done with the admin's permission), keeping only the facts a timegrapher needs: no photos or descriptions. Every entry links back to its archive page. Cylinder, pin-lever and tuning-fork movements get a note on what a timegrapher can and can't read. **Links & sources** in the app's footer lists every site the data is based on. Each movement also links to [Ranfft DB](https://ranfft.org), the community movement encyclopedia; Escapement doesn't copy Ranfft's data.

</details>

## 🛠️ Development

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # analysis tests against the simulated watch
npm run build      # type-check + production build into dist/
```

Vite and TypeScript with no framework, the Web Audio `AudioWorklet`, and Dexie (IndexedDB). It deploys as a static site to Vercel, Netlify or GitHub Pages.

<details>
<summary>Project layout</summary>

```
src/
  audio/      detector (worklet-safe), simulated watch, worklet, engine
  analysis/   beat-rate detection, fit, trace
  ui/         canvas trace + waveform, SVG history chart
  data/       reference movements (sourced specs, Watch Movements Archive import, caliber matching)
  views/      measure, watches, watch detail/form, movements, data
  sync/       online sync engine and its UI
  lab/        Pickup Lab page
  db.ts       Dexie schema
api/          Vercel Functions: GitHub sign-in, sync, photos (private Blob)
scripts/      offline clip analyser; Watch Movements Archive importer
tests/        detector, analysis, API and sync tests
docs/media/   README screenshots and GIFs
```

</details>

## 🗺️ Status and roadmap

**v0.6, in active use.** Tested on real watches with an inexpensive clip-on pickup: a 1970s hand-wound Rotary, a 1976 Citizen automatic and a Citizen Eco-Drive. What those recordings taught (turn the input up, where to clip the pickup, quiet unlock clicks, audio dropouts during long quartz runs) is built into the app.

**Done**

- [x] **Live timegrapher:** rate, beat error, amplitude, auto beat rate, paper trace
- [x] **Your collection:** watches, every test saved, the Log, export and backup
- [x] **Six-position test, Pickup Lab** and the offline clip analyser
- [x] **Tested on real watches:** auto-tune, readouts that settle with an honest ±, surviving a lost beat
- [x] **Quartz:** acoustic test with sound-card clock calibration, time checks, battery log
- [x] **Movements:** reference library of ~3,000 calibres, Find the movement, free AI identification
- [x] **The most over-engineered image placeholder ever**
- [x] **Optional sync** across devices

**Next**

- [ ] **Pickup comparison and calibration:** record the same watch through several pickups and compare them side by side; each input remembers its own best settings, and the recordings become a test set for tuning detection. Plus an install option, so it can live on your home screen with its own icon.
- [ ] **Service hints:** trends from your history, like amplitude falling or the rate drifting since the last service
- [ ] **Public share page** for chosen watches and their results

**Later, for fun**

- [ ] A display caseback with the balance swinging at the measured amplitude, and each watch's own recorded tick
- [ ] A ridiculously formal certificate for six-position tests that land within chronometer limits

## Licence

MIT © Charl Fourie

The movement facts in `src/data/archive.json` come from [Watch Movements Archive](https://watch-movements-archive.com/) and the UHRFORUM.de community, used with the site admin's permission. They aren't covered by the MIT licence; ask the archive before reusing them. Escapement's own reference entries in `src/data/movements.ts` cite their sources.
