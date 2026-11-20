// Flight-assist bench: step responses and a scripted "virtual thumb" that flies the player's aircraft (real flight
// model, headless) against the AI, through the assist or through the direct controls.
//
//   node src/combat/assist/tools/thumb.mjs steps [--types f16,f15] [--speeds 250,350,450] [--alt 3000]
//   node src/combat/assist/tools/thumb.mjs duel  [--types f16] [--ai rookie,veteran] [--modes assist,direct]
//        [--sticks analog,digital] [--runs 8] [--seconds 150] [--seed 1] [--json]
//
// The thumb only sees the screen: where the target (or, close in, the gun lead point) sits relative to the nose, in
// the frame the stick acts in (the assist's horizon frame, or the aircraft's own axes on direct controls), 150–250 ms
// late, with noise. It pushes the stick toward it (analog: proportional with saturation; digital: arrow keys through
// the real key ramp, src/input/logic.js), and holds the trigger when the pipper is on.
import * as THREE from 'three';
import { createSandbox } from '../../ai/tools/sandbox.mjs';
import { stepKeyAxis } from '../../../input/logic.js';
import { ASSIST_TUNING } from '../index.js';
import { profileOf, createFlightController } from '../../ai/fly.js';

const DEG = Math.PI / 180, KT = 0.514444;
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _d = new THREE.Vector3();

/** Spawn the player's aircraft (a human-flown entity: pilot null, the assist runs in combat.pre). */
export function spawnPlayer(b, o) {
  const e = b.combat.world.spawnAircraft({ ...o, team: 'blue', asPlayer: true, callsign: 'Player' });
  e.pilot = null;
  return e;
}

/** Nose heading (rad, unwrapped by the caller) and elevation of the aircraft's nose. */
function noseAngles(e, out) {
  _f.set(0, 0, -1).applyQuaternion(e.state.quaternion);
  out.h = Math.atan2(_f.x, -_f.z); out.el = Math.asin(Math.max(-1, Math.min(1, _f.y)));
  return out;
}
const wrap = (a) => a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI;

/**
 * Step response: level flight at `kt`, then full right stick (analog, or the right-arrow key through the key ramp)
 * held until the nose has turned `deg`, then released. Returns t90 (s), overshoot (deg), and what the released stick
 * did over the next 3–8 s (heading drift deg/s, flight-path change deg, bank at the end).
 */
export async function stepResponse({ type = 'f16', kt = 350, deg = 30, alt = 3000, stick = 'analog', seed = 1, axis = 'h', tune = null, hold = 0 }) {
  const b = await createSandbox({ seed, difficulty: 'veteran' });
  if (tune) Object.assign(ASSIST_TUNING, tune);
  const c = b.combat;
  c.assist.setMode('assist');
  if (process.env.FRAME) c.assist.frame = process.env.FRAME;
  const rho = Math.exp(-alt / 9000);
  const e = spawnPlayer(b, { aircraft: type, position: new THREE.Vector3(0, alt, 0), heading: 0, speed: kt * KT / Math.sqrt(rho) });
  const ct = e.controls;
  ct.throttle = 0.92;
  const na = { h: 0, el: 0 };
  // settle: hands off, the throttle kept near the target speed by hand (as a player would)
  const settle = (t) => { ct.pitch = 0; ct.roll = 0; ct.yaw = 0; ct.throttle = Math.max(0.3, Math.min(1, ct.throttle + (kt * KT - e.state.ias) * 0.002)); void t; };
  b.run(4, () => { settle(); }, 1 / 60);
  const ias0 = e.state.ias / KT, alt0 = e.state.position.y;
  noseAngles(e, na); const h0 = na.h, el0 = na.el;
  const ks = { v: 0, t: 0, dir: 0 };
  let hRel = 0, h4 = 0, t = 0, phase = 'hold', tRel = null, t90 = null, peak = 0, h3 = 0, g3 = 0, h8 = 0, g8 = 0, maxG = 0, bankEnd = 0;
  const target = deg * DEG;
  const dt = 1 / 60;
  const gam = () => Math.asin(Math.max(-1, Math.min(1, e.state.velocity.y / Math.max(e.state.velocity.length(), 1))));
  b.run(25, () => {
    t += dt;
    noseAngles(e, na);
    const ch = axis === 'h' ? wrap(na.h - h0) : na.el - el0;
    if (t90 === null && ch >= 0.9 * target) t90 = t;
    if (phase === 'hold' && (hold > 0 ? t >= hold : ch >= target)) { phase = 'rel'; tRel = t; hRel = ch; }
    if (phase === 'rel') peak = Math.max(peak, ch);
    const want = phase === 'hold' ? 1 : 0;
    const v = stick === 'digital' ? stepKeyAxis(ks, want, dt) : want;
    // the throttle stays where it is (the player's)
    ct.yaw = 0;
    if (axis === 'h') { ct.roll = v; ct.pitch = 0; } else { ct.pitch = v; ct.roll = 0; }
    maxG = Math.max(maxG, e.state.gLoad);
    if (globalThis.__trace && tRel !== null && (Math.round(t * 60) % (globalThis.__every || 12) === 0) && t - tRel > (globalThis.__from || 0) && t - tRel < (globalThis.__to || 99)) {
      const S = c.assist._st, st2 = e.state;
      console.log(`  +${(t - tRel).toFixed(2)} ch ${(ch / DEG).toFixed(1)} roll ${(st2.roll / DEG).toFixed(0)} g ${st2.gLoad.toFixed(1)} settle ${S.settle.toFixed(2)} N-F ${(Math.acos(Math.min(1, S.A.dot(_f))) / DEG).toFixed(1)} P-v ${(Math.acos(Math.min(1, S.P.dot(_d.copy(st2.velocity).normalize()))) / DEG).toFixed(1)} nI ${(S.nI.length() / DEG).toFixed(1)} aoa ${(st2.aoa / DEG).toFixed(1)} pitch ${ct.pitch.toFixed(2)} roll ${ct.roll.toFixed(2)} el N ${(Math.asin(S.A.y) / DEG).toFixed(1)} P ${(Math.asin(S.P.y) / DEG).toFixed(1)} F ${(Math.asin(_f.y) / DEG).toFixed(1)} v ${(Math.asin(_d.y) / DEG).toFixed(1)} nzCmd ${S.fc.nzCmd.toFixed(2)} lift ${S.fc.liftWorld.y.toFixed(1)}`);
    }
    if (tRel !== null) {
      const dtR = t - tRel;
      if (dtR <= 3 && dtR + dt > 3) { h3 = na.h; g3 = gam(); }
      if (dtR <= 4 && dtR + dt > 4) h4 = ch;
      if (dtR <= 8 && dtR + dt > 8) { h8 = na.h; g8 = gam(); bankEnd = e.state.roll; return true; }
    }
    return !e.alive;
  }, dt);
  return {
    type, kt, ias0: Math.round(ias0), deg, stick, axis, t90, tRel, overshoot: tRel !== null ? (peak - (hold > 0 ? hRel : target)) / DEG : null, maxG,
    driftDegS: tRel !== null ? wrap(h8 - h3) / DEG / 5 : null, gammaChange: tRel !== null ? (g8 - g3) / DEG : null,
    bankEnd: bankEnd / DEG, giveBack: tRel !== null ? (hRel - h4) / DEG : null, turned: hRel / DEG, settle3: tRel !== null ? (wrap(h3 - h0) - target) / DEG : null, altLoss: alt0 - e.state.position.y, alive: e.alive, limiting: c.assist.info.limiting,
  };
}

function gauss(rng) { let u = 0, v = 0; while (u === 0) u = rng(); v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

/**
 * A virtual thumb flying the player's aircraft. mode 'assist' | 'direct', stick 'analog' | 'digital'.
 * Returns { update(dt) } — call before combat.pre each frame (it writes e.controls and e.trigger).
 */
export function createThumb(c, e, { mode = 'assist', stick = 'analog', lag = null, span = null } = {}) {
  const SPAN = (span ?? +(process.env.SPAN || (mode === 'assist' ? 6 : 5))) * DEG;
  const rng = c.rng;
  const N = 32, bx = new Float32Array(N), by = new Float32Array(N), bt = new Float32Array(N);
  let head = 0, t = 0;
  const delay = lag ?? (process.env.LAG != null ? +process.env.LAG : 0.15 + rng() * 0.1);
  const NOISE = process.env.NOISE != null ? +process.env.NOISE : 1;
  const kx = { v: 0, t: 0, dir: 0 }, ky = { v: 0, t: 0, dir: 0 };
  const SOL = { point: new THREE.Vector3(), dir: new THREE.Vector3(), tof: 0, range: 0, inRange: false };
  let nx = 0, ny = 0, sample = 0, ix = 0, iy = 0, tapT = 0, tapU = 0.5, tapV = 0.5;
  const KI = +(process.env.KI ?? 1.0);
  const thumb = {
    delay, firstSolution: null, firing: 0,
    update(dt) {
      t += dt;
      const s = e.state, T = e.target;
      e.trigger = false;
      if (!T || !T.alive || !e.alive) { e.controls.pitch = e.controls.roll = e.controls.yaw = 0; return; }
      // what the screen shows: lead point close in (the HUD pipper / lead cue), the target itself far out
      const range = T.state.position.distanceTo(s.position);
      c.weapons.gunSolution(e, T, SOL);
      if (range < 1600) _d.copy(SOL.dir); else _d.copy(T.state.position).sub(s.position).normalize();
      _f.set(0, 0, -1).applyQuaternion(s.quaternion);
      // the screen point the thumb steers: on direct controls the nose (gun cross); with the assist the reticle of the
      // commanded nose (assist.command), which the HUD draws and the stick moves directly
      let cx = _f;
      if (mode === 'assist') { cx = c.assist.command; _r.copy(c.assist.frameRight); _u.copy(c.assist.frameUp); }
      else { _r.set(1, 0, 0).applyQuaternion(s.quaternion); _u.set(0, 1, 0).applyQuaternion(s.quaternion); }
      const fz = _d.dot(cx), x = Math.atan2(_d.dot(_r), fz), y = Math.atan2(_d.dot(_u), fz);
      // true pipper error (for the time-to-first-solution metric)
      const err = Math.acos(Math.max(-1, Math.min(1, _f.dot(SOL.dir))));
      const tol = 1.2 * DEG + (T.radius || 5) / Math.max(range, 50) * 0.7;
      if (thumb.firstSolution === null && err < tol && range < 1000 && SOL.inRange) thumb.firstSolution = c.clock;
      // perception: delayed and noisy (noise grows with the angle: a thumb is precise only near the centre)
      sample += dt;
      if (sample >= (delay > 0 ? 1 / 30 : 0)) {
        sample = 0;
        const a = Math.exp(-(1 / 30) / 0.3), k = Math.sqrt(1 - a * a);
        nx = nx * a + k * gauss(rng); ny = ny * a + k * gauss(rng);
        const sig = (0.004 + 0.06 * Math.min(1, Math.hypot(x, y))) * NOISE;
        head = (head + 1) % N; bx[head] = x + nx * sig; by[head] = y + ny * sig; bt[head] = t;
      }
      let px = 0, py = 0;
      for (let i = 0; i < N; i++) { const j = (head - i + N) % N; if (bt[j] <= t - delay || i === N - 1) { px = bx[j]; py = by[j]; break; } }
      // stick
      let sx, sy;
      if (mode === 'assist') {
        // push toward the target on the screen, proportional near the centre, full stick when far
        // a thumb holds the deflection a steady turn needs (integral part, leaky) plus a proportional correction
        ix = Math.max(-0.8, Math.min(0.8, ix * (1 - 0.3 * dt) + KI * (px / SPAN) * dt));
        iy = Math.max(-0.8, Math.min(0.8, iy * (1 - 0.3 * dt) + KI * (py / SPAN) * dt));
        sx = Math.max(-1, Math.min(1, px / SPAN + ix)); sy = Math.max(-1, Math.min(1, py / SPAN + iy));
        if (Math.abs(px) > Math.PI / 2 || fz < 0) { sx = Math.sign(px) || 1; sy = Math.max(-0.3, Math.min(0.5, py / SPAN)); ix = iy = 0; }
      } else {
        // direct controls (roll-rate / G stick): roll the target toward "above the canopy", pull when it is there;
        // near the centre fine corrections on both axes; the pull a steady turn needs is held (integral part)
        const off = Math.hypot(px, py), clockA = Math.atan2(px, py);
        iy = Math.max(-0.3, Math.min(0.8, iy * (1 - 0.3 * dt) + KI * 0.6 * (py / SPAN) * dt));
        if (off > 4 * DEG) {
          sx = Math.max(-1, Math.min(1, clockA * 0.7));
          sy = Math.cos(clockA) > 0.6 ? Math.min(1, off / (15 * DEG)) * Math.cos(clockA) + iy : Math.cos(clockA) < -0.5 ? 0 : 0.15 + iy * 0.5;
        } else {
          sx = Math.max(-1, Math.min(1, px / (SPAN * 1.5))); sy = Math.max(-1, Math.min(1, py / (SPAN * 0.6) + iy));
        }
      }
      // the ground: a player who sees it coming pulls out (wings level, then pull)
      const agl = s.position.y - (c.ctx.world.groundHeightAt?.(s.position.x, s.position.z) ?? 0);
      if (s.velocity.y < -15 && agl + s.velocity.y * 10 < 600) {
        if (mode === 'assist') { sx = 0; sy = 1; }
        else { sx = Math.max(-1, Math.min(1, -s.roll * 1.2)); sy = Math.abs(s.roll) < 1.0 ? 1 : 0.1; }
      }
      if (stick === 'digital') {
        // arrow keys: held while far off, tapped near the aim (tap length ~ the deflection the thumb would like)
        tapT -= dt; if (tapT <= 0) { tapT = 0.12; tapU = rng(); tapV = rng(); }
        const dx = Math.abs(sx) > Math.max(0.15, tapU) ? Math.sign(sx) : 0, dy = Math.abs(sy) > Math.max(0.15, tapV) ? Math.sign(sy) : 0;
        sx = stepKeyAxis(kx, dx, dt); sy = stepKeyAxis(ky, dy, dt);
      }
      e.controls.roll = sx; e.controls.pitch = sy; e.controls.yaw = 0;
      // throttle: a player leaves it at MIL-ish, AB when slow (rookie auto-throttle may take over)
      // trigger: the perceived pipper on the target, in range
      // trigger: the gun cross on the lead point as the thumb sees it (noisy)
      const pErr = err + Math.abs(nx) * (0.004 + 0.01) * NOISE;
      if (range < 1000 && SOL.inRange && pErr < tol * 1.3) { e.trigger = true; thumb.firing += dt; }
    },
  };
  return thumb;
}

/** One fight: the thumb in the player's aircraft vs an AI. */
export async function thumbDuel({ seed = 1, type = 'f16', aiType = null, aiSkill = 0.25, mode = 'assist', stick = 'analog', seconds = 150, range = 6000, alt = 4000, difficulty = 'veteran' }) {
  const b = await createSandbox({ seed, difficulty });
  const c = b.combat, w = c.world, rng = c.rng;
  c.difficulty = difficulty;
  c.assist.setMode(mode === 'assist' ? 'assist' : 'off');
  const ang = (rng() - 0.5) * 0.6, off = (rng() - 0.5) * 2000;
  const loadout = { ir: 0, radar: 0 };
  const P = spawnPlayer(b, { aircraft: type, position: new THREE.Vector3(off, alt + (rng() - 0.5) * 600, range / 2), heading: (ang / DEG + 360) % 360, speed: 220, loadout });
  const B = w.spawnAircraft({ aircraft: aiType || type, team: 'red', position: new THREE.Vector3(-off, alt + (rng() - 0.5) * 600, -range / 2), heading: 180 + ang / DEG, speed: 220, callsign: 'Red', skill: aiSkill, loadout });
  B.pilot = c.ai.createPilot(B, { skill: aiSkill });
  P.target = B;
  P.controls.throttle = 0.9;
  const thumb = createThumb(c, P, { mode, stick });
  const rec = { seed, type, mode, stick, aiSkill, firstSolution: null, kill: false, killT: null, died: false, deathBy: null, hits: 0, shots: 0, ground: 0, gunAssistT: 0, limiting: {} };
  c.events.on('kill', (k) => {
    if (k.victim === B && !rec.kill && !rec.died) { rec.kill = true; rec.killT = c.clock; }
    if (k.victim === P && !rec.died && !rec.kill) { rec.died = true; rec.deathBy = k.killer ? k.weapon : (P.state.crashReason || 'terrain'); }
  });
  c.events.on('damage', (d) => { if (d.target === B && d.source === P) rec.hits++; });
  const dt = 1 / 60;
  let end = null;
  b.run(seconds, () => {
    if (P.alive) {
      // the thumb acts for the NEXT frame's combat.pre (input happens before the assist)
      thumb.update(dt);
      if (c.assist.info.gunAssist) rec.gunAssistT += dt;
      if (globalThis.__duelTrace && Math.round(c.clock * 60) % Math.round(globalThis.__duelTrace * 60) === 0) {
        const s = P.state, i = c.assist.info;
        console.log(`t ${c.clock.toFixed(0)} alt ${s.position.y.toFixed(0)} ias ${(s.ias / KT).toFixed(0)} g ${s.gLoad.toFixed(1)} roll ${(s.roll / DEG).toFixed(0)} pitch ${(s.pitch / DEG).toFixed(0)} vy ${s.velocity.y.toFixed(0)} stick ${P.controls.pitch.toFixed(2)},${P.controls.roll.toFixed(2)} thr ${P.controls.throttle.toFixed(2)} lim ${i.limiting} ${i.pullUp ? 'PULLUP' : ''} r ${B.state.position.distanceTo(s.position).toFixed(0)} B ${B.pilot.mode}`);
      }
      const l = c.assist.info.limiting; if (l) rec.limiting[l] = (rec.limiting[l] || 0) + dt;
    }
    if ((!P.alive || !B.alive) && end === null) end = c.clock;
    return end !== null && c.clock > end + 0.5;
  }, dt);
  rec.firstSolution = thumb.firstSolution;
  rec.firing = thumb.firing;
  rec.shots = Math.max(0, (P.loadout?.gun?.max ?? 0) - (P.loadout?.gun?.rounds ?? 0));
  return rec;
}


/**
 * Gun-tracking test: a scripted target ('turn' = steady level turn at `g`, 'weave' = bank reversals every 4 s,
 * 'straight') starts `range` m ahead; the thumb tracks it for `seconds`. Returns the share of time the true pipper
 * error is inside the hit cone (target radius / range) and inside 2°, the RMS error, hits.
 */
export async function trackTest({ type = 'f16', pattern = 'turn', g = 4, range = 600, seconds = 30, mode = 'assist', stick = 'analog', aim = null, seed = 1, difficulty = 'veteran', kt = 380 }) {
  const b = await createSandbox({ seed, difficulty });
  if (process.env.TUNE) Object.assign(ASSIST_TUNING, JSON.parse(process.env.TUNE));
  const c = b.combat, w = c.world;
  c.difficulty = difficulty;
  c.assist.setMode(mode === 'assist' ? 'assist' : 'off');
  if (process.env.FRAME) c.assist.frame = process.env.FRAME;
  if (aim !== null) c.assist.setAimAssist(aim);
  const loadout = { ir: 0, radar: 0 };
  const V = kt * KT / Math.sqrt(Math.exp(-4000 / 9000));
  const P = spawnPlayer(b, { aircraft: type, position: new THREE.Vector3(0, 4000, 0), heading: 0, speed: V, loadout });
  const B = w.spawnAircraft({ aircraft: 'f16', team: 'red', position: new THREE.Vector3(0, 4000, -range), heading: 0, speed: V, callsign: 'Tgt', skill: 0.2, loadout });
  const fc = createFlightController(B, profileOf(B.def, B.sim));
  let tt = 0;
  B.pilot = { mode: pattern, update(dt) {
    tt += dt;
    let bank = 0, nz = 1;
    if (tt > 1 && pattern !== 'straight') {
      const side = pattern === 'weave' ? (Math.floor((tt - 1) / 4) % 2 ? -1 : 1) : 1;
      nz = g; bank = side * Math.acos(Math.min(1, 1 / g));
    }
    fc.direct(nz, bank, 9); fc.speed(V * 0.95, true, true); fc.apply(dt);
  } };
  B.invulnerable = true;
  P.target = B; P.controls.throttle = 0.9;
  const thumb = createThumb(c, P, { mode, stick });
  const SOL = { point: new THREE.Vector3(), dir: new THREE.Vector3() };
  let n = 0, inCone = 0, in2 = 0, se = 0, hits = 0;
  b.run(seconds, () => {
    if (!P.alive || !B.alive) return true;
    // the thumb holds the throttle to keep station (a player would)
    const r = B.state.position.distanceTo(P.state.position);
    P.controls.throttle = Math.max(0.3, Math.min(1, 0.85 + (r - range) * 0.002));
    if (process.env.HANDS_OFF) { P.controls.pitch = P.controls.roll = P.controls.yaw = 0; } else thumb.update(1 / 60);
    if (c.clock > 3) {
      c.weapons.gunSolution(P, B, SOL);
      _f.set(0, 0, -1).applyQuaternion(P.state.quaternion);
      const err = Math.acos(Math.max(-1, Math.min(1, _f.dot(SOL.dir))));
      n++; se += err * err;
      if (err < (B.radius || 5) / Math.max(r, 50)) { inCone++; if (P.trigger) hits++; }
      if (err < 2 * DEG) in2++;
      if (process.env.TRACE && (n % +(process.env.TRACE)) === 0) {
        _r.copy(c.assist.frameRight).addScaledVector(_f, -c.assist.frameRight.dot(_f)).normalize(); _u.crossVectors(_r, _f); const fz = SOL.dir.dot(_f);
        console.log(`t ${c.clock.toFixed(1)} r ${r.toFixed(0)} pip x ${(Math.atan2(SOL.dir.dot(_r), fz) / DEG).toFixed(1)} y ${(Math.atan2(SOL.dir.dot(_u), fz) / DEG).toFixed(1)} err ${(err / DEG).toFixed(1)} stick ${P.controls.pitch.toFixed(2)},${P.controls.roll.toFixed(2)} g ${P.state.gLoad.toFixed(1)} tg ${B.state.gLoad.toFixed(1)} roll ${(P.state.roll / DEG).toFixed(0)} troll ${(B.state.roll / DEG).toFixed(0)} ${c.assist.info.gunAssist ? 'GA' : ''} ${c.assist.info.limiting} A-v ${(Math.acos(Math.min(1, c.assist.command.dot(_d.copy(P.state.velocity).normalize()))) / DEG).toFixed(1)} aoaS ${(c.assist._st.aoaS / DEG).toFixed(1)} nAero ${c.assist._st.nAero.toFixed(1)} aoa ${(P.state.aoa / DEG).toFixed(1)}`);
      }
    }
    return false;
  });
  return { type, pattern, mode, stick, aim: c.assist.aimAssist, cone: inCone / Math.max(n, 1), in2: in2 / Math.max(n, 1), rmsDeg: Math.sqrt(se / Math.max(n, 1)) / DEG, hits: hits / 60, alive: P.alive, firing: thumb.firing };
}

// ---- CLI
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const args = process.argv.slice(2);
  const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
  const cmd = args[0] || 'steps';
  const types = flag('types', 'f16,f15,fa18,f14,a10').split(',');
  if (cmd === 'steps') {
    const speeds = flag('speeds', '250,350,450').split(',').map(Number), sticks = flag('sticks', 'analog,digital').split(',');
    const degs = flag('degs', '30,120').split(',').map(Number), axis = flag('axis', 'h');
    const hold = +flag('hold', 0);
    console.log(`type  kt(ias)  stick    ${hold ? 'hold s' : 'deg   '}t90 s  overshoot°  maxG  nose@+3s°  | released 3-8 s: drift°/s  Δγ°  bank°  | alt loss m | give-back° (+4 s)`);
    for (const type of types) for (const kt of speeds) for (const stick of sticks) for (const deg of (hold ? [hold] : degs)) {
      const r = await stepResponse({ type, kt, deg, stick, axis, hold, alt: +flag('alt', 3000), tune: process.env.TUNE ? JSON.parse(process.env.TUNE) : null });
      const f = (x, n = 1, w = 6) => (x === null || x === undefined ? '-' : x.toFixed(n)).padStart(w);
      console.log(`${type.padEnd(5)} ${String(kt).padStart(3)}(${String(r.ias0).padStart(3)}) ${stick.padEnd(8)} ${String(deg).padStart(4)} ${f(r.t90, 2, 7)} ${f(r.overshoot, 1, 10)} ${f(r.maxG, 1, 5)} ${f(r.settle3, 1, 9)}   | ${f(r.driftDegS, 2, 15)} ${f(r.gammaChange, 1, 5)} ${f(r.bankEnd, 0, 6)}  | ${f(r.altLoss, 0, 6)} | ${f(r.giveBack, 1, 6)} of ${f(r.turned, 0, 4)}${r.alive ? '' : ' DEAD'}`);
    }
  } else if (cmd === 'track') {
    const pats = flag('patterns', 'turn,weave').split(','), modes = flag('modes', 'assist,direct').split(','), sticks = flag('sticks', 'analog,digital').split(',');
    const aims = flag('aims', '').split(',').filter(Boolean).map(Number);
    console.log('type  pattern mode    stick    aim   | in hit cone  within 2°  rms°   on-target firing s  firing s');
    for (const type of types) for (const pattern of pats) for (const mode of modes) for (const stick of sticks) for (const aim of (mode === 'assist' && aims.length ? aims : [null])) {
      const r = await trackTest({ type, pattern, mode, stick, aim, g: +flag('g', 4), seconds: +flag('seconds', 30), tune: null });
      console.log(`${type.padEnd(5)} ${pattern.padEnd(7)} ${mode.padEnd(7)} ${stick.padEnd(8)} ${String(mode === 'assist' ? r.aim : '-').padEnd(5)} | ${(r.cone * 100).toFixed(0).padStart(6)} %   ${(r.in2 * 100).toFixed(0).padStart(6)} %  ${r.rmsDeg.toFixed(1).padStart(5)}  ${r.hits.toFixed(1).padStart(10)}  ${r.firing.toFixed(1).padStart(15)}${r.alive ? '' : ' DEAD'}`);
    }
  } else if (cmd === 'duel') {
    const AI = { rookie: 0.18, veteran: 0.5, ace: 0.8 };
    const ais = flag('ai', 'rookie,veteran').split(','), modes = flag('modes', 'assist,direct').split(','), sticks = flag('sticks', 'analog,digital').split(',');
    const runs = +flag('runs', 8), seconds = +flag('seconds', 150), seed0 = +flag('seed', 1);
    const all = [];
    console.log('type  ai       mode    stick    | kills  deaths  t-first-solution s (median, n)  t-kill s  hits/run  gunAssist s');
    for (const type of types) for (const ai of ais) for (const mode of modes) for (const stick of sticks) {
      const rs = [];
      for (let i = 0; i < runs; i++) rs.push(await thumbDuel({ seed: seed0 + i, type, aiSkill: AI[ai] ?? +ai, mode, stick, seconds, difficulty: ai === 'rookie' ? 'rookie' : 'veteran' }));
      all.push(...rs);
      const fs = rs.map((r) => r.firstSolution).filter((x) => x !== null).sort((a, b) => a - b);
      const ks = rs.filter((r) => r.kill).map((r) => r.killT).sort((a, b) => a - b);
      const med = (a) => (a.length ? a[a.length >> 1].toFixed(0) : '-');
      console.log(`${type.padEnd(5)} ${ai.padEnd(8)} ${mode.padEnd(7)} ${stick.padEnd(8)} | ${String(ks.length).padStart(2)}/${runs}  ${String(rs.filter((r) => r.died).length).padStart(3)}     ${med(fs).padStart(6)} (${fs.length}/${runs})                ${med(ks).padStart(6)}  ${(rs.reduce((a, r) => a + r.hits, 0) / runs).toFixed(1).padStart(6)}  ${(rs.reduce((a, r) => a + r.gunAssistT, 0) / runs).toFixed(1).padStart(8)}  ${rs.filter((r) => r.died).map((r) => r.deathBy).join(',')}`);
    }
    if (args.includes('--json')) console.log(JSON.stringify(all));
  }
}
