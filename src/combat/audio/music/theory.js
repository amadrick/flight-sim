// Music theory helpers for the combat score. Pure (no Web Audio, no DOM): safe in node tests.
export const NOTE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
export const SCALES = { minor: [0, 2, 3, 5, 7, 8, 10], major: [0, 2, 4, 5, 7, 9, 11] };
export const QUALITY = { M: [0, 4, 7], m: [0, 3, 7], '5': [0, 7], sus2: [0, 2, 7], sus4: [0, 5, 7], add9: [0, 3, 7, 14], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10] };
// chord symbols relative to a minor key: [semitones above the tonic, quality]
export const CHORDS = {
  i: [0, 'm'], i5: [0, '5'], iadd9: [0, 'add9'], im7: [0, 'm7'], I: [0, 'M'],
  bII: [1, 'M'], bII5: [1, '5'], III: [3, 'M'], III5: [3, '5'], iv: [5, 'm'], iv5: [5, '5'], IV: [5, 'M'],
  v: [7, 'm'], V: [7, 'M'], V5: [7, '5'], Vsus4: [7, 'sus4'], VI: [8, 'M'], VI5: [8, '5'], VImaj7: [8, 'maj7'],
  VII: [10, 'M'], VII5: [10, '5'], i5lo: [0, '5'],
};

/** midi note number from a name like 'D4', 'Bb5', 'C#3'. */
export function midi(name) {
  const m = /^([A-G](?:#|b)?)(-?\d)$/.exec(name); if (!m) throw new Error('bad note ' + name);
  return 12 * (+m[2] + 1) + NOTE[m[1]];
}
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const pc = (m) => ((m % 12) + 12) % 12;

/** { root (pitch class), tones (pitch classes), ivs (intervals), sym } for chord `sym` in minor key `tonic` (pitch class). */
export function chord(tonic, sym) {
  const c = CHORDS[sym]; if (!c) throw new Error('unknown chord ' + sym);
  const root = pc(tonic + c[0]), ivs = QUALITY[c[1]];
  return { sym, root, ivs, quality: c[1], tones: ivs.map((i) => pc(root + i)) };
}
/** pitch classes of the key (natural minor on `tonic`). */
export const keyPcs = (tonic) => SCALES.minor.map((s) => pc(tonic + s));
/**
 * Pitch classes a melody may use over chord `ch` in minor key `tonic`: the scale, with chord tones that are not in the
 * scale added and the non-tonic scale tones a semitone away from them removed (e.g. over V major the 7th is raised).
 */
export function allowedPcs(tonic, ch) {
  const key = keyPcs(tonic), set = new Set(key);
  for (const t of ch.tones) if (!key.includes(t)) {
    set.add(t);
    for (const n of [pc(t + 1), pc(t - 1)]) if (n !== pc(tonic) && !ch.tones.includes(n)) set.delete(n);
  }
  return set;
}
/** Nearest midi note to `m` whose pitch class is in `pcs` (ties go down). */
export function nearest(m, pcs) {
  for (let d = 0; d < 12; d++) { if (pcs.has ? pcs.has(pc(m - d)) : pcs.includes(pc(m - d))) return m - d; if (pcs.has ? pcs.has(pc(m + d)) : pcs.includes(pc(m + d))) return m + d; }
  return m;
}
/** Lowest midi note >= lo with pitch class p. */
export const atOrAbove = (p, lo) => lo + pc(p - lo);

/**
 * Pad voicing with smooth voice leading: n notes from chord tones inside [lo, hi], choosing the voicing
 * whose total movement from `prev` is smallest (prev may be null).
 */
export function voiceLead(ch, prev, lo = 50, hi = 72, n = 4) {
  const cands = [];
  for (let m = lo; m <= hi; m++) if (ch.tones.includes(pc(m))) cands.push(m);
  let best = null, bestCost = Infinity;
  const pick = (start, acc) => {
    if (acc.length === n) {
      // every chord tone (up to n) must be present
      const have = new Set(acc.map(pc)); if (have.size < Math.min(n, ch.tones.length)) return;
      if (acc[acc.length - 1] - acc[0] > 19) return;
      let cost = 0;
      if (prev) for (let i = 0; i < n; i++) cost += Math.abs(acc[i] - prev[Math.min(i, prev.length - 1)]);
      else cost = Math.abs((acc[0] + acc[n - 1]) / 2 - (lo + hi) / 2);
      if (acc[1] - acc[0] < 3) cost += 4;                         // avoid muddy close intervals at the bottom
      if (cost < bestCost) { bestCost = cost; best = acc.slice(); }
      return;
    }
    for (let i = start; i < cands.length; i++) { acc.push(cands[i]); pick(i + 1, acc); acc.pop(); }
  };
  pick(0, []);
  return best || cands.slice(0, n);
}

/** Diatonic third below/above `m` inside the allowed set (for the harmonised twin lead). */
export function diatonicThird(m, pcs, dir = -1) {
  for (const d of dir < 0 ? [3, 4] : [3, 4]) { const t = m + dir * d; if (pcs.has(pc(t))) return t; }
  return m + dir * 3;
}

/** Small deterministic RNG (mulberry32). */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** String hash (FNV-1a) for picking a cue from a mission id. */
export function hash(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
