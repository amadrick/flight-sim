// Adaptive music engine (live side). Sections are pre-rendered into stems (render.js); this schedules them bar by bar
// on the AudioContext clock: one band + one drum AudioBufferSourceNode per section entry, drum fills and the merge riser
// as one-shots, crossfades on every cut. Per frame it does a few comparisons; nodes exist only for what is sounding.
//
// createMusic(ac, dest, opts) -> { update(now, mood, sig), setCue(id), stop(fade), setVolume(v), setEnabled(on),
//   setDuck(k), ready(), dispose(), info, stepDur, playing }
// Works with a live AudioContext and with an OfflineAudioContext (the harness calls update() at suspend points).
import { CUES, FILL_FROM } from './cues.js';
import { createArranger } from './arranger.js';
import { createStems, ORDER } from './render.js';
import { G } from './synth.js';

export const MUSIC_LEVEL = 0.17;        // music bus gain into the master (before the user's music volume)
const XFADE = 0.03;                     // time constant of the fade on a cut section (s)
const FADE_IN = 0.006;                  // ramp when a section starts mid-buffer (s)

export function createMusic(ac, dest, opts = {}) {
  let cue = CUES[opts.cue] || CUES.sweep, arr = createArranger(cue);
  let stems = opts.stems || createStems(cue, { sr: opts.sr, log: opts.log ? (s) => info.log?.push({ msg: s }) : null });
  let barDur = 240 / cue.bpm, sd = barDur / 16;
  const LOOK = opts.lookahead ?? 0.3;
  const out = G(ac, 0), trim = G(ac, MUSIC_LEVEL); trim.connect(out); out.connect(dest);
  let mood = 'off', sig = null, volume = opts.volume ?? 1, duck = 1, enabled = true, pendingCue = null;
  let nextT = 0, curT = 0, cur = null, voice = null, fillDone = false, riserDone = false, silentBars = 0, started = false;
  const live = new Set();
  const info = { cue: cue.id, section: null, bar: -1, mood: 'off', bars: 0, skipped: 0, playing: false, waiting: null, fills: 0, risers: 0, cuts: 0,
    voices: 0, nodes: 0, stems: stems.stats, log: opts.log ? [] : null };

  // ---- voices ----------------------------------------------------------------------------------------------------
  function track(v) { live.add(v); info.voices = live.size; info.nodes = [...live].reduce((n, x) => n + x.n, 0); }
  function untrack(v) { if (!live.delete(v)) return; for (const n of v.nodes) { try { n.disconnect(); } catch {} } info.voices = live.size; info.nodes = [...live].reduce((n, x) => n + x.n, 0); }
  function play(buf, t, offset, gain = 1) {
    const s = ac.createBufferSource(); s.buffer = buf;
    const g = G(ac, gain); s.connect(g); g.connect(trim);
    s.start(t, Math.max(0, offset));
    return { s, g };
  }
  function startSection(name, barIdx, t, forName) {
    const e = stems.get(name); if (!e) return null;
    const off = (barIdx % e.bars) * e.barDur;
    const band = play(e.band, t, off), drums = e.drums ? play(e.drums, t, off) : null;
    const v = { name, for: forName, bar: barIdx % e.bars, bars: e.bars, band, drums, nodes: [band.s, band.g], n: 2, end: t - off + e.duration };
    if (drums) { v.nodes.push(drums.s, drums.g); v.n = 4; }
    if (off > 0) for (const p of [band, drums]) if (p) { p.g.gain.setValueAtTime(0, t); p.g.gain.linearRampToValueAtTime(1, t + FADE_IN); }
    band.s.onended = () => untrack(v);
    track(v);
    return v;
  }
  function cut(v, t, tc = XFADE) {
    for (const p of [v.band, v.drums]) if (p) { p.g.gain.cancelScheduledValues(t); p.g.gain.setTargetAtTime(0, t, tc); try { p.s.stop(t + tc * 10); } catch {} }
    info.cuts++;
  }
  function oneShot(buf, t, offset = 0) {
    const p = play(buf, t, offset), v = { nodes: [p.s, p.g], n: 2 };
    p.s.onended = () => untrack(v); track(v);
    return p;
  }

  // ---- bar scheduling --------------------------------------------------------------------------------------------
  function fallbackFor(name) {
    for (const n of [name, 'chorus', 'verse', 'intro', 'tension', 'calm']) if (stems.get(n) && cue.sections[n].group === cue.sections[name].group) return n;
    return null;
  }
  function barStart(t) {
    const nb = arr.next(mood, sig);
    fillDone = riserDone = false;
    if (!nb) {
      if (voice) { if (!(cur && cur.last && voice.for === cur.section)) cut(voice, t, 0.25); voice = null; }
      cur = null; info.section = null; info.bar = -1;
      if (++silentBars > 1) { info.playing = false; started = false; }
      return;
    }
    silentBars = 0;
    const contin = voice && cur && voice.for === nb.section && nb.index === cur.index + 1 && voice.bar + 1 < voice.bars;
    if (contin) voice.bar++;
    else {
      const old = voice, ended = old && cur && cur.last && old.for === cur.section && old.bar + 1 >= old.bars;
      const name = fallbackFor(nb.section);
      if (name !== nb.section) stems.want(nb.section);
      voice = name ? startSection(name, nb.index, t, nb.section) : null;
      if (old && !ended) cut(old, t);                              // a section that finished rings out on its own tail
      info.waiting = name === nb.section ? null : nb.section;
    }
    cur = nb; curT = t; info.bars++; info.section = nb.section; info.bar = nb.index;
    if (info.log) info.log.push({ t: +t.toFixed(3), section: nb.section, bar: nb.index, mood, playing: voice?.name || null });
  }
  function scheduleFill(name, tf) {
    const buf = stems.fill(name); if (!buf) return;
    if (voice?.drums) { const g = voice.drums.g.gain; g.setTargetAtTime(0, tf, 0.004); g.setTargetAtTime(1, curT + barDur, 0.003); }
    oneShot(buf, tf); fillDone = true; info.fills++;
  }
  function scheduleRiser(now) {
    const buf = stems.riser; riserDone = true; if (!buf) return;
    const end = curT + barDur, t = Math.max(now + 0.02, end - barDur);
    if (end - t < 0.3) return;
    oneShot(buf, t, barDur - (end - t)); info.risers++;
  }

  function level(t, tc = 0.25) { out.gain.setTargetAtTime(enabled ? volume * duck : 0, t, tc); }
  const firstFor = (m) => { const d = arr.peek(m, sig); return d && d.name; };

  const api = {
    info,
    get mood() { return mood; },
    get playing() { return info.playing; },
    get stepDur() { return sd; },
    get stems() { return stems; },
    /** resolves when every section of the current cue is rendered (harness / loading screens) */
    ready() { return stems.all(); },
    /** Pick a cue by id ('sweep' | 'nightfall'); takes effect when the music next starts from silence. */
    setCue(id) {
      const c = CUES[id]; if (!c || c === cue) return;
      if (info.playing) { pendingCue = c; return; }
      stems.dispose();
      cue = c; arr = createArranger(cue); barDur = 240 / cue.bpm; sd = barDur / 16; info.cue = cue.id;
      stems = createStems(cue, { sr: opts.sr }); info.stems = stems.stats;
      stems.prepare(ORDER);
    },
    /** start rendering the current cue's stems (call at mission load) */
    preload(first) { if (first) stems.want(first); stems.prepare(ORDER); },
    setVolume(v) { volume = Math.max(0, Math.min(1, +v || 0)); level(ac.currentTime, 0.1); },
    setEnabled(on) { enabled = !!on; level(ac.currentTime, 0.3); },
    /** duck factor (0..1) under radio speech / missile warnings */
    setDuck(k) { if (Math.abs(k - duck) < 0.005) return; const down = k < duck; duck = k; level(ac.currentTime, down ? 0.06 : 0.35); },
    /** Call every frame with the AudioContext time, the mood (mood.js) and signals ({ push }). */
    update(now, m, s) {
      mood = m || 'off'; sig = s || null; info.mood = mood;
      if (!info.playing) {
        if (mood === 'off' || !enabled) return;
        if (pendingCue) { const c = pendingCue; pendingCue = null; api.setCue(c.id); }
        const first = firstFor(mood); if (!first) return;          // e.g. the victory tag already played
        if (!stems.get(first)) { stems.want(first); info.waiting = first; return; }
        level(now, 0.05); info.playing = true; started = true; nextT = now + 0.05; cur = null; voice = null; silentBars = 0;
      }
      if (now > nextT + barDur) { info.skipped += Math.floor((now - nextT) / barDur); nextT = now + 0.05; }   // stalled > 1 bar: re-sync
      while (info.playing && now >= nextT - LOOK) { barStart(nextT); nextT += barDur; }
      if (!cur || !info.playing) return;
      // mid-bar: a drum fill into an unplanned change, a riser when the band comes in
      if (!fillDone && now >= curT + 8 * sd - LOOK) {
        const f = arr.fillFor(mood, sig);
        if (f) {
          const t8 = curT + FILL_FROM[f] * sd, t12 = curT + 12 * sd;
          if (t8 > now + 0.005) scheduleFill(f, t8);
          else if (t12 > now + 0.005) scheduleFill('fillSmall', t12);
          else fillDone = true;
        }
      }
      if (!riserDone && arr.entering(mood, sig)) scheduleRiser(now);
    },
    /** Stop at once (mission abort): fade out quickly, reset the arrangement. */
    stop(fade = 0.4) {
      const t = ac.currentTime;
      out.gain.cancelScheduledValues(t); out.gain.setTargetAtTime(0, t, fade / 3);
      for (const v of live) for (const n of v.nodes) if (n.stop) { try { n.stop(t + fade * 2); } catch {} }
      arr.reset(); voice = null; cur = null; info.playing = false; started = false; info.section = null;
    },
    dispose() {
      for (const v of [...live]) { for (const n of v.nodes) { try { n.stop?.(); } catch {} } untrack(v); }
      try { out.disconnect(); } catch {}
      stems.dispose(); info.playing = false;
    },
  };
  void started;
  return api;
}
