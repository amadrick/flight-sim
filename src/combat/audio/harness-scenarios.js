// Harness scenarios (see harness.js). Each scenario renders offline, measures and records rows + checks.
import { makeRhythmGuitar, makeLeadGuitar, noise, makeReverb, makePingPong, G } from './music/synth.js';
import { CUES } from './music/cues.js';
import { MUSIC_SCENARIOS_EXTRA } from './harness-sfx.js';

function moodAt(script, t) { let m = script[0][1]; for (const [t0, mm] of script) if (t >= t0) m = mm; return m; }

async function musicRun(H, cueId, script, seconds) {
  const { A } = H;
  const { buf, obj } = await H.render({
    seconds,
    setup: (ac, M) => ({ mus: H.createMusic(ac, M.master, { cue: cueId, log: true }) }),
    tick: (t, o) => o.mus.update(t, moodAt(script, t)),
  });
  const x = A.mono(buf), log = obj.mus.info.log, sd = obj.mus.stepDur, barLen = 16 * sd;
  const r = H.row(`music ${cueId}: ${seconds}s scripted moods`, buf);
  // per-section levels (whole bars only)
  const sec = {};
  for (let i = 0; i < log.length - 1; i++) { const s = log[i].section; (sec[s] ||= []).push([log[i].t, log[i + 1].t]); }
  const lv = {}, cen = {}, gtr = {}, wid = {};
  for (const [s, spans] of Object.entries(sec)) {
    let e = 0, n = 0, c = 0, g = 0, w = 0;
    for (const [a, b] of spans) { const v = A.rms(x, a, b); e += v * v * (b - a); n += b - a; c += A.centroid(x, a, b) * (b - a); g += A.bandFrac(x, a, b, 1200, 4500) * (b - a); w += A.width(buf, a, b) * (b - a); }
    lv[s] = +A.db(Math.sqrt(e / n)).toFixed(1); cen[s] = Math.round(c / n); gtr[s] = +(g / n).toFixed(3); wid[s] = +(w / n).toFixed(2);
  }
  const barTimes = log.map((l) => l.t), offGrid = barTimes.filter((t) => Math.abs(((t - barTimes[0]) / barLen) - Math.round((t - barTimes[0]) / barLen)) > 1e-3).length;
  const fightSpan = [sec.riff?.[0]?.[0] ?? 0, sec.riff2?.[sec.riff2.length - 1]?.[1] ?? 0];
  const beat = A.beatPeriod(x, fightSpan[0], fightSpan[1], 0.7, 2.4);
  const firstT = barTimes[0] ?? 0, lastPlay = (log[log.length - 1]?.t ?? 0) + barLen;
  const gap = A.longestGap(x, firstT + 0.5, Math.min(seconds, lastPlay), -55);
  const sections = log.map((l) => l.section + l.bar).join(' ');
  H.results.music[cueId] = { bpm: CUES[cueId].bpm, barSec: +barLen.toFixed(3), measuredBeatSec: +beat.toFixed(3), levelsDb: lv, centroidHz: cen, gtrBand800_5k: gtr, stereoWidth: wid, longestGapSec: gap, skipped: obj.mus.info.skipped, order: [...new Set(log.map((l) => l.section))].join(' > '), sections };
  H.check(`${cueId}: no clipping / NaN, peak < 1`, r.peak < 1 && r.nan === 0, `peak ${r.peak}`);
  H.check(`${cueId}: no DC offset`, Math.abs(+r.dc) < 2e-3, r.dc);
  H.check(`${cueId}: section changes land on bar lines`, offGrid === 0, `${offGrid} off-grid of ${barTimes.length}`);
  const q = 60 / CUES[cueId].bpm, bOk = [q * 2, q * 4].some((p) => Math.abs(beat - p) < 0.02 * p);
  H.check(`${cueId}: rhythmic period (onset autocorrelation) = half bar or bar at ${CUES[cueId].bpm} BPM`, bOk, `${beat.toFixed(3)} s vs ${(2 * q).toFixed(3)} / ${(4 * q).toFixed(3)} s`);
  H.check(`${cueId}: no silent gap while playing`, gap < 0.3, `${gap.toFixed(2)} s`);
  const band = ['riff', 'riff2', 'chorus', 'chorus2', 'danger'].filter((s) => lv[s] !== undefined).map((s) => lv[s]);
  H.check(`${cueId}: full-band sections within 6 dB of each other`, Math.max(...band) - Math.min(...band) < 6, band.join(' / '));
  H.check(`${cueId}: calm is the quiet state (>= 5 dB under the band)`, lv.calm !== undefined && Math.min(...band) - lv.calm >= 5, `calm ${lv.calm} vs band min ${Math.min(...band)}`);
  H.check(`${cueId}: tension sits between calm and the band`, lv.tension > lv.calm && lv.tension < Math.max(...band), `${lv.calm} < ${lv.tension} < ${Math.max(...band)}`);
  H.check(`${cueId}: guitars enter with the fight (0.8-5 kHz share of riff > tension, which has only mutes)`, gtr.riff > gtr.tension, `${gtr.calm} -> ${gtr.riff}`);
  H.check(`${cueId}: stereo width in the band sections`, wid.riff > 0.25, `${wid.riff}`);
  H.check(`${cueId}: victory sting plays then the score goes quiet`, lv.win > lv.calm && A.db(A.rms(x, seconds - 1.5, seconds)) < -45, `win ${lv.win} dB, tail ${A.db(A.rms(x, seconds - 1.5, seconds)).toFixed(1)} dB`);
  return { x, buf, log };
}

export const SCENARIOS = {
  async 'debug-inst'(H) {
    for (const inst of ['drums', 'gtr', 'lead', 'bass', 'arp', 'pad', 'clean', 'sbass', 'riser', 'all']) for (const [mood, secs] of [['calm', 8], ['fight', 32]]) {
      const { buf } = await H.render({ seconds: secs, setup: (ac, M) => ({ mus: H.createMusic(ac, ac.destination, { cue: 'sweep', only: inst === 'all' ? null : [inst] }) }), tick: (t, o) => o.mus.update(t, mood) });
      const x = H.A.mono(buf); let nanAt = -1; for (let i = 0; i < x.length; i++) if (!isFinite(x[i])) { nanAt = i / H.SR; break; }
      H.row(`debug ${inst} ${mood}`, buf, { nanAt, cen: Math.round(H.A.centroid(x, 1, Math.min(secs, nanAt > 0 ? nanAt : secs))) });
    }
  },
  async 'music-sweep'(H) {
    await musicRun(H, 'sweep', [[0, 'calm'], [10, 'tension'], [17, 'fight'], [47, 'hero'], [64, 'danger'], [72, 'fight'], [74, 'victory']], 90);
  },
  async 'music-night'(H) {
    await musicRun(H, 'nightfall', [[0, 'calm'], [10, 'tension'], [20, 'fight'], [50, 'hero'], [66, 'danger'], [76, 'victory']], 96);
  },
  async 'music-defeat'(H) {
    const { buf, obj } = await H.render({ seconds: 22, setup: (ac, M) => ({ mus: H.createMusic(ac, M.master, { cue: 'sweep', log: true }) }), tick: (t, o) => o.mus.update(t, t < 8 ? 'fight' : 'defeat') });
    const x = H.A.mono(buf); H.row('music sweep: fight -> defeat sting', buf);
    const secs = obj.mus.info.log.map((l) => l.section);
    H.check('defeat: sombre sting follows the fight, then silence', secs.includes('lose') && H.A.db(H.A.rms(x, 20.5, 22)) < -45, secs.join(','));
  },
  async 'music-abort'(H) {
    const { buf } = await H.render({ seconds: 8, setup: (ac, M) => ({ mus: H.createMusic(ac, M.master, { cue: 'sweep' }) }), tick: (t, o) => { if (t > 4 && !o.stopped) { o.stopped = true; o.mus.stop(0.3); } o.mus.update(t, t > 4 ? 'off' : 'fight'); } });
    const x = H.A.mono(buf);
    H.check('abort: music stops within ~1 s', H.A.db(H.A.rms(x, 5.5, 8)) < -50, `${H.A.db(H.A.rms(x, 5.5, 8)).toFixed(1)} dB after stop`);
  },
  async 'guitar-cab'(H) {
    const { A } = H;
    // ringing power chord D5 (D2 A2 D3) then 8 palm-muted chugs
    const { buf } = await H.render({ seconds: 4, setup: (ac, M) => {
      const w = noise(ac, 'white'); w.start();
      const g = makeRhythmGuitar(ac, M.master, w); const sd = 60 / 132 / 4;
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
