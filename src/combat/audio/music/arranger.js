// Arranger: turns a cue (cues.js) into bars of step events, and decides bar by bar which section plays for the current
// game mood. Pure (no Web Audio): node-tested. Bars are generated once per section and cached.
//
// Moods (from mood.js): 'off' | 'calm' | 'tension' | 'fight' | 'hero' | 'danger' | 'victory' | 'defeat'.
// Signals (optional, from index.js): { push } true while the player holds a lock or just scored a kill.
//
// The fight is a song: intro riff -> verse -> pre-chorus -> chorus -> (intro riff as interlude) -> verse -> pre ->
// chorus 2 -> solo -> chorus 2 -> interlude -> verse ... The song position survives every mood flicker:
//   * a lock or a kill (push) or the hero mood in a verse jumps to the pre-chorus at the next 4-bar phrase;
//   * hero at the end of a chorus goes to the solo (once per chorus);
//   * danger cuts in on the next bar; when it clears, the interrupted section resumes from its start;
//   * when the fight dies down (calm / tension) a 2-bar cool-down rings out before the calm music;
//   * coming back to the fight soon after resumes at the next verse; only a fresh fight (or > 64 bars later) gets the intro.
// Event shapes (durations in 16th steps):
//   drums  { i: 'kick'|'snare'|'hat'|'ohat'|'ride'|'crash'|'tom', v, n? (tom 0 high … 2 low), dr: 1 }
//   pitched{ i: 'gtr', n: [midi…], d, v, m (palm mute), sl? (slide up from sl semitones) } { i: 'scrape', d, v }
//           { i: 'bass'|'sbass'|'clean'|'arp'|'bell', n, d, v } { i: 'pad'|'stab', n: [midi…], d, v, dark? }
//           { i: 'lead'|'lead2'|'horn', n, d, v, f: flags } { i: 'riser', d, v }
import { DRUMS, FILL_FROM, GTR, BASS, ARP, STABS } from './cues.js';
import { chord, midi, pc, voiceLead, atOrAbove, allowedPcs, diatonicThird } from './theory.js';

const VEL = { X: 1, x: 0.75, o: 0.45, g: 0.22, H: 0.95, M: 0.95, L: 0.95, h: 0.6, m: 0.6, l: 0.6 };
const TOM = { H: 0, h: 0, M: 1, m: 1, L: 2, l: 2 };
export const MOOD_GROUP = { calm: 'calm', tension: 'tension', fight: 'band', hero: 'band', danger: 'danger', victory: 'win', defeat: 'lose' };
export const FORM = ['intro', 'verse', 'pre', 'chorus', 'intro', 'verse', 'pre', 'chorus2', 'solo', 'chorus2'];
const LOOP_TO = 4, FRESH_BARS = 64;
const LOUD = new Set(['band', 'danger']);

function drumEvents(steps, pat, from = 0, to = 16) {
  for (const inst in pat) {
    const s = pat[inst];
    for (let k = from; k < to; k++) {
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

const approach = (a, lo) => (a < lo ? a + 12 : a);
const chordAt = (chs, k) => { let c = chs[0]; for (const x of chs) if (x.at <= k) c = x; return c; };

/** Generate every bar of a section: [{ section, index, last, chords: [{ ch, at }], steps: [16][events], group }]. */
export function genSection(cue, name) {
  const sec = cue.sections[name]; if (!sec) throw new Error('no section ' + name);
  const T = cue.tonic, low = cue.gtrLow, bars = [];
  let prevPad = null, prevStab = null;
  const rootGtr = (ch) => low + pc(ch.root - T);
  for (let b = 0; b < sec.bars; b++) {
    const steps = Array.from({ length: 16 }, () => []), last = b === sec.bars - 1;
    const spec = sec.chords[b % sec.chords.length];
    const syms = Array.isArray(spec) ? spec : [spec];
    const chs = syms.map((s, k) => ({ ch: chord(T, s), at: k * (16 / syms.length) }));
    const nextSpec = sec.chords[(b + 1) % sec.chords.length], nextCh = chord(T, Array.isArray(nextSpec) ? nextSpec[0] : nextSpec);
    // ---- drums ----
    const dname = sec.drumPlan ? sec.drumPlan[b] : last && sec.drumsLast ? sec.drumsLast : sec.drums2 && b % 2 ? sec.drums2 : sec.drums;
    const fillAt = last && sec.fillLast ? FILL_FROM[sec.fillLast] : 16;
    if (dname && DRUMS[dname]) drumEvents(steps, DRUMS[dname], 0, fillAt);
    if (fillAt < 16) drumEvents(steps, DRUMS[sec.fillLast], fillAt);
    if (sec.crash?.includes(b)) steps[0].push({ i: 'crash', v: 1, dr: 1 });
    // ---- rhythm guitar + bass ----
    if (sec.riffPlan) {
      const cell = cue.riffs[sec.riffPlan[b % sec.riffPlan.length]];
      for (const [k, semis, len, kind] of cell) {
        const r = low + semis, mute = kind === 'm';
        steps[k].push({ i: 'gtr', n: mute ? [r, r + 7] : [r, r + 7, r + 12], d: len, v: mute ? 0.8 : 1, m: mute ? 1 : 0 });
        if (sec.bass === 'riff') steps[k].push({ i: 'bass', n: r - 12, d: len, v: (sec.bassLevel ?? 1) * (mute ? 0.8 : 1) });
      }
    } else if (sec.gtr) {
      const pat = GTR[sec.gtr], lvl = sec.gtrLevel ?? 1;
      for (let k = 0; k < 16; k++) {
        const c = pat[k], ch = chordAt(chs, k).ch, change = k > 0 && chs.some((x) => x.at === k);
        if (c === 'R' || c === 'r' || c === 'M' || (change && c === '-')) {
          let len = 1; while (k + len < 16 && pat[k + len] === '-' && !chs.some((x) => x.at === k + len)) len++;
          const r = rootGtr(ch), mute = c === 'M';
          const e = { i: 'gtr', n: mute ? [r, r + 7] : [r, r + 7, r + 12], d: c === 'r' ? Math.min(len, 2) : len, v: lvl * (c === 'r' ? 0.85 : mute ? 0.8 : 1), m: mute ? 1 : 0 };
          if (sec.slideIn && b === 0 && k === 0) e.sl = sec.slideIn;
          steps[k].push(e);
        }
      }
    }
    if (sec.scrape && last) steps[12].push({ i: 'scrape', d: 4, v: 0.8 });
    const bassPat = (key, inst, octave, lvl) => {
      const pat = BASS[key]; if (!pat) return;
      for (let k = 0; k < 16; k++) {
        const c = pat[k], ch = chordAt(chs, k).ch, change = k > 0 && chs.some((x) => x.at === k);
        if (c === '.' || (c === '-' && !change)) continue;
        let len = 1; while (k + len < 16 && pat[k + len] === '-' && !chs.some((x) => x.at === k + len)) len++;
        const r = rootGtr(ch) + octave;
        const n = c === 'O' ? r + 12 : c === '5' ? r + 7 : c === 'A' ? approach(rootGtr(nextCh) + octave - 1, low + octave) : r;
        steps[k].push({ i: inst, n, d: c === '-' || c === 'R' && len > 1 ? len : Math.max(1, len - 0.2), v: lvl * (k % 4 === 0 ? 1 : 0.82) });
      }
    };
    if (sec.bass && sec.bass !== 'riff') bassPat(sec.bass, 'bass', -12, sec.bassLevel ?? 1);
    if (sec.sbass) bassPat(sec.sbass, 'sbass', 0, sec.sbassLevel ?? 0.4);
    // ---- pads (voice-led) ----
    const voicings = chs.map(({ ch }) => {
      const v = sec.padDark ? voiceLead(ch, prevPad, 48, 67, 4) : voiceLead(ch, prevPad, 55, 76, 4);
      prevPad = v; return v;
    });
    if (sec.pad) chs.forEach((c, k) => steps[c.at].push({ i: 'pad', n: voicings[k], d: 16 / chs.length, v: sec.pad, dark: sec.padDark ? 1 : 0 }));
    // ---- brass stabs ----
    if (sec.stabs) {
      const pat = STABS[sec.stabs] || sec.stabs;
      for (let k = 0; k < 16; k++) {
        const c = pat[k]; if (c !== 'X' && c !== 'x') continue;
        const ch = chordAt(chs, k).ch, v = voiceLead(ch, prevStab, 58, 79, 4); prevStab = v;
        let len = 1; while (k + len < 16 && pat[k + len] === '.') len++;
        steps[k].push({ i: 'stab', n: v, d: sec.end ? 16 : Math.min(len, c === 'X' ? 3 : 1.5), v: c === 'X' ? 1 : 0.7 });
      }
    }
    // ---- clean guitar arpeggio (8ths, let ring) ----
    if (sec.clean && (sec.cleanBars === undefined || b < sec.cleanBars)) {
      const pat = ARP[sec.clean], cl = sec.cleanLevel ?? 1;
      for (let k = 0; k < 16; k++) {
        const idx = pat[k]; if (idx === '.') continue;
        const vi = chs.indexOf(chordAt(chs, k)), ladder = voicings[vi].concat(voicings[vi].map((x) => x + 12));
        steps[k].push({ i: 'clean', n: ladder[idx % ladder.length], d: 6, v: cl * (k % 4 === 0 ? 0.9 : 0.7) });
      }
    }
    // ---- FM bell melody ----
    const bell = sec.bell && cue.hooks[sec.bell]?.[b];
    if (bell) for (const [k, note, len] of bell) steps[k].push({ i: 'bell', n: midi(note), d: len, v: k % 4 === 0 ? 1 : 0.8 });
    // ---- synth arpeggio (16ths) ----
    if (sec.arp && b >= (sec.arpFrom ?? 0)) {
      const pat = ARP[sec.arp];
      for (let k = 0; k < 16; k++) {
        const ch = chordAt(chs, k).ch, base = atOrAbove(ch.root, 62), ladder = [];
        for (let o = 0; o < 3; o++) for (const iv of ch.ivs) if (iv < 12) ladder.push(base + iv + 12 * o);
        steps[k].push({ i: 'arp', n: ladder[pat[k] % ladder.length], d: 0.8, v: (sec.arpLevel ?? 0.6) * (k % 4 === 0 ? 1 : 0.75) });
      }
    }
    // ---- lead (+ brass double an octave down, + harmonised twin) ----
    const hook = sec.lead && b >= (sec.leadFrom ?? 0) && cue.hooks[sec.lead]?.[b - (sec.leadFrom ?? 0)];
    if (hook) for (const [k, note, len, flags = ''] of hook) {
      const n = midi(note), lv = sec.leadLevel ?? 1;
      steps[k].push({ i: 'lead', n, d: len, v: lv, f: flags });
      if (sec.double) steps[k].push({ i: 'horn', n: n - 12, d: len, v: sec.double, f: flags });
      if (sec.twin && b >= sec.twin[0] && b < sec.twin[1]) {
        const ch = chordAt(chs, k).ch;
        steps[k].push({ i: 'lead2', n: diatonicThird(n, allowedPcs(T, ch), -1), d: len, v: lv * 0.8, f: flags });
      }
    }
    if (sec.riser && last) steps[0].push({ i: 'riser', d: 16, v: 0.8 });
    bars.push({ section: name, index: b, last, chords: chs, steps, group: sec.group });
  }
  return bars;
}

/** Bar-by-bar song logic with a per-section cache. */
export function createArranger(cue) {
  const S = cue.sections, cache = new Map();
  const st = { cur: null, ended: null, form: -1, saved: null, sinceBand: Infinity, soloAfter: -1 };
  const fills = { fillBig: fillSteps('fillBig'), fillSmall: fillSteps('fillSmall'), fillRoll: fillSteps('fillRoll') };
  const section = (name) => { let s = cache.get(name); if (!s) { s = genSection(cue, name); cache.set(name, s); } return s; };
  const cont = (c) => ({ name: c.name, bar: c.bar + 1, form: c.form });
  const at = (form) => ({ name: FORM[form], bar: 0, form });
  const nextForm = (i) => (i + 1 >= FORM.length ? LOOP_TO : i + 1);
  const findForm = (name, from) => { for (let k = 1; k <= FORM.length; k++) { const i = (from + k) % FORM.length; if (FORM[i] === name) return i; } return 0; };

  /** where the band starts when the fight (re)starts */
  function entry() {
    if (st.form < 0 || st.sinceBand > FRESH_BARS) return at(0);
    return at(findForm('verse', st.form));
  }
  function resume() {
    const s = st.saved; if (!s) return entry();
    return s.name === 'intro' ? at(nextForm(s.form)) : { name: s.name, bar: 0, form: s.form };
  }
  function bandNext(cur, last, mood, sig) {
    const hot = mood === 'hero' || !!sig?.push;
    if (cur.name === 'verse' && hot && (cur.bar + 1) % 4 === 0 && !last) return at(findForm('pre', cur.form));
    if (!last) return cont(cur);
    if (cur.name === 'verse' || (cur.name === 'intro' && cur.form >= LOOP_TO && hot)) return at(findForm('pre', cur.form));
    if ((cur.name === 'chorus' || cur.name === 'chorus2') && mood === 'hero' && st.soloAfter !== cur.form) return { name: 'solo', bar: 0, form: 8, soloFrom: cur.form };
    return at(nextForm(cur.form));
  }

  function decide(mood, sig) {
    const tg = MOOD_GROUP[mood] || null, cur = st.cur;
    if (cur && S[cur.name].end) return cur.bar + 1 < S[cur.name].bars ? cont(cur) : null;   // tags play out
    if (!tg || st.ended === tg) return null;
    if (!cur) return tg === 'band' ? entry() : { name: tg === 'win' || tg === 'lose' ? tg : tg, bar: 0 };
    const cs = S[cur.name], cg = cs.group, last = cur.bar + 1 >= cs.bars;
    switch (tg) {
      case 'band':
        if (cg === 'band') return bandNext(cur, last, mood, sig);
        if (cg === 'danger') return resume();
        return entry();
      case 'danger':
        return cg === 'danger' ? (last ? { name: 'danger', bar: 0 } : cont(cur)) : { name: 'danger', bar: 0 };
      case 'calm': case 'tension':
        if (LOUD.has(cg)) return { name: 'cool', bar: 0 };
        if (cg === 'cool') return last ? { name: tg, bar: 0 } : cont(cur);
        if (cg === tg) return last ? { name: tg, bar: 0 } : cont(cur);
        return { name: tg, bar: 0 };
      default:
        return { name: tg, bar: 0 };                                                           // win / lose tags
    }
  }
  /** is the next bar the planned continuation (no fill needed)? */
  function natural(cur, d) {
    if (!d) return true;
    if (d.name === cur.name && d.bar === cur.bar + 1) return true;
    const cs = S[cur.name];
    return cur.bar + 1 >= cs.bars && (cs.fillLast || cs.drumsLast || cs.riser || cs.scrape) && S[d.name].group === cs.group;
  }
  return {
    cue, section,
    get current() { return st.cur; },
    get state() { return { form: st.form, saved: st.saved?.name || null, sinceBand: st.sinceBand }; },
    /** what the next bar would be for this mood (no state change) */
    peek: decide,
    /** advance one bar; returns the bar object or null (silence) */
    next(mood, sig) {
      const d = decide(mood, sig), cur = st.cur;
      if (!d && cur && S[cur.name].end) st.ended = S[cur.name].group;
      else if (st.ended && MOOD_GROUP[mood] !== st.ended) st.ended = null;
      if (d) {
        const g = S[d.name].group;
        if (g === 'band') { st.form = d.form ?? st.form; st.sinceBand = 0; if (d.soloFrom !== undefined) st.soloAfter = d.soloFrom; if (d.name === 'chorus2' && cur?.name === 'solo') st.soloAfter = d.form; }
        else st.sinceBand++;
        if (g === 'danger' && cur && S[cur.name].group === 'band') st.saved = { name: cur.name, form: cur.form };
        if (g !== 'danger' && g !== 'band') st.saved = null;
      }
      st.cur = d;
      return d ? section(d.name)[d.bar] : null;
    },
    /** which drum fill (if any) should replace the rest of the current bar, given the mood */
    fillFor(mood, sig) {
      const cur = st.cur; if (!cur || S[cur.name].end) return null;
      const d = decide(mood, sig); if (!d || natural(cur, d)) return null;
      const cg = S[cur.name].group, dg = S[d.name].group;
      if (dg === 'win') return 'fillRoll';
      if (!LOUD.has(dg)) return null;
      return cg !== dg ? 'fillBig' : 'fillSmall';
    },
    /** true when the next bar brings the band in from the quiet states (play a riser into it) */
    entering(mood, sig) {
      const cur = st.cur; if (!cur) return false;
      const d = decide(mood, sig);
      return !!d && S[d.name].group === 'band' && !LOUD.has(S[cur.name].group);
    },
    fills,
    reset() { st.cur = null; st.ended = null; st.form = -1; st.saved = null; st.sinceBand = Infinity; st.soloAfter = -1; },
  };
}
