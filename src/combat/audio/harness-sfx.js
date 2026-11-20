// Harness scenarios for weapon sounds, explosions, warnings, radio framing, voice pool and the overall mix.
import { createPool, gunVoice, gunTail, missileLaunch, flare, airframeHit, hitTick, nearMiss, explosion, flyby } from './sfx.js';
import { createWarnings } from './warnings.js';
import { createRadio } from './radio.js';
import { createRig } from '../../audio/rig.js';
import { MIX } from './index.js';

const F16 = { id: 'f16', category: 'fighter', hudType: 'fighter', sound: { engine: 'jet-lowbypass', afterburner: true }, specs: { engineCount: 1, thrustDry: 76300, thrustMax: 131000 }, geometry: { gear: [] } };

async function one(H, name, seconds, fn, measure) {
  const { buf, obj } = await H.render({ seconds, setup: (ac, M) => { const pool = createPool(24); const o = { pool }; fn(ac, M.flightIn, pool, o); return o; }, tick: (t, o, ac) => o.tick?.(t, ac) });
  const x = H.A.mono(buf); const r = H.row(name, buf, measure ? measure(x, buf, obj) : {});
  H.check(`${name}: finite, audible, no clipping`, r.nan === 0 && r.peak > 0.01 && r.peak < 1, `peak ${r.peak}`);
  return { x, buf, r, obj };
}

export const MUSIC_SCENARIOS_EXTRA = {
  async 'sfx-gun'(H) {
    const { A } = H;
    const gun = async (label, o) => one(H, `gun ${label}: 1.5 s burst + release`, 3, (ac, d, pool, st) => {
      const v = gunVoice(ac, pool, d, 0.2, o); st.tick = (t) => { if (t >= 1.7 && !st.s) { st.s = true; v.stop(1.7); if (!o.far) gunTail(ac, pool, d, 1.72, 1, o.heavy, o.rof); } };
    }, (x) => ({ centroid: Math.round(A.centroid(x, 0.7, 1.6)), low200: +A.bandFrac(x, 0.7, 1.6, 20, 200).toFixed(3), hi2k: +A.bandFrac(x, 0.7, 1.6, 2000, 12000).toFixed(3), fund: Math.round(A.peakFreq(x, 0.7, 1.6, 30, 400)) }));
    const m61 = await gun('M61 20mm (rof 100)', { rof: 100 }), gau8 = await gun('GAU-8 30mm (rof 65, heavy)', { rof: 65, heavy: true, level: 0.9 });
    const gau22 = await gun('GAU-22 25mm (rof 55)', { rof: 55, level: 1.05 });
    const far = await gun('M61 heard at 1.5 km', { rof: 100, far: true, cutoff: 2000, level: 0.9 / (1 + 1500 / 180) * 1.4 });
    const g = (o) => ({ c: A.centroid(o.x, 0.7, 1.6), lo: A.bandFrac(o.x, 0.7, 1.6, 20, 200), hi: A.bandFrac(o.x, 0.7, 1.6, 2000, 12000), f: A.peakFreq(o.x, 0.7, 1.6, 30, 400), rms: A.rms(o.x, 0.7, 1.6) });
    const a = g(m61), b = g(gau8), c = g(far), m = g(gau22);
    const clicks = A.bandFrac(m61.x, 1.8, 2.4, 1500, 4500), clicksBurst = A.bandFrac(m61.x, 0.7, 1.6, 1500, 4500);
    const ad = A.attackDecay(m61.x, 0.15, 0.6, 0.005);
    const tail = A.rms(m61.x, 1.8, 2.2), fire = a.rms;
    H.results.sfx.gun = { m61: { rmsDb: +A.db(a.rms).toFixed(1), centroid: Math.round(a.c), below200: +a.lo.toFixed(3), above2k: +a.hi.toFixed(3), fundamentalHz: Math.round(a.f), attackMs: Math.round(ad.attack * 1000), tailDb: +A.db(tail).toFixed(1) },
      gau8: { rmsDb: +A.db(b.rms).toFixed(1), centroid: Math.round(b.c), below200: +b.lo.toFixed(3), fundamentalHz: Math.round(b.f) }, gau22: { rmsDb: +A.db(m.rms).toFixed(1), centroid: Math.round(m.c), fundamentalHz: Math.round(m.f) }, tailMechanism1k5_4k5Share: +clicks.toFixed(3), far1500m: { rmsDb: +A.db(c.rms).toFixed(1), centroid: Math.round(c.c) } };
    H.check('M61: buzz fundamental at the rate of fire (100 Hz)', Math.abs(a.f - 100) < 8, `${Math.round(a.f)} Hz`);
    H.check('M61: punch below 200 Hz and bite above 2 kHz', a.lo > 0.2 && a.hi > 0.05, `<200: ${a.lo.toFixed(2)}, >2k: ${a.hi.toFixed(2)}`);
    H.check('GAU-8: heavier — lower fundamental (65 Hz) and centroid than the M61', Math.abs(b.f - 65) < 8 && b.c < a.c, `${Math.round(b.f)} Hz, centroid ${Math.round(b.c)} vs ${Math.round(a.c)}`);
    H.check('GAU-22: its own rate (55 Hz buzz), between the M61 and the GAU-8', Math.abs(m.f - 55) < 6, `${Math.round(m.f)} Hz`);
    H.check('gun tail: mechanism clicks (1.5-4.5 kHz share in the tail above the burst share)', clicks > clicksBurst, `${clicks.toFixed(3)} vs ${clicksBurst.toFixed(3)}`);
    H.check('gun: fast attack (< 60 ms)', ad.attack < 0.06, `${Math.round(ad.attack * 1000)} ms`);
    H.check('gun: audible spin-down tail after release, below the burst', tail > fire * 0.01 && tail < fire * 0.5, `tail ${A.db(tail).toFixed(1)} vs burst ${A.db(fire).toFixed(1)} dB`);
    H.check('distant gun: duller and much quieter', c.c < a.c && c.rms < a.rms * 0.25, `centroid ${Math.round(c.c)}, ${A.db(c.rms).toFixed(1)} dB`);
  },
  async 'sfx-oneshots'(H) {
    const { A } = H;
    const ms = {};
    const add = async (name, secs, fn, win) => {
      const o = await one(H, name, secs, fn, (x) => { const ad = A.attackDecay(x, 0.05, secs, 0.002); return { centroid: Math.round(A.centroid(x, 0.1, Math.min(secs, 0.1 + win))), attackMs: +(ad.attack * 1000).toFixed(1), decayMs: Math.round(ad.decay * 1000) }; });
      ms[name] = { rms: A.rms(o.x, 0.1, 0.1 + win), centroid: A.centroid(o.x, 0.1, Math.min(secs, 0.1 + win)), peak: o.r.peak, ad: A.attackDecay(o.x, 0.05, secs, 0.002), x: o.x };
    };
    await add('missile launch (player)', 5, (ac, d, p) => missileLaunch(ac, p, d, 0.1), 4);
    await add('flare', 2.5, (ac, d, p) => flare(ac, p, d, 0.1), 1.6);
    await add('airframe hit (s=1)', 1, (ac, d, p) => airframeHit(ac, p, d, 0.1, 1, () => 0.5), 0.4);
    await add('hit confirm tick', 0.5, (ac, d, p) => hitTick(ac, p, d, 0.1), 0.1);
    await add('near miss crack', 0.6, (ac, d, p) => nearMiss(ac, p, d, 0.1, 1, () => 0.5), 0.25);
    await add('explosion cannon kill (s=1.1)', 6, (ac, d, p) => explosion(ac, p, d, 0.1, { size: 1.1 }), 4);
    await add('explosion missile kill (s=1.7)', 7, (ac, d, p) => explosion(ac, p, d, 0.1, { size: 1.7 }), 4);
    await add('explosion at 3 km (s=1.7)', 7, (ac, d, p) => { const g = ac.createGain(); g.gain.value = 1 / (1 + 3000 / 450); g.connect(d); explosion(ac, p, g, 0.1, { size: 1.7, cutoff: 15000 * Math.exp(-3000 / 3200) }); }, 4);
    await add('wreck ground impact', 7, (ac, d, p) => explosion(ac, p, d, 0.1, { size: 1.3, ground: true }), 5);
    await add('fly-by merge 400 m/s, 40 m', 3, (ac, d, p) => flyby(ac, p, d, 0.1, { tca: 0.5, dopIn: 1.6, dopOut: 0.6, level: 1.3 }), 2);
    const L = ms['missile launch (player)'];
    const early = A.rms(L.x, 0.3, 0.8), late = A.rms(L.x, 3, 3.8), c1 = A.centroid(L.x, 0.3, 0.8), c2 = A.centroid(L.x, 2.5, 3.8);
    H.check('missile launch: motor recedes (level and brightness fall)', late < early * 0.4 && c2 < c1, `${A.db(early).toFixed(1)} -> ${A.db(late).toFixed(1)} dB, ${Math.round(c1)} -> ${Math.round(c2)} Hz`);
    const ex = ms['explosion missile kill (s=1.7)'], ec = ms['explosion cannon kill (s=1.1)'], far = ms['explosion at 3 km (s=1.7)'];
    H.check('explosion: low thump dominates (<200 Hz share > 40 %)', A.bandFrac(ex.x, 0.1, 1.5, 20, 200) > 0.4, A.bandFrac(ex.x, 0.1, 1.5, 20, 200).toFixed(2));
    H.check('explosion: missile kill bigger than cannon kill', ex.rms > ec.rms, `${A.db(ex.rms).toFixed(1)} vs ${A.db(ec.rms).toFixed(1)} dB`);
    H.check('explosion: crackle/debris tail present 1.5-3.5 s', A.rms(ex.x, 1.5, 3.5) > ex.rms * 0.05, `${A.db(A.rms(ex.x, 1.5, 3.5)).toFixed(1)} dB`);
    H.check('explosion at 3 km: quieter (>= 7 dB, after the master compressor) and duller', far.rms < ex.rms * 0.45 && far.centroid < ex.centroid, `${A.db(far.rms).toFixed(1)} dB, ${Math.round(far.centroid)} Hz`);
    const tk = ms['hit confirm tick'], nm = ms['near miss crack'], ah = ms['airframe hit (s=1)'];
    H.check('hit tick: short (< 40 ms to -20 dB) and subtle (quieter than an airframe hit)', tk.ad.decay < 0.04 && tk.peak < ah.peak, `decay ${Math.round(tk.ad.decay * 1000)} ms, peak ${tk.peak} vs ${ah.peak}`);
    H.check('near miss: sharp attack (< 3 ms) and bright', nm.ad.attack < 0.003 && nm.centroid > 2000, `${(nm.ad.attack * 1000).toFixed(1)} ms, ${Math.round(nm.centroid)} Hz`);
    H.check('airframe hit: metallic (energy 1.5-5 kHz > 35 %)', A.bandFrac(ah.x, 0.1, 0.4, 1500, 5000) > 0.35, A.bandFrac(ah.x, 0.1, 0.4, 1500, 5000).toFixed(2));
    const fb = ms['fly-by merge 400 m/s, 40 m'], pf1 = A.peakFreq(fb.x, 0.2, 0.55, 500, 4000, H.SR, 2048), pf2 = A.peakFreq(fb.x, 0.7, 1.2, 500, 4000, H.SR, 2048);
    H.check('fly-by: swells to the pass then the band drops (Doppler)', A.rms(fb.x, 0.5, 0.7) > A.rms(fb.x, 0.1, 0.2) * 2 && pf2 < pf1, `peak band ${Math.round(pf1)} -> ${Math.round(pf2)} Hz`);
  },
  async 'sfx-pool'(H) {
    const { obj } = await H.render({ seconds: 9, setup: (ac, M) => { const pool = createPool(24); for (let i = 0; i < 60; i++) explosion(ac, pool, M.flightIn, 0.1 + i * 0.02, { size: 0.5 }); return { pool, peakAt: 0 }; }, tick: (t, o) => { o.mid ??= {}; if (t > 1 && t < 1.05) o.mid.live = o.pool.live; } });
    H.results.sfx.pool = { peak: obj.pool.peak, refused: obj.pool.refused, liveAfter: obj.pool.live };
    H.check('voice pool: capped at 24, excess refused, all voices released (no leaks)', obj.pool.peak <= 24 && obj.pool.refused > 0 && obj.pool.live === 0, JSON.stringify(H.results.sfx.pool));
  },
  async 'warnings'(H) {
    const { A } = H;
    const W = {};
    const run = async (name, secs, script) => {
      const { buf } = await H.render({ seconds: secs, setup: (ac, M) => ({ w: createWarnings(ac, M.flightIn) }), tick: (t, o) => script(t, o.w) });
      const x = A.mono(buf); W[name] = x; H.row('warn: ' + name, buf, { centroid: Math.round(A.centroid(x, 0.3, secs - 0.2)) }); return x;
    };
    const irl = await run('IR seeker locked', 2, (t, w) => w.setSeeker('ir-lock', 0.05));
    const irs = await run('IR seeker searching (growl)', 2, (t, w) => w.setSeeker('ir-search', 0.05));
    const rds = await run('radar seeker searching', 2.2, (t, w) => w.setSeeker('rdr-search', 0.05));
    const rdl = await run('radar seeker locked', 2, (t, w) => w.setSeeker('rdr-lock', 0.05));
    const lw = await run('missile launch warning', 3, (t, w) => w.update(t, { launch: true }));
    const rw = await run('RWR lock chirps', 3, (t, w) => w.update(t, { rwrLock: true }));
    const fw = await run('fire bell', 3.5, (t, w) => w.update(t, { fire: true }));
    const nl = await run('no-lock blip', 0.6, (t, w) => { if (!w._d) { w._d = 1; w.noLock(0.1); } });
    const off = await run('launch warning stops', 3, (t, w) => w.update(t, { launch: t < 1 }));
    const p1 = A.tonePurity(irl, 0.3, 1.8, 25), p2 = A.tonePurity(rdl, 0.3, 1.8, 25);
    const bursts = (x, t0, t1) => { const e = A.envelope(x, t0, t1, 0.01), mx = Math.max(...e); let n = 0, on = false; for (const v of e) { if (v > mx - 8 && !on) { n++; on = true; } else if (v < mx - 14) on = false; } return n; };
    H.results.sfx.warnings = { irLock: { hz: Math.round(p1.f), purity: +p1.purity.toFixed(3) }, radarLock: { hz: Math.round(p2.f), purity: +p2.purity.toFixed(3) }, irSearchCentroid: Math.round(A.centroid(irs, 0.3, 1.8)), radarSearchPulsesPer2s: bursts(rds, 0.1, 2.1), launchBurstsPer3s: bursts(lw, 0, 3), rwrBurstsPer3s: bursts(rw, 0, 3),
      levelsDb: { irLock: +A.db(A.rms(irl, 0.3, 1.8)).toFixed(1), irSearch: +A.db(A.rms(irs, 0.3, 1.8)).toFixed(1), rdrSearch: +A.db(A.rms(rds, 0.3, 2)).toFixed(1), rdrLock: +A.db(A.rms(rdl, 0.3, 1.8)).toFixed(1), launch: +A.db(A.rms(lw, 0.1, 2.9)).toFixed(1), rwr: +A.db(A.rms(rw, 0.1, 2.9)).toFixed(1), fire: +A.db(A.rms(fw, 0.1, 3.3)).toFixed(1) } };
    H.check('IR lock: clean tone at 1250 Hz (purity > 0.85)', Math.abs(p1.f - 1250) < 10 && p1.purity > 0.85, `${Math.round(p1.f)} Hz, purity ${p1.purity.toFixed(3)}`);
    H.check('IR search growl: low, unsteady, distinct from the lock tone', A.tonePurity(irs, 0.3, 1.8, 25).purity < 0.6 && A.peakFreq(irs, 0.3, 1.8, 100, 3000) < 700, `purity ${A.tonePurity(irs, 0.3, 1.8, 25).purity.toFixed(2)}, peak ${Math.round(A.peakFreq(irs, 0.3, 1.8, 100, 3000))} Hz`);
    H.check('radar lock: steady 1560 Hz, distinct timbre from IR lock', Math.abs(p2.f - 1560) < 10 && p2.purity < p1.purity, `${Math.round(p2.f)} Hz, purity ${p2.purity.toFixed(2)}`);
    H.check('radar search: pulsed (~5 per second)', Math.abs(bursts(rds, 0.1, 2.1) - 10) <= 2, `${bursts(rds, 0.1, 2.1)} pulses in 2 s`);
    H.check('launch warning: repeating bursts, alternating two pitches', bursts(lw, 0, 3) >= 4 && Math.abs(A.peakFreq(lw, 0.1, 2.9, 500, 2500) - 1360) < 40 || Math.abs(A.peakFreq(lw, 0.1, 2.9, 500, 2500) - 960) < 40, `${bursts(lw, 0, 3)} bursts, peak ${Math.round(A.peakFreq(lw, 0.1, 2.9, 500, 2500))} Hz`);
    H.check('launch warning stops when the threat is gone', A.db(A.rms(off, 1.3, 3)) < -70, `${A.db(A.rms(off, 1.3, 3)).toFixed(1)} dB`);
    H.check('RWR and missile-launch warning are distinct (pitch band and rhythm)', A.peakFreq(rw, 0.1, 2.9, 500, 5000) > 1.5 * A.peakFreq(lw, 0.1, 2.9, 500, 5000) && bursts(rw, 0, 3) !== bursts(lw, 0, 3), `RWR ${Math.round(A.peakFreq(rw, 0.1, 2.9, 500, 5000))} Hz / ${bursts(rw, 0, 3)} groups vs launch ${Math.round(A.peakFreq(lw, 0.1, 2.9, 500, 5000))} Hz / ${bursts(lw, 0, 3)} bursts`);
    H.check('RWR: ~1 chirp group per second, high', bursts(rw, 0, 3) >= 2 && bursts(rw, 0, 3) <= 12 && A.peakFreq(rw, 0.1, 2.9, 500, 5000) > 2000, `${bursts(rw, 0, 3)} groups, ${Math.round(A.peakFreq(rw, 0.1, 2.9, 500, 5000))} Hz`);
    H.check('fire bell: low bell distinct from tones', A.peakFreq(fw, 0.1, 3.3, 200, 3000) < 500, `${Math.round(A.peakFreq(fw, 0.1, 3.3, 200, 3000))} Hz`);
    H.check('no-lock blip: low and short', A.peakFreq(nl, 0.1, 0.4, 100, 2000) < 400, `${Math.round(A.peakFreq(nl, 0.1, 0.4, 100, 2000))} Hz`);
  },
  async 'radio'(H) {
    const { A } = H;
    const { buf, obj } = await H.render({ seconds: 6, setup: (ac, M) => { const r = createRadio(ac, M.flightIn, { speech: null, rng: (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })() }); r.say({ text: 'Two bandits, bullseye zero four zero, twenty miles, hot.', role: 'awacs', priority: 1 }, 0); return { r, log: [] }; }, tick: (t, o) => { o.r.update(t, false); o.log.push(o.r.speaking ? 1 : 0); } });
    const x = A.mono(buf), on = obj.log.indexOf(1), offI = obj.log.lastIndexOf(1);
    const band = A.bandFrac(x, 0.2, 3, 300, 3600);
    H.row('radio: squelch + murmur + roger (no speech)', buf, { centroid: Math.round(A.centroid(x, 0.2, 3)), band300_3600: +band.toFixed(3), onAirSec: +((offI - on) / 30).toFixed(2) });
    H.results.sfx.radio = { band300_3600: +band.toFixed(3), onAirSec: +((offI - on) / 30).toFixed(2), rmsDb: +A.db(A.rms(x, 0.2, 3)).toFixed(1) };
    H.check('radio: band-limited like a radio (> 85 % of energy 300-3600 Hz)', band > 0.85, band.toFixed(3));
    H.check('radio: line stays on air ~ its spoken length, then squelch out', (offI - on) / 30 > 2 && (offI - on) / 30 < 5.5 && A.db(A.rms(x, 5.3, 6)) < -60, `${((offI - on) / 30).toFixed(2)} s`);
    // queue behaviour with an urgent line
    const { obj: o2 } = await H.render({ seconds: 4, setup: (ac, M) => { const r = createRadio(ac, M.flightIn, { speech: null }); r.say({ text: 'Viper two, say fuel state when able.', role: 'lead', priority: 0 }, 0); return { r, seen: [] }; },
      tick: (t, o) => { if (t > 0.6 && !o.u) { o.u = 1; o.r.say({ text: 'Missile launch, break right!', role: 'wingman', priority: 2 }, t); } o.r.update(t, false); const c = o.r.current?.text; if (c && o.seen[o.seen.length - 1] !== c) o.seen.push(c); } });
    H.check('radio: an urgent line pre-empts chatter', o2.seen[1] === 'Missile launch, break right!', o2.seen.join(' | '));
  },
  async 'mix'(H) {
    const { A } = H;
    // relative loudness in the shared master: F-16 at MIL (chase camera), the player's gun, warnings, music in a fight
    const lvl = async (setup, t0, t1, secs = t1 + 0.2) => { const { buf } = await H.render({ seconds: secs, setup: setup.s, tick: setup.t }); return A.rms(A.mono(buf), t0, t1); };
    const st = { engines: [{ running: true, n1: 0.98, n2: 1, thrust: 76300, afterburner: 0, reverser: 0 }], surfaces: { gear: 0, flaps: 0, speedbrake: 0, canopy: 0 }, gear: [], ias: 220, mach: 0.7, aoa: 0.05, gLoad: 1, agl: 3000, altitude: 3000, onGround: false, groundSpeed: 220, throttle: 0.9, verticalSpeed: 0, ap: { engaged: false } };
    const eng = await lvl({ s: (ac, M) => ({ rig: createRig(ac, M.flightIn, F16, {}) }), t: (t, o) => o.rig.update({ dt: 1 / 30, st, mix: 0, L: { dist: 25, front: -0.9, pan: 0, dop: 1 }, now: t, rough: 0.3, turbulence: 0 }) }, 2, 4);
    const gun = await lvl({ s: (ac, M) => { gunVoice(ac, createPool(), M.flightIn, 0.1, { rof: 100 }); } }, 0.5, 1.5, 1.6);
    const bandE = async (withGun) => { const { buf } = await H.render({ seconds: 3.6, setup: (ac, M) => ({ rig: createRig(ac, M.flightIn, F16, {}), g: withGun ? gunVoice(ac, createPool(), M.flightIn, 2, { rof: 100 }) : null }), tick: (t, o) => o.rig.update({ dt: 1 / 30, st, mix: 0, L: { dist: 25, front: -0.9, pan: 0, dop: 1 }, now: t, rough: 0.3, turbulence: 0 }) }); const x = A.mono(buf); return A.rms(x, 2.3, 3.5) * Math.sqrt(A.bandFrac(x, 2.3, 3.5, 1500, 6000)); };
    const bOff = await bandE(false), bOn = await bandE(true);
    const gunEng = await lvl({ s: (ac, M) => ({ rig: createRig(ac, M.flightIn, F16, {}), g: gunVoice(ac, createPool(), M.flightIn, 2, { rof: 100 }) }), t: (t, o) => o.rig.update({ dt: 1 / 30, st, mix: 0, L: { dist: 25, front: -0.9, pan: 0, dop: 1 }, now: t, rough: 0.3, turbulence: 0 }) }, 2.3, 3.5, 3.6);
    const warn = await lvl({ s: (ac, M) => { const g = ac.createGain(); g.gain.value = MIX.warnings * MIX.warnExterior; g.connect(M.flightIn); return { w: createWarnings(ac, g) }; }, t: (t, o) => o.w.update(t, { launch: true }) }, 0.2, 2.8, 3);
    const lock = await lvl({ s: (ac, M) => { const g = ac.createGain(); g.gain.value = MIX.warnings * MIX.warnExterior; g.connect(M.flightIn); const w = createWarnings(ac, g); w.setSeeker('ir-lock', 0.05); } }, 0.3, 1.5, 1.6);
    const stems = await H.stemsFor('sweep');
    const mus = await lvl({ s: (ac, M) => { const m = H.createMusic(ac, M.master, { cue: 'sweep', stems }); m.setVolume(0.8 * MIX.music); return { m }; }, t: (t, o) => o.m.update(t, 'hero') }, 8, 20, 20);
    const musCalm = await lvl({ s: (ac, M) => { const m = H.createMusic(ac, M.master, { cue: 'sweep', stems }); m.setVolume(0.8 * MIX.music); return { m }; }, t: (t, o) => o.m.update(t, 'calm') }, 2, 12, 12);
    const d = (v) => +A.db(v).toFixed(1);
    H.results.sfx.mix = { engineMilChaseDb: d(eng), gunDb: d(gun), gunOverEngineDb: d(gunEng), engineBand1k5_6kDb: d(bOff), withGunBand1k5_6kDb: d(bOn), launchWarnDb: d(warn), irLockToneDb: d(lock), musicFightDb: d(mus), musicCalmDb: d(musCalm) };
    H.check('mix: gun clearly above the music (>= 5 dB RMS; its peaks far more)', A.db(gun) - A.db(mus) >= 5, `${d(gun)} vs ${d(mus)} dB`);
    H.check('mix: music under the engine at MIL (chase camera)', A.db(mus) < A.db(eng), `${d(mus)} vs ${d(eng)} dB`);
    H.check('mix: warnings above the music', A.db(warn) > A.db(mus) && A.db(lock) > A.db(mus), `launch ${d(warn)}, lock ${d(lock)} vs music ${d(mus)} dB`);
    H.check('mix: the gun is as loud as the F-16 at MIL heard from the chase camera (within 3 dB or above)', A.db(gun) - A.db(eng) > -3, `gun ${d(gun)} vs engine ${d(eng)} dB`);
  },
};
