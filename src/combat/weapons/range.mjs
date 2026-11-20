// Weapons range: measures the gun and missiles in scripted engagements on the real flight model and prints tables.
//
//   node src/combat/weapons/range.mjs [gun] [ir] [radar] [flyout] [--n 6] [--alt 5000] [--quick]
//
// gun:    hit probability and time-to-kill vs range, perfect tracking, against a straight and a 5 g turning F-16.
// ir/radar: kill probability vs launch range and aspect against defences (straight, break, flares+beam, flares only /
//         straight, break, notch, drag), plus an altitude sweep against a straight target.
// flyout: missile speed and distance vs time, and the dynamic launch zone.
import * as THREE from 'three';
import { createBench } from '../../../tools/combat-bench.mjs';
import { MISSILES, GUNS } from './specs.js';
import { flyout, buildTable, launchZone } from './missile.js';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? +args[i + 1] : d; };
const isMain = process.argv[1] && process.argv[1].endsWith('range.mjs');
const want = (n) => isMain && (!args.some((a) => ['gun', 'ir', 'radar', 'flyout', 'htk'].includes(a)) || args.includes(n));
const N = flag('n', 6), ALT = flag('alt', 5000), QUICK = args.includes('--quick');
const DT = 1 / 60, G = 9.80665;
const FWD = new THREE.Vector3(0, 0, -1), UP = new THREE.Vector3(0, 1, 0), RIGHT = new THREE.Vector3(1, 0, 0);
const v = new THREE.Vector3(), w = new THREE.Vector3();

// ---- scripted pilots -------------------------------------------------------------------------------------------------
function levelPilot(e, o = {}) {
  const h0 = e.state.position.y; let hdgHold = null;
  return { update() {
    const s = e.state, c = e.controls;
    c.throttle = o.throttle ?? 0.85; c.yaw = 0;
    c.roll = Math.max(-1, Math.min(1, -s.roll * 2 - s.bodyRates.p * 0.3));
    c.pitch = Math.max(-0.6, Math.min(0.6, (h0 - s.position.y) * 0.003 - s.verticalSpeed * 0.03));
    void hdgHold;
  } };
}
/** Turn holding `g` (level-ish), integral g control. dir: +1 right, -1 left */
function turnPilot(e, gT, dir = 1, o = {}) {
  let I = 0.3; const h0 = e.state.position.y;
  return { update(dt) {
    const s = e.state, c = e.controls;
    c.throttle = o.throttle ?? 1;
    const bank = dir * Math.acos(Math.min(0.99, 1 / gT)) + (h0 - s.position.y) * -0.0006 * dir;
    c.roll = Math.max(-1, Math.min(1, (bank - s.roll) * 2.5 - s.bodyRates.p * 0.3));
    I = Math.max(-1, Math.min(1, I + (gT - s.gLoad) * dt * 0.25));
    c.pitch = Math.max(-1, Math.min(1, I + (gT - s.gLoad) * 0.08));
  } };
}
/** Roll the lift vector toward world direction `dir` and pull to `gT` (or proportional when close). */
function steer(e, dir, gT, dt, st, full = false) {
  const s = e.state, c = e.controls;
  const b = sv.copy(dir).applyQuaternion(tmpQ.copy(s.quaternion).invert());
  const v = b;
  const off = Math.atan2(Math.hypot(v.x, v.y), -v.z);
  let rollErr = Math.atan2(v.x, v.y);
  if (off < 0.08 && !full) rollErr = -s.roll * 0.5;
  c.roll = Math.max(-1, Math.min(1, rollErr * 2.5 - s.bodyRates.p * 0.3));
  const g = off < 0.15 && !full ? 1 + (gT - 1) * off / 0.15 : gT;
  st.I = Math.max(-1, Math.min(1, (st.I ?? 0.3) + (g - s.gLoad) * dt * 0.25));
  c.pitch = Math.abs(rollErr) < 0.6 || (off < 0.08 && !full) ? Math.max(-1, Math.min(1, st.I + (g - s.gLoad) * 0.08)) : 0.1;
}
const tmpQ = new THREE.Quaternion(), sv = new THREE.Vector3();
function pursuitPilot(e, target) {
  const st = {};
  return { update(dt) { e.controls.throttle = 0.9; if (!target.alive) return; v.copy(target.state.position).sub(e.state.position).normalize(); steer(e, w.copy(v), 4, dt, st); } };
}
/**
 * Defender. mode: 'straight' | 'break' (7 g into the missile when tgo < tBreak) | 'beam' (flares + beam turn) |
 * 'flares' (straight, flares) | 'notch' (beam + descend) | 'drag' (turn cold, afterburner, slight dive)
 */
function defender(e, W, mode, o = {}) {
  const base = levelPilot(e, { throttle: o.throttle ?? 0.85 }), st = {};
  const tBreak = o.tBreak ?? 3.5, flareRange = o.flareRange ?? 2200, salvos = o.salvos ?? 4;
  let broke = false, dropped = 0, nextDrop = 0;
  return { update(dt) {
    const m = W.missiles.find((x) => x.origTarget === e);
    if (!m || mode === 'straight') return base.update(dt);
    const s = e.state, c = e.controls;
    const r = m.state.position.distanceTo(s.position);
    const tgo = r / Math.max(50, m.state.velocity.length() + s.velocity.dot(v.copy(m.state.position).sub(s.position).normalize()));
    // flare program: `salvos` pairs, 0.5 s apart, starting when the missile is inside flareRange
    if ((mode === 'flares' || mode === 'beam') && r < flareRange && dropped < salvos && W.combat.clock >= nextDrop) {
      if (W.dropFlares(e)) { dropped++; nextDrop = W.combat.clock + 0.5; }
    }
    if (mode === 'flares') return base.update(dt);
    if (mode === 'break') {
      if (tgo < tBreak || broke) {
        // break: max-g turn toward the missile's 3-9 line (the side the missile is drifting to), afterburner
        if (!broke) {
          v.copy(m.state.position).sub(s.position); v.y = 0; v.normalize();
          st.side = (e.right.dot(v) >= 0 ? 1 : -1);
        }
        broke = true;
        v.copy(m.state.position).sub(s.position); v.y = 0; v.normalize();
        w.set(-v.z, 0, v.x).multiplyScalar(st.side); if (w.dot(e.forward) < -0.2) w.negate();
        w.addScaledVector(e.right, st.side * 0.6).normalize();
        c.throttle = 1; steer(e, w, 8, dt, st, true); return;
      }
      return base.update(dt);
    }
    // beam / notch: put the missile on the 3-9 line (perpendicular to the LOS, horizontal), idle (beam) or MIL (notch)
    v.copy(m.state.position).sub(s.position); v.y = 0; v.normalize();
    w.set(-v.z, 0, v.x);                   // perpendicular
    if (w.dot(e.forward) < 0) w.negate();
    if (mode === 'drag') { w.copy(v).negate(); w.y = -0.08; c.throttle = 1; }
    else if (mode === 'notch') { w.y = s.position.y > 900 ? -0.25 : 0.02; c.throttle = 0.85; }
    else { w.y = -0.05; c.throttle = r < flareRange * 1.3 ? 0.55 : 0.85; }
    w.normalize();
    steer(e, w, 6, dt, st);
    if (mode !== 'drag' && mode !== 'notch') c.throttle = r < flareRange * 1.3 ? 0.5 : 0.85;
  } };
}

// ---- harness ---------------------------------------------------------------------------------------------------------
async function setup(seed) {
  const b = await createBench({ seed });
  const c = b.combat;
  c.active = false;
  return { b, c, W: c.weapons, world: c.world };
}
function stepWorld(H, n = 1) { for (let i = 0; i < n; i++) { H.c.clock += DT; H.world.stepAircraft(DT); H.W.update(DT); } }

/** One missile shot. Returns { outcome: 'kill'|'hit'|'miss', reason, nolock } */
async function missileShot(type, range, aspectDeg, alt, mode, seed, o = {}) {
  const H = await setup(seed);
  const { W, world, c } = H;
  const spd = o.speed ?? 250;
  const shooter = world.spawnAircraft({ aircraft: 'f16', team: 'blue', position: new THREE.Vector3(0, alt, 0), heading: 0, speed: spd });
  // target sits `range` m north; aspect 0 = flying away (tail-on), 180 = toward the shooter
  const tAlt = alt + (o.dAlt || 0);
  const target = world.spawnAircraft({ aircraft: 'f16', team: 'red', position: new THREE.Vector3(0, tAlt, -range), heading: aspectDeg, speed: spd });
  shooter.pilot = pursuitPilot(shooter, target);
  W.combat = c;
  target.pilot = defender(target, W, mode, o);
  shooter.target = target;
  const L = shooter.lock;
  shooter.loadout.selected = type; L.seeker = type; L.target = target;
  const nolock = !W.canLock(shooter, target, type);
  L.state = 'locked'; L.progress = 1;
  const m = W.launchMissile(shooter, type);
  if (!m) return { outcome: 'nolaunch', nolock };
  let res = null;
  const offs = [c.events.on('missile:miss', (p) => { if (p.missile === m) res = res || { outcome: 'miss', reason: p.reason }; }),
    c.events.on('missile:hit', (p) => { if (p.missile === m) res = { outcome: 'hit', distance: p.distance }; }),
    c.events.on('kill', (p) => { if (p.victim === target) res = { outcome: 'kill', ...(res || {}) , outcome2: 'kill' }; })];
  const trace = o.trace;
  for (let i = 0; i < 90 / DT && !(res && (res.outcome !== 'hit' || !W.missiles.includes(m))); i++) {
    stepWorld(H);
    if (trace && i % 6 === 0 && W.missiles.includes(m)) { const ts = target.state; console.log(`t ${c.clock.toFixed(2)} r ${m.state.position.distanceTo(ts.position).toFixed(0)} tgo ${m.tgo.toFixed(2)} msl v ${m.speed.toFixed(0)} g ${m.g.toFixed(1)} aMax ${(m.kin.aMax/9.8).toFixed(1)} | tgt g ${ts.gLoad.toFixed(1)} roll ${(ts.roll*57.3).toFixed(0)} ias ${ts.ias.toFixed(0)} thr ${target.controls.throttle} ab ${ts.engines[0].afterburner.toFixed(2)} n1 ${ts.engines[0].n1.toFixed(2)} tgtMode ${m.target.kind}`); }
    if (res && res.outcome === 'hit') { stepWorld(H, 2); if (!target.alive) res.outcome = 'kill'; break; }
  }
  offs.forEach((f) => f());
  if (!res) res = { outcome: 'miss', reason: 'none' };
  if (res.outcome2) res.outcome = 'kill';
  res.nolock = nolock;
  res.hp = target.hp;
  return res;
}

/** Gun: perfect tracking from `range` behind; fire up to 4 s. Returns { shots, hits, ttk } */
async function gunRun(range, turnG, seed, gun = 'm61', targetId = 'f16', hitOnly = false) {
  const H = await setup(seed);
  const { W, world, c } = H;
  const target = world.spawnAircraft({ aircraft: targetId, team: 'red', position: new THREE.Vector3(0, ALT, -range), heading: 0, speed: 230 });
  target.pilot = turnG > 1.2 ? turnPilot(target, turnG, 1) : levelPilot(target, { throttle: 0.9 });
  const shooter = world.spawnAircraft({ aircraft: gun === 'gau8' ? 'a10' : gun === 'gau22' ? 'f35' : 'f16', team: 'blue', position: new THREE.Vector3(0, ALT, 0), heading: 0, speed: 230 });
  shooter.pilot = null; shooter.ownsSim = false;
  shooter.loadout.gun.rounds = 5000;
  // let the turn establish
  for (let i = 0; i < 4 / DT; i++) { H.c.clock += DT; world.stepAircraft(DT); }
  const sol = {};
  const place = () => {
    const ts = target.state, ss = shooter.state;
    v.copy(ts.velocity).normalize();
    ss.position.copy(ts.position).addScaledVector(v, -range);
    if (turnG > 1.2) {   // in a turn the shooter sits inside the turn on the target's path (lag ≈ path behind)
      const R = ts.velocity.lengthSq() / (turnG * G);
      const ang = range / R;
      w.copy(ts.acceleration).setY(0).normalize();   // toward the turn centre
      ss.position.copy(ts.position).addScaledVector(v, -R * Math.sin(ang)).addScaledVector(w, R * (1 - Math.cos(ang)));
      ss.velocity.copy(ts.velocity).applyAxisAngle(UP, (ts.velocity.x * w.z - ts.velocity.z * w.x) > 0 ? ang : -ang);
    } else ss.velocity.copy(ts.velocity);
    W.gunSolution(shooter, target, sol);
    ss.quaternion.setFromUnitVectors(FWD, sol.dir);
    shooter.forward.copy(FWD).applyQuaternion(ss.quaternion); shooter.up.copy(UP).applyQuaternion(ss.quaternion); shooter.right.copy(RIGHT).applyQuaternion(ss.quaternion);
  };
  if (hitOnly) target.invulnerable = true;
  let hits = 0, shots0 = shooter.loadout.gun.rounds, ttk = null, t0 = c.clock, htk = null, firstSmoke = null;
  const offS = c.events.on('bullet:hit', (p) => { if (p.target === target && firstSmoke == null && (target.damage.smoke > 0.05 || target.damage.leak > 0 || target.damage.fire > 0)) firstSmoke = hits + 1; });
  const off = c.events.on('bullet:hit', (p) => { if (p.target === target) hits++; });
  shooter.trigger = true;
  for (let i = 0; i < (hitOnly ? 1.5 : 4) / DT; i++) {
    c.clock += DT; world.stepAircraft(DT); place(); W.update(DT);
    if (!target.alive) { ttk = c.clock - t0; htk = hits; break; }
  }
  shooter.trigger = false;
  // let the remaining rounds arrive for the hit count
  for (let i = 0; i < 2 / DT && target.alive; i++) { c.clock += DT; world.stepAircraft(DT); place(); W.update(DT); }
  off(); offS();
  return { shots: shots0 - shooter.loadout.gun.rounds, hits, ttk, htk, firstSmoke };
}

const pct = (x) => (x * 100).toFixed(0).padStart(4) + '%';
const pad = (s, n) => String(s).padStart(n);

if (want('flyout')) {
  console.log('\n## Missile fly-out (level, launched at 250 m/s): speed m/s / distance km');
  for (const id of ['ir', 'radar']) {
    const S = MISSILES[id];
    console.log(`\n${S.name} (${S.designation})`);
    const times = [1, 2, 3, 5, 8, 10, 15, 20, 30, 40, 60].filter((t) => t <= S.life);
    console.log('alt m   ' + times.map((t) => pad('t=' + t + 's', 11)).join(''));
    for (const h of [1000, 5000, 10000]) {
      const f = flyout(S, h, 250);
      console.log(pad(h, 6) + '  ' + times.map((t) => pad(`${f.V[Math.round(t / 0.25)].toFixed(0)}/${(f.D[Math.round(t / 0.25)] / 1000).toFixed(1)}`, 11)).join(''));
    }
    const T = buildTable(S), z = {};
    console.log('launch zone (both 250 m/s, co-altitude): rMax head-on / beam / tail-on, rNe (beam) km');
    for (const h of [1000, 5000, 10000]) {
      const r = (vAway) => (launchZone(T, { alt: h, climb: 0, vLaunch: 250, vAway, vTarget: 250, range: 5000 }, z), z.rMax / 1000).toFixed(1);
      launchZone(T, { alt: h, climb: 0, vLaunch: 250, vAway: 0, vTarget: 250, range: 5000 }, z);
      const ne = (z.rNe / 1000).toFixed(1);
      console.log(`  ${pad(h, 6)} m: ${r(-250)} / ${r(0)} / ${r(250)}   rNe ${ne}`);
    }
  }
}

if (want('gun')) {
  console.log(`\n## Gun: perfect tracking from astern, F-16 target at ${ALT} m, 230 m/s. hit% = hits/rounds over a 1.5 s burst, ttk = trigger → kill (s), n=${N}`);
  for (const gun of QUICK ? ['m61'] : ['m61', 'gau8']) {
    console.log(`\n${GUNS[gun].name} (${GUNS[gun].designation}), ${GUNS[gun].rof * 60} rpm`);
    console.log('range m   straight: hit%   ttk s (kills)     5 g turn: hit%   ttk s (kills)');
    for (const R of [150, 300, 500, 750, 1000, 1300]) {
      const row = [];
      for (const g of [1, 5]) {
        let shots = 0, hits = 0, tk = 0, kills = 0;
        for (let k = 0; k < N; k++) {
          const h = await gunRun(R, g, 100 + k, gun, 'f16', true); shots += h.shots; hits += h.hits;
          const r = await gunRun(R, g, 100 + k, gun); if (r.ttk != null) { kills++; tk += r.ttk; }
        }
        row.push(`${pct(hits / Math.max(1, shots))}   ${kills ? (tk / kills).toFixed(2) : '  - '} (${kills}/${N})`);
      }
      console.log(`${pad(R, 7)}        ${row[0]}            ${row[1]}`);
    }
  }
}

async function hitsToKill() {
  console.log(`\n## Hits to kill (perfect tracking from 300 m astern, straight target, n=${N}): mean hits at the kill (first visible damage at hit #)`);
  const tg = ['f16', 'f15', 'a10', 'c17', 'b738'];
  console.log('gun        ' + tg.map((t) => pad(t, 14)).join(''));
  for (const gun of ['m61', 'gau22', 'gau8']) {
    const cells = [];
    for (const id of tg) {
      let h = 0, k = 0, fs = 0, nf = 0;
      for (let i = 0; i < N; i++) { const r = await gunRun(300, 1, 400 + i, gun, id); if (r.htk != null) { h += r.htk; k++; } if (r.firstSmoke != null) { fs += r.firstSmoke; nf++; } }
      cells.push(`${k ? (h / k).toFixed(1) : '>' } (${nf ? (fs / nf).toFixed(1) : '-'})`);
    }
    console.log(pad(gun, 6) + '     ' + cells.map((x) => pad(x, 14)).join(''));
  }
}

async function missileTable(type, modes, ranges, aspects) {
  const S = MISSILES[type];
  console.log(`\n## ${S.name}: kill probability (hit probability), F-16 vs F-16 at ${ALT} m, 250 m/s, n=${N}. '·' = no seeker lock at launch range`);
  for (const asp of aspects) {
    console.log(`\naspect ${asp}° (${asp === 0 ? 'tail-on' : asp === 180 ? 'head-on' : 'beam'})`);
    console.log('range km ' + modes.map((m) => pad(m, 15)).join(''));
    for (const R of ranges) {
      const cells = [];
      let nl = false;
      for (const mode of modes) {
        let kills = 0, hits = 0; const reasons = {};
        for (let k = 0; k < N; k++) {
          const r = await missileShot(type, R, asp, ALT, mode, 200 + k);
          if (r.nolock) nl = true;
          if (r.outcome === 'kill') kills++;
          if (r.outcome === 'kill' || r.outcome === 'hit') hits++;
          else reasons[r.reason] = (reasons[r.reason] || 0) + 1;
        }
        const top = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0];
        cells.push(`${pct(kills / N)}(${pct(hits / N).trim()})${top ? top[0][0] : ' '}`);
      }
      console.log(pad((R / 1000).toFixed(1), 7) + (nl ? '·' : ' ') + cells.map((x) => pad(x, 15)).join(''));
    }
  }
  console.log('miss letter: most common miss reason (e energy, d decoyed, l lost, t timeout, g ground)');
}

if (want('htk')) await hitsToKill();
if (want('ir')) {
  const ranges = QUICK ? [1500, 3000, 4500, 6000] : [1000, 2000, 3000, 4500, 6000, 8000, 10000];
  await missileTable('ir', ['straight', 'break', 'beam', 'flares'], ranges, QUICK ? [0] : [0, 90, 180]);
}
if (want('radar')) {
  const ranges = QUICK ? [5000, 12000, 20000] : [3000, 6000, 10000, 15000, 20000, 25000, 32000];
  await missileTable('radar', ['straight', 'break', 'notch', 'drag'], ranges, QUICK ? [180] : [0, 90, 180]);
}

export { missileShot, gunRun };
