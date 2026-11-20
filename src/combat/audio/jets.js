// Other aircraft: a few shared engine-presence voices assigned to the nearest aircraft (Doppler, distance, directivity),
// plus fly-by whooshes when an aircraft or missile passes the camera at high relative speed. Allocation-free per frame.
import * as THREE from 'three';
import { listenerGeometry, distCutoff } from '../../audio/perspective.js';
import { G, BQ, OSC, noise } from './music/synth.js';
import { flyby } from './sfx.js';

export const JET_CFG = { voices: 3, range: 3000, flybyRange: 900, cooldown: 2.5 };
const C = 340;

export function createJets(ac, dest, pool, cfg = JET_CFG) {
  const slots = [];
  for (let i = 0; i < cfg.voices; i++) {
    const pk = noise(ac, 'pink'), bp = BQ(ac, 'bandpass', 900, 0.6), br = noise(ac, 'brown'), brF = BQ(ac, 'lowpass', 260, 0.8), brG = G(ac, 1.2);
    const wh = OSC(ac, 'sine', 2400), whG = G(ac, 0), lp = BQ(ac, 'lowpass', 8000, 0.5), g = G(ac, 0), pan = ac.createStereoPanner();
    pk.connect(bp); bp.connect(lp); br.connect(brF); brF.connect(brG); brG.connect(lp); wh.connect(whG); whG.connect(lp); lp.connect(g); g.connect(pan); pan.connect(dest);
    pk.start(0, i * 0.7); br.start(0, i * 1.1); wh.start();
    slots.push({ e: null, pk, br, bp, wh, whG, lp, g, pan, dop: 1, geo: { dist: 0, front: 0, pan: 0, dop: 1 }, seen: false });
  }
  const pick = new Array(cfg.voices).fill(null), pickD = new Array(cfg.voices).fill(Infinity);
  const last = new WeakMap();
  const r = new THREE.Vector3(), v = new THREE.Vector3();
  const tc = (p, val, now, k = 0.08) => p.setTargetAtTime(val, now, k);

  function considerFlyby(e, cam, camVel, now, missile) {
    r.copy(e.state.position).sub(cam); const d = r.length();
    if (d > (missile ? 500 : cfg.flybyRange)) return;
    v.copy(e.state.velocity).sub(camVel); const vv = v.lengthSq(), sp = Math.sqrt(vv);
    if (sp < (missile ? 150 : 90)) return;
    const tca = -r.dot(v) / vv; if (tca < 0 || tca > 0.7) return;
    const missX = r.x + v.x * tca, missY = r.y + v.y * tca, missZ = r.z + v.z * tca, miss = Math.sqrt(missX * missX + missY * missY + missZ * missZ);
    if (miss > (missile ? 70 : 170)) return;
    const lt = last.get(e); if (lt !== undefined && now - lt < cfg.cooldown) return;
    last.set(e, now);
    const k = Math.min(0.85, sp / C * 0.8);
    const lvl = Math.min(1.4, (sp / 250) * (70 / (miss + 45)));
    flyby(ac, pool, dest, now + 0.01, { tca, dopIn: 1 / (1 - k), dopOut: 1 / (1 + k), level: lvl, missile });
  }

  return {
    slots,
    /** cam/camVel/camQuat world; list = world.aircraft; missiles = weapons.missiles */
    update(now, cam, camVel, camQuat, list, missiles, active) {
      for (let i = 0; i < pick.length; i++) { pick[i] = null; pickD[i] = Infinity; }
      if (active) for (let i = 0; i < list.length; i++) {
        const e = list[i]; if (!e || e.isPlayer || !e.alive || !e.state) continue;
        const d = e.state.position.distanceTo(cam);
        considerFlyby(e, cam, camVel, now, false);
        if (d > cfg.range) continue;
        // insertion into the nearest-N list
        for (let k = 0; k < pick.length; k++) if (d < pickD[k]) { for (let j = pick.length - 1; j > k; j--) { pick[j] = pick[j - 1]; pickD[j] = pickD[j - 1]; } pick[k] = e; pickD[k] = d; break; }
      }
      if (active && missiles) for (let i = 0; i < missiles.length; i++) { const m = missiles[i]; if (m?.alive !== false && m.state) considerFlyby(m, cam, camVel, now, true); }
      // keep slots whose aircraft is still picked, free the others, then fill
      for (const s of slots) { s.seen = false; if (s.e) for (let k = 0; k < pick.length; k++) if (pick[k] === s.e) { s.seen = true; pick[k] = null; } if (!s.seen) s.e = null; }
      for (let k = 0; k < pick.length; k++) if (pick[k]) for (const s of slots) if (!s.e) { s.e = pick[k]; s.dop = 1; break; }
      for (const s of slots) {
        if (!s.e) { tc(s.g.gain, 0, now, 0.06); continue; }
        const st = s.e.state, geo = s.geo;
        listenerGeometry(st.position, st.velocity, st.quaternion, cam, camVel, camQuat, geo);
        s.dop += (geo.dop - s.dop) * 0.25;
        const eng = st.engines?.[0], thr = Math.min(1, Math.max(0.15, st.throttle ?? eng?.n1 ?? 0.7)), ab = eng?.afterburner || 0;
        const d = geo.dist, back = Math.max(0, -geo.front), fwd = Math.max(0, geo.front);
        const gl = (0.35 + 0.65 * thr + 0.5 * ab) / (1 + Math.pow(d / 110, 1.3)) * (0.7 + 1.1 * back);
        tc(s.g.gain, Math.min(1.5, gl * 1.3), now);
        tc(s.lp.frequency, distCutoff(d), now);
        tc(s.bp.frequency, 900 * s.dop * (0.8 + 0.4 * thr), now);
        tc(s.pk.playbackRate, s.dop, now, 0.05); tc(s.br.playbackRate, s.dop, now, 0.05);
        tc(s.wh.frequency, 2400 * s.dop * (0.85 + 0.2 * thr), now, 0.05); tc(s.whG.gain, 0.05 * fwd * thr, now);
        tc(s.pan.pan, geo.pan, now, 0.05);
      }
    },
    silence(now) { for (const s of slots) { s.e = null; tc(s.g.gain, 0, now, 0.05); } },
  };
}
