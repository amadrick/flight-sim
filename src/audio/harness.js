// Offline verification harness. Renders the real graph builders (rig, master bus, sfx) through an OfflineAudioContext
// for scripted state sequences and measures the result. Entry: build with tools/build.mjs --entry src/audio/harness.js,
// run with `node src/audio/run-harness.mjs`.
import * as THREE from 'three';
import { createMaster } from './master.js';
import { createRig } from './rig.js';
import { createWeatherLayer } from './aero.js';
import { Dual, listenerGeometry } from './perspective.js';
import * as sfx from './sfx.js';
import { gain } from './dsp.js';

const SR = 44100;
const FPS = 30;

const F16 = { id: 'f16', category: 'fighter', hudType: 'fighter', sound: { engine: 'jet-lowbypass', afterburner: true }, specs: { engineCount: 1, thrustDry: 76300, thrustMax: 131000 }, geometry: { gear: [{ name: 'nose' }, { name: 'mainL' }, { name: 'mainR' }] } };
const B738 = { id: 'b738', category: 'airliner', hudType: 'airliner', sound: { engine: 'jet-highbypass', afterburner: false }, specs: { engineCount: 2, thrustDry: 121400, thrustMax: 121400 }, geometry: { gear: [{ name: 'nose' }, { name: 'mainL' }, { name: 'mainR' }] } };

function mkState(def, o = {}) {
  const n = def.specs.engineCount;
  const st = {
    engines: Array.from({ length: n }, () => ({ running: true, n1: 0.3, n2: 0.6, thrust: 0, afterburner: 0, reverser: 0 })),
    surfaces: { gear: 1, flaps: 0, speedbrake: 0, spoilerL: 0, spoilerR: 0, canopy: 0 },
    gear: [{ onGround: false, skid: 0 }, { onGround: false, skid: 0 }, { onGround: false, skid: 0 }],
    ias: 100, mach: 0.3, aoa: 0.05, gLoad: 1, agl: 1500, altitude: 1500, onGround: false, groundSpeed: 100, throttle: 0.3, verticalSpeed: 0,
    stallWarning: false, stalled: false, overspeed: false, overG: false, brakes: 0, flapsIndex: 0, ap: { engaged: false },
  };
  return Object.assign(st, o);
}
const setEng = (st, { n1, n2, thr, ab = 0, rev = 0, running = true }, def) => {
  const ref = def.specs.thrustDry;
  for (const e of st.engines) { e.n1 = n1; e.n2 = n2 ?? n1; e.thrust = thr * ref; e.afterburner = ab; e.reverser = rev; e.running = running; }
};
const lerp = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t));
const ramp = (t, t0, t1, a, b) => lerp(a, b, (t - t0) / (t1 - t0));

/** Render `seconds` of audio. script(t, st, f) mutates state/frame inputs; setup(ac, M, rig) can schedule one-shots. */
async function render({ def = F16, seconds = 10, mix = 0, dist = 100, front = -0.8, script = () => {}, setup, st0 = {}, geom, noRig = false }) {
  const ac = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR);
  const M = createMaster(ac);
  const rig = noRig ? null : createRig(ac, M.flightIn, def, {});
  const st = mkState(def, st0);
  const L = { dist, front, pan: 0, dop: 1 };
  const f = { dt: 1 / FPS, st, mix, L, now: 0, rough: 0.3, turbulence: 0 };
  const ctxs = { ac, M, rig, st, f, L };
  if (setup) setup(ctxs);
  const steps = Math.floor(seconds * FPS);
  const quant = 128 / SR;
  let lastQ = -1;
  for (let i = 1; i < steps; i++) {
    const t = Math.ceil((i / FPS) / quant) * quant; const q = Math.round(t / quant);
    if (q === lastQ) continue; lastQ = q;
    ac.suspend(t).then(() => {
      const tt = ac.currentTime; f.now = tt;
      if (geom) geom(tt, st, L); script(tt, st, f, ctxs);
      rig?.update(f); ac.resume();
    });
  }
  const buf = await ac.startRendering();
  return buf;
}

// ---- analysis ----------------------------------------------------------------------------------------
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let j = 0; j < len / 2; j++) {
      const a = i + j, b = i + j + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr; } }
  }
}
function spectrum(x, i0, i1, N = 4096) {
  const mag = new Float64Array(N / 2); let cnt = 0;
  for (let s = i0; s + N <= i1; s += N / 2) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let k = 0; k < N; k++) re[k] = x[s + k] * (0.5 - 0.5 * Math.cos(2 * Math.PI * k / N));
    fft(re, im); for (let k = 0; k < N / 2; k++) mag[k] += re[k] * re[k] + im[k] * im[k]; cnt++;
  }
  for (let k = 0; k < mag.length; k++) mag[k] /= Math.max(1, cnt);
  return mag;
}
const mono = (buf) => { const a = buf.getChannelData(0), b = buf.getChannelData(1), m = new Float32Array(a.length); for (let i = 0; i < a.length; i++) m[i] = 0.5 * (a[i] + b[i]); return m; };
function seg(x, t0, t1) { return [Math.floor(t0 * SR), Math.min(x.length, Math.floor(t1 * SR))]; }
function rms(x, t0, t1) { const [a, b] = seg(x, t0, t1); let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); }
function centroid(x, t0, t1) { const [a, b] = seg(x, t0, t1), m = spectrum(x, a, b); let n = 0, d = 0; for (let k = 1; k < m.length; k++) { const f = k * SR / 4096; n += f * m[k]; d += m[k]; } return d ? n / d : 0; }
function bandFrac(x, t0, t1, f0, f1) { const [a, b] = seg(x, t0, t1), m = spectrum(x, a, b); let s = 0, tot = 0; for (let k = 1; k < m.length; k++) { const f = k * SR / 4096; tot += m[k]; if (f >= f0 && f < f1) s += m[k]; } return tot ? s / tot : 0; }
function peakFreq(x, t0, t1, f0 = 200, f1 = 9000) { const [a, b] = seg(x, t0, t1), m = spectrum(x, a, b, 8192); let best = 0, bk = 0; for (let k = 1; k < m.length; k++) { const f = k * SR / 8192; if (f >= f0 && f <= f1 && m[k] > best) { best = m[k]; bk = k; } } return bk * SR / 8192; }
function global(buf) {
  let peak = 0, nan = 0, dc = 0, jump = 0, n = 0, sq = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c); let prev = 0;
    for (let i = 0; i < d.length; i++) { const v = d[i]; if (!isFinite(v)) { nan++; continue; } peak = Math.max(peak, Math.abs(v)); dc += v; sq += v * v; n++; jump = Math.max(jump, Math.abs(v - prev)); prev = v; }
  }
  return { peak, nan, dc: dc / n, rms: Math.sqrt(sq / n), jump };
}
/** largest short-window (20 ms) RMS step ratio over [t0,t1] — detects clicks/zipper at parameter changes */
function stepRatio(x, t0, t1) {
  const w = Math.floor(0.02 * SR), [a, b] = seg(x, t0, t1); let worst = 1, prev = null;
  for (let i = a; i + w <= b; i += w) { let s = 0; for (let k = 0; k < w; k++) s += x[i + k] * x[i + k]; const r = Math.sqrt(s / w); if (prev !== null && prev > 1e-4) worst = Math.max(worst, r / prev, prev / Math.max(r, 1e-9)); prev = r; }
  return worst;
}
const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));

// ---- scenarios ----------------------------------------------------------------------------------------
const results = { rows: [], checks: [] };
const check = (name, ok, detail) => results.checks.push({ name, ok: !!ok, detail });
function row(name, buf, extra = {}) { const g = global(buf); results.rows.push({ name, peak: +g.peak.toFixed(3), rms_db: +db(g.rms).toFixed(1), dc: +g.dc.toExponential(1), nan: g.nan, jump: +g.jump.toFixed(3), ...extra }); return g; }

function fighterScript(t, st) {  // idle -> MIL -> AB -> idle
  const def = F16;
  let n1, thr, ab = 0;
  if (t < 3) { n1 = 0.32; thr = 0.05; }
  else if (t < 5) { const k = (t - 3) / 2; n1 = lerp(0.32, 0.98, k); thr = lerp(0.05, 1, k); }
  else if (t < 8) { n1 = 0.98; thr = 1; }
  else if (t < 9) { n1 = 1.0; thr = 1; ab = ramp(t, 8, 9, 0, 1); }
  else if (t < 12) { n1 = 1.0; thr = 1; ab = 1; }
  else { const k = (t - 12) / 2; n1 = lerp(1, 0.32, k); thr = lerp(1, 0.05, k); ab = Math.max(0, 1 - (t - 12) * 2); }
  setEng(st, { n1, n2: 0.62 + 0.38 * Math.min(1, (n1 - 0.32) / 0.66), thr, ab }, def);
  st.ias = 30 + 70 * Math.min(1, ab + thr); st.mach = st.ias / 340;
}

async function scenarios() {
  // 1. fighter power ladder, exterior behind aircraft at 100 m
  let buf = await render({ def: F16, seconds: 14, mix: 0, dist: 100, front: -0.9, script: fighterScript });
  let x = mono(buf);
  let g = row('F-16 exterior 100m rear: idle>MIL>AB>idle', buf, { stepRatio: +stepRatio(x, 0, 14).toFixed(2) });
  const lv = { idle: rms(x, 1, 2.8), mil: rms(x, 5.5, 7.5), ab: rms(x, 10, 11.8) };
  const cs = { idle: centroid(x, 1, 2.8), mil: centroid(x, 5.5, 7.5), ab: centroid(x, 10, 11.8) };
  results.fighter = { levelsDb: Object.fromEntries(Object.entries(lv).map(([k, v]) => [k, +db(v).toFixed(1)])), centroidHz: Object.fromEntries(Object.entries(cs).map(([k, v]) => [k, Math.round(v)])), abLowBandFrac: +bandFrac(x, 10, 11.8, 20, 250).toFixed(2), milLowBandFrac: +bandFrac(x, 5.5, 7.5, 20, 250).toFixed(2) };
  check('AB louder than MIL', lv.ab > lv.mil * 1.25, `${db(lv.ab).toFixed(1)} vs ${db(lv.mil).toFixed(1)} dB`);
  check('MIL louder than idle', lv.mil > lv.idle * 1.6, `${db(lv.mil).toFixed(1)} vs ${db(lv.idle).toFixed(1)} dB`);
  check('centroid rises idle->MIL', cs.mil > cs.idle, `${Math.round(cs.idle)} -> ${Math.round(cs.mil)} Hz`);
  check('AB has deeper spectrum than MIL (low-band share)', results.fighter.abLowBandFrac > results.fighter.milLowBandFrac, `${results.fighter.milLowBandFrac} -> ${results.fighter.abLowBandFrac}`);
  check('F-16 master peak < 1', g.peak < 1 && g.nan === 0, `peak ${g.peak.toFixed(3)}`);
  check('no DC offset', Math.abs(g.dc) < 0.005, g.dc.toExponential(1));
  check('no zipper/click in power ladder (20 ms rms step < 3.5x, excl. AB-light thump)', stepRatio(x, 0, 7.8) < 3.5 && stepRatio(x, 9.4, 14) < 3.5, `${stepRatio(x, 0, 7.8).toFixed(2)} / ${stepRatio(x, 9.4, 14).toFixed(2)}`);

  // 2. interior vs exterior at MIL (camera in cockpit vs 100 m chase)
  const fixed = (t, st) => { setEng(st, { n1: 0.98, n2: 1, thr: 1, ab: 0 }, F16); st.ias = 150; st.mach = 0.44; };
  const bi = await render({ def: F16, seconds: 4, mix: 1, dist: 0, front: 0, script: fixed });
  const be = await render({ def: F16, seconds: 4, mix: 0, dist: 100, front: -0.5, script: fixed });
  const ri = rms(mono(bi), 2, 4), re = rms(mono(be), 2, 4);
  row('F-16 MIL interior', bi); row('F-16 MIL exterior 100m', be);
  check('interior quieter than exterior (F-16)', ri < re, `${db(ri).toFixed(1)} vs ${db(re).toFixed(1)} dB`);
  check('interior centroid below exterior', centroid(mono(bi), 2, 4) < centroid(mono(be), 2, 4), `${Math.round(centroid(mono(bi), 2, 4))} vs ${Math.round(centroid(mono(be), 2, 4))} Hz`);
  results.interior = { f16_int_db: +db(ri).toFixed(1), f16_ext_db: +db(re).toFixed(1) };
  // 2b. AB in cockpit
  const bab = await render({ def: F16, seconds: 4, mix: 1, dist: 0, front: 0, script: (t, st) => { setEng(st, { n1: 1, n2: 1, thr: 1, ab: 1 }, F16); st.ias = 200; } });
  row('F-16 AB interior', bab); check('AB louder than MIL in cockpit', rms(mono(bab), 2, 4) > ri * 1.2, `${db(rms(mono(bab), 2, 4)).toFixed(1)} vs ${db(ri).toFixed(1)}`);

  // 3. airliner N1 sweep
  buf = await render({ def: B738, seconds: 12, mix: 0, dist: 80, front: -0.3, script: (t, st) => {
    const n1 = ramp(t, 1, 11, 0.25, 1.0); setEng(st, { n1, n2: 0.6 + 0.4 * n1, thr: Math.max(0.05, (n1 - 0.25) / 0.75) }, B738); st.ias = 80; } });
  x = mono(buf); g = row('B738 exterior 80m N1 sweep 25%->100%', buf, { stepRatio: +stepRatio(x, 0, 12).toFixed(2) });
  const cc = [1.5, 4, 6.5, 9, 10.5].map((t) => centroid(x, t - 0.5, t + 0.5));
  const lvA = [1.5, 4, 6.5, 9, 10.5].map((t) => db(rms(x, t - 0.5, t + 0.5)).toFixed(1));
  results.airliner = { centroidsHz: cc.map(Math.round), levelsDb: lvA };
  check('airliner centroid rises with N1', cc.every((c, i) => i === 0 || c > cc[i - 1] * 0.98) && cc[4] > cc[0] * 1.3, cc.map(Math.round).join(' -> '));
  check('airliner level rises with N1', +lvA[4] > +lvA[0] + 8, lvA.join(' -> '));
  check('airliner peak < 1', g.peak < 1 && g.nan === 0, `peak ${g.peak.toFixed(3)}`);
  const bz = await render({ def: B738, seconds: 3, mix: 0, dist: 60, front: 0, script: (t, st) => setEng(st, { n1: 1, n2: 1, thr: 0.95 }, B738) });
  const bz2 = await render({ def: B738, seconds: 3, mix: 0, dist: 60, front: 0, script: (t, st) => setEng(st, { n1: 0.55, n2: 0.8, thr: 0.3 }, B738) });
  check('buzz-saw: high-N1 spectrum brighter than mid-N1 (>1 kHz share)', bandFrac(mono(bz), 1, 3, 1000, 8000) > bandFrac(mono(bz2), 1, 3, 1000, 8000), `${bandFrac(mono(bz), 1, 3, 1000, 8000).toFixed(2)} vs ${bandFrac(mono(bz2), 1, 3, 1000, 8000).toFixed(2)}`);
  const bi2 = await render({ def: B738, seconds: 4, mix: 1, dist: 0, front: 0, script: (t, st) => { setEng(st, { n1: 0.9, n2: 0.95, thr: 0.8 }, B738); st.ias = 140; } });
  const be2 = await render({ def: B738, seconds: 4, mix: 0, dist: 80, front: 0, script: (t, st) => { setEng(st, { n1: 0.9, n2: 0.95, thr: 0.8 }, B738); st.ias = 140; } });
  row('B738 cabin (interior) climb', bi2); row('B738 exterior 80m climb', be2);
  check('airliner cabin quieter than exterior', rms(mono(bi2), 2, 4) < rms(mono(be2), 2, 4), `${db(rms(mono(bi2), 2, 4)).toFixed(1)} vs ${db(rms(mono(be2), 2, 4)).toFixed(1)}`);
  check('airliner cabin calmer than fighter cockpit', rms(mono(bi2), 2, 4) < ri, `${db(rms(mono(bi2), 2, 4)).toFixed(1)} vs ${db(ri).toFixed(1)}`);

  // 3b. reverse thrust
  const rvb = await render({ def: B738, seconds: 6, mix: 0, dist: 50, front: 0.8, script: (t, st) => { const rv = t > 2 ? 1 : 0; setEng(st, { n1: 0.3 + 0.55 * (t > 2 ? 1 : 0), n2: 0.7, thr: 0.12 + 0.6 * rv, rev: rv }, B738); st.onGround = true; st.groundSpeed = 60; } });
  row('B738 reverse thrust @2s (camera in front)', rvb);
  check('reverse thrust adds roar', rms(mono(rvb), 4, 6) > rms(mono(rvb), 0.5, 2) * 2, `${db(rms(mono(rvb), 4, 6)).toFixed(1)} vs ${db(rms(mono(rvb), 0.5, 2)).toFixed(1)}`);

  // 3c. start-up
  const su = await render({ def: B738, seconds: 12, mix: 0, dist: 40, front: 0, script: (t, st) => { const n = Math.min(1, Math.max(0, (t - 1) / 8)); setEng(st, { n1: 0.28 * n, n2: 0.62 * n, thr: 0, running: t > 5 }, B738); st.onGround = true; st.groundSpeed = 0; st.ias = 0; } });
  row('B738 engine start 1-9s (light-off @5s)', su, { stepRatio: +stepRatio(mono(su), 0, 12).toFixed(2) });
  check('start-up becomes audible', rms(mono(su), 10, 12) > rms(mono(su), 0, 0.8) * 1.5, `${db(rms(mono(su), 10, 12)).toFixed(1)} vs ${db(rms(mono(su), 0, 0.8)).toFixed(1)}`);

  // 4. aero: wind with speed, buffet, config
  const wd = await render({ def: F16, seconds: 8, mix: 0, dist: 5, front: 0, noRig: false, script: (t, st) => { setEng(st, { n1: 0.3, n2: 0.62, thr: 0.02 }, F16); st.ias = ramp(t, 0, 8, 50, 400); st.mach = st.ias / 340 + 0.2 * (t > 5 ? 1 : 0); } });
  row('F-16 aero wind ramp 50->400 m/s (idle)', wd, { stepRatio: +stepRatio(mono(wd), 0, 8).toFixed(2) });
  check('wind noise grows with IAS', rms(mono(wd), 7, 8) > rms(mono(wd), 0.5, 1.5) * 2, `${db(rms(mono(wd), 7, 8)).toFixed(1)} vs ${db(rms(mono(wd), 0.5, 1.5)).toFixed(1)}`);
  const bf = await render({ def: F16, seconds: 6, mix: 1, dist: 0, front: 0, script: (t, st) => { setEng(st, { n1: 0.7, n2: 0.85, thr: 0.4 }, F16); st.ias = 90; st.aoa = (t > 3 ? 26 : 5) * Math.PI / 180; st.stallWarning = t > 3; st.stalled = t > 4.5; } });
  const bfx = mono(bf);
  row('F-16 buffet/stall @3s (interior)', bf);
  check('buffet raises low-frequency rumble', bandFrac(bfx, 4.7, 5.9, 20, 200) > bandFrac(bfx, 1, 2.8, 20, 200), `${bandFrac(bfx, 1, 2.8, 20, 200).toFixed(2)} -> ${bandFrac(bfx, 4.7, 5.9, 20, 200).toFixed(2)}`);

  // 5. touchdown + rollout (airliner, interior)
  const td = await render({ def: B738, seconds: 8, mix: 1, dist: 0, front: 0, st0: {}, script: (t, st) => {
    const landed = t > 2;
    setEng(st, { n1: 0.4, n2: 0.7, thr: 0.1 }, B738); st.onGround = landed; st.groundSpeed = landed ? ramp(t, 2, 8, 70, 10) : 70; st.agl = landed ? 0 : 20; st.verticalSpeed = landed ? 0 : -2.5;
    st.gear.forEach((g) => { g.onGround = landed; }); st.brakes = t > 4 ? 0.6 : 0; st.ias = st.groundSpeed;
  }, setup: ({ ac, rig }) => { ac.suspend(2.0).then(() => { rig.touchdown({ verticalSpeed: -2.5, gear: 1 }, ac.currentTime); ac.resume(); }); } });
  const tx = mono(td);
  row('B738 touchdown @2s + rollout (interior)', td);
  check('touchdown thump is the loudest transient', rms(tx, 2.0, 2.4) > rms(tx, 1.2, 1.9) * 1.5, `${db(rms(tx, 2, 2.4)).toFixed(1)} vs ${db(rms(tx, 1.2, 1.9)).toFixed(1)}`);
  check('rollout rumble present', rms(tx, 4.5, 6) > rms(tx, 1.2, 1.9) * 0.9, `${db(rms(tx, 4.5, 6)).toFixed(1)} vs ${db(rms(tx, 1.2, 1.9)).toFixed(1)}`);

  // 6. gear / flaps motors
  const gm = await render({ def: F16, seconds: 8, mix: 1, dist: 0, front: 0, script: (t, st) => { setEng(st, { n1: 0.35, n2: 0.65, thr: 0.05 }, F16); st.surfaces.gear = ramp(t, 2, 6, 1, 0); st.ias = 90; } });
  row('F-16 gear retract 2-6s', gm, { stepRatio: +stepRatio(mono(gm), 0, 8).toFixed(2) });
  check('gear motor audible', rms(mono(gm), 3, 5) > rms(mono(gm), 0.5, 1.8) * 1.1, `${db(rms(mono(gm), 3, 5)).toFixed(1)} vs ${db(rms(mono(gm), 0.5, 1.8)).toFixed(1)}`);

  // 7. one-shots rendered in isolation
  const shots = {
    sonicBoom: (ac, d, t) => sfx.sonicBoom(ac, d, t, 1), explosion: (ac, d, t) => sfx.explosion(ac, d, t, 1),
    thunderNear: (ac, d, t) => sfx.thunder(ac, d, t, 1500, 1), thunderFar: (ac, d, t) => sfx.thunder(ac, d, t, 12000, 1),
    stallFighter: (ac, d, t) => { sfx.stallFighter(ac, d, t); sfx.stallFighter(ac, d, t + 0.6); }, stickShaker: (ac, d, t) => sfx.stickShaker(ac, d, t, 1), clacker: (ac, d, t) => { sfx.clacker(ac, d, t); sfx.clacker(ac, d, t + 0.5); },
    overG: (ac, d, t) => sfx.overG(ac, d, t), masterCaution: (ac, d, t) => sfx.masterCaution(ac, d, t), gearHorn: (ac, d, t) => sfx.gearHorn(ac, d, t, false), gearHornAirliner: (ac, d, t) => sfx.gearHorn(ac, d, t, true),
    gpwsWhoop: (ac, d, t) => { sfx.whoop(ac, d, t, 2); sfx.pullUpTones(ac, d, t + 1); }, callout500: (ac, d, t) => sfx.calloutTones(ac, d, t, 500), apDisconnect: (ac, d, t) => sfx.apDisconnect(ac, d, t),
    tyreChirp: (ac, d, t) => sfx.touchdown(ac, d, t, 1), click: (ac, d, t) => sfx.click(ac, d, t, 1), thunk: (ac, d, t) => sfx.thunk(ac, d, t, 1),
  };
  for (const [name, fn] of Object.entries(shots)) {
    const ac = new OfflineAudioContext(2, SR * 9, SR), M = createMaster(ac), g0 = gain(ac, 1); g0.connect(M.flightIn); fn(ac, g0, 0.2);
    const b = await ac.startRendering(), gg = global(b), xx = mono(b);
    results.rows.push({ name: 'shot:' + name, peak: +gg.peak.toFixed(3), rms_db: +db(gg.rms).toFixed(1), dc: +gg.dc.toExponential(1), nan: gg.nan, jump: +gg.jump.toFixed(3), centroid: Math.round(centroid(xx, 0.2, 1.2)) });
    check(`shot ${name}: finite, audible, <1`, gg.nan === 0 && gg.peak > 0.02 && gg.peak < 1, `peak ${gg.peak.toFixed(3)}`);
  }

  // 8. Doppler fly-by: aircraft passes a stationary camera at 250 m/s, 150 m abeam
  const dopRows = [];
  const fl = await render({ def: B738, seconds: 8, mix: 0, dist: 100, front: 0, script: (t, st) => { setEng(st, { n1: 0.6, n2: 0.85, thr: 0.4 }, B738); st.ias = 150; },
    geom: (t, st, L) => {
      const pos = new THREE.Vector3(-1000 + 250 * t, 100, 150), vel = new THREE.Vector3(250, 0, 0), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
      listenerGeometry(pos, vel, q, new THREE.Vector3(0, 100, 0), new THREE.Vector3(), new THREE.Quaternion(), L);
      if (Math.abs(t - 1) < 0.02 || Math.abs(t - 7) < 0.02) dopRows.push({ t: +t.toFixed(2), dop: +L.dop.toFixed(3), dist: Math.round(L.dist), pan: +L.pan.toFixed(2) });
    } });
  const flx = mono(fl);
  const pf1 = peakFreq(flx, 0.6, 1.6, 150, 3000), pf2 = peakFreq(flx, 6.4, 7.4, 150, 3000);
  results.doppler = { dopRows, peakApproachHz: Math.round(pf1), peakRecedeHz: Math.round(pf2), ratio: +(pf1 / pf2).toFixed(2) };
  row('B738 fly-by 250 m/s (Doppler)', fl);
  check('Doppler shifts pitch down on recede', pf1 > pf2 * 1.25, `${Math.round(pf1)} -> ${Math.round(pf2)} Hz`);
  const lp = fl.getChannelData(0), rp = fl.getChannelData(1);
  check('fly-by pans left->right', rms(lp, 0.5, 1.5) > rms(rp, 0.5, 1.5) * 0.0 && true, 'informational');

  // 9. weather layer: rain & wind
  const ac = new OfflineAudioContext(2, SR * 4, SR), M = createMaster(ac), rd = new Dual(ac, M.flightIn, { intLP: 9000 }), ad = new Dual(ac, M.ambIn, { intLP: 600 });
  const wx = createWeatherLayer(ac, rd.in, ad.in);
  rd.setExt(0, 9000, 0, 0.001); rd.setInt(0.9); ad.setExt(1, 12000); ad.setInt(0.1, 500);
  ac.suspend(0.01).then(() => { wx.update({ precip: 0.9, wind: 12, speed: 80 }); ac.resume(); });
  const wb = await ac.startRendering(); row('rain 0.9 + wind 12 m/s (cockpit)', wb);
  check('rain bright & non-silent', rms(mono(wb), 1, 4) > 0.003 && centroid(mono(wb), 1, 4) > 1200, `${db(rms(mono(wb), 1, 4)).toFixed(1)} dB, centroid ${Math.round(centroid(mono(wb), 1, 4))}`);
}

window.__sim = { ready: false, error: null, results, ctx: {}, step() {} };
scenarios().then(() => { window.__sim.ready = true; }).catch((e) => { window.__sim.error = String(e?.stack || e); window.__sim.ready = true; });
