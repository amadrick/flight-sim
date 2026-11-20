// The combat score: two original cues, written for this game. Pure data (safe in node).
//
// Genre brief: post-grunge arena rock crossed with an 1980s action anthem. Everything here (riffs, progressions with their
// melodies, the lead hooks, the drum parts) is an original composition — see README.md "Music" for the written-out parts.
//
// Grid: 16 steps per 4/4 bar (16th notes). Drum strings: X accent, x normal, o soft, g ghost, . rest;
// toms H/M/L (accent) h/m/l (soft). Guitar strings: R = ring a chord, r = short ringing accent, M = palm mute,
// '-' = keep holding, '.' = rest. Bass strings: R root, O octave, 5 fifth, A approach (a semitone under the next chord root),
// '-' hold, '.' rest. Riff cells: [step, semitones above the guitar's low tonic, length (steps), 'r' ring | 'm' mute].
// Lead hooks: one array per bar of [step, note, length, flags] with flags b = bend up into the note from a tone below,
// s = bend from a semitone below, v = long vibrato, f = feedback bloom (octave harmonic swells in).

export const DRUMS = {
  calm:    { hat: '..g...g...g...g.' },
  tension: { kick: 'x.......x.......', hat: 'o.g.o.g.o.g.o.g.', tom: '..........l...l.' },
  tension2:{ kick: 'x.......x.....x.', hat: 'o.g.o.g.o.g.o.g.', tom: '......l...m.l.m.' },
  riff:    { kick: 'X.x...x.X.x...x.', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.' },
  riff2:   { kick: 'X.x...x.X.x..xx.', snare: '....X.......X..g', hat: 'x.o.x.o.x.o.x.o.', ohat: '..............x.' },
  bridge:  { kick: 'X..x..x.X..x..x.', snare: '....X.......X...', ride: 'x.x.x.x.x.x.x.x.' },
  chorus:  { kick: 'X...x...X...x.x.', snare: '....X.......X...', ohat: '..x...x...x...x.', hat: 'x...x...x...x...' },
  danger:  { kick: 'X......x.x....x.', snare: '........X.......', hat: 'x.x.x.x.x.x.x.x.', tom: '..............L.' },
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
  ring2:  'R-------R-------',
  stab:   'R---------r-r---',
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

// --------------------------------------------------------------------------------------------------------------
// Cue 1 — "Sweep": D minor, drop-D guitars, 132 BPM. Day / sweep missions.
// --------------------------------------------------------------------------------------------------------------
const SWEEP = {
  id: 'sweep', title: 'Sweep', tonic: 2 /* D */, bpm: 132, gtrLow: 38 /* D2 (drop D) */, swing: 0,
  riffs: {
    A: [[0, 0, 2, 'r'], [2, 0, 1, 'm'], [3, 0, 1, 'm'], [4, 3, 2, 'r'], [6, 0, 1, 'm'], [7, 0, 1, 'm'], [8, 5, 3, 'r'], [11, 3, 1, 'm'], [12, 0, 1, 'm'], [13, 0, 1, 'm'], [14, 7, 2, 'r']],
    B: [[0, 0, 2, 'r'], [2, 0, 1, 'm'], [3, 0, 1, 'm'], [4, 7, 2, 'r'], [6, 0, 1, 'm'], [7, 0, 1, 'm'], [8, 8, 2, 'r'], [10, 7, 2, 'r'], [12, 5, 2, 'r'], [14, 3, 2, 'r']],
    C: [[0, 8, 3, 'r'], [3, 8, 1, 'm'], [4, 8, 1, 'm'], [5, 8, 1, 'm'], [6, 8, 2, 'r'], [8, 8, 1, 'm'], [9, 8, 1, 'm'], [10, 7, 2, 'r'], [12, 8, 4, 'r']],
    D: [[0, 10, 3, 'r'], [3, 10, 1, 'm'], [4, 10, 1, 'm'], [5, 10, 1, 'm'], [6, 10, 2, 'r'], [8, 12, 4, 'r'], [12, 12, 1, 'm'], [13, 12, 1, 'm'], [14, 12, 2, 'r']],
  },
  hooks: {
    // chorus over Bb – C – F – Dm | Bb – C – F – A
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
    // danger: a slow wail over the half-time groove (one long bent note per bar)
    siren: [[[0, 'D5', 12, 'bv']], [[0, 'Eb5', 12, 'sv']], [[0, 'D5', 8, 'v'], [8, 'F5', 8, 'bv']], [[0, 'C5', 12, 'bvf']]],
    // victory: climbs to the major third of the final D major chord and holds it
    win: [[[0, 'F5', 8, 'b'], [8, 'G5', 8, 'b']], [[0, 'A5', 4], [4, 'D6', 12, 'bv']], [[0, 'F#6', 16, 'vf']], [[0, 'F#6', 16, 'v']]],
    lose: [[[0, 'A4', 8, 'v'], [8, 'G4', 8]], [[0, 'Bb4', 8, 'v'], [8, 'A4', 8]], [[0, 'D4', 16, 'v']], []],
    // second verse: long counter-line notes
    counter: [[[0, 'A4', 16, 'bv']], [[0, 'D5', 12, 'v'], [12, 'C5', 4]], [[0, 'A4', 16, 'v']], [[0, 'F5', 8, 'b'], [8, 'E5', 8, 'v']],
      [[0, 'A4', 16, 'bv']], [[0, 'D5', 12, 'v'], [12, 'E5', 4]], [[0, 'F5', 16, 'v']], [[0, 'G5', 8, 'b'], [8, 'E5', 8, 'v']]],
  },
};
SWEEP.sections = {
  calm:    { bars: 8, chords: ['iadd9', 'iadd9', 'VImaj7', 'VImaj7', 'iv', 'iv', 'Vsus4', 'V'], drums: 'calm', clean: 'clean8', pad: 0.55, sbass: 'pulse8', sbassLevel: 0.35, group: 'calm' },
  tension: { bars: 4, chords: ['i5', 'i5', 'VI5', 'VII5'], drums: 'tension', drums2: 'tension2', gtr: 'mute8', gtrLevel: 0.45, bass: 'root8', bassLevel: 0.55, pad: 0.5, arp: 'pulse16', arpLevel: 0.6, riser: true, group: 'tension' },
  riff:    { bars: 8, chords: ['i5', 'i5', 'i5', 'i5', 'i5', 'i5', 'VI5', 'VII5'], riffPlan: 'ABABABCD', drums: 'riff', bass: 'riff', crash: [0], group: 'fight' },
  riff2:   { bars: 8, chords: ['i5', 'i5', 'i5', 'i5', 'i5', 'i5', 'VI5', 'VII5'], riffPlan: 'ABABABCD', drums: 'riff2', bass: 'riff', arp: 'pulse16', arpLevel: 0.5, lead: 'counter', leadLevel: 0.7, crash: [0], group: 'fight' },
  bridge:  { bars: 4, chords: ['VI5', 'VII5', 'iv5', 'V5'], drums: 'bridge', gtr: 'ring2', bass: 'root8', pad: 0.7, arp: 'up16', arpLevel: 0.7, riser: true, crash: [0], group: 'fight' },
  chorus:  { bars: 8, chords: ['VI', 'VII', 'III', 'i', 'VI', 'VII', 'III', 'V'], drums: 'chorus', gtr: 'ring', bass: 'drive8', pad: 1, arp: 'up16', arpLevel: 0.55, lead: 'hook', crash: [0, 4], group: 'hero' },
  chorus2: { bars: 8, chords: ['VI', 'VII', 'III', 'i', 'VI', 'VII', 'III', 'V'], drums: 'chorus', gtr: 'ring', bass: 'drive8', pad: 1, arp: 'up16', arpLevel: 0.6, lead: 'hook', twin: [4, 8], crash: [0, 4], group: 'hero' },
  danger:  { bars: 4, chords: ['i5', 'bII5', 'i5', 'VII5'], drums: 'danger', gtr: 'danger', bass: 'danger', pad: 0.6, padDark: true, arp: 'danger16', arpLevel: 0.65, lead: 'siren', leadLevel: 0.85, crash: [0], group: 'danger' },
  win:     { bars: 4, chords: [['VI', 'VII'], 'I', 'I', 'I'], drums: 'win', gtr: 'hold', bass: 'hold', pad: 1, lead: 'win', crash: [1], end: true, group: 'win', halfGtr: [0] },
  lose:    { bars: 4, chords: ['i', 'iv', 'i', 'i'], drums: 'lose', clean: 'clean8', cleanBars: 3, pad: 0.7, padDark: true, lead: 'lose', leadLevel: 0.6, end: true, group: 'lose' },
};

// --------------------------------------------------------------------------------------------------------------
// Cue 2 — "Nightfall": C minor, guitars a whole step lower (drop C), 108 BPM, darker and more synth-forward. Night / strike missions.
// --------------------------------------------------------------------------------------------------------------
const NIGHT = {
  id: 'nightfall', title: 'Nightfall', tonic: 0 /* C */, bpm: 108, gtrLow: 36 /* C2 */, swing: 0,
  riffs: {
    A: [[0, 0, 1, 'm'], [2, 0, 1, 'm'], [3, 0, 1, 'm'], [4, 0, 1, 'm'], [6, 0, 1, 'm'], [7, 0, 1, 'm'], [8, 3, 2, 'r'], [10, 2, 2, 'r'], [12, 0, 1, 'm'], [14, 0, 1, 'm'], [15, 0, 1, 'm']],
    B: [[0, 0, 1, 'm'], [2, 0, 1, 'm'], [3, 0, 1, 'm'], [4, 0, 1, 'm'], [6, 0, 1, 'm'], [7, 0, 1, 'm'], [8, 6, 2, 'r'], [10, 5, 2, 'r'], [12, 3, 4, 'r']],
    C: [[0, 8, 4, 'r'], [4, 8, 1, 'm'], [6, 8, 1, 'm'], [7, 8, 1, 'm'], [8, 7, 4, 'r'], [12, 7, 1, 'm'], [14, 7, 1, 'm'], [15, 7, 1, 'm']],
    D: [[0, 10, 6, 'r'], [6, 10, 1, 'm'], [7, 10, 1, 'm'], [8, 11, 4, 'r'], [12, 12, 4, 'r']],
  },
  hooks: {
    // chorus over Ab – Bb – Eb – Cm | Ab – Bb – Eb – G
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
    siren: [[[0, 'C5', 12, 'bv']], [[0, 'Db5', 12, 'sv']], [[0, 'C5', 8, 'v'], [8, 'Eb5', 8, 'sv']], [[0, 'Bb4', 12, 'bvf']]],
    win: [[[0, 'Eb5', 8, 'b'], [8, 'F5', 8, 'b']], [[0, 'G5', 4], [4, 'C6', 12, 'bv']], [[0, 'E6', 16, 'vf']], [[0, 'E6', 16, 'v']]],
    lose: [[[0, 'G4', 8, 'v'], [8, 'F4', 8]], [[0, 'Ab4', 8, 'v'], [8, 'G4', 8]], [[0, 'C4', 16, 'v']], []],
    counter: [[[0, 'G4', 16, 'bv']], [[0, 'C5', 12, 'v'], [12, 'Bb4', 4]], [[0, 'G4', 16, 'v']], [[0, 'Eb5', 8, 'b'], [8, 'D5', 8, 'v']],
      [[0, 'G4', 16, 'bv']], [[0, 'C5', 12, 'v'], [12, 'D5', 4]], [[0, 'Eb5', 16, 'v']], [[0, 'F5', 8, 'b'], [8, 'D5', 8, 'v']]],
  },
};
NIGHT.sections = {
  calm:    { bars: 8, chords: ['im7', 'im7', 'VImaj7', 'VImaj7', 'iv', 'iv', 'Vsus4', 'V'], drums: 'calm', clean: 'clean8', pad: 0.6, sbass: 'pulse16', sbassLevel: 0.3, group: 'calm' },
  tension: { bars: 4, chords: ['i5', 'i5', 'VI5', 'VII5'], drums: 'tension', drums2: 'tension2', gtr: 'mute16', gtrLevel: 0.42, bass: 'root8', bassLevel: 0.55, pad: 0.55, arp: 'pulse16', arpLevel: 0.7, riser: true, group: 'tension' },
  riff:    { bars: 8, chords: ['i5', 'i5', 'i5', 'i5', 'i5', 'i5', 'VI5', 'VII5'], riffPlan: 'ABABABCD', drums: 'riff', bass: 'riff', sbass: 'pulse16', sbassLevel: 0.25, crash: [0], group: 'fight' },
  riff2:   { bars: 8, chords: ['i5', 'i5', 'i5', 'i5', 'i5', 'i5', 'VI5', 'VII5'], riffPlan: 'ABABABCD', drums: 'riff2', bass: 'riff', arp: 'pulse16', arpLevel: 0.6, lead: 'counter', leadLevel: 0.7, crash: [0], group: 'fight' },
  bridge:  { bars: 4, chords: ['VI5', 'VII5', 'iv5', 'V5'], drums: 'bridge', gtr: 'ring2', bass: 'root8', pad: 0.75, arp: 'up16', arpLevel: 0.75, riser: true, crash: [0], group: 'fight' },
  chorus:  { bars: 8, chords: ['VI', 'VII', 'III', 'i', 'VI', 'VII', 'III', 'V'], drums: 'chorus', gtr: 'ring', bass: 'drive8', pad: 1, arp: 'up16', arpLevel: 0.6, lead: 'hook', crash: [0, 4], group: 'hero' },
  chorus2: { bars: 8, chords: ['VI', 'VII', 'III', 'i', 'VI', 'VII', 'III', 'V'], drums: 'chorus', gtr: 'ring', bass: 'drive8', pad: 1, arp: 'up16', arpLevel: 0.65, lead: 'hook', twin: [4, 8], crash: [0, 4], group: 'hero' },
  danger:  { bars: 4, chords: ['i5', 'bII5', 'i5', 'VII5'], drums: 'danger', gtr: 'danger', bass: 'danger', pad: 0.65, padDark: true, arp: 'danger16', arpLevel: 0.7, lead: 'siren', leadLevel: 0.85, crash: [0], group: 'danger' },
  win:     { bars: 4, chords: [['VI', 'VII'], 'I', 'I', 'I'], drums: 'win', gtr: 'hold', bass: 'hold', pad: 1, lead: 'win', crash: [1], end: true, group: 'win', halfGtr: [0] },
  lose:    { bars: 4, chords: ['i', 'iv', 'i', 'i'], drums: 'lose', clean: 'clean8', cleanBars: 3, pad: 0.7, padDark: true, lead: 'lose', leadLevel: 0.6, end: true, group: 'lose' },
};

export const CUES = { sweep: SWEEP, nightfall: NIGHT };
export const CUE_IDS = Object.keys(CUES);
