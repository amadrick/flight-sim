// Arranger: turns a cue (cues.js) into bars of step events and decides, bar by bar, which section plays for the current
// game mood. Pure (no Web Audio): node-tested. Bars are generated once per section and cached.
//
// Moods (from mood.js): 'off' | 'calm' | 'tension' | 'fight' | 'hero' | 'danger' | 'victory' | 'defeat'.
// Event shapes (durations in 16th steps):
//   drums  { i: 'kick'|'snare'|'hat'|'ohat'|'ride'|'crash'|'tom', v, n? (tom 0 high … 2 low), dr: 1 }
//   pitched{ i: 'gtr', n: [midi…], d, v, m (palm mute) } { i: 'bass'|'sbass'|'clean'|'arp', n, d, v }
//           { i: 'pad', n: [midi…], d, v, dark } { i: 'lead'|'lead2', n, d, v, f: flags } { i: 'riser', d, v }
import { DRUMS, FILL_FROM, GTR, BASS, ARP } from './cues.js';
import { chord, midi, pc, voiceLead, atOrAbove, allowedPcs, diatonicThird } from './theory.js';

const VEL = { X: 1, x: 0.75, o: 0.45, g: 0.22, H: 0.95, M: 0.95, L: 0.95, h: 0.6, m: 0.6, l: 0.6 };
const TOM = { H: 0, h: 0, M: 1, m: 1, L: 2, l: 2 };
export const MOOD_GROUP = { calm: 'calm', tension: 'tension', fight: 'fight', hero: 'hero', danger: 'danger', victory: 'win', defeat: 'lose' };
const GROUP_START = { calm: 'calm', tension: 'tension', fight: 'riff', hero: 'chorus', danger: 'danger', win: 'win', lose: 'lose' };
const NEXT = { calm: 'calm', tension: 'tension', danger: 'danger', riff: 'riff2', riff2: 'bridge', bridge: 'riff', chorus: 'chorus2', chorus2: 'riff' };
const BAND = new Set(['fight', 'hero', 'danger']);

function drumEvents(steps, pat, from = 0) {
  for (const inst in pat) {
    const s = pat[inst];
    for (let k = from; k < 16; k++) {
      const c = s[k]; if (c === '.' || c === undefined) continue;
      const e = { i: inst, v: VEL[c] ?? 0.7, dr: 1 };
      if (inst === 'tom') e.n = TOM[c] ?? 1;
      steps[k].push(e);
    }
  }
}
export function fillSteps(name) {
  const steps = Array.from({ length: 16 }, () => []);
  drumEvents(steps, DRUMS[name], FILL_FROM[name] ?? 8);
  return steps;
}

/** chord active at step k of a bar */
const chordAt = (chs, k) => { let c = chs[0]; for (const x of chs) if (x.at <= k) c = x; return c; };

/** Generate every bar of a section: [{ section, index, chords: [{ ch, at }], steps: [16][events] }]. */
export function genSection(cue, name) {
  const sec = cue.sections[name]; if (!sec) throw new Error('no section ' + name);
  const T = cue.tonic, low = cue.gtrLow, bars = [];
  let prevPad = null;
  const rootGtr = (ch) => low + pc(ch.root - T);
  for (let b = 0; b < sec.bars; b++) {
    const steps = Array.from({ length: 16 }, () => []);
    const spec = sec.chords[b % sec.chords.length];
    const syms = Array.isArray(spec) ? spec : [spec];
    const chs = syms.map((s, k) => ({ ch: chord(T, s), at: k * (16 / syms.length) }));
    const nextSpec = sec.chords[(b + 1) % sec.chords.length], nextCh = chord(T, Array.isArray(nextSpec) ? nextSpec[0] : nextSpec);
    // ---- drums ----
    const dname = sec.drums2 && b % 2 ? sec.drums2 : sec.drums;
    if (dname && DRUMS[dname]) drumEvents(steps, DRUMS[dname]);
    if (sec.crash?.includes(b)) steps[0].push({ i: 'crash', v: 1, dr: 1 });
    // ---- rhythm guitar + bass ----
    if (sec.riffPlan) {
      const cell = cue.riffs[sec.riffPlan[b % sec.riffPlan.length]];
      for (const [k, semis, len, kind] of cell) {
        const r = low + semis, mute = kind === 'm';
        steps[k].push({ i: 'gtr', n: mute ? [r, r + 7] : [r, r + 7, r + 12], d: len, v: mute ? 0.8 : 1, m: mute ? 1 : 0 });
        if (sec.bass === 'riff') steps[k].push({ i: 'bass', n: r - 12, d: len, v: mute ? 0.8 : 1 });
      }
    } else if (sec.gtr) {
      const pat = GTR[sec.gtr], lvl = sec.gtrLevel ?? 1;
      for (let k = 0; k < 16; k++) {
        const c = pat[k], ch = chordAt(chs, k).ch, change = k > 0 && chs.some((x) => x.at === k);
        if (c === 'R' || c === 'r' || c === 'M' || (change && c === '-')) {
          let len = 1; while (k + len < 16 && pat[k + len] === '-' && !chs.some((x) => x.at === k + len)) len++;
          const r = rootGtr(ch), mute = c === 'M';
          steps[k].push({ i: 'gtr', n: mute ? [r, r + 7] : [r, r + 7, r + 12], d: c === 'r' ? Math.min(len, 2) : len, v: lvl * (c === 'r' ? 0.85 : mute ? 0.8 : 1), m: mute ? 1 : 0 });
        }
      }
    }
    const bassPat = (key, inst, octave, lvl) => {
      const pat = BASS[key]; if (!pat) return;
      for (let k = 0; k < 16; k++) {
        const c = pat[k], ch = chordAt(chs, k).ch, change = k > 0 && chs.some((x) => x.at === k);
        if (c === '.' || (c === '-' && !change)) continue;
        let len = 1; while (k + len < 16 && pat[k + len] === '-' && !chs.some((x) => x.at === k + len)) len++;
        const r = rootGtr(ch) + octave;
        const n = c === 'O' ? r + 12 : c === '5' ? r + 7 : c === 'A' ? rootGtr(nextCh) + octave - 1 : r;
        steps[k].push({ i: inst, n, d: c === '-' || c === 'R' && len > 1 ? len : Math.max(1, len - 0.2), v: lvl * (k % 4 === 0 ? 1 : 0.82) });
      }
    };
    if (sec.bass && sec.bass !== 'riff') bassPat(sec.bass, 'bass', -12, 1);
    if (sec.sbass) bassPat(sec.sbass, 'sbass', 0, sec.sbassLevel ?? 0.4);
    // ---- pads (voice-led) ----
    const voicings = chs.map(({ ch }) => {
      const v = sec.padDark ? voiceLead(ch, prevPad, 48, 67, 4) : voiceLead(ch, prevPad, 55, 76, 4);
      prevPad = v; return v;
    });
    if (sec.pad) chs.forEach((c, k) => steps[c.at].push({ i: 'pad', n: voicings[k], d: 16 / chs.length, v: sec.pad, dark: sec.padDark ? 1 : 0 }));
    // ---- clean guitar arpeggio (8ths, let ring) ----
    if (sec.clean && (sec.cleanBars === undefined || b < sec.cleanBars)) {
      const pat = ARP[sec.clean];
      for (let k = 0; k < 16; k++) {
        const idx = pat[k]; if (idx === '.') continue;
        const vi = chs.indexOf(chordAt(chs, k)), ladder = voicings[vi].concat(voicings[vi].map((x) => x + 12));
        steps[k].push({ i: 'clean', n: ladder[idx % ladder.length], d: 6, v: k % 4 === 0 ? 0.9 : 0.7 });
      }
    }
    // ---- synth arpeggio (16ths) ----
    if (sec.arp) {
      const pat = ARP[sec.arp];
      for (let k = 0; k < 16; k++) {
        const ch = chordAt(chs, k).ch, base = atOrAbove(ch.root, 62), ladder = [];
        for (let o = 0; o < 3; o++) for (const iv of ch.ivs) if (iv < 12) ladder.push(base + iv + 12 * o);
        steps[k].push({ i: 'arp', n: ladder[pat[k] % ladder.length], d: 0.8, v: (sec.arpLevel ?? 0.6) * (k % 4 === 0 ? 1 : 0.75) });
      }
    }
    // ---- lead guitar ----
    const hook = sec.lead && cue.hooks[sec.lead]?.[b];
    if (hook) for (const [k, note, len, flags = ''] of hook) {
      const n = midi(note), ev = { i: 'lead', n, d: len, v: sec.leadLevel ?? 1, f: flags };
      steps[k].push(ev);
      if (sec.twin && b >= sec.twin[0] && b < sec.twin[1]) {
        const ch = chordAt(chs, k).ch;
        steps[k].push({ i: 'lead2', n: diatonicThird(n, allowedPcs(T, ch), -1), d: len, v: (sec.leadLevel ?? 1) * 0.8, f: flags });
      }
    }
    if (sec.riser && b === sec.bars - 1) steps[0].push({ i: 'riser', d: 16, v: 0.8 });
    bars.push({ section: name, index: b, last: b === sec.bars - 1, chords: chs, steps, group: sec.group });
  }
  return bars;
}

/** Bar-by-bar section logic with a per-section cache. */
export function createArranger(cue) {
  const S = cue.sections, cache = new Map();
  const st = { cur: null, ended: null };
  const fills = { fillBig: fillSteps('fillBig'), fillSmall: fillSteps('fillSmall'), fillRoll: fillSteps('fillRoll') };
  const section = (name) => { let s = cache.get(name); if (!s) { s = genSection(cue, name); cache.set(name, s); } return s; };
  const cont = (c) => ({ name: c.name, bar: c.bar + 1 });

  function decide(mood) {
    const tg = MOOD_GROUP[mood] || null, cur = st.cur;
    if (cur && S[cur.name].end) return cur.bar + 1 < S[cur.name].bars ? cont(cur) : null;   // stings play out
    if (!tg || st.ended === tg) return null;
    if (!cur) return { name: GROUP_START[tg], bar: 0 };
    const cs = S[cur.name], cg = cs.group, last = cur.bar + 1 >= cs.bars;
    if (cg === tg) return last ? { name: NEXT[cur.name], bar: 0 } : cont(cur);
    if (cg === 'fight' && tg === 'hero') return (cur.bar + 1) % 4 === 0 || last ? { name: 'chorus', bar: 0 } : cont(cur);
    if (cg === 'hero' && tg === 'fight') return last ? { name: 'riff', bar: 0 } : cont(cur);
    return { name: GROUP_START[tg], bar: 0 };
  }
  return {
    cue, section,
    get current() { return st.cur; },
    /** what the next bar would be for this mood (no state change) */
    peek: decide,
    /** advance one bar; returns the bar object or null (silence) */
    next(mood) {
      const d = decide(mood), cur = st.cur;
      if (!d && cur && S[cur.name].end) st.ended = S[cur.name].group;
      else if (st.ended && MOOD_GROUP[mood] !== st.ended) st.ended = null;
      st.cur = d;
      return d ? section(d.name)[d.bar] : null;
    },
    /** which drum fill (if any) should replace the rest of the current bar, given the mood */
    fillFor(mood) {
      const cur = st.cur; if (!cur) return null;
      const d = decide(mood); if (!d) return null;
      const cs = S[cur.name];
      if (d.name === cur.name && d.bar === cur.bar + 1) return null;          // just the next bar of the same section
      const dg = S[d.name].group;
      if (dg === 'win') return 'fillRoll';
      if (dg === 'lose' || dg === 'calm' || dg === 'tension') return null;
      const bandSwap = (cs.group === 'fight' && dg === 'hero') || (cs.group === 'hero' && dg === 'fight');
      if (BAND.has(dg) && cs.group !== dg && !bandSwap) return 'fillBig';
      return 'fillSmall';
    },
    fills,
    reset() { st.cur = null; st.ended = null; },
  };
}
