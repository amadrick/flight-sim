// Harness scenarios (see harness.js). Each scenario renders offline, measures and records rows + checks.
import { makeRhythmGuitar, makeLeadGuitar, noise, G } from './music/synth.js';
import { CUES } from './music/cues.js';
import { createStems, getStems, clearStemCache, stemCache, setLoad, PROFILES, ORDER } from './music/render.js';
import { createRadio } from './radio.js';
import { createWarnings } from './warnings.js';
import { MIX } from './index.js';
import { MUSIC_SCENARIOS_EXTRA } from './harness-sfx.js';

const STEMS = {};
/** render (once per page) every stem of a cue, with timings */
export async function stemsFor(H, id, profile = PROFILES.desktop) {
  const key = id + '/' + profile.name;
  if (STEMS[key]) return STEMS[key];
  const t0 = performance.now(), st = createStems(id, { profile, gated: false });
  await st.all();
  const per = {};
  for (const n of ORDER) { const e = st.get(n); if (e) per[n] = { renderMs: Math.round(e.renderMs), mainMs: +e.mainMs.toFixed(1), maxSliceMs: +e.maxSliceMs.toFixed(1), where: e.where, sec: +e.duration.toFixed(1) }; }
  H.results.music['stems_' + key] = { profile: profile.name, sections: st.stats.sections, failed: st.stats.failed, totalMs: Math.round(performance.now() - t0), renderMs: Math.round(st.stats.renderMs), mainThreadMs: Math.round(st.stats.mainMs), maxMainThreadSliceMs: +st.stats.maxSliceMs.toFixed(1), MB: +(st.stats.bytes / 1048576).toFixed(1), budgetMB: profile.budgetMB, per };
  H.check(`stems ${key}: within the memory budget (${profile.budgetMB} MB)`, st.stats.bytes / 1048576 <= profile.budgetMB, `${(st.stats.bytes / 1048576).toFixed(1)} MB`);
  return (STEMS[key] = st);
}
const scriptAt = (script, t) => { let e = script[0]; for (const x of script) if (t >= x[0]) e = x; return e; };

async function musicRun(H, cueId, script, seconds) {
  const { A } = H;
  const stems = await stemsFor(H, cueId);
  setLoad(1 / 60, true);
  const cpu = { calls: 0, ms: 0, max: 0, maxNodes: 0, maxVoices: 0 };
  const { buf, obj } = await H.render({
    seconds,
    setup: (ac) => ({ mus: H.createMusic(ac, ac.destination, { cue: cueId, log: true, stems }) }),
    tick: (t, o) => {
      const [, m, sig] = scriptAt(script, t), t0 = performance.now();
      o.mus.update(t, m, sig);
      const dt = performance.now() - t0; cpu.calls++; cpu.ms += dt; cpu.max = Math.max(cpu.max, dt);
      cpu.maxNodes = Math.max(cpu.maxNodes, o.mus.info.nodes); cpu.maxVoices = Math.max(cpu.maxVoices, o.mus.info.voices);
    },
  });
  const x = A.mono(buf), log = obj.mus.info.log.filter((l) => l.section), barLen = 16 * obj.mus.stepDur;
  const r = H.row(`music ${cueId}: ${seconds}s scripted game`, buf);
  // per-section measurements (whole bars only, first 0.25 s of each entry skipped for the crossfade)
  const spans = {};
  for (let i = 0; i < log.length; i++) { const s = log[i].section, t0 = log[i].t, t1 = log[i + 1]?.t ?? t0 + barLen; (spans[s] ||= []).push([t0, t1]); }
  const per = {}, phone = A.highpassBuf(buf, 300);
  for (const [s, sp] of Object.entries(spans)) {
    const inner = sp.map(([t0, t1], i) => [i === 0 || sp[i - 1][1] !== t0 ? t0 + 0.25 : t0, t1]);   // skip each entry's crossfade
    let lo = 0, mid = 0, hi = 0, n = 0, w = 0;
    for (const [t0, t1] of sp) { const d = t1 - t0; lo += A.bandFrac(x, t0, t1, 20, 250) * d; mid += A.bandFrac(x, t0, t1, 250, 4000) * d; hi += A.bandFrac(x, t0, t1, 4000, 20000) * d; w += A.width(buf, t0, t1) * d; n += d; }
    per[s] = { lufs: +A.lufs(buf, inner).toFixed(1), phoneLufs: +A.lufs(phone, inner).toFixed(1), peak: +Math.max(...inner.map(([a, b]) => A.peak(x, a, b))).toFixed(3), low: +(lo / n).toFixed(2), mid: +(mid / n).toFixed(2), high: +(hi / n).toFixed(2), width: +(w / n).toFixed(2), bars: sp.length };
  }
  // click check: energy above 17 kHz (the stems are band-limited to 16 kHz) at every section change vs inside sections
  const changes = log.filter((l, i) => i > 0 && (l.section !== log[i - 1].section || l.bar !== log[i - 1].bar + 1)).map((l) => l.t);
  const base = []; for (let t = 1; t < seconds - 1; t += 0.37) base.push(A.hfEnergy(x, t));
  base.sort((p, q) => p - q); const med = base[Math.floor(base.length / 2)] || 1e-20, p99 = base[Math.floor(base.length * 0.99)] || 1e-20;
  let worst = -Infinity; for (const t of changes) for (const dt of [-0.01, 0, 0.01, 0.02]) worst = Math.max(worst, 10 * Math.log10(A.hfEnergy(x, t + dt) / med));
  const lead = script.find((e) => e[1] === 'fight' || e[1] === 'hero'), firstBand = log.find((l) => ['intro', 'verse'].includes(l.section));
  const startLag = firstBand && lead ? firstBand.t - lead[0] : null;
  const barTimes = log.map((l) => l.t), offGrid = barTimes.filter((t) => Math.abs(((t - barTimes[0]) / barLen) - Math.round((t - barTimes[0]) / barLen)) > 1e-3).length;
  const order = []; for (const l of log) if (l.bar === 0 || order[order.length - 1] !== l.section) if (order[order.length - 1] !== l.section) order.push(l.section);
  const gap = A.longestGap(x, (barTimes[0] ?? 0) + 0.5, Math.min(seconds, (barTimes[barTimes.length - 1] ?? 0) + barLen), -60);
  H.results.music[cueId] = { bpm: CUES[cueId].bpm, barSec: +barLen.toFixed(3), sections: per, songOrder: order.join(' > '), bandStartsAfterContactSec: startLag && +startLag.toFixed(2), fills: obj.mus.info.fills, risers: obj.mus.info.risers, cuts: obj.mus.info.cuts,
    clickWorstDbOverMedianHF: +worst.toFixed(1), hfP99DbOverMedian: +(10 * Math.log10(p99 / med)).toFixed(1), scheduler: { avgMsPerFrame: +(cpu.ms / cpu.calls).toFixed(4), maxMs: +cpu.max.toFixed(3), maxNodes: cpu.maxNodes, maxVoices: cpu.maxVoices }, longestGapSec: gap, skipped: obj.mus.info.skipped };
  H.check(`${cueId}: no clipping / NaN, peak < 1`, r.peak < 1 && r.nan === 0, `peak ${r.peak}`);
  H.check(`${cueId}: section changes land on bar lines`, offGrid === 0, `${offGrid} off-grid of ${barTimes.length}`);
  H.check(`${cueId}: the band starts within a bar of contact`, startLag !== null && startLag <= barLen + 0.35, `${startLag?.toFixed(2)} s (bar ${barLen.toFixed(2)} s)`);
  H.check(`${cueId}: riser into the first merge`, obj.mus.info.risers >= 1, obj.mus.info.risers);
  H.check(`${cueId}: click-free cuts (HF at changes < p99 of the music + 3 dB)`, worst < 10 * Math.log10(p99 / med) + 3, `worst ${worst.toFixed(1)} dB vs p99 ${(10 * Math.log10(p99 / med)).toFixed(1)} dB over median`);
  H.check(`${cueId}: no silent gap while playing`, gap < 0.3, `${gap.toFixed(2)} s`);
  H.check(`${cueId}: phone speaker (300 Hz high-pass): verse within 6 LU of the chorus, tension audible`, per.chorus.phoneLufs - per.verse.phoneLufs <= 6 && per.chorus.phoneLufs - per.tension.phoneLufs <= 9, `verse ${per.verse.phoneLufs} / tension ${per.tension.phoneLufs} / chorus ${per.chorus.phoneLufs}`);
  const band = ['verse', 'pre', 'chorus', 'solo', 'danger', 'intro'].filter((s) => per[s]).map((s) => per[s].lufs);
  H.check(`${cueId}: chorus is the loudest band section, verse >= 4 LU below it (loud-quiet)`, per.chorus && per.verse && per.chorus.lufs >= Math.max(...band) - 0.6 && per.verse.lufs < per.chorus.lufs - 4, `verse ${per.verse?.lufs} / chorus ${per.chorus?.lufs} / max ${Math.max(...band)}`);
  H.check(`${cueId}: calm is the quiet state (>= 5 LU under the verse, >= 10 under the chorus), tension between`, per.calm && per.verse && per.verse.lufs - per.calm.lufs >= 5 && per.chorus.lufs - per.calm.lufs >= 10 && per.tension.lufs > per.calm.lufs && per.tension.lufs < per.chorus.lufs, `calm ${per.calm?.lufs} / tension ${per.tension?.lufs} / verse ${per.verse?.lufs} / chorus ${per.chorus?.lufs}`);
  H.check(`${cueId}: scheduler < 0.2 ms per frame on average`, cpu.ms / cpu.calls < 0.2, `${(cpu.ms / cpu.calls).toFixed(4)} ms`);
  return { x, buf, log, obj };
}

export const SCENARIOS = {
  async 'music-memory'(H) {
    for (const p of [PROFILES.phone, PROFILES.desktop]) for (const id of ['sweep', 'nightfall']) await stemsFor(H, id, p);
    // the session cache: phones keep one cue; switching cue releases the other's buffers
    clearStemCache();
    const a = getStems('sweep', { profile: PROFILES.phone }); await a.all();
    const before = stemCache().MB;
    const b = getStems('nightfall', { profile: PROFILES.phone }); await b.all();
    const after = stemCache();
    H.results.music.cache = { phoneOneCueMB: before, afterSwitch: after, oldDisposed: a.disposed, oldBytes: a.stats.bytes, sameAgain: getStems('nightfall', { profile: PROFILES.phone }) === b };
    H.check('stem cache: a cue switch on a phone releases the previous cue; the same cue is reused', a.disposed && a.stats.bytes === 0 && after.cues.length === 1 && getStems('nightfall', { profile: PROFILES.phone }) === b, JSON.stringify(H.results.music.cache));
    clearStemCache();
  },
  async 'music-coldstart'(H) {
    // real AudioContext, nothing rendered: the band must sound within a bar of the fight starting (live fallback), then
    // hand over to the stems; a 16 ms heartbeat measures main-thread stalls while the stems render
    const res = {};
    for (const id of ['sweep', 'nightfall']) for (const prof of [PROFILES.phone, PROFILES.desktop]) {
      clearStemCache();
      const ac = new AudioContext(); await ac.resume();
      const m = H.createMusic(ac, ac.destination, { cue: id, profile: prof, log: true });
      setLoad(1 / 60, false);
      const t0 = ac.currentTime, w0 = performance.now(); let last = w0, worst = 0, firstStem = null;
      await new Promise((done) => {
        const iv = setInterval(() => {
          const n = performance.now(); worst = Math.max(worst, n - last); last = n;
          setLoad(1 / 60, false);
          m.update(ac.currentTime, 'fight');
          if (firstStem === null && m.info.playing && !m.info.live && m.info.section) firstStem = ac.currentTime - t0;
          if ((m.info.stems.allReadyMs !== null && firstStem !== null) || n - w0 > 120000) { clearInterval(iv); done(); }
        }, 16);
      });
      const st = m.info.stems;
      res[id + '/' + prof.name] = { firstSoundSec: m.info.firstSoundAt !== null ? +(m.info.firstSoundAt - t0).toFixed(2) : null, liveBars: m.info.liveBars, firstStemSec: firstStem && +firstStem.toFixed(1), allStemsSec: st.allReadyMs && +(st.allReadyMs / 1000).toFixed(1), renderSec: +(st.renderMs / 1000).toFixed(1), worstMainSliceMs: +st.maxSliceMs.toFixed(1), worstHeartbeatGapMs: Math.round(worst), MB: +(st.bytes / 1048576).toFixed(1), barSec: +(240 / CUES[id].bpm).toFixed(2) };
      m.stop(0.05); await ac.close();
      const r = res[id + '/' + prof.name];
      H.check(`cold start ${id}/${prof.name}: music within one bar of the fight (live fallback)`, r.firstSoundSec !== null && r.firstSoundSec <= r.barSec, `${r.firstSoundSec} s, bar ${r.barSec} s`);
    }
    H.results.music.coldStart = res;
    clearStemCache();
  },
  async 'music-stems'(H) { for (const id of ['sweep', 'nightfall']) await stemsFor(H, id); },
  async 'music-sweep'(H) {
    // contact at 20 s; a lock at 31 s; kill (hero) at 50 s; missile at 76 s; disengage at 98 s; back at 112 s; win at 126 s
    await musicRun(H, 'sweep', [[0, 'calm'], [12, 'tension'], [20, 'fight'], [31, 'fight', { push: true }], [40, 'fight'], [50, 'hero'], [76, 'danger'], [83, 'fight'], [98, 'tension'], [112, 'fight'], [126, 'victory']], 142);
  },
  async 'music-night'(H) {
    await musicRun(H, 'nightfall', [[0, 'calm'], [14, 'tension'], [24, 'fight'], [40, 'fight', { push: true }], [50, 'fight'], [62, 'hero'], [92, 'danger'], [100, 'fight'], [118, 'tension'], [134, 'fight'], [150, 'victory']], 168);
  },
  async 'music-defeat'(H) {
    const stems = await stemsFor(H, 'sweep');
    const { buf, obj } = await H.render({ seconds: 22, setup: (ac) => ({ mus: H.createMusic(ac, ac.destination, { cue: 'sweep', log: true, stems }) }), tick: (t, o) => o.mus.update(t, t < 8 ? 'fight' : 'defeat') });
    const x = H.A.mono(buf); H.row('music sweep: fight -> defeat tag', buf);
    const secs = obj.mus.info.log.filter((l) => l.section).map((l) => l.section);
    H.check('defeat: sombre tag follows the fight, then silence', secs.includes('lose') && H.A.db(H.A.rms(x, 20.5, 22)) < -50, secs.join(','));
  },
  async 'music-abort'(H) {
    const stems = await stemsFor(H, 'sweep');
    const { buf } = await H.render({ seconds: 8, setup: (ac) => ({ mus: H.createMusic(ac, ac.destination, { cue: 'sweep', stems }) }), tick: (t, o) => { if (t > 4 && !o.stopped) { o.stopped = true; o.mus.stop(0.3); } o.mus.update(t, t > 4 ? 'off' : 'fight'); } });
    const x = H.A.mono(buf);
    H.check('abort: music stops within ~1 s', H.A.db(H.A.rms(x, 5.2, 8)) < -60, `${H.A.db(H.A.rms(x, 5.2, 8)).toFixed(1)} dB after stop`);
  },
  async 'music-duck'(H) {
    // the same chorus rendered with and without the duck, and the radio / warnings alone through the simulator mix
    const { A } = H; const stems = await stemsFor(H, 'sweep');
    const run = (duck) => H.render({ seconds: 20, setup: (ac, M) => { const m = H.createMusic(ac, M.master, { cue: 'sweep', stems }); m.setVolume(0.8 * MIX.music); return { m }; },
      tick: (t, o) => { o.m.setDuck(duck && t > 10 && t < 14 ? MIX.duckRadio : duck && t > 15 && t < 18 ? MIX.duckWarn : 1); o.m.update(t, 'hero'); } });
    const a = A.mono((await run(false)).buf), b = A.mono((await run(true)).buf);
    const dR = A.db(A.rms(b, 10.6, 13.9) / A.rms(a, 10.6, 13.9)), dW = A.db(A.rms(b, 15.6, 17.9) / A.rms(a, 15.6, 17.9));
    const radio = await H.render({ seconds: 4, setup: (ac, M) => { const g = ac.createGain(); g.gain.value = MIX.radio; g.connect(M.flightIn); const r = createRadio(ac, g, { speech: null }); r.say({ text: 'Two bandits, bullseye zero four zero, twenty miles, hot.', role: 'awacs', priority: 1 }, 0); return { r }; }, tick: (t, o) => o.r.update(t, false) });
    const warn = await H.render({ seconds: 3, setup: (ac, M) => { const g = ac.createGain(); g.gain.value = MIX.warnings; g.connect(M.flightIn); return { w: createWarnings(ac, g) }; }, tick: (t, o) => o.w.update(t, { launch: true }) });
    const rx = A.mono(radio.buf), wx = A.mono(warn.buf);
    const bandE = (x, t0, t1, f0, f1) => A.rms(x, t0, t1) * Math.sqrt(A.bandFrac(x, t0, t1, f0, f1));
    const snrR = A.db(bandE(rx, 0.3, 3, 300, 3400) / bandE(b, 10.6, 13.9, 300, 3400)), snrW = A.db(bandE(wx, 0.2, 2.8, 800, 1600) / bandE(b, 15.6, 17.9, 800, 1600));
    const clickD = Math.max(...[10, 14, 15, 18].map((t) => 10 * Math.log10((A.hfEnergy(b, t) + 1e-20) / (A.hfEnergy(a, t) + 1e-20))));
    H.results.music.duck = { radioDuckDb: +dR.toFixed(1), warnDuckDb: +dW.toFixed(1), radioOverDuckedMusicDb_300_3400: +snrR.toFixed(1), launchWarnOverDuckedMusicDb_800_1600: +snrW.toFixed(1), duckEdgeHFDeltaDb: +clickD.toFixed(1) };
    H.check('duck: music drops ~7 dB under radio, ~4 dB under missile warnings', dR < -5.5 && dR > -9 && dW < -3 && dW > -6, `${dR.toFixed(1)} / ${dW.toFixed(1)} dB`);
    H.check('duck: radio band > music band by 6 dB (intelligible)', snrR > 6, `${snrR.toFixed(1)} dB`);
    H.check('duck: launch warning > music in its band by 10 dB', snrW > 10, `${snrW.toFixed(1)} dB`);
    H.check('duck: duck edges are click-free', clickD < 3, `${clickD.toFixed(1)} dB`);
  },
  async 'guitar-cab'(H) {
    const { A } = H;
    // ringing power chord D5 (D2 A2 D3) then 8 palm-muted chugs
    const { buf } = await H.render({ seconds: 4, setup: (ac, M) => {
      const w = noise(ac, 'white'); w.start();
      const g = makeRhythmGuitar(ac, M.master, w, { os: '4x' }); const sd = 60 / 132 / 4;
      g.trigger({ n: [38, 45, 50], d: 16, v: 1, m: 0 }, 0.1, sd);
      for (let i = 0; i < 8; i++) g.trigger({ n: [38, 45], d: 1, v: 0.8, m: 1 }, 2.2 + i * 2 * sd, sd);
    } });
    const x = A.mono(buf);
    const raw = await H.render({ seconds: 2, setup: (ac, M) => { for (const m of [38, 45, 50]) { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 440 * Math.pow(2, (m - 69) / 12); const g = ac.createGain(); g.gain.value = 0.08; o.connect(g); g.connect(M.master); o.start(); } } });
    const xr = A.mono(raw.buf);
    const ring = { hi5k: A.bandFrac(x, 0.3, 1.8, 5000, 20000), lo80: A.bandFrac(x, 0.3, 1.8, 20, 80), mid: A.bandFrac(x, 0.3, 1.8, 150, 2500), centroid: A.centroid(x, 0.3, 1.8) };
    const sawRef = { hi5k: A.bandFrac(xr, 0.3, 1.8, 5000, 20000), centroid: A.centroid(xr, 0.3, 1.8) };
    const chug = A.attackDecay(x, 2.2, 2.2 + 2 * 60 / 132 / 4, 0.01);
    const muteCen = A.centroid(x, 2.2, 3.4), presence = A.bandFrac(x, 0.3, 1.8, 1000, 4000);
    H.results.sfx.guitar = { ringHi5kFrac: +ring.hi5k.toFixed(4), ringLo80Frac: +ring.lo80.toFixed(4), ring150_2500Frac: +ring.mid.toFixed(3), ringCentroidHz: Math.round(ring.centroid), ring1k_4kFrac: +presence.toFixed(3), rawSawHi5kFrac: +sawRef.hi5k.toFixed(4), rawSawCentroidHz: Math.round(sawRef.centroid), chugAttackMs: Math.round(chug.attack * 1000), chugDecayMs: Math.round(chug.decay * 1000), muteCentroidHz: Math.round(muteCen) };
    H.row('guitar: D5 ring + palm mutes', buf);
    H.check('guitar cab: little energy above 5 kHz (vs raw saw)', ring.hi5k < 0.02 && ring.hi5k < sawRef.hi5k / 3, `${ring.hi5k.toFixed(4)} vs saw ${sawRef.hi5k.toFixed(4)}`);
    H.check('guitar cab: low end tamed below 80 Hz', ring.lo80 < 0.08, ring.lo80.toFixed(4));
    H.check('guitar: energy concentrated 150-2500 Hz', ring.mid > 0.6, ring.mid.toFixed(3));
    H.check('palm mute: short and darker than the ringing chord', chug.decay < 0.2 && muteCen < ring.centroid, `decay ${Math.round(chug.decay * 1000)} ms, centroid ${Math.round(muteCen)} vs ${Math.round(ring.centroid)} Hz`);
  },
  async 'lead-guitar'(H) {
    const { A } = H;
    const { buf } = await H.render({ seconds: 3, setup: (ac, M) => {
      const s = { reverb: G(ac, 0), delay: G(ac, 0) };
      const l = makeLeadGuitar(ac, M.master, s); l.trigger({ n: 74, d: 16, v: 1, f: 'bv' }, 0.1, 60 / 132 / 4);
    } });
    const x = A.mono(buf);
    const early = A.peakFreq(x, 0.1, 0.16, 300, 1000, H.SR, 2048), late = A.peakFreq(x, 1.0, 1.8, 300, 1000);
    H.results.sfx.lead = { bendStartHz: Math.round(early), heldHz: Math.round(late), targetHz: 587, centroid: Math.round(A.centroid(x, 0.5, 1.5)) };
    H.row('lead guitar: bent D5 with vibrato', buf);
    H.check('lead: bends up into the written pitch (D5 587 Hz)', Math.abs(late - 587) < 15 && early < late - 25, `${Math.round(early)} -> ${Math.round(late)} Hz`);
  },
  ...MUSIC_SCENARIOS_EXTRA,
};
