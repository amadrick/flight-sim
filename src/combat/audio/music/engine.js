// Adaptive music engine: look-ahead step sequencer on the AudioContext clock driving the instruments in synth.js.
// createMusic(ac, dest) -> { update(now, mood), setCue(id), stop(fast), setVolume(v), setDuck(k), dispose(), info }
// Works with a live AudioContext and with an OfflineAudioContext (the harness calls update() at suspend points).
import { CUES, FILL_FROM } from './cues.js';
import { createArranger } from './arranger.js';
import { createClock } from './clock.js';
import { G, BQ, noise, makeReverb, makePingPong, makeGatedVerb, makeDrums, makeRhythmGuitar, makeLeadGuitar, makeCleanGuitar, makeBass, makeSynthBass, makePad, makeArp, makeRiser } from './synth.js';

export const MUSIC_LEVEL = 0.17;        // music bus gain into the master (before the user's music volume)

export function createMusic(ac, dest, opts = {}) {
  let cue = CUES[opts.cue] || CUES.sweep;
  let arr = createArranger(cue);
  const clock = createClock({ bpm: cue.bpm, lookahead: opts.lookahead ?? 0.25 });
  let built = null, bar = null, fill = null, mood = 'off', volume = opts.volume ?? 1, duck = 1, enabled = true, padOn = false, silentBars = 0;
  const info = { cue: cue.id, section: null, bar: -1, mood: 'off', bars: 0, skipped: 0, playing: false, log: opts.log ? [] : null };

  function build() {
    const out = G(ac, 0);                                   // fade / volume / duck
    const hp = BQ(ac, 'highpass', 30, 0.7);
    const glue = ac.createDynamicsCompressor();
    glue.threshold.value = -18; glue.knee.value = 8; glue.ratio.value = 3; glue.attack.value = 0.01; glue.release.value = 0.18;
    const sum = G(ac, 1), trim = G(ac, MUSIC_LEVEL);
    sum.connect(hp); hp.connect(glue); glue.connect(trim); trim.connect(out); out.connect(dest);
    const pump = G(ac, 1); pump.connect(sum);                // side-chain-style ducking of the sustained layers on each kick
    const drumBus = G(ac, 0.9); drumBus.connect(sum);
    const room = makeReverb(ac, { decay: 0.9, damp: 5000, size: 0.85, level: 0.5 }); room.out.connect(sum);
    const hall = makeReverb(ac, { decay: 2.2, damp: 3800, size: 1.3, level: 0.55 }); hall.out.connect(sum);
    const delay = makePingPong(ac, { time: cue ? (60 / cue.bpm) * 0.75 : 0.34, fb: 0.36, tone: 3000, level: 0.5 }); delay.out.connect(sum);
    const sends = { reverb: hall.in, delay: delay.in };
    const gate = makeGatedVerb(ac, drumBus);
    const white = noise(ac, 'white'); white.start();
    const gtrBus = G(ac, 1); gtrBus.connect(pump); const gtrRoom = G(ac, 0.12); gtrBus.connect(gtrRoom); gtrRoom.connect(room.in);
    const inst = {
      drums: makeDrums(ac, drumBus, room.in, gate, white),
      gtr: makeRhythmGuitar(ac, gtrBus, white),
      lead: makeLeadGuitar(ac, sum, sends, { pan: 0.1 }),
      lead2: makeLeadGuitar(ac, sum, sends, { pan: -0.35, detune: -6 }),
      clean: makeCleanGuitar(ac, pump),
      bass: makeBass(ac, pump, white),
      sbass: makeSynthBass(ac, pump),
      pad: makePad(ac, pump, sends),
      arp: makeArp(ac, pump, sends),
      riser: makeRiser(ac, sum, sends, white),
    };
    const cleanVerb = G(ac, 0.35); inst.clean.out.connect(cleanVerb); cleanVerb.connect(hall.in);
    const cleanDelay = G(ac, 0.25); inst.clean.out.connect(cleanDelay); cleanDelay.connect(delay.in);
    const sources = [white];
    for (const k in inst) sources.push(...inst[k].sources);
    return { out, pump, delay, inst, sources, nodes: [out, hp, glue, sum, trim] };
  }

  const sd = () => clock.stepDur;
  function trigger(e, t) {
    const I = built.inst;
    if (opts.only && !opts.only.includes(e.dr ? 'drums' : e.i) && !opts.only.includes(e.i)) return;
    if (e.dr) { if (I.drums.trigger(e, t) === 'kick') { const p = built.pump.gain; p.setTargetAtTime(0.55, t, 0.003); p.setTargetAtTime(1, t + 0.03, 0.09); } return; }
    const v = I[e.i]; if (!v) return;
    if (e.i === 'pad') padOn = true;
    v.trigger(e, t, sd());
  }
  function onStep(t, step) {
    if (step === 0) {
      fill = null;
      const nb = arr.next(mood);
      if (!nb) {
        if (bar) releaseAll(t);
        bar = null; silentBars++;
        info.section = null; info.bar = -1;
        if (silentBars > 2) { clock.stop(); info.playing = false; }
        return;
      }
      silentBars = 0;
      if (padOn && !nb.steps.some((s) => s.some((e) => e.i === 'pad'))) { built.inst.pad.release(t); padOn = false; }
      if (bar && bar.section !== nb.section) { built.inst.lead.release(t); built.inst.lead2.release(t); }
      bar = nb; info.bars++; info.section = bar.section; info.bar = bar.index;
      if (info.log) info.log.push({ t: +t.toFixed(3), section: bar.section, bar: bar.index, mood });
    }
    if (!bar) return;
    if (step === 8 && !fill) { const f = arr.fillFor(mood); if (f && FILL_FROM[f] === 8) fill = f; }
    if (step === 12 && !fill) { const f = arr.fillFor(mood); if (f) fill = 'fillSmall'; }
    const evs = bar.steps[step];
    for (let i = 0; i < evs.length; i++) { const e = evs[i]; if (fill && e.dr && step >= FILL_FROM[fill]) continue; trigger(evs[i], t); }
    if (fill && step >= FILL_FROM[fill]) { const fe = arr.fills[fill][step]; for (let i = 0; i < fe.length; i++) trigger(fe[i], t); }
  }
  function releaseAll(t) {
    if (!built) return;
    for (const k in built.inst) built.inst[k].release(t);
    padOn = false;
  }
  function level(t, tc = 0.25) {
    if (!built) return;
    built.out.gain.setTargetAtTime(enabled ? volume * duck : 0, t, tc);
  }

  const api = {
    info,
    get mood() { return mood; },
    get playing() { return info.playing; },
    get stepDur() { return clock.stepDur; },
    /** Pick a cue by id ('sweep' | 'nightfall'); takes effect when the music next starts from silence. */
    setCue(id) {
      const c = CUES[id]; if (!c || c === cue) return;
      if (info.playing) { api._pendingCue = c; return; }
      cue = c; arr = createArranger(cue); clock.setTempo(cue.bpm); info.cue = cue.id;
      if (built) built.delay.setTime((60 / cue.bpm) * 0.75, ac.currentTime);
    },
    setVolume(v) { volume = Math.max(0, Math.min(1, +v || 0)); level(ac.currentTime, 0.1); },
    setEnabled(on) { enabled = !!on; level(ac.currentTime, 0.3); },
    /** duck factor (0..1) for radio speech / warnings */
    setDuck(k) { if (Math.abs(k - duck) < 0.01) return; duck = k; level(ac.currentTime, k < duck ? 0.08 : 0.4); },
    /** Call every frame with the AudioContext time and the current mood (see mood.js). */
    update(now, m) {
      mood = m || 'off';
      info.mood = mood;
      if (!info.playing) {
        if (mood === 'off' || !enabled) return;
        if (api._pendingCue) { const c = api._pendingCue; api._pendingCue = null; cue = null; api.setCue(c.id); }
        if (!built) built = build();
        if (!arr.peek(mood)) return;                             // e.g. the victory sting already played
        level(now, 0.05);
        clock.start(now + 0.06); info.playing = true; bar = null; silentBars = 0;
      }
      clock.pump(now, onStep);
      info.skipped = clock.skipped;
    },
    /** Stop at once (mission abort): fade out quickly, reset the arrangement. */
    stop(fade = 0.4) {
      if (!built) return;
      const t = ac.currentTime;
      built.out.gain.setTargetAtTime(0, t, fade / 3);
      releaseAll(t); clock.stop(); arr.reset(); bar = null; info.playing = false; info.section = null;
    },
    dispose() {
      if (!built) return;
      for (const s of built.sources) { try { s.stop(); } catch {} try { s.disconnect(); } catch {} }
      try { built.out.disconnect(); } catch {}
      built = null; info.playing = false;
    },
  };
  return api;
}
