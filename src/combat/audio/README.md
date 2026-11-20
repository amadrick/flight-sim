# Combat audio (`src/combat/audio/`)

This module covers weapon sounds, warning tones, explosions, other jets, radio voice and an original adaptive rock score. Everything is synthesised with Web Audio: no samples, no files, no network. It shares the simulator's AudioContext and master bus (see `INTEGRATION.md`). Until the context exists and is running, every call is a silent no-op. Nothing touches Web Audio or the DOM at module top level.

| file | what |
|---|---|
| `index.js` | `createCombatAudio(combat)`: wiring (events → sounds, per-frame state → warnings, jets, music mood), buses, settings |
| `sfx.js` | rotary-cannon voice, gun tail, missile launch, flare, airframe hits, hit-confirm tick, near-miss crack, explosions, fly-by; `createPool` (voice cap) |
| `warnings.js` | seeker tones (IR / radar, search / lock), RWR chirps, missile-launch warning, fire bell, blips (no lock, target tick, low ammo, Winchester, dry click, caution) |
| `radio.js`, `radio-queue.js` | `speechSynthesis` voice casting per role, queue (pre-emption, staleness), squelch / static / roger-beep framing, formant "murmur" fallback |
| `jets.js` | 3 shared engine-presence voices for the nearest aircraft (Doppler, distance, directivity, pan) and fly-by detection |
| `music/` | `theory.js`, `cues.js` (the score), `arranger.js` (sections, fills), `mood.js` (game state → mood), `clock.js` (look-ahead), `synth.js` (instruments), `engine.js` (sequencer) |
| `analyze.js`, `harness*.js`, `run-harness.mjs` | offline measurement harness |
| `*.test.js`, `tests.mjs` | `node --test src/combat/audio` |

## API

`createCombatAudio(combat) → api`:

- `update(dt)` (kept from the original contract)
- `setMusicVolume(0..1)`, `musicVolume` (default 0.8)
- `musicEnabled` (get/set), `setMusicEnabled(bool)`. The URL parameter `music=0` starts with music off.
- `setRadioVoice(bool)`, `radioVoice`. Speech synthesis on/off; the URL parameter `radiovoice=0` starts with it off.
- `setRadioVolume(0..1)`, `radioVolume`, `setSfxVolume(0..1)`, `sfxVolume`
- `mood` is the current music mood. `info` gives `{ cue, section, bar, mood, playing, voices, refused, radio, seeker }`, for diagnostics.

New events: none. Optional mission field: `mission.music = 'sweep' | 'nightfall'`.

## Mix

All levels feed the simulator's master (compressor at -16 dB, 8:1, then a tanh limiter).

| source | bus | level / law |
|---|---|---|
| player's gun, launch, flares, hits on the airframe | cockpit `Dual` → `flightIn` | exterior gain `cos(mix·π/2)`; interior `sin(…)·1.0` low-passed at 2.6 kHz |
| explosions, other guns, other launches, fly-bys, engine presence | world `Dual` → `flightIn` | explosions `1/(1+d/400…500)`, guns `1.4/(1+d/180)`, delay `d/340` s (≤ 20 s), air absorption `distCutoff(d)`; interior path 0.55 at 800 Hz |
| warnings | `flightIn` | 1.0 in the cockpit, 0.75 outside |
| radio | `flightIn` | 0.5 × radio volume |
| music | `master` | `MUSIC_LEVEL` 0.17 × music volume (0.8) × `MIX.music` 0.8; × 0.6 while a radio line plays, × 0.75 during a launch warning, × 0.35 paused, × 0.5 menu |

Voice budget:

- One-shots: 24 (`createPool(24)`); an explosion counts as one voice. Warnings use a separate 10-voice pool and radio a 6-voice pool.
- AI guns: at most 3 at once, within 3 km. Engine presence: 3 voices shared by the nearest aircraft.
- Every one-shot disconnects all its nodes when its last source ends. The harness checks this: after 60 explosions, `live` is back to 0.

Event rate limits:

- airframe hits: ≥ 55 ms apart
- hit ticks: ≥ 45 ms apart
- near misses: ≥ 50 ms apart
- player flares: ≥ 60 ms apart
- fly-bys: ≥ 2.5 s apart per aircraft

## Weapons and warnings

- **Gun.** The voice is a pulse-train oscillator at the gun's real rate of fire (`loadout.gun.spec.rof`: M61 100/s, GAU-22 55/s, GAU-8 65/s). Its layers:
  - firing-rate punch (< 260 Hz) and a low-mid body
  - per-round "bite": white noise ring-modulated by the pulse train and high-passed at 2 kHz
  - barrel whine (6.8 × rof)
  - soft saturation

  The pitch follows `loadout.gun.spin`, so spin-up and spin-down come from the weapons model. On release, the rate drops and the gate closes in about 35 ms, then the whine winds down over about 1 s with a low report tail. The GAU-8 (A-10) has a heavier voice: lower filters, more drive, and it is louder. Other aircraft's guns use the same voice, darker, scaled by distance and delayed by the speed of sound.
- **Missile launch.** Rail clunk, then an ignition whump, then a motor of rumble, roar and hiss that recedes: level ∝ 1/(1+(t/0.7)^1.6), the low-pass sweeps from 12 kHz to 1.6 kHz, and the band drops (Doppler).
- **Flare.** Cartridge pop, a thump, then a 1.5 s burning hiss.
- **Hits.**
  - Rounds hitting the player: 1–3 resonant metallic pings (1.7–4.3 kHz), a thud and a crack, scaled by damage.
  - The player's own hits: a 10 ms dry tick at -42 dB, deliberately subtle.
  - Near misses: an N-wave crack plus a falling whizz.
- **Explosions.** Crack, a brown-noise body under a falling low-pass, a sub thump, a crackling debris tail (thresholded band noise) and a rolling rumble.
  - Missile kills are bigger.
  - A missile kill that already had its warhead blast gets an airframe-breakup layer 0.22 s later.
  - Wreck impacts are deeper and longer.
  - The player's own death is left to the simulator's crash audio.
- **Warnings.** Each tone is distinct:

  | warning | sound |
  |---|---|
  | IR search | growl: 430 Hz triangle with noise frequency modulation and 23 Hz sawtooth amplitude modulation |
  | IR lock | clean 1250 Hz sine |
  | radar search | 880 Hz square pulsed at 5 Hz |
  | radar lock | steady 1560 Hz filtered square |
  | RWR lock | 3 rising chirps (2.2–3.1 kHz) every 1.05 s |
  | missile launch | 1360/960 Hz alternating square bursts, faster once the missile is active or within 3 km |
  | fire | two-partial bell, 440 Hz |
  | no lock | descending 330 → 220 Hz blips |
  | target change | a tick |
  | low ammo / Winchester / caution | beeps and chimes |
  | dry fire | a click |

  `player.lock` is read every frame. Threats come from `weapons.threatsTo(player)`; without it, the code falls back to `missiles[].target`.

## Radio

- Each role (`awacs`, `lead`, `wingman`, `enemy`, `tower`, `player`) gets its own pitch, rate and installed voice. Voices are the English ones, sorted by name, then picked per role.
- The queue holds at most 4 lines.
  - Urgent lines (priority 2) pre-empt the line on air.
  - A line is dropped after waiting 5 s (priority 0), 7 s (priority 1) or 3.5 s (priority 2).
  - Duplicates within 2.5 s are ignored.
- Each line has the same framing: a squelch click, then a band-limited static bed with crackle while it plays, then a roger beep for friendly roles and a squelch tail.
- The `enemy` role has a narrower band, more static and no roger beep.
- Without speech (unsupported, no voices, or `setRadioVoice(false)`), a formant murmur plays for the line's estimated duration. It is a sawtooth source through two formant filters that jump between vowel shapes, gated in syllables, with consonant noise, radio band-pass and drive. Chatter is still felt.
- Nothing is spoken while paused or in menus.

## Music

The direction was post-grunge arena rock crossed with an 80s action anthem. **All of it is original, written for this game.** The material is written out below so it can be checked.

### Instruments (all synthesised, `music/synth.js`)

- **Rhythm guitar.** Double-tracked: left and right are detuned differently and the right side plays 9 ms late.
  - Each side: 3 strings × 2 band-limited saws, then a pick transient, then pre-EQ (HP 120 Hz, +6 dB at 850 Hz, and a "palm" low-pass that closes to about 520 Hz for mutes).
  - That feeds an asymmetric tanh waveshaper (2× oversampled).
  - Then a cab filter: HP 95 Hz, +2.5 dB at 240 Hz, +6 dB presence at 2.6 kHz, −5 dB low shelf at 160 Hz, and two LP 4.8 kHz stages (24 dB/oct).
  - Power-chord voicings (root, 5th, octave); palm mutes drop the octave.
- **Lead guitar.** Monophonic voice:
  - two saws plus an octave sine for feedback bloom (flag `f`)
  - glide, bends into notes from a tone or semitone below (flags `b` / `s`)
  - delayed vibrato (flag `v` = wide)
  - +7 dB at 1.3 kHz before a high-gain shaper, then the cab filter
  - sends to a tempo-synced ping-pong delay (dotted eighth) and a hall reverb

  A second instance plays the harmonised twin lead a diatonic third below.
- **Clean guitar.** Karplus-Strong plucks rendered once per note, with all-pass fine tuning and a pick-position comb, through a stereo chorus.
- **Picked bass:** saw + square + sine sub through a tracking low-pass, with a pick click.
- **80s synth layer:** synth bass pulse, a bright 8-saw pad with slow filter sweep, a plucky square/saw arpeggio and a noise riser.
- **Drums:**
  - kick: pitched sine with a beater click
  - snare: noise plus a two-mode body, sent into a gated reverb that opens on each hit and shuts after 0.2 s (80s gated snare)
  - hats/open hat, ride, three toms, crash
  - room reverb
- **Mix:** kicks duck the sustained layers (side-chain pump: 0.55 → 1 over about 0.1 s). The reverbs are feedback-delay networks: pre-delay, two all-pass diffusers, 4 damped combs per side with one-pole IIR damping so the loop gain stays below 1. Then a glue compressor and a high-pass at 30 Hz.

### Cue 1, "Sweep": D minor, drop-D guitars, 132 BPM, 16 steps per bar (bar = 1.818 s)

| section | bars | chords (one per bar) | parts |
|---|---|---|---|
| calm | 8 | Dm(add9) Dm(add9) B♭maj7 B♭maj7 Gm Gm Asus4 A | clean guitar arpeggio, pad, soft synth-bass pulse, ghost hats |
| tension | 4 | D5 D5 B♭5 C5 | muted 8th chugs, toms, root 8ths, pad, synth arp pulse, riser in the last bar |
| riff (fight) | 8 | riff cells A B A B A B C D (D5 … B♭5 C5) | full band; bass doubles the riff |
| riff2 | 8 | as riff | + synth arp, counter-line lead |
| bridge | 4 | B♭5 C5 G5 A5 | ringing chords, ride, arp, riser |
| chorus (hero) | 8 | B♭ C F Dm \| B♭ C F A | ringing chords, drive bass, pad, arp, **lead hook**, crash-led |
| chorus2 | 8 | as chorus | bars 5–8: **twin lead in thirds** |
| danger | 4 | D5 E♭5 D5 C5 | half-time (snare on 3), darker pad, wailing bent-note lead |
| win | 4 | B♭→C (half bars), then D major held | snare/kick hit, lead climbs to F♯ (the major third) and holds |
| lose | 4 | Dm Gm Dm Dm | clean guitar, dark pad, lead descends A G B♭ A D |

**Main riff** (16th steps; semitones above low D, so 0 = D2; r = ringing, m = palm-muted):

- A: 0r ·0m 0m | 3r ·0m 0m | 5r · · 3m | 0m 0m 7r ·
- B: 0r ·0m 0m | 7r ·0m 0m | 8r ·7r · | 5r ·3r ·
- C (over B♭): 8r · · 8m | 8m 8m 8r · | 8m 8m 7r · | 8r (held)
- D (over C): 10r · · 10m | 10m 10m 10r · | 12r (held) | 12m 12m 12r ·

**Lead hook** (chorus, one line per bar; 16th-step positions and lengths, b = bend, v = vibrato, f = bloom):

```
B♭: D5(0,6,b)  C5(6,2)   D5(8,4)   F5(12,4)
C : E5(0,8,v)  G5(8,8,bv)
F : A5(0,10,vf) G5(10,2) F5(12,4)
Dm: F5(0,4)    E5(4,4)   D5(8,8,v)
B♭: D5(0,6,b)  C5(6,2)   D5(8,4)   F5(12,4)
C : E5(0,6)    F5(6,2)   G5(8,8,bv)
F : A5(0,6)    B♭5(6,2)  C6(8,4,b) A5(12,4)
A : A5(0,16,vf)   (twin lead a third below in chorus2: C♯5…)
```

### Cue 2, "Nightfall": C minor, drop-C guitars, 108 BPM (bar = 2.222 s), darker and more synth-forward

- Same section plan as Sweep.
- Calm: Cm7 Cm7 A♭maj7 A♭maj7 Fm Fm Gsus4 G. Tension: C5 C5 A♭5 B♭5 with 16th mutes.
- Chorus: A♭ B♭ E♭ Cm | A♭ B♭ E♭ G. Danger: C5 D♭5 C5 B♭5.

**Riff cells** (0 = C2):

- A: gallop of mutes 0m ·0m 0m 0m ·0m 0m, then 3r · 2r ·, then 0m · 0m 0m
- B: as A, then 6r · 5r · 3r (held)
- C (over A♭): 8r (held) 8m ·8m 8m, then 7r (held) 7m ·7m 7m
- D (over B♭): 10r (held 6), 10m 10m, 11r (held), 12r (held)

**Hook:**

```
A♭: C5(0,4)  E♭5(4,4)  G5(8,2)  A♭5(10,6,b)
B♭: F5(0,8,v) D5(8,4)  E♭5(12,4)
E♭: G5(0,12,vf) F5(12,2) E♭5(14,2)
Cm: E♭5(0,4) D5(4,4)   C5(8,8,v)
A♭: C5(0,4)  E♭5(4,4)  G5(8,2)  A♭5(10,6,b)
B♭: F5(0,4)  G5(4,4)   B♭5(8,8,bv)
E♭: G5(0,6)  A♭5(6,2)  B♭5(8,4) C6(12,4,s)
G : B5(0,16,vf)
```

The progressions are common minor-key building blocks (i–VI–VII, VI–VII–III–i, Phrygian ♭II for danger). The riffs, hooks, counter-lines and drum parts were written for this game and do not quote or imitate any existing work.

### Adaptive behaviour (`mood.js` → `arranger.js`)

| mood | when (hysteresis in brackets) | music |
|---|---|---|
| off | no mission | silence (after any sting finishes) |
| calm | no enemy within 25 km | calm |
| tension | an enemy within 25 km | tension |
| fight | an enemy within 6 km, weapons fired in the last 8 s, or the player locked / locked up [held 20 s] | full band enters **on the next bar**: big drum fill over the rest of the current bar, then crash and main riff; then riff → riff2 → bridge → riff … |
| hero | fighting and winning: a player kill in the last 25 s, or the friendly side outnumbers the enemy 2:1 with the player above 60 % health [≥ 16 s] | chorus at the next 4-bar phrase, chorus2 with twin lead, then back to the riff; a chorus is never cut off |
| danger | a missile guides on the player, or health below 35 % [held 5 s] | half-time danger section (big fill in) |
| victory | `mission:end` success | snare roll fill, then the 4-bar held-chord ending, then silence |
| defeat | failure, or the player down | short sombre resolve, then silence |

- Section changes always land on a bar line; the harness found 0 off-grid out of 45.
- The last bar of each section gets a small fill. Mood changes seen before step 8 get a big fill, before step 12 a small one.
- The sequencer schedules 16th steps 250 ms ahead on the AudioContext clock. After a main-thread stall it skips late steps instead of bunching them (`info.skipped`).
- A cue is picked per mission: `mission.music` if set, Nightfall for night start times, otherwise a hash of the mission id.
- On `mission:abort` the music fades out in 0.4 s and the arrangement resets.

## Verification

Run `node src/combat/audio/run-harness.mjs [filter]`. It builds `dist/cbt-audio.html` from `harness.js`, renders the real graph builders through an `OfflineAudioContext` into the simulator's master bus (or the real F-16 rig for the mix scenario), and prints measurements and checks. Run `node --test src/combat/audio` for the pure logic: theory, cue integrity (every note in key and in range, downbeat hook notes are chord tones), arranger transitions, mood hysteresis, clock maths, radio queue and roles, and a no-op import test. The last measured values are in the final report and in the commit log.
