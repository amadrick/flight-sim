// The combat score: two original cues written for this game, each a song with a verse / pre-chorus / chorus / solo
// form that the arranger walks through as the fight develops. Pure data (safe in node).
//
// Genre brief: post-grunge arena rock crossed with an 1980s action-film synth-rock anthem. Every riff, chord-with-melody
// combination, lead line and drum part here is an original composition; see README.md "Music" for the written-out parts.
//
// Grid: 16 steps per 4/4 bar (16th notes). Drum strings: X accent, x normal, o soft, g ghost, . rest;
// toms H/M/L (accent) h/m/l (soft). Guitar strings: R = ring a chord, r = short ringing accent, M = palm mute,
// '-' = keep holding, '.' = rest. Bass strings: R root, O octave, 5 fifth, A approach (a semitone under the next chord root),
// '-' hold, '.' rest. Riff cells: [step, semitones above the guitar's low tonic, length (steps), 'r' ring | 'm' mute].
// Melodies: one array per bar of [step, note, length, flags] with flags b = bend up into the note from a tone below,
// s = bend from a semitone below, v = wide vibrato, f = feedback bloom (octave harmonic swells in), l = legato slide.
//
// Section keys: bars, chords (one per bar, or [a, b] for two half-bar chords), drums / drums2 (odd bars) / drumsLast /
// drumPlan (per bar), fillLast (drum fill baked into the last bar), riffPlan (riff cell per bar) or gtr (pattern),
// bass, sbass (+Level), pad (level) / padDark, clean (arp pattern) / cleanBars, bell (melody), arp (+Level, arpFrom),
// stabs (brass chord-stab rhythm), lead (melody, leadLevel, leadFrom), double (brass doubles the lead an octave down),
// twin ([from, to) bars harmonised a third below), slideIn (slide into the first chord), scrape (pick scrape at the end),
// riser (noise riser over the last bar), crash (bars), ownDrums (drums rendered into the band stem: no fills over it),
// end (a tag that plays once), group (what the arranger calls it).

export const DRUMS = {
  calm:    { hat: '..g...g...g...g.' },
  tension: { kick: 'x.......x.......', hat: 'o.g.o.g.o.g.o.g.', tom: '..........l...l.' },
  tension2:{ kick: 'x.......x.....x.', hat: 'o.g.o.g.o.g.o.g.', tom: '......l...m.l.m.' },
  riff:    { kick: 'X.x...x.X.x...x.', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.' },
  verse:   { kick: 'X.x...x...x.x...', snare: '........X.....g.', hat: 'x.x.x.x.x.x.x.x.' },
  verse2:  { kick: 'X.x...x...xx..x.', snare: '...g....X.....g.', hat: 'x.x.x.x.x.x.x.xo' },
  gallop:  { kick: 'X.xxx.xxx.xx..x.', snare: '........X.......', hat: 'x.x.x.x.x.x.x.x.' },
  pre:     { kick: 'X...X...X...X...', snare: '....X.......X...', hat: 'x...x...x...x...', ohat: '..x...x...x...x.' },
  build:   { kick: 'X...X...X...X...', snare: 'x.x.x.x.xxxxXXXX' },
  chorus:  { kick: 'X...x...X...x.x.', snare: '....X.......X...', ohat: '..x...x...x...x.', hat: 'x...x...x...x...' },
  solo:    { kick: 'X.x.X.x.X.x.X.xx', snare: '....X.......X...', ride: 'x.x.x.x.x.x.x.x.' },
  danger:  { kick: 'X......x.x....x.', snare: '........X.......', hat: 'x.x.x.x.x.x.x.x.', tom: '..............L.' },
  cool:    { kick: 'X...............' },
  winA:    { kick: 'X.......X...X...', snare: '........ooxxXXXX' },
  win:     { kick: 'X...............', snare: 'X...............' },
  lose:    { tom: 'L...............' },
  after:   { },
  // fills replace the drums from their first step onward (8 = big fill, 12 = small fill)
  fillBig:   { kick: '........X.....X.', snare: '........x.xxX.x.', tom: '............HHML' },
  fillSmall: { kick: '............X...', snare: '............x.xX', tom: '..............ML' },
  fillRoll:  { snare: '........oooxxxXX' },
};
export const FILL_FROM = { fillBig: 8, fillSmall: 12, fillRoll: 8 };

export const GTR = {
  mute8:  'M.M.M.M.M.M.M.M.',
  mute16: 'M.MMM.MMM.MMM.MM',
  ring:   'R-----r-r-------',
  lift8:  'R-R-R-R-R-R-R-R-',
  chug:   'R---M.MMR---M.MM',
  danger: 'R-------M.MM.M.M',
  hold:   'R---------------',
};
export const BASS = {
  root8:  'R.R.R.R.R.R.R.R.',
  drive8: 'R.R.R.R.R.R.O.RA',
  half:   'R-------R---R---',
  hold:   'R---------------',
  pulse16:'RRRRRRRRRRRRRRRR',
  pulse8: 'R.R.R.R.R.R.R.R.',
  danger: 'R-------R.RR.R.R',
};
// arpeggio index patterns into the chord's tone ladder (0 = root, 1 = next chord tone up, …), one entry per step;
// '.' rests. The clean guitar plays 8ths, the synth arp 16ths.
export const ARP = {
  clean8: [0, '.', 2, '.', 1, '.', 3, '.', 2, '.', 4, '.', 3, '.', 1, '.'],
  up16:   [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 4, 2],
  pulse16:[0, 0, 3, 0, 0, 2, 0, 3, 0, 0, 3, 0, 2, 0, 4, 3],
  danger16:[0, 3, 1, 3, 0, 3, 1, 4, 0, 3, 1, 3, 0, 4, 2, 3],
};
export const STABS = {
  anthem: 'X.....x...x.....',
  push:   'X.......x.x.x...',
};

// shared section shapes (the cues differ in riffs, melodies, tempo, key and a few levels)
function sections(o) {
  return {
    calm:    { bars: 8, chords: o.calmChords, drums: 'calm', bell: 'bell', clean: 'clean8', cleanLevel: 0.55, pad: 0.5, sbass: o.calmPulse, sbassLevel: 0.28, ownDrums: true, level: 0.72, group: 'calm' },
    tension: { bars: 4, chords: ['i5', 'i5', 'VI5', 'VII5'], drums: 'tension', drums2: 'tension2', gtr: o.tensionGtr, gtrLevel: 0.45, bass: 'root8', bassLevel: 0.45, pad: 0.5, arp: 'pulse16', arpLevel: 0.6, riser: true, level: 0.7, mix: { hats: 1.5 }, group: 'tension' },
    intro:   { bars: 4, chords: ['i5', 'i5', 'VI5', 'VII5'], riffPlan: 'ABCD', drums: 'riff', bass: 'riff', crash: [0], scrape: true, level: 0.9, bassLevel: 0.85, group: 'band' },
    verse:   { bars: 8, chords: ['i5', 'i5', 'i5', 'VI5', 'i5', 'i5', 'i5', 'VII5'], riffPlan: ['VA', 'VB', 'VA', 'VC', 'VA', 'VB', 'VA', 'VD'], drums: o.verseDrums, drums2: o.verseDrums2, bass: 'riff', sbass: 'pulse16', sbassLevel: 0.2, arp: 'pulse16', arpLevel: 0.42, arpFrom: 4, pad: 0.35, padDark: true, lead: 'vlead', leadFrom: 4, leadLevel: 0.6, fillLast: 'fillSmall', level: 0.75, bassLevel: 0.7, mix: { gtr: 1.25, hats: 1.6 }, group: 'band' },
    pre:     { bars: 4, chords: ['iv', 'VI', 'iv', ['Vsus4', 'V']], drums: 'pre', drumsLast: 'build', gtr: 'lift8', gtrLevel: 0.85, bass: 'drive8', pad: 0.8, arp: 'up16', arpLevel: 0.5, lead: 'pre', leadLevel: 0.8, double: 0.6, riser: true, crash: [0], swell: [0.78, 1], group: 'band' },
    chorus:  { bars: 8, chords: ['VI', 'VII', 'III', 'i', 'VI', 'VII', 'III', 'V'], drums: 'chorus', gtr: 'ring', slideIn: 2, bass: 'drive8', pad: 0.9, stabs: 'anthem', arp: 'up16', arpLevel: 0.45, lead: 'hook', double: 0.75, twin: [4, 8], crash: [0, 4], fillLast: 'fillSmall', group: 'band' },
    solo:    { bars: 8, chords: ['i', 'VI', 'VII', 'i', 'iv', 'VI', 'VII', 'V'], drums: 'solo', gtr: 'chug', gtrLevel: 0.9, bass: 'root8', pad: 0.55, lead: 'solo', leadLevel: 1.05, crash: [0, 4], scrape: true, level: 0.92, group: 'band' },
    danger:  { bars: 4, chords: ['i5', 'bII5', 'i5', 'VII5'], drums: 'danger', gtr: 'danger', bass: 'danger', pad: 0.6, padDark: true, arp: 'danger16', arpLevel: 0.65, lead: 'siren', leadLevel: 0.85, crash: [0], level: 0.92, group: 'danger' },
    cool:    { bars: 2, chords: ['VI', 'i'], drums: 'cool', gtr: 'hold', gtrLevel: 0.8, bass: 'hold', pad: 0.7, clean: 'clean8', cleanLevel: 0.5, crash: [0], ownDrums: true, group: 'cool' },
    win:     { bars: 3, chords: [['VI', 'VII'], 'I', 'I'], drumPlan: ['winA', 'win', 'after'], gtr: 'hold', bass: 'hold', pad: 1, stabs: 'X...............', lead: 'win', crash: [1], end: true, ownDrums: true, group: 'win' },
    lose:    { bars: 3, chords: ['i', 'iv', 'i'], drums: 'lose', clean: 'clean8', cleanBars: 2, pad: 0.7, padDark: true, lead: 'lose', leadLevel: 0.6, end: true, ownDrums: true, group: 'lose' },
  };
}

// --------------------------------------------------------------------------------------------------------------
// Cue 1 — "Sweep": D minor, drop-D guitars, 132 BPM. Day / sweep missions.
// --------------------------------------------------------------------------------------------------------------
const SWEEP = {
  id: 'sweep', title: 'Sweep', tonic: 2 /* D */, bpm: 132, gtrLow: 38 /* D2 (drop D) */,
  riffs: {
    // intro / interlude riff (over D5 D5 Bb5 C5)
    A: [[0, 0, 2, 'r'], [2, 0, 1, 'm'], [3, 0, 1, 'm'], [4, 3, 2, 'r'], [6, 0, 1, 'm'], [7, 0, 1, 'm'], [8, 5, 3, 'r'], [11, 3, 1, 'm'], [12, 0, 1, 'm'], [13, 0, 1, 'm'], [14, 7, 2, 'r']],
    B: [[0, 0, 2, 'r'], [2, 0, 1, 'm'], [3, 0, 1, 'm'], [4, 7, 2, 'r'], [6, 0, 1, 'm'], [7, 0, 1, 'm'], [8, 8, 2, 'r'], [10, 7, 2, 'r'], [12, 5, 2, 'r'], [14, 3, 2, 'r']],
    C: [[0, 8, 3, 'r'], [3, 8, 1, 'm'], [4, 8, 1, 'm'], [5, 8, 1, 'm'], [6, 8, 2, 'r'], [8, 8, 1, 'm'], [9, 8, 1, 'm'], [10, 7, 2, 'r'], [12, 8, 4, 'r']],
    D: [[0, 10, 3, 'r'], [3, 10, 1, 'm'], [4, 10, 1, 'm'], [5, 10, 1, 'm'], [6, 10, 2, 'r'], [8, 12, 4, 'r'], [12, 12, 1, 'm'], [13, 12, 1, 'm'], [14, 12, 2, 'r']],
    // verse: palm-muted chugs on low D with ringing stabs
    VA: [[0, 0, 1, 'm'], [1, 0, 1, 'm'], [3, 0, 1, 'm'], [4, 0, 1, 'm'], [6, 0, 1, 'm'], [8, 0, 1, 'm'], [9, 0, 1, 'm'], [11, 0, 1, 'm'], [12, 0, 1, 'm'], [14, 3, 2, 'r']],
    VB: [[0, 0, 1, 'm'], [1, 0, 1, 'm'], [3, 0, 1, 'm'], [4, 0, 1, 'm'], [6, 0, 1, 'm'], [8, 0, 1, 'm'], [9, 0, 1, 'm'], [11, 0, 1, 'm'], [12, 5, 2, 'r'], [14, 3, 2, 'r']],
    VC: [[0, 8, 1, 'm'], [1, 8, 1, 'm'], [3, 8, 1, 'm'], [4, 8, 1, 'm'], [6, 8, 1, 'm'], [8, 8, 1, 'm'], [9, 8, 1, 'm'], [11, 8, 1, 'm'], [12, 10, 4, 'r']],
    VD: [[0, 10, 1, 'm'], [1, 10, 1, 'm'], [3, 10, 1, 'm'], [4, 10, 1, 'm'], [6, 10, 1, 'm'], [8, 10, 4, 'r'], [12, 7, 4, 'r']],
  },
  hooks: {
    // chorus melody (the "sung" line) over Bb – C – F – Dm | Bb – C – F – A
    hook: [
      [[0, 'D5', 6, 'b'], [6, 'C5', 2], [8, 'D5', 4], [12, 'F5', 4]],
      [[0, 'E5', 8, 'v'], [8, 'G5', 8, 'bv']],
      [[0, 'A5', 10, 'vf'], [10, 'G5', 2], [12, 'F5', 4]],
      [[0, 'F5', 4], [4, 'E5', 4], [8, 'D5', 8, 'v']],
      [[0, 'D5', 6, 'b'], [6, 'C5', 2], [8, 'D5', 4], [12, 'F5', 4]],
      [[0, 'E5', 6], [6, 'F5', 2], [8, 'G5', 8, 'bv']],
      [[0, 'A5', 6], [6, 'Bb5', 2], [8, 'C6', 4, 'b'], [12, 'A5', 4]],
      [[0, 'A5', 16, 'vf']],
    ],
    // pre-chorus lift over Gm – Bb – Gm – Asus4/A
    pre: [
      [[0, 'Bb4', 8], [8, 'D5', 8, 'v']],
      [[0, 'D5', 8], [8, 'F5', 8, 'v']],
      [[0, 'G5', 8, 'b'], [8, 'F5', 4], [12, 'D5', 4]],
      [[0, 'D5', 8, 'v'], [8, 'E5', 8, 'bv']],
    ],
    // verse, second half: a low counter-line
    vlead: [[[0, 'A4', 16, 'bv']], [[0, 'D5', 12, 'v'], [12, 'C5', 4]], [[0, 'A4', 8, 'v'], [8, 'F4', 8]], [[0, 'G4', 8, 'b'], [8, 'A4', 8, 'v']]],
    // guitar solo over Dm – Bb – C – Dm | Gm – Bb – C – A
    solo: [
      [[0, 'D5', 2], [2, 'F5', 2], [4, 'A5', 4, 'b'], [8, 'G5', 2], [10, 'F5', 2, 'l'], [12, 'E5', 2, 'l'], [14, 'F5', 2]],
      [[0, 'D5', 6, 'bv'], [6, 'F5', 2], [8, 'Bb5', 4], [12, 'A5', 2, 'l'], [14, 'F5', 2]],
      [[0, 'G5', 4, 'b'], [4, 'E5', 2], [6, 'C5', 2], [8, 'E5', 2], [10, 'G5', 2], [12, 'C6', 4, 'v']],
      [[0, 'A5', 8, 'vf'], [8, 'G5', 1, 'l'], [9, 'A5', 1, 'l'], [10, 'G5', 1, 'l'], [11, 'F5', 1, 'l'], [12, 'E5', 2], [14, 'D5', 2]],
      [[0, 'Bb5', 4, 'b'], [4, 'A5', 2], [6, 'G5', 2], [8, 'D5', 2], [10, 'G5', 2], [12, 'Bb5', 2], [14, 'D6', 2]],
      [[0, 'F6', 8, 'bv'], [8, 'D6', 2], [10, 'Bb5', 2, 'l'], [12, 'F5', 2], [14, 'D6', 2]],
      [[0, 'E6', 4, 'b'], [4, 'C6', 2], [6, 'G5', 2], [8, 'E6', 2], [10, 'F6', 2, 'l'], [12, 'G6', 4, 'b']],
      [[0, 'E6', 8, 'vf'], [8, 'C#6', 4, 'v'], [12, 'A5', 4]],
    ],
    // calm: FM-bell motif over Dm(add9) – Bb(maj7) – Gm – Asus4/A
    bell: [
      [[0, 'A5', 3], [3, 'D6', 3], [6, 'E6', 2], [8, 'F6', 8]],
      [[0, 'E6', 4], [4, 'D6', 4], [8, 'A5', 8]],
      [[0, 'F5', 3], [3, 'Bb5', 3], [6, 'D6', 2], [8, 'A5', 8]],
      [[0, 'C6', 4], [4, 'Bb5', 4], [8, 'F5', 8]],
      [[0, 'G5', 3], [3, 'Bb5', 3], [6, 'D6', 2], [8, 'F6', 8]],
      [[0, 'D6', 4], [4, 'C6', 4], [8, 'Bb5', 8]],
      [[0, 'A5', 3], [3, 'D6', 3], [6, 'E6', 2], [8, 'D6', 8]],
      [[0, 'C#6', 8], [8, 'E6', 8]],
    ],
    // danger: a slow wail over the half-time groove
    siren: [[[0, 'D5', 12, 'bv']], [[0, 'Eb5', 12, 'sv']], [[0, 'D5', 8, 'v'], [8, 'F5', 8, 'bv']], [[0, 'C5', 12, 'bvf']]],
    // victory tag: a run up through Bb and C, then the major third of D major, held
    win: [[[0, 'D5', 2], [2, 'F5', 2], [4, 'G5', 2], [6, 'A5', 2], [8, 'E5', 2], [10, 'G5', 2], [12, 'C6', 2], [14, 'E6', 2]], [[0, 'D6', 2], [2, 'E6', 2], [4, 'F#6', 12, 'bvf']], [[0, 'F#6', 16, 'v']]],
    lose: [[[0, 'A4', 8, 'v'], [8, 'G4', 8]], [[0, 'Bb4', 8, 'v'], [8, 'A4', 8]], [[0, 'D4', 16, 'v']]],
  },
};
SWEEP.sections = sections({ calmChords: ['iadd9', 'iadd9', 'VImaj7', 'VImaj7', 'iv', 'iv', 'Vsus4', 'V'], calmPulse: 'pulse8', tensionGtr: 'mute8', verseDrums: 'verse', verseDrums2: 'verse2' });

// --------------------------------------------------------------------------------------------------------------
// Cue 2 — "Nightfall": C minor, guitars a whole step lower (drop C), 108 BPM, darker and more synth-forward.
// --------------------------------------------------------------------------------------------------------------
const NIGHT = {
  id: 'nightfall', title: 'Nightfall', tonic: 0 /* C */, bpm: 108, gtrLow: 36 /* C2 */,
  riffs: {
    A: [[0, 0, 1, 'm'], [2, 0, 1, 'm'], [3, 0, 1, 'm'], [4, 0, 1, 'm'], [6, 0, 1, 'm'], [7, 0, 1, 'm'], [8, 3, 2, 'r'], [10, 2, 2, 'r'], [12, 0, 1, 'm'], [14, 0, 1, 'm'], [15, 0, 1, 'm']],
    B: [[0, 0, 1, 'm'], [2, 0, 1, 'm'], [3, 0, 1, 'm'], [4, 0, 1, 'm'], [6, 0, 1, 'm'], [7, 0, 1, 'm'], [8, 6, 2, 'r'], [10, 5, 2, 'r'], [12, 3, 4, 'r']],
    C: [[0, 8, 4, 'r'], [4, 8, 1, 'm'], [6, 8, 1, 'm'], [7, 8, 1, 'm'], [8, 7, 4, 'r'], [12, 7, 1, 'm'], [14, 7, 1, 'm'], [15, 7, 1, 'm']],
    D: [[0, 10, 6, 'r'], [6, 10, 1, 'm'], [7, 10, 1, 'm'], [8, 11, 4, 'r'], [12, 12, 4, 'r']],
    // verse: galloping mutes with a b2 / b3 sting
    VA: [[0, 0, 1, 'm'], [2, 0, 1, 'm'], [3, 0, 1, 'm'], [4, 0, 1, 'm'], [6, 0, 1, 'm'], [7, 0, 1, 'm'], [8, 0, 1, 'm'], [10, 0, 1, 'm'], [11, 0, 1, 'm'], [12, 3, 2, 'r'], [14, 0, 1, 'm'], [15, 0, 1, 'm']],
    VB: [[0, 0, 1, 'm'], [2, 0, 1, 'm'], [3, 0, 1, 'm'], [4, 0, 1, 'm'], [6, 0, 1, 'm'], [7, 0, 1, 'm'], [8, 0, 1, 'm'], [10, 0, 1, 'm'], [11, 0, 1, 'm'], [12, 1, 4, 'r']],
    VC: [[0, 8, 1, 'm'], [2, 8, 1, 'm'], [3, 8, 1, 'm'], [4, 8, 1, 'm'], [6, 8, 1, 'm'], [7, 8, 1, 'm'], [8, 8, 1, 'm'], [10, 8, 1, 'm'], [11, 8, 1, 'm'], [12, 7, 4, 'r']],
    VD: [[0, 10, 1, 'm'], [2, 10, 1, 'm'], [3, 10, 1, 'm'], [4, 10, 1, 'm'], [6, 10, 1, 'm'], [7, 10, 1, 'm'], [8, 10, 4, 'r'], [12, 11, 2, 'r'], [14, 12, 2, 'r']],
  },
  hooks: {
    // chorus melody over Ab – Bb – Eb – Cm | Ab – Bb – Eb – G
    hook: [
      [[0, 'C5', 4], [4, 'Eb5', 4], [8, 'G5', 2], [10, 'Ab5', 6, 'b']],
      [[0, 'F5', 8, 'v'], [8, 'D5', 4], [12, 'Eb5', 4]],
      [[0, 'G5', 12, 'vf'], [12, 'F5', 2], [14, 'Eb5', 2]],
      [[0, 'Eb5', 4], [4, 'D5', 4], [8, 'C5', 8, 'v']],
      [[0, 'C5', 4], [4, 'Eb5', 4], [8, 'G5', 2], [10, 'Ab5', 6, 'b']],
      [[0, 'F5', 4], [4, 'G5', 4], [8, 'Bb5', 8, 'bv']],
      [[0, 'G5', 6], [6, 'Ab5', 2], [8, 'Bb5', 4], [12, 'C6', 4, 's']],
      [[0, 'B5', 16, 'vf']],
    ],
    // pre-chorus over Fm – Ab – Fm – Gsus4/G
    pre: [
      [[0, 'C5', 4], [4, 'Ab4', 4], [8, 'F5', 8, 'v']],
      [[0, 'Eb5', 8, 'v'], [8, 'C5', 4], [12, 'Eb5', 4]],
      [[0, 'F5', 6, 'b'], [6, 'G5', 2], [8, 'Ab5', 8, 'v']],
      [[0, 'G5', 8, 'v'], [8, 'B4', 4], [12, 'D5', 4]],
    ],
    vlead: [[[0, 'G4', 16, 'bv']], [[0, 'C5', 8, 'v'], [8, 'Eb5', 8]], [[0, 'D5', 12, 'v'], [12, 'Bb4', 4]], [[0, 'F4', 8, 'b'], [8, 'G4', 8, 'v']]],
    // guitar solo over Cm – Ab – Bb – Cm | Fm – Ab – Bb – G
    solo: [
      [[0, 'G5', 4, 'b'], [4, 'Eb5', 2], [6, 'C5', 2], [8, 'D5', 2, 'l'], [10, 'Eb5', 2, 'l'], [12, 'G5', 4, 'v']],
      [[0, 'C6', 6, 'bv'], [6, 'Bb5', 2], [8, 'Ab5', 2], [10, 'G5', 2], [12, 'F5', 2], [14, 'Eb5', 2]],
      [[0, 'D5', 4, 's'], [4, 'F5', 2], [6, 'Bb5', 2], [8, 'D6', 4, 'b'], [12, 'C6', 2, 'l'], [14, 'Bb5', 2, 'l']],
      [[0, 'C6', 8, 'vf'], [8, 'Bb5', 1, 'l'], [9, 'C6', 1, 'l'], [10, 'Bb5', 1, 'l'], [11, 'G5', 1, 'l'], [12, 'Eb5', 4, 'v']],
      [[0, 'F5', 2], [2, 'Ab5', 2], [4, 'C6', 4, 'b'], [8, 'Eb6', 4, 'bv'], [12, 'C6', 4]],
      [[0, 'Eb6', 8, 'bv'], [8, 'C6', 2], [10, 'Ab5', 2], [12, 'Eb5', 2], [14, 'C6', 2]],
      [[0, 'D6', 4, 'b'], [4, 'F6', 4, 'bv'], [8, 'D6', 2], [10, 'Bb5', 2], [12, 'F6', 4, 'b']],
      [[0, 'G6', 8, 'vf'], [8, 'D6', 4, 'v'], [12, 'B5', 4]],
    ],
    // calm: FM-bell motif over Cm7 – Abmaj7 – Fm – Gsus4/G
    bell: [
      [[0, 'G5', 2], [2, 'C6', 2], [4, 'Eb6', 4], [8, 'D6', 4], [12, 'Bb5', 4]],
      [[0, 'C6', 8], [8, 'G5', 8]],
      [[0, 'Eb5', 2], [2, 'Ab5', 2], [4, 'C6', 4], [8, 'Bb5', 4], [12, 'G5', 4]],
      [[0, 'Ab5', 8], [8, 'Eb5', 8]],
      [[0, 'F5', 2], [2, 'Ab5', 2], [4, 'C6', 4], [8, 'Eb6', 4], [12, 'C6', 4]],
      [[0, 'Bb5', 8], [8, 'Ab5', 8]],
      [[0, 'G5', 2], [2, 'C6', 2], [4, 'D6', 8], [12, 'C6', 4]],
      [[0, 'B5', 8], [8, 'D6', 8]],
    ],
    siren: [[[0, 'C5', 12, 'bv']], [[0, 'Db5', 12, 'sv']], [[0, 'C5', 8, 'v'], [8, 'Eb5', 8, 'sv']], [[0, 'Bb4', 12, 'bvf']]],
    win: [[[0, 'C5', 2], [2, 'Eb5', 2], [4, 'F5', 2], [6, 'G5', 2], [8, 'D5', 2], [10, 'F5', 2], [12, 'Bb5', 2], [14, 'D6', 2]], [[0, 'C6', 2], [2, 'D6', 2], [4, 'E6', 12, 'bvf']], [[0, 'E6', 16, 'v']]],
    lose: [[[0, 'G4', 8, 'v'], [8, 'F4', 8]], [[0, 'Ab4', 8, 'v'], [8, 'G4', 8]], [[0, 'C4', 16, 'v']]],
  },
};
NIGHT.sections = sections({ calmChords: ['im7', 'im7', 'VImaj7', 'VImaj7', 'iv', 'iv', 'Vsus4', 'V'], calmPulse: 'pulse16', tensionGtr: 'mute16', verseDrums: 'gallop', verseDrums2: 'gallop' });
NIGHT.sections.intro.sbass = 'pulse16'; NIGHT.sections.intro.sbassLevel = 0.25;

export const CUES = { sweep: SWEEP, nightfall: NIGHT };
export const CUE_IDS = Object.keys(CUES);
