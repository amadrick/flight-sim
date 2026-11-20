// Stem renderer: every section of a cue is rendered once, offline, into a band stem and a mono drum stem, so the live
// music is a couple of AudioBufferSourceNodes. Fills (drums) and the merge riser are short one-shots. The heavy synth
// graph (synth.js: oscillators, oversampled waveshapers, reverbs) only ever exists inside an OfflineAudioContext.
//
// Budget-aware (see deviceProfile): phones get mono 24 kHz stems (<= 24 MB per cue), desktops a stereo 24 kHz band
// stem (the guitars have nothing above 5 kHz) with a 30 kHz mono drum stem for the cymbals (<= 40 MB per cue).
// Rendering is cut into 0.5 s chunks (OfflineAudioContext.suspend): between chunks a gate holds the work back while the
// game's frame time is bad (setLoad), so the render thread never runs flat out against a struggling frame. Main-thread
// work (graph building, note scheduling) is cut into <= 3 ms slices.
// Stems are cached per cue for the session (getStems): restarting a mission or replaying it costs nothing.
//
// getStems(cueId, opts) -> { prepare(names), want(name), get(name), fill(name), riser, ready, all(), stats, dispose() }
import { CUES, FILL_FROM } from './cues.js';
import { genSection, fillSteps } from './arranger.js';
import { G, BQ, noise, makeReverb, makePingPong, makeGatedVerb, makeDrums, makeRhythmGuitar, makeLeadGuitar, makeCleanGuitar,
  makeBass, makeSynthBass, makePad, makeArp, makeRiser, makeBell, makeStab, makeHorn } from './synth.js';

/** What the first 30 s of a fight need come first; the chorus and solo can wait. '#fills' / '#riser' are the one-shots. */
export const ORDER = ['tension', 'intro', 'verse', '#fills', '#riser', 'calm', 'pre', 'chorus', 'danger', 'cool', 'win', 'lose', 'solo'];
const SECTIONS = ORDER.filter((n) => n[0] !== '#');
const TAIL = 1.0, END_TAIL = 2.6, CHUNK = 0.5;

export const PROFILES = {
  phone:   { name: 'phone', bandSr: 24000, bandCh: 1, drumSr: 24000, budgetMB: 24, keep: 1 },
  desktop: { name: 'desktop', bandSr: 24000, bandCh: 2, drumSr: 30000, budgetMB: 40, keep: 2 },
};
/** phone: navigator.deviceMemory <= 4, or a coarse pointer on a small screen. `?audioprofile=phone|desktop` overrides. */
export function deviceProfile(override) {
  if (PROFILES[override]) return PROFILES[override];
  try {
    const nav = globalThis.navigator || {}, mem = nav.deviceMemory;
    const coarse = !!globalThis.matchMedia?.('(pointer: coarse)')?.matches;
    const s = globalThis.screen, small = s ? Math.min(s.width, s.height) <= 900 : false;
    if ((mem !== undefined && mem <= 4) || (coarse && small)) return PROFILES.phone;
  } catch {}
  return PROFILES.desktop;
}

function glue(ac, threshold = -18, ratio = 3) {
  const c = ac.createDynamicsCompressor();
  c.threshold.value = threshold; c.knee.value = 8; c.ratio.value = ratio; c.attack.value = 0.01; c.release.value = 0.18;
  return c;
}

/**
 * The instrument rig inside an offline context. role: 'band' (no drum sounds; kicks still drive the pump), 'drums'
 * (drums only), or 'all'. Instruments are created on first use, so a section only pays for what it plays.
 */
export function buildRig(ac, cue, out, { os = '4x', mix = {}, role = 'all' } = {}) {
  const white = noise(ac, 'white'); white.start();
  const sum = G(ac, 1), hp = BQ(ac, 'highpass', 30, 0.7), gl = role === 'drums' ? glue(ac, -14, 2.5) : glue(ac);
  sum.connect(hp); hp.connect(gl); gl.connect(out);
  const pump = G(ac, 1); pump.connect(sum);                 // side-chain-style ducking of the sustained layers on each kick
  const lazy = (f) => { let v; return () => (v ||= f()); };
  const hall = lazy(() => { const r = makeReverb(ac, { decay: 2.2, damp: 3800, size: 1.3, level: 0.55 }); r.out.connect(sum); return r; });
  const delay = lazy(() => { const d = makePingPong(ac, { time: (60 / cue.bpm) * 0.75, fb: 0.36, tone: 3000, level: 0.5 }); d.out.connect(sum); return d; });
  const S = () => ({ reverb: hall().in, delay: delay().in });
  const room = lazy(() => { const r = makeReverb(ac, { decay: 0.9, damp: 5000, size: 0.85, level: 0.5 }); r.out.connect(sum); return r; });
  const make = {
    drums: () => { const bus = G(ac, 0.75 * (mix.drums ?? 1)); bus.connect(sum); return makeDrums(ac, bus, room().in, () => makeGatedVerb(ac, bus), white, { hats: mix.hats ?? 1 }); },
    gtr: () => { const bus = G(ac, 1.4 * (mix.gtr ?? 1)); bus.connect(pump); const rs = G(ac, 0.12); bus.connect(rs); rs.connect(room().in); return makeRhythmGuitar(ac, bus, white, { os }); },
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
  return {
    trigger(e, t, sd) {
      if (e.dr) {
        if (role !== 'band') get('drums').trigger(e, t);
        if (e.i === 'kick' && role !== 'drums') { const p = pump.gain; p.setTargetAtTime(0.55, t, 0.003); p.setTargetAtTime(1, t + 0.03, 0.09); }
        return;
      }
      if (role === 'drums') return;
      const k = e.i === 'scrape' ? 'gtr' : e.i; if (!make[k]) return;
      get(k).trigger(e, t, sd);
    },
    release(t) { for (const k in inst) inst[k].release(t); },
    /** the build steps the events need, one heavy constructor each, so the caller can yield between them */
    steps(keys) {
      const need = new Set(), out = [];
      for (const k0 of keys) { const k = k0 === 'scrape' ? 'gtr' : k0; if (role === 'drums' ? k === 'drums' : (make[k] && (role !== 'band' || k !== 'drums'))) need.add(k); }
      if (need.has('drums') || need.has('gtr')) out.push(['room', room]);
      if ([...need].some((k) => k !== 'drums' && k !== 'gtr' && k !== 'bass' && k !== 'sbass')) out.push(['hall', hall], ['delay', delay]);
      for (const k of need) out.push([k, () => get(k)]);
      return out;
    },
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Main-thread work in slices of at most `budgetMs`, yielding between them. Tracks the total and the longest slice. */
function slicer(budgetMs) {
  const m = { total: 0, maxSlice: 0, start: now(), where: '' };
  const note = (d, where) => { m.total += d; if (d > m.maxSlice) { m.maxSlice = d; m.where = where; } };
  m.breathe = async (force, where) => { const n = now(), d = n - m.start; if (force || d > budgetMs) { note(d, where); await yieldTask(); m.start = now(); } };
  m.end = (where) => note(now() - m.start, where);
  return m;
}

/** Render a scheduled offline context in CHUNK-second pieces, each one let through by `gate`. */
async function renderChunked(ac, gate, M) {
  const sr = ac.sampleRate, dur = ac.length / sr, q = 128 / sr;
  if (gate) for (let t = CHUNK; t < dur - q; t += CHUNK) {
    const at = Math.round(t / q) * q;
    ac.suspend(at).then(async () => { M.start = now(); await gate(); ac.resume(); }).catch(() => {});
  }
  M.end('schedule');
  const t0 = now(); const out = await ac.startRendering();
  M.start = now();
  return { out, renderMs: now() - t0 };
}

/** Render one section: { band, drums|null, bars, barDur, duration, mainMs, maxSliceMs, renderMs }. */
export async function renderSection(cue, name, profile = PROFILES.desktop, opts = {}) {
  const O = OAC(); const sec = cue.sections[name], barDur = 240 / cue.bpm, sd = barDur / 16;
  const M = slicer(opts.budgetMs ?? 3), own = !!sec.ownDrums;
  const bars = genSection(cue, name);
  await M.breathe(false, 'gen');
  const dur = bars.length * barDur + (sec.end ? END_TAIL : TAIL), total = bars.length * barDur;
  const jobs = [{ role: own ? 'all' : 'band', sr: profile.bandSr, ch: profile.bandCh }];
  if (!own) jobs.push({ role: 'drums', sr: profile.drumSr, ch: 1 });
  const res = [];
  let renderMs = 0;
  for (const j of jobs) {
    const ac = new O(j.ch, Math.ceil(j.sr * dur), j.sr);
    const out = G(ac, 1);
    // `tilt`: a high shelf (dB above ~700 Hz) for the low, chuggy sections, so they still read on a phone speaker
    if (sec.tilt) { const sh = BQ(ac, 'highshelf', 700, 0.7, sec.tilt); out.connect(sh); sh.connect(ac.destination); } else out.connect(ac.destination);
    // section level (loud-quiet dynamics) and an optional swell across the section (pre-chorus lift)
    const lv = sec.level ?? 1;
    out.gain.setValueAtTime(lv * (sec.swell ? sec.swell[0] : 1), 0);
    if (sec.swell) out.gain.linearRampToValueAtTime(lv * sec.swell[1], total - barDur * 0.25);
    const rig = buildRig(ac, cue, out, { os: opts.os, mix: sec.mix || {}, role: j.role });
    await M.breathe(true, 'rig');
    const keys = new Set(); for (const b of bars) for (const evs of b.steps) for (const e of evs) keys.add(e.dr ? 'drums' : e.i);
    for (const [k, build] of rig.steps(keys)) { build(); await M.breathe(true, 'build:' + k); }
    for (let b = 0; b < bars.length; b++) for (let k = 0; k < 16; k++) {
      const evs = bars[b].steps[k], t = (b * 16 + k) * sd;
      for (let i = 0; i < evs.length; i++) { rig.trigger(evs[i], t, sd); await M.breathe(false, evs[i].i); }
    }
    rig.release(total + (sec.end ? 2 : 0.05));
    const r = await renderChunked(ac, opts.gate, M);
    renderMs += r.renderMs; res.push(r.out);
  }
  M.end('done');
  return { band: res[0], drums: res[1] || null, bars: bars.length, barDur, duration: dur, mainMs: M.total, maxSliceMs: M.maxSlice, where: M.where, renderMs };
}

/** A drum fill from its first step to the bar end (+ room tail), mono. */
async function renderFill(cue, name, profile, gate) {
  const O = OAC(), sd = 60 / cue.bpm / 4, from = FILL_FROM[name], steps = fillSteps(name), M = slicer(3);
  const ac = new O(1, Math.ceil(profile.drumSr * ((16 - from) * sd + 1.2)), profile.drumSr);
  const out = G(ac, 1); out.connect(ac.destination);
  const rig = buildRig(ac, cue, out, { role: 'drums' });
  for (let k = from; k < 16; k++) for (const e of steps[k]) rig.trigger(e, (k - from) * sd, sd);
  return (await renderChunked(ac, gate, M)).out;
}
/** One bar of noise riser (+ reverb tail), to land on the bar line where the band comes in. */
async function renderRiser(cue, profile, gate) {
  const O = OAC(), barDur = 240 / cue.bpm, M = slicer(3);
  const ac = new O(profile.bandCh, Math.ceil(profile.bandSr * (barDur + 1.6)), profile.bandSr);
  const out = G(ac, 1); out.connect(ac.destination);
  const rig = buildRig(ac, cue, out, { role: 'all' });
  rig.trigger({ i: 'riser', d: 16, v: 0.9 }, 0, barDur / 16);
  rig.trigger({ i: 'crash', v: 0.6, dr: 1 }, barDur - 0.002, barDur / 16);
  return (await renderChunked(ac, gate, M)).out;
}

// ---- load gate (shared by every cue: one renderer at a time) ------------------------------------------------------
const load = { frameMs: 16, hold: true, lastChunk: 0, waitMs: 0, held: 0 };
/** Fed every frame: the real frame time (s) and whether the game is paused / in a menu (render freely then). */
export function setLoad(realDt, hold) {
  if (Number.isFinite(realDt) && realDt > 0) load.frameMs += (Math.min(realDt, 0.25) * 1000 - load.frameMs) * 0.1;
  load.hold = !!hold;
}
export const LOAD = load;
/** While a mission runs with frames slower than ~30 fps, let one 0.5 s chunk through every 400 ms only. */
async function gate() {
  const t0 = now();
  while (!load.hold && load.frameMs > 34 && now() - load.lastChunk < 400) { await sleep(40); }
  const w = now() - t0; if (w > 1) { load.waitMs += w; load.held++; }
  load.lastChunk = now();
}

// ---- per-cue stem sets, cached for the session --------------------------------------------------------------------
const cache = new Map();                 // key -> stems (insertion order = LRU)
export function stemCache() {
  let bytes = 0; for (const s of cache.values()) bytes += s.stats.bytes;
  return { cues: [...cache.keys()], MB: +(bytes / 1048576).toFixed(1) };
}
/** The cached stem set for a cue (created on first use; least recently used sets beyond profile.keep are released). */
export function getStems(cueId, opts = {}) {
  const profile = opts.profile || deviceProfile(), key = `${cueId}/${profile.name}`;
  let s = cache.get(key);
  if (s && !s.disposed) { cache.delete(key); cache.set(key, s); return s; }
  s = createStems(cueId, { ...opts, profile });
  cache.set(key, s);
  while (cache.size > profile.keep) { const [k, old] = cache.entries().next().value; cache.delete(k); old.dispose(); }
  return s;
}
export function clearStemCache() { for (const s of cache.values()) s.dispose(); cache.clear(); }

export function createStems(cueOrId, { profile = PROFILES.desktop, log, gated = true } = {}) {
  const cue = typeof cueOrId === 'string' ? CUES[cueOrId] : cueOrId;
  const done = new Map(), fills = {}, queue = [];
  const stats = { profile: profile.name, sections: 0, total: SECTIONS.length, renderMs: 0, mainMs: 0, maxSliceMs: 0, bytes: 0, failed: 0, firstReadyMs: null, allReadyMs: null, startedAt: null };
  let busy = false, riser = null, waiters = [];
  const supported = !!OAC();
  const bytes = (b) => (b ? b.length * b.numberOfChannels * 4 : 0);
  const g = gated ? gate : null;

  async function job(name) {
    if (name === '#fills') { for (const f of Object.keys(FILL_FROM)) if (!fills[f]) { fills[f] = await renderFill(cue, f, profile, g); stats.bytes += bytes(fills[f]); } return; }
    if (name === '#riser') { if (!riser) { riser = await renderRiser(cue, profile, g); stats.bytes += bytes(riser); } return; }
    const r = await renderSection(cue, name, profile, { gate: g });
    if (api.disposed) return;
    done.set(name, r); stats.sections++; stats.renderMs += r.renderMs; stats.mainMs += r.mainMs; stats.maxSliceMs = Math.max(stats.maxSliceMs, r.maxSliceMs);
    stats.bytes += bytes(r.band) + bytes(r.drums);
    if (stats.firstReadyMs === null) stats.firstReadyMs = now() - stats.startedAt;
    log?.(`stem ${cue.id}/${name}: ${r.renderMs.toFixed(0)} ms render, ${r.mainMs.toFixed(1)} ms main thread`);
  }
  const isDone = (n) => (n === '#fills' ? !!fills.fillBig : n === '#riser' ? !!riser : done.has(n));
  async function pump() {
    if (busy || api.disposed || !supported) return;
    busy = true; stats.startedAt ??= now();
    try {
      while (queue.length && !api.disposed) {
        const name = queue.shift(); if (isDone(name)) continue;
        try { await job(name); } catch (e) { stats.failed++; log?.(`stem ${name} failed: ${e}`); }
        await yieldTask();
      }
    } finally { busy = false; }
    if (stats.sections === stats.total && stats.allReadyMs === null) stats.allReadyMs = now() - stats.startedAt;
    const w = waiters; waiters = []; for (const f of w) f();
    if (queue.length && !api.disposed) pump();
  }
  const api = {
    cue, profile, stats, supported, disposed: false,
    /** queue jobs (in this order, after anything already queued) */
    prepare(names = ORDER) { if (api.disposed) return; for (const n of names) if ((n[0] === '#' || cue.sections[n]) && !isDone(n) && !queue.includes(n)) queue.push(n); pump(); },
    /** move a section to the front of the queue */
    want(name) { if (api.disposed || !cue.sections[name] || done.has(name)) return; const i = queue.indexOf(name); if (i >= 0) queue.splice(i, 1); queue.unshift(name); pump(); },
    get(name) { return done.get(name) || null; },
    fill(name) { return fills[name] || null; },
    get riser() { return riser; },
    get ready() { return stats.sections; },
    get busy() { return busy || queue.length > 0; },
    /** resolves when everything queued so far is rendered */
    all() { api.prepare(); return new Promise((res) => { if (!busy && !queue.length) res(); else waiters.push(res); }); },
    /** release every buffer (voices already playing keep theirs until they end) */
    dispose() { api.disposed = true; done.clear(); queue.length = 0; for (const k in fills) delete fills[k]; riser = null; stats.bytes = 0; const w = waiters; waiters = []; for (const f of w) f(); },
  };
  return api;
}
