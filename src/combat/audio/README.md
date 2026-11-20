# Combat audio (`src/combat/audio/`)

This module covers weapon sounds, warning tones, explosions, other jets, radio voice and an original adaptive rock score. Everything is synthesised with Web Audio: no samples, no files, no network. It shares the simulator's AudioContext and master bus (see `INTEGRATION.md`). Until the context exists and is running, every call is a silent no-op. Nothing touches Web Audio or the DOM at module top level.

| file | what |
|---|---|
| `index.js` | `createCombatAudio(combat)`: wiring (events → sounds, per-frame state → warnings, jets, music mood), buses, settings |
| `sfx.js` | rotary-cannon voice, gun tail, missile launch, flare, airframe hits, hit-confirm tick, near-miss crack, explosions, fly-by; `createPool` (voice cap) |
| `warnings.js` | seeker tones (IR / radar, search / lock), RWR chirps, missile-launch warning, fire bell, blips (no lock, target tick, low ammo, Winchester, dry click, caution) |
| `radio.js`, `radio-queue.js` | `speechSynthesis` voice casting per role, queue (pre-emption, staleness), squelch / static / roger-beep framing, formant "murmur" fallback |
| `jets.js` | 3 shared engine-presence voices for the nearest aircraft (Doppler, distance, directivity, pan) and fly-by detection |
| `music/` | `theory.js`, `cues.js` (the score), `arranger.js` (song form, sections, fills), `mood.js` (game state → mood), `synth.js` (instruments), `render.js` (offline stem renderer), `engine.js` (live bar scheduler) |
| `perf-live.mjs` | cost on the real game page (stems, scheduler, nodes, frame times) |
| `analyze.js`, `harness*.js`, `run-harness.mjs` | offline measurement harness |
| `*.test.js`, `tests.mjs` | `node --test src/combat/audio` |

## API

`createCombatAudio(combat) → api`:

- `update(dt)` (kept from the original contract)
- `setMusicVolume(0..1)`, `musicVolume` (default 0.8)
- `musicEnabled` (get/set), `setMusicEnabled(bool)`. The URL parameter `music=0` starts with music off.
- `setRadioVoice(bool)`, `radioVoice`. Speech synthesis on/off; the URL parameter `radiovoice=0` starts with it off.
- `setRadioVolume(0..1)`, `radioVolume`, `setSfxVolume(0..1)`, `sfxVolume`
- `mood` is the current music mood. `info` gives `{ cue, section, bar, mood, playing, waiting, fills, risers, cuts, musicVoices, nodes, cpu, stems, voices, refused, radio, seeker }`, for diagnostics.

New events: none. Optional mission field: `mission.music = 'sweep' | 'nightfall'`.

## Mix

All levels feed the simulator's master (compressor at -16 dB, 8:1, then a tanh limiter).

| source | bus | level / law |
|---|---|---|
| player's gun, launch, flares, hits on the airframe | cockpit `Dual` → `flightIn` | exterior gain `cos(mix·π/2)`; interior `sin(…)·1.0` low-passed at 2.6 kHz |
| explosions, other guns, other launches, fly-bys, engine presence | world `Dual` → `flightIn` | explosions `1/(1+d/400…500)`, guns `1.4/(1+d/180)`, delay `d/340` s (≤ 20 s), air absorption `distCutoff(d)`; interior path 0.55 at 800 Hz |
| warnings | `flightIn` | 1.0 in the cockpit, 0.75 outside |
| radio | `flightIn` | 0.5 × radio volume |
| music | `master` | `MUSIC_LEVEL` 0.17 × music volume (0.8) × `MIX.music` 0.8; × 0.45 (−6.9 dB) while a radio line plays, × 0.6 (−4.4 dB) during a missile-launch warning, × 0.35 paused, × 0.5 menu |

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

  The pitch follows `loadout.gun.spin`, so spin-up and spin-down come from the weapons model. On release, the rate drops and the gate closes in about 35 ms, then the whine winds down over about 1 s with a low report tail, a metallic clunk as the feed stops and a ratchet of clicks slowing from half the rate of fire to a stop (0.8 s; 1.1 s for the GAU-8). The GAU-8 (A-10) has a heavier voice: lower filters, more drive, and it is louder. Other aircraft's guns use the same voice, darker, scaled by distance and delayed by the speed of sound.
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

The direction is late-90s/2000s post-grunge arena rock crossed with 80s action-film synth-rock: genre and energy only. **Every note is original, written for this game**; no melody, riff, progression-with-melody or sound reproduces an existing song or film theme. The material is written out below so it can be checked.

### How it plays (`render.js`, `engine.js`)

- At mission load every section of the mission's cue is rendered once in an `OfflineAudioContext` (32 kHz) into two stems, band and drums. The heavy instrument graph (about 80 oscillators, 4× oversampled waveshapers, feedback-delay reverbs) only ever exists offline. The three drum fills and the merge riser are rendered as short one-shots.
- The main-thread part of that work (building the graph, scheduling the notes, copying buffers) is cut into ≤ 3 ms slices that yield to the game through a `MessageChannel`; the rendering itself runs on the browser's audio rendering thread. The first two sections come first, so the music can start, then the fills, then the rest.
- Live, the engine is a bar scheduler on the `AudioContext` clock (0.3 s look-ahead). Each section entry starts one band and one drum `AudioBufferSourceNode` at the bar line, at the right bar offset. A cut section fades with a 30 ms time constant, a section that reached its end rings out on its own tail, and a section entered mid-buffer fades in over 6 ms.
- A fill mutes the drum stem from step 8 (or 12) and plays the fill one-shot. The riser starts mid-bar so it lands on the bar line where the band comes in.
- Steady state is 2–4 buffer sources (16 nodes at most in the harness). A steady frame allocates nothing: the arranger is asked again only when the mood, the push signal or the bar changes.

### Instruments (all synthesised, `music/synth.js`)

- **Rhythm guitar.** Double-tracked and panned hard left and right; the right side is detuned differently and plays 9 ms late.
  - Each side: 3 strings × 2 band-limited saws, then a pick transient, then pre-EQ (HP 120 Hz, +6 dB at 850 Hz, and a "palm" low-pass that closes to about 520 Hz for mutes).
  - That feeds an asymmetric tanh waveshaper (4× oversampled).
  - Then the cab: HP 80 Hz, +2.5 dB at 240 Hz, +6 dB presence at 2.6 kHz, −5 dB low shelf at 160 Hz, and two LP 4.8 kHz stages (24 dB/oct).
  - Drop-D (drop-C) power chords (root, 5th, octave); palm mutes drop the octave and are short filtered envelopes.
  - Held chords get a slow, shallow vibrato (9 cents after 0.45 s). Chorus entries slide up into the first chord. Pick scrapes (noise swept 3.2 kHz → 380 Hz through the amp) lead out of the intro and the solo.
- **Lead guitar.** Monophonic voice:
  - two saws plus an octave sine for feedback bloom (`f`)
  - bends into notes from a tone or semitone below (`b` / `s`), legato slides without a re-pick (`l`), delayed vibrato (`v` = wide)
  - +7 dB at 1.3 kHz before a high-gain shaper, then a cab
  - sends to a dotted-eighth ping-pong delay and a hall reverb

  A second instance plays the harmonised twin lead a diatonic third below.
- **Synth brass.** A mono brass lead doubles the chorus and pre-chorus melodies an octave down: saws, a swelling filter, delayed vibrato and glide, so the line reads as "sung". Poly brass chord stabs (detuned saw pairs, filter swell, pitch scoop) hit in the choruses and the victory tag.
- **FM bell.** Two-operator FM (1:1 tine body plus a 3.5:1 bell partial, decaying index) through a chorus. It carries the calm cue's motif.
- **Clean guitar.** Karplus-Strong plucks with all-pass fine tuning and a pick-position comb, through a stereo chorus.
- **Picked bass:** saw + square + sine sub through a tracking low-pass, with a pick click. It doubles the riffs.
- **80s layer:** a pulsing 16th synth bass and plucky arpeggio under the verse, a bright 8-saw pad, and a noise riser into the pre-chorus and into the first merge.
- **Drums:**
  - kick: three layers (pitched sine, triangle "knock", beater click)
  - snare: noise plus a two-mode body, sent to a gated reverb that opens on each hit and shuts after 0.2 s (80s gated snare)
  - closed and open hats (open in the choruses), ride (solo), three toms (fills into transitions), crash on section starts
  - room reverb
- **Mix:** kicks duck the sustained layers (side-chain pump: 0.55 → 1 over about 0.1 s). The reverbs are feedback-delay networks: pre-delay, two all-pass diffusers, 4 damped combs per side with non-resonant biquad damping so the loop gain stays below 1. Glue compression per stem. Section levels shape the loud-quiet dynamics; the pre-chorus swells from 0.78 to 1.

### Song map

Both cues share one form. Bars are 4/4, 16 steps per bar.

| section | bars | role and layers | level |
|---|---|---|---|
| calm | 8 | FM-bell motif, clean guitar arpeggio, pad, soft synth-bass pulse, ghost hats | quiet |
| tension | 4 | muted 8th/16th chugs, toms, root 8ths, pad, synth arp pulse; riser in the last bar | low |
| intro | 4 | the main riff, full band, crash; pick scrape out. Also the interlude after a chorus | loud |
| verse | 8 | palm-muted drop-tuned chugs with ringing stabs, half-time drums (snare on 3), bass doubling the chugs, pulsing synth bass, dark pad; synth arp and a low counter-line in bars 5–8; small fill out | low (−6 LU) |
| pre | 4 | lift: ringing 8th chords, four-on-the-floor kick, open hats, melody plus brass, pad, arp; swells; snare build and riser in the last bar | rising |
| chorus | 8 | big open chords with slow vibrato, slide in, drive bass, bright pad, brass stabs, open hats, crashes on bars 1 and 5, the "sung" lead melody doubled by brass | loudest |
| chorus2 | 8 | as chorus, other stab rhythm; twin lead in thirds in bars 5–8 | loudest |
| solo | 8 | lead-guitar solo over driving chugs, ride, crashes; pick scrape out | loud |
| danger | 4 | half-time, darker (Phrygian ♭II), wailing bent-note lead, dark pad, 16th arp | loud |
| cool | 2 | ringing chord, crash, pad, clean guitar: the fight dies down instead of cutting | fading |
| win | 3 | victory tag: snare build, then a big held major chord with brass stab, lead run up to the major third with bend and bloom | — |
| lose | 3 | defeat tag: clean guitar, dark pad, falling lead | — |

**Song form during a fight:** intro → verse → pre → chorus → intro (interlude) → verse → pre → chorus2 → **solo** → chorus2 → interlude → verse → … The solo comes after the second chorus.

**What drives it** (`mood.js` → `arranger.js`). `push` = the player holds a lock, or scored a kill in the last 10 s.

| game state | music |
|---|---|
| no enemy within 25 km | calm |
| an enemy within 25 km | tension |
| first contact: enemy within 6 km, weapons fired in the last 8 s, or anyone locked up | band in **at the next bar line**: big drum fill over the rest of the current bar plus a riser landing on the downbeat, then the intro riff |
| `push` during a verse | jump to the pre-chorus at the next 4-bar phrase, so the chorus lands on the lock or the kill |
| hero (a kill in the last 25 s, or winning 2:1 and healthy) at the end of a chorus | the solo (once per chorus), then chorus2 |
| a missile guiding on the player, or health < 35 % | danger on the next bar (big fill); when it clears, the interrupted section resumes from its start, never the song's top |
| the fight dies down (fight mood held 20 s after the last activity) | cool-down (2 bars), then calm or tension |
| fighting again within 64 bars | the next verse (the intro only for a fresh fight) |
| mission success | snare roll into the victory tag, which rings out |
| failure / player down | defeat tag at the next bar, then silence |

Every change lands on a bar line. Fills are dynamic only for unplanned changes; planned ends have their fill or build written in.

### Cue 1, "Sweep": D minor, drop-D guitars, 132 BPM (bar = 1.818 s)

| section | chords (one per bar) |
|---|---|
| calm | Dm(add9) Dm(add9) B♭maj7 B♭maj7 Gm Gm Asus4 A |
| tension | D5 D5 B♭5 C5 |
| intro | riff cells A B C D (D5 D5 B♭5 C5) |
| verse | cells VA VB VA VC VA VB VA VD (D5 D5 D5 B♭5 D5 D5 D5 C5) |
| pre | Gm B♭ Gm Asus4→A (half bars) |
| chorus / chorus2 | B♭ C F Dm \| B♭ C F A |
| solo | Dm B♭ C Dm \| Gm B♭ C A |
| danger | D5 E♭5 D5 C5 |
| cool | B♭ Dm |
| win | B♭→C (half bars), D major, D major |
| lose | Dm Gm Dm |

**Riff cells.** Each entry is [16th step, semitones above low D (0 = D2), length], r = ringing, m = palm-muted.

- A: 0r(2) 0m 0m · 3r(2) 0m 0m · 5r(3) 3m · 0m 0m 7r(2)
- B: 0r(2) 0m 0m · 7r(2) 0m 0m · 8r(2) 7r(2) · 5r(2) 3r(2)
- C (B♭): 8r(3) 8m 8m 8m · 8r(2) 8m 8m · 7r(2) · 8r(4)
- D (C): 10r(3) 10m 10m 10m · 10r(2) · 12r(4) · 12m 12m 12r(2)
- verse VA: mutes on steps 0 1 3 4 6 8 9 11 12, then 3r(2) on step 14; VB: same mutes to step 11, then 5r 3r; VC (B♭): the same chug on 8, then 10r(4); VD (C): chug on 10, then 10r(4) 7r(4)

**Melodies.** Each entry is note(step, length), with flags b = bend, s = semitone bend, v = vibrato, f = bloom, l = legato.

```
CHORUS ("sung" line, lead guitar + brass an octave down)
B♭: D5(0,6,b)  C5(6,2)   D5(8,4)   F5(12,4)
C : E5(0,8,v)  G5(8,8,bv)
F : A5(0,10,vf) G5(10,2) F5(12,4)
Dm: F5(0,4)    E5(4,4)   D5(8,8,v)
B♭: D5(0,6,b)  C5(6,2)   D5(8,4)   F5(12,4)
C : E5(0,6)    F5(6,2)   G5(8,8,bv)
F : A5(0,6)    B♭5(6,2)  C6(8,4,b) A5(12,4)
A : A5(0,16,vf)                     (chorus2: twin lead a diatonic third below in bars 5-8)
PRE-CHORUS
Gm: B♭4(0,8) D5(8,8,v) | B♭: D5(0,8) F5(8,8,v) | Gm: G5(0,8,b) F5(8,4) D5(12,4) | Asus4/A: D5(0,8,v) E5(8,8,bv)
VERSE (bars 5-8, low counter-line)
A4(0,16,bv) | D5(0,12,v) C5(12,4) | A4(0,8,v) F4(8,8) | G4(0,8,b) A4(8,8,v)
SOLO
Dm: D5(0,2) F5(2,2) A5(4,4,b) G5(8,2) F5(10,2,l) E5(12,2,l) F5(14,2)
B♭: D5(0,6,bv) F5(6,2) B♭5(8,4) A5(12,2,l) F5(14,2)
C : G5(0,4,b) E5(4,2) C5(6,2) E5(8,2) G5(10,2) C6(12,4,v)
Dm: A5(0,8,vf) G5 A5 G5 F5 (8-11, 16ths, l) E5(12,2) D5(14,2)
Gm: B♭5(0,4,b) A5(4,2) G5(6,2) D5(8,2) G5(10,2) B♭5(12,2) D6(14,2)
B♭: F6(0,8,bv) D6(8,2) B♭5(10,2,l) F5(12,2) D6(14,2)
C : E6(0,4,b) C6(4,2) G5(6,2) E6(8,2) F6(10,2,l) G6(12,4,b)
A : E6(0,8,vf) C♯6(8,4,v) A5(12,4)
CALM (FM bell)
A5(0,3) D6(3,3) E6(6,2) F6(8,8) | E6(0,4) D6(4,4) A5(8,8) | F5(0,3) B♭5(3,3) D6(6,2) A5(8,8) | C6(0,4) B♭5(4,4) F5(8,8)
G5(0,3) B♭5(3,3) D6(6,2) F6(8,8) | D6(0,4) C6(4,4) B♭5(8,8) | A5(0,3) D6(3,3) E6(6,2) D6(8,8) | C♯6(0,8) E6(8,8)
DANGER  D5(0,12,bv) | E♭5(0,12,sv) | D5(0,8,v) F5(8,8,bv) | C5(0,12,bvf)
WIN     D5 F5 G5 A5 E5 G5 C6 E6 (8ths) | D6(0,2) E6(2,2) F♯6(4,12,bvf) | F♯6(0,16,v)
LOSE    A4(0,8,v) G4(8,8) | B♭4(0,8,v) A4(8,8) | D4(0,16,v)
```

### Cue 2, "Nightfall": C minor, drop-C guitars, 108 BPM (bar = 2.222 s), darker and more synth-forward

| section | chords (one per bar) |
|---|---|
| calm | Cm7 Cm7 A♭maj7 A♭maj7 Fm Fm Gsus4 G |
| tension | C5 C5 A♭5 B♭5 (16th mutes) |
| intro | riff cells A B C D (C5 C5 A♭5 B♭5), with a pulsing synth bass |
| verse | VA VB VA VC VA VB VA VD, galloping kick |
| pre | Fm A♭ Fm Gsus4→G |
| chorus | A♭ B♭ E♭ Cm \| A♭ B♭ E♭ G |
| solo | Cm A♭ B♭ Cm \| Fm A♭ B♭ G |
| danger | C5 D♭5 C5 B♭5 |

**Riff cells** (0 = C2):

- A: mutes 0 2 3 4 6 7 · 3r(2) 2r(2) · mutes 12 14 15
- B: as A to step 7 · 6r(2) 5r(2) 3r(4)
- C (A♭): 8r(4) 8m 8m 8m · 7r(4) 7m 7m 7m
- D (B♭): 10r(6) 10m 10m · 11r(4) · 12r(4)
- verse VA: gallop of mutes on 0 2 3 4 6 7 8 10 11, then 3r(2) and two mutes; VB: gallop then 1r(4) (the ♭2); VC (A♭): gallop then 7r(4); VD (B♭): gallop then 10r(4) 11r 12r

```
CHORUS
A♭: C5(0,4)  E♭5(4,4)  G5(8,2)  A♭5(10,6,b)
B♭: F5(0,8,v) D5(8,4)  E♭5(12,4)
E♭: G5(0,12,vf) F5(12,2) E♭5(14,2)
Cm: E♭5(0,4) D5(4,4)   C5(8,8,v)
A♭: C5(0,4)  E♭5(4,4)  G5(8,2)  A♭5(10,6,b)
B♭: F5(0,4)  G5(4,4)   B♭5(8,8,bv)
E♭: G5(0,6)  A♭5(6,2)  B♭5(8,4) C6(12,4,s)
G : B5(0,16,vf)
PRE-CHORUS
Fm: C5(0,4) A♭4(4,4) F5(8,8,v) | A♭: E♭5(0,8,v) C5(8,4) E♭5(12,4) | Fm: F5(0,6,b) G5(6,2) A♭5(8,8,v) | Gsus4/G: G5(0,8,v) B4(8,4) D5(12,4)
VERSE (bars 5-8)  G4(0,16,bv) | C5(0,8,v) E♭5(8,8) | D5(0,12,v) B♭4(12,4) | F4(0,8,b) G4(8,8,v)
SOLO
Cm: G5(0,4,b) E♭5(4,2) C5(6,2) D5(8,2,l) E♭5(10,2,l) G5(12,4,v)
A♭: C6(0,6,bv) B♭5(6,2) A♭5(8,2) G5(10,2) F5(12,2) E♭5(14,2)
B♭: D5(0,4,s) F5(4,2) B♭5(6,2) D6(8,4,b) C6(12,2,l) B♭5(14,2,l)
Cm: C6(0,8,vf) B♭5 C6 B♭5 G5 (8-11, 16ths, l) E♭5(12,4,v)
Fm: F5(0,2) A♭5(2,2) C6(4,4,b) E♭6(8,4,bv) C6(12,4)
A♭: E♭6(0,8,bv) C6(8,2) A♭5(10,2) E♭5(12,2) C6(14,2)
B♭: D6(0,4,b) F6(4,4,bv) D6(8,2) B♭5(10,2) F6(12,4,b)
G : G6(0,8,vf) D6(8,4,v) B5(12,4)
CALM (FM bell)
G5 C6 E♭6(4,4) D6(8,4) B♭5(12,4) | C6(0,8) G5(8,8) | E♭5 A♭5 C6(4,4) B♭5(8,4) G5(12,4) | A♭5(0,8) E♭5(8,8)
F5 A♭5 C6(4,4) E♭6(8,4) C6(12,4) | B♭5(0,8) A♭5(8,8) | G5 C6 D6(4,8) C6(12,4) | B5(0,8) D6(8,8)
DANGER  C5(0,12,bv) | D♭5(0,12,sv) | C5(0,8,v) E♭5(8,8,sv) | B♭4(0,12,bvf)
WIN     C5 E♭5 F5 G5 D5 F5 B♭5 D6 (8ths) | C6(0,2) D6(2,2) E6(4,12,bvf) | E6(0,16,v)
LOSE    G4(0,8,v) F4(8,8) | A♭4(0,8,v) G4(8,8) | C4(0,16,v)
```

The progressions are common minor-key building blocks (i–VI–VII, VI–VII–III–i, iv–VI–V lift, Phrygian ♭II for danger). The riffs, melodies, counter-lines and drum parts were written for this game and do not quote or imitate any existing work.

A cue is picked per mission: `mission.music` if set, Nightfall for night start times, otherwise a hash of the mission id. On `mission:abort` the music fades out in 0.4 s and the arrangement resets.

## Verification

- `node src/combat/audio/run-harness.mjs [filter]` builds `dist/cbt-audio.html` from `harness.js` and runs it in headless Chromium.
  - It renders the real stems and the live engine through an `OfflineAudioContext` and walks a scripted game per cue: calm, contact, a lock, a kill, a missile, disengage, re-engage, win.
  - Per section it reports integrated loudness (BS.1770 gating), low/mid/high energy (< 250 Hz, 250 Hz–4 kHz, > 4 kHz), peak and stereo width.
  - It also checks clicks at every cut (energy above 17 kHz, which band-limited 32 kHz stems cannot contain on their own), how fast the band starts after contact, the riser, the duck depth and the intelligibility of radio and warnings over the ducked music, and the scheduler cost.
  - The SFX, warnings, radio, pool and mix scenarios run the real one-shot builders into the simulator's master (or the real F-16 rig).
- `node --test src/combat/audio` covers the pure logic:
  - theory and cue integrity: every note in key and in range, downbeat melody notes are chord tones
  - the song form: order, push to the pre-chorus at the phrase, solo after the chorus, danger resume, cool-down, quick return to the verse, tags once
  - the layers each section must carry, mood hysteresis, radio queue and roles, and a no-op import test
- `node src/combat/audio/perf-live.mjs [seconds] [extra params]`, after `node tools/build.mjs`, measures the real game page (software GL, instant-2v2 with the combat bot): stem preparation, per-frame cost of the combat-audio update and the music scheduler, nodes and voices, and frame times.
