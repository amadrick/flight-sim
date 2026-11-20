// Stem renderer: every section of a cue is rendered once, offline, into two AudioBuffers (band and drums) at mission
// load, so the live music is just a couple of AudioBufferSourceNodes and costs almost nothing per frame.
// Fills (drums only) and the merge riser are rendered as short one-shots. The heavy synth graph (synth.js: ~80
// oscillators, oversampled waveshapers, reverbs) only ever exists inside an OfflineAudioContext.
//
// createStems(cue, { sr }) -> { prepare(names), want(name), get(name), fill(name), riser, ready, all(), stats, dispose() }
import { CUES, FILL_FROM } from './cues.js';
import { genSection, fillSteps } from './arranger.js';
import { G, BQ, noise, makeReverb, makePingPong, makeGatedVerb, makeDrums, makeRhythmGuitar, makeLeadGuitar, makeCleanGuitar,
  makeBass, makeSynthBass, makePad, makeArp, makeRiser, makeBell, makeStab, makeHorn } from './synth.js';

export const STEM_SR = 32000;
export const ORDER = ['calm', 'tension', 'intro', 'verse', 'pre', 'chorus', 'danger', 'cool', 'win', 'lose', 'chorus2', 'solo'];
const TAIL = 2.2, END_TAIL = 4;

function glue(ac, threshold = -18, ratio = 3) {
  const c = ac.createDynamicsCompressor();
  c.threshold.value = threshold; c.knee.value = 8; c.ratio.value = ratio; c.attack.value = 0.01; c.release.value = 0.18;
  return c;
}

/**
 * The instrument rig inside an offline context. band / drums: stereo destinations (drums may be the band bus).
 * Instruments are created on first use, so a section only pays for what it plays.
 */
export function buildRig(ac, cue, band, drums, { os = '4x' } = {}) {
  const white = noise(ac, 'white'); white.start();
  const sum = G(ac, 1), hp = BQ(ac, 'highpass', 30, 0.7), gl = glue(ac);
  sum.connect(hp); hp.connect(gl); gl.connect(band);
  let dsum = sum;
  if (drums !== band) { dsum = G(ac, 1); const dhp = BQ(ac, 'highpass', 30, 0.7), dgl = glue(ac, -14, 2.5); dsum.connect(dhp); dhp.connect(dgl); dgl.connect(drums); }
  const pump = G(ac, 1); pump.connect(sum);                 // side-chain-style ducking of the sustained layers on each kick
  const lazy = (f) => { let v; return () => (v ||= f()); };
  const hall = lazy(() => { const r = makeReverb(ac, { decay: 2.2, damp: 3800, size: 1.3, level: 0.55 }); r.out.connect(sum); return r; });
  const delay = lazy(() => { const d = makePingPong(ac, { time: (60 / cue.bpm) * 0.75, fb: 0.36, tone: 3000, level: 0.5 }); d.out.connect(sum); return d; });
  const sends = { get reverb() { return hall().in; }, get delay() { return delay().in; } };
  const S = () => ({ reverb: hall().in, delay: delay().in });
  const gtrRoom = lazy(() => { const r = makeReverb(ac, { decay: 0.9, damp: 5000, size: 0.85, level: 0.5 }); r.out.connect(sum); return r; });
  const drumRoom = lazy(() => { const r = makeReverb(ac, { decay: 0.9, damp: 5000, size: 0.85, level: 0.5 }); r.out.connect(dsum); return r; });
  const make = {
    drums: () => { const bus = G(ac, 0.9); bus.connect(dsum); return makeDrums(ac, bus, drumRoom().in, makeGatedVerb(ac, bus), white); },
    gtr: () => { const bus = G(ac, 1); bus.connect(pump); const rs = G(ac, 0.12); bus.connect(rs); rs.connect(gtrRoom().in); return makeRhythmGuitar(ac, bus, white, { os }); },
    lead: () => makeLeadGuitar(ac, sum, S(), { pan: 0.1, os }),
    lead2: () => makeLeadGuitar(ac, sum, S(), { pan: -0.35, detune: -6, os }),
    clean: () => { const c = makeCleanGuitar(ac, pump); const v = G(ac, 0.35), d = G(ac, 0.25); c.out.connect(v); v.connect(hall().in); c.out.connect(d); d.connect(delay().in); return c; },
    bass: () => makeBass(ac, pump, white),
    sbass: () => makeSynthBass(ac, pump),
    pad: () => makePad(ac, pump, S()),
    arp: () => makeArp(ac, pump, S()),
    riser: () => makeRiser(ac, sum, S(), white),
    bell: () => makeBell(ac, sum, S()),
    stab: () => makeStab(ac, pump, S()),
    horn: () => makeHorn(ac, pump, S()),
  };
  const inst = {};
  const get = (k) => (inst[k] ||= make[k]());
  void sends;
  return {
    trigger(e, t, sd) {
      if (e.dr) {
        if (get('drums').trigger(e, t) === 'kick') { const p = pump.gain; p.setTargetAtTime(0.55, t, 0.003); p.setTargetAtTime(1, t + 0.03, 0.09); }
        return;
      }
      const k = e.i === 'scrape' ? 'gtr' : e.i; if (!make[k]) return;
      get(k).trigger(e, t, sd);
    },
    release(t) { for (const k in inst) inst[k].release(t); },
  };
}

const OAC = () => globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
const now = () => (globalThis.performance?.now ? performance.now() : Date.now());

// yield to the event loop: a MessageChannel task (not clamped like setTimeout, keeps going in a background tab)
let chan = null; const waiting = [];
const yieldTask = () => new Promise((r) => {
  if (!chan && typeof MessageChannel !== 'undefined') { chan = new MessageChannel(); chan.port1.onmessage = () => waiting.shift()?.(); }
  if (!chan) { setTimeout(r, 0); return; }
  waiting.push(r); chan.port2.postMessage(0);
});
/**
 * Main-thread work is cut into slices of at most `budgetMs` (yielding to the game between them), so preparing the
 * stems never costs a frame. Tracks the total and the longest slice.
 */
function slicer(budgetMs) {
  const m = { total: 0, maxSlice: 0, start: now() };
  const note = (d, where) => { m.total += d; if (d > m.maxSlice) { m.maxSlice = d; m.where = where; } };
  m.breathe = async (force, where) => { const n = now(), d = n - m.start; if (force || d > budgetMs) { note(d, where); await yieldTask(); m.start = now(); } };
  m.end = (where) => note(now() - m.start, where);
  return m;
}

/** Render one section: returns { band, drums|null, bars, barDur, duration, mainMs, maxSliceMs, renderMs }. */
export async function renderSection(cue, name, sr = STEM_SR, opts = {}) {
  const O = OAC(); const sec = cue.sections[name], barDur = 240 / cue.bpm, sd = barDur / 16;
  const M = slicer(opts.budgetMs ?? 3);
  const bars = genSection(cue, name), own = !!sec.ownDrums;
  await M.breathe(false, 'gen');
  const len = Math.ceil(sr * (bars.length * barDur + (sec.end ? END_TAIL : TAIL)));
  const ac = new O(own ? 2 : 4, len, sr);
  let band = G(ac, 1), drums = band;
  if (own) band.connect(ac.destination);
  else {
    ac.destination.channelInterpretation = 'discrete';
    const m = ac.createChannelMerger(4); m.connect(ac.destination);
    const bS = ac.createChannelSplitter(2), dS = ac.createChannelSplitter(2);
    drums = G(ac, 1); band.connect(bS); drums.connect(dS);
    bS.connect(m, 0, 0); bS.connect(m, 1, 1); dS.connect(m, 0, 2); dS.connect(m, 1, 3);
    band.channelCount = 2; band.channelCountMode = 'explicit'; drums.channelCount = 2; drums.channelCountMode = 'explicit';
  }
  // section level (loud-quiet dynamics) and an optional swell across the section (pre-chorus lift)
  const lv = sec.level ?? 1, total = bars.length * barDur;
  for (const g of new Set([band, drums])) {
    g.gain.setValueAtTime(lv * (sec.swell ? sec.swell[0] : 1), 0);
    if (sec.swell) g.gain.linearRampToValueAtTime(lv * sec.swell[1], total - barDur * 0.25);
  }
  const rig = buildRig(ac, cue, band, drums, opts);
  for (let b = 0; b < bars.length; b++) for (let k = 0; k < 16; k++) {
    const evs = bars[b].steps[k], t = (b * 16 + k) * sd;
    for (let i = 0; i < evs.length; i++) { rig.trigger(evs[i], t, sd); await M.breathe(false, evs[i].i); }
  }
  rig.release(bars.length * barDur + (sec.end ? 2.5 : 0.05));
  M.end('release');
  const t1 = now();
  const out = await ac.startRendering();
  const t2 = now(); M.start = t2;
  let bandBuf = out, drumBuf = null;
  if (!own) {
    bandBuf = new AudioBuffer({ length: out.length, numberOfChannels: 2, sampleRate: sr });
    bandBuf.copyToChannel(out.getChannelData(0), 0); bandBuf.copyToChannel(out.getChannelData(1), 1);
    await M.breathe(true, 'copy1');
    drumBuf = new AudioBuffer({ length: out.length, numberOfChannels: 2, sampleRate: sr });
    drumBuf.copyToChannel(out.getChannelData(2), 0); drumBuf.copyToChannel(out.getChannelData(3), 1);
  }
  M.end('copy2');
  return { band: bandBuf, drums: drumBuf, bars: bars.length, barDur, duration: out.duration, mainMs: M.total, maxSliceMs: M.maxSlice, where: M.where, renderMs: t2 - t1 };
}

/** A drum fill from its first step to the bar end (+ room tail), drums only. */
async function renderFill(cue, name, sr) {
  const O = OAC(), sd = 60 / cue.bpm / 4, from = FILL_FROM[name], steps = fillSteps(name);
  const ac = new O(2, Math.ceil(sr * ((16 - from) * sd + 1.6)), sr);
  const rig = buildRig(ac, cue, ac.destination, ac.destination);
  for (let k = from; k < 16; k++) for (const e of steps[k]) rig.trigger(e, (k - from) * sd, sd);
  return ac.startRendering();
}
/** One bar of noise riser (+ reverb tail), to land on the bar line where the band comes in. */
async function renderRiser(cue, sr) {
  const O = OAC(), barDur = 240 / cue.bpm;
  const ac = new O(2, Math.ceil(sr * (barDur + 2)), sr);
  const rig = buildRig(ac, cue, ac.destination, ac.destination);
  rig.trigger({ i: 'riser', d: 16, v: 0.9 }, 0, barDur / 16);
  rig.trigger({ i: 'crash', v: 0.6, dr: 1 }, barDur - 0.002, barDur / 16);
  return ac.startRendering();
}

export function createStems(cueOrId, { sr = STEM_SR, log } = {}) {
  const cue = typeof cueOrId === 'string' ? CUES[cueOrId] : cueOrId;
  const done = new Map(), fills = {}, queue = [];
  const stats = { sections: 0, total: ORDER.length, renderMs: 0, mainMs: 0, maxSliceMs: 0, bytes: 0, failed: 0 };
  let busy = false, disposed = false, riser = null, waiters = [];
  const supported = !!OAC() && typeof AudioBuffer !== 'undefined';
  const bytes = (b) => (b ? b.length * b.numberOfChannels * 4 : 0);

  async function pump() {
    if (busy || disposed || !supported) return;
    busy = true;
    try {
      if (!riser) {
        for (const f of Object.keys(FILL_FROM)) { fills[f] = await renderFill(cue, f, sr); stats.bytes += bytes(fills[f]); }
        riser = await renderRiser(cue, sr); stats.bytes += bytes(riser);
      }
      while (queue.length && !disposed) {
        const name = queue.shift(); if (done.has(name)) continue;
        try {
          const r = await renderSection(cue, name, sr);
          if (disposed) break;
          done.set(name, r); stats.sections++; stats.renderMs += r.renderMs; stats.mainMs += r.mainMs; stats.maxSliceMs = Math.max(stats.maxSliceMs, r.maxSliceMs);
          stats.bytes += bytes(r.band) + bytes(r.drums);
          log?.(`stem ${cue.id}/${name}: ${r.renderMs.toFixed(0)} ms render, ${r.mainMs.toFixed(1)} ms main thread`);
        } catch (e) { stats.failed++; log?.(`stem ${name} failed: ${e}`); }
        await new Promise((r) => setTimeout(r, 0));                // yield to the game between sections
      }
    } finally { busy = false; }
    const w = waiters; waiters = []; for (const f of w) f();
    if (queue.length && !disposed) pump();
  }
  const api = {
    cue, sr, stats, supported,
    /** queue sections (in this order, after anything already queued) */
    prepare(names = ORDER) { for (const n of names) if (cue.sections[n] && !done.has(n) && !queue.includes(n)) queue.push(n); pump(); },
    /** move a section to the front of the queue */
    want(name) { if (!cue.sections[name] || done.has(name)) return; const i = queue.indexOf(name); if (i >= 0) queue.splice(i, 1); queue.unshift(name); pump(); },
    get(name) { return done.get(name) || null; },
    fill(name) { return fills[name] || null; },
    get riser() { return riser; },
    get ready() { return stats.sections; },
    get busy() { return busy || queue.length > 0; },
    /** resolves when everything queued so far is rendered */
    all() { api.prepare(); return new Promise((res) => { if (!busy && !queue.length) res(); else waiters.push(res); }); },
    dispose() { disposed = true; done.clear(); queue.length = 0; },
  };
  return api;
}
