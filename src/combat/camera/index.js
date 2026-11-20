// COMBAT CAMERAS — padlock (outside and cockpit), missile cam, kill cam, victory framing, and camera feel
// (gun shake, hit kicks, launch punch, buffet, near-miss jolts). See README.md.
// API (COMBAT.md §13): createCombatCamera(combat) -> { update(realDt), mode, setMode(m) }
//   + (additive) setKillCam(on), killCam, setFeel(on), feel, reducedMotion, toggle(m), modes.
// update(realDt) runs right after ctx.cameraRig.update and before the frame uniforms: it may override ctx.camera's pose.
// Outside a mission, and in a mission with mode === null and no feel impulse running, ctx.camera is not touched.
// All persistent pose state is world space (doubles) or relative to the player, so floating-origin shifts need no handler.
import * as THREE from 'three';
import { sizeFor, trackFov, damp } from '../../camera/cammath.js';
import {
  DEG, clamp, saturate, smoothstep, dampK, easeInOut,
  newLos, stepLos, dirFromAzEl, padlockUp, padlockFrame, angleFromAxis, fovToContain,
  newNeck, neckTarget, stepNeck, blendOffset, shouldCut, gunThreat, safeToCutAway, victoryAzimuth,
  springStep, band, lookAtQuat, finitePose,
} from './math.js';
import { createModeState, currentMode, setBase, pushOverlay, endOverlay, clearOverlays, clearAll } from './modes.js';

export const COMBAT_CAMERA_MODES = ['padlock', 'missile', 'kill', 'victory'];

// tuning (seconds / metres / degrees)
const T = {
  blendIn: 0.75, blendOut: 0.65, victorySwoop: 1.4,
  padDist: 1.75, padFrac: 0.42, padFov: 60, padFovWide: 11,
  killDur: 3.2, killCooldown: 7, killRide: 0.6,
  missileBack: 9, missileUp: 1.6, missileHold: 1.4, missileFov: 55,
  victoryDist: 2.6, victoryEl: 6, victoryRate: 7, victoryFov: 40,
};
const FEEL = { gunCockpit: 0.0021, gunChase: 0.0013, buffet: 0.0011, hitKick: 1.1, launchKick: 0.32, nearKick: 0.5, fovPunch: 22 };

const V3 = () => new THREE.Vector3();
const pose = () => ({ pos: V3(), quat: new THREE.Quaternion(), fov: 60, near: 1, interior: false });
const Y = new THREE.Vector3(0, 1, 0);

export async function createCombatCamera(combat) {
  const ctx = combat.ctx, ev = combat.events, cam = ctx.camera;
  const world = combat.world;
  const S = createModeState();

  // ---------- settings ----------
  let reduced = false;
  try {
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    if (mq) { reduced = !!mq.matches; mq.addEventListener?.('change', (e) => { reduced = !!e.matches; }); }
  } catch { reduced = false; }
  const store = combat.ui?.progress;
  let killCamOn = true, feelOn = true;
  try { killCamOn = store?.getSetting?.('camKillCam', true) !== false; feelOn = store?.getSetting?.('camFeel', true) !== false; } catch {}
  const raw = ctx.params?.raw || {};
  if (raw.killcam === '0') killCamOn = false;
  if (raw.camfeel === '0') feelOn = false;

  // ---------- scratch ----------
  const t1 = V3(), t2 = V3(), t3 = V3(), t4 = V3(), t5 = V3();
  const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
  const eul = new THREE.Euler(0, 0, 0, 'YXZ');
  const threats = [], enemies = [];

  const P = V3();                         // player position (world) this frame
  const rigPose = pose();                 // what the simulator rig posed this frame (world)
  const tgt = pose();                     // the active view's pose this frame
  const outP = pose();                    // what we show
  const shown = pose(); let shownValid = false;
  const fromOff = V3(), fromQ = new THREE.Quaternion(); let fromFov = 60, fromNear = 1, fromInterior = false;
  const tr = { view: null, t: 1, dur: 0, cut: false, pendingCut: false };
  let lastView = null;                   // view key shown last frame ('padlock-chase' | 'padlock-cockpit' | 'missile' | 'kill' | 'victory' | null)
  let overriding = false, interiorTouched = false;
  const velPrev = V3(); let velValid = false; const camVel = V3();
  let clk = 0, sinceHit = 99, lastMode = null;

  // ---------- padlock state ----------
  const los = newLos(), neck = newNeck(), nt = { yaw: 0, pitch: 0 };
  const pad = { w: 0, fov: T.padFov, up: V3(0, 1, 0), F: V3(0, 0, -1), target: null, pose: pose() };
  // ---------- missile cam ----------
  const mc = { m: null, hold: -1, pos: V3(), last: V3(), Fs: V3(0, 0, -1), q: new THREE.Quaternion(), fresh: true, newest: null };
  // ---------- kill cam ----------
  const kc = { victim: null, t: 0, pos0: V3(), vel: V3(), last: V3(), q: new THREE.Quaternion(), fov: 30, size: 15, cooldown: 0, lastKillAt: -99, lastKillPos: V3(), lastKillValid: false };
  // ---------- victory ----------
  const vc = { az: 0, side: 1, t: 0 };
  // ---------- feel ----------
  const F = { yaw: { x: 0, v: 0 }, pitch: { x: 0, v: 0 }, roll: { x: 0, v: 0 }, fov: { x: 0, v: 0 }, gun: 0, buffet: 0, nearObj: null, nearD: 1e9, jolted: null, seed: 1, fovOut: 0 };

  const api = {
    mode: null,
    modes: COMBAT_CAMERA_MODES.slice(),
    get killCam() { return killCamOn; },
    get feel() { return feelOn; },
    get reducedMotion() { return reduced; },
    setKillCam(on) { killCamOn = !!on; try { store?.setSetting?.('camKillCam', killCamOn); } catch {} if (!killCamOn && S.overlay === 'kill') { tr.pendingCut = true; endOverlay(S, 'kill'); syncMode(); } return killCamOn; },
    setFeel(on) { feelOn = !!on; try { store?.setSetting?.('camFeel', feelOn); } catch {} return feelOn; },
    /** m: 'padlock' | 'missile' | 'kill' | 'victory' | null. Returns true when the mode is now m. */
    setMode(m) {
      if (m == null) { clearAll(S); syncMode(); return true; }
      if (!combat.active || !world.player?.alive) return false;
      if (m === 'padlock') { clearOverlays(S); enterPadlock(); syncMode(); return S.base === 'padlock'; }
      if (m === 'missile') { const ok = startMissileCam(); syncMode(); return ok; }
      if (m === 'kill') { const v = kc.victim && kc.victim !== world.player ? kc.victim : world.player.target; const ok = !!v && startKillCam(v, true); syncMode(); return ok; }
      if (m === 'victory') { const ok = startVictory(true); syncMode(); return ok; }
      return false;
    },
    toggle(m) {
      if (m === 'padlock') { if (S.base === 'padlock' && !S.overlay) { setBase(S, null); syncMode(); return false; } return api.setMode('padlock'); }
      if (m === 'missile') { if (S.overlay === 'missile') { tr.pendingCut = true; endOverlay(S, 'missile'); syncMode(); return false; } return api.setMode('missile'); }
      return api.setMode(m);
    },
    update,
  };

  function syncMode() {
    const m = currentMode(S);
    api.mode = m;
    if (m !== lastMode) { lastMode = m; ev.emit('camera:combat', { mode: m }); }
  }
  const rigInteriorFor = (m) => m === 'cockpit' || (m === 'wing' && world.player?.def?.category === 'airliner');

  function enterPadlock() {
    const rig = ctx.cameraRig;
    if (rig && rig.mode !== 'chase' && rig.mode !== 'cockpit') rig.setMode?.('chase');
    setBase(S, 'padlock');
    los.valid = false; pad.w = 0; neck.fwd = true; pad.target = null;
  }

  // ---------- missile cam ----------
  function newestPlayerMissile() {
    const p = world.player, ms = combat.weapons?.missiles; if (!p || !ms) return null;
    let best = null;
    for (let i = 0; i < ms.length; i++) { const m = ms[i]; if (m.owner === p && m.alive !== false && (!best || (m.age ?? 0) < (best.age ?? 0))) best = m; }
    return best;
  }
  function startMissileCam() {
    const m = newestPlayerMissile(); if (!m) return false;
    if (!pushOverlay(S, 'missile')) return false;
    mc.m = m; mc.hold = -1; mc.fresh = true;
    return true;
  }
  function missileLive(m) { return !!m && m.alive !== false && !!combat.weapons?.missiles?.includes(m); }

  // ---------- kill cam ----------
  function startKillCam(victim, force) {
    if (!victim?.state?.position) return false;
    if (!force && (!killCamOn || kc.cooldown > 0 || !safe())) return false;
    if (!pushOverlay(S, 'kill')) return false;
    const p = world.player;
    kc.victim = victim; kc.t = 0; kc.cooldown = T.killCooldown;
    kc.size = sizeFor(victim.def?.geometry).big;
    const V = victim.state.position;
    kc.last.copy(V);
    t1.copy(victim.state.velocity || t1.set(0, 0, 0));
    let sp = t1.length();
    if (sp < 20) { t1.copy(victim.forward || t2.set(0, 0, -1)).multiplyScalar(60); sp = 60; }
    t2.copy(t1).multiplyScalar(1 / sp);                                   // victim's direction of travel
    t3.crossVectors(t2, Y); if (t3.lengthSq() < 1e-4) t3.set(1, 0, 0); t3.normalize();   // lateral
    t4.copy(p.state.position).sub(V);
    if (t3.dot(t4) > 0) t3.negate();                                       // stand on the far side from the player
    const lat = 40 + 2.2 * kc.size;
    kc.pos0.copy(V).addScaledVector(t2, sp * 0.6).addScaledVector(t3, lat).addScaledVector(Y, 10 + 0.5 * kc.size);
    kc.vel.copy(t1).multiplyScalar(T.killRide);                            // the camera rides along at 60 % of its speed
    const g = groundY(kc.pos0) + 8; if (kc.pos0.y < g) kc.pos0.y = g;
    lookAtQuat(kc.q, kc.pos0, V, Y);
    kc.fov = trackFov(kc.size, kc.pos0.distanceTo(V), 0.32, 14, 50);
    tr.pendingCut = true;
    return true;
  }

  // ---------- victory ----------
  function startVictory(force) {
    const p = world.player; if (!p?.alive) return false;
    const st = p.state;
    if (!force && ((st.agl ?? 9999) < 250 || st.onGround)) return false;
    const recent = kc.lastKillValid && clk - kc.lastKillAt < 8 && kc.lastKillPos.distanceTo(st.position) < 4000;
    vc.side = (st.roll || 0) > 0 ? -1 : 1;
    vc.az = victoryAzimuth(p.forward, st.position, recent ? kc.lastKillPos : null, vc.side);
    vc.t = 0;
    if (S.overlay === 'kill' && kc.t > 1.0) return pushOverlay(S, 'victory', { queue: true });
    if (S.overlay === 'kill') tr.pendingCut = true;
    return pushOverlay(S, 'victory');
  }

  // ---------- safety ----------
  function safe() {
    const p = world.player; if (!p?.alive) return false;
    const st = p.state;
    let missiles = 0;
    try { combat.weapons?.threatsTo?.(p, threats); for (let i = 0; i < threats.length; i++) if (threats[i].type === 'missile') missiles++; } catch { missiles = 0; }
    world.enemiesOf(p, enemies, 'aircraft');
    return safeToCutAway({
      alive: true, onGround: !!st.onGround, agl: st.agl, vs: st.verticalSpeed, missileThreats: missiles,
      gunThreat: gunThreat(p, enemies), hpFrac: p.maxHp ? p.hp / p.maxHp : 1, recentHit: sinceHit,
    });
  }

  function groundY(pos) { try { return ctx.world.groundHeightAt(pos.x, pos.z) || 0; } catch { return 0; } }

  // ---------- events ----------
  ev.on('cmd', (c) => {
    const n = c?.name;
    if (n === 'padlock') api.toggle('padlock');
    else if (n === 'missileCam') api.toggle('missile');
  });
  ev.on('kill', (e) => {
    const p = world.player;
    if (!p || e?.killer !== p || !e.victim || e.victim === p) return;
    if (e.victim.kind !== 'aircraft' && e.victim.kind !== 'ground') return;
    kc.lastKillAt = clk; kc.lastKillPos.copy(e.victim.state.position); kc.lastKillValid = true;
    if (S.overlay === 'victory') return;
    if (startKillCam(e.victim, false)) syncMode();
  });
  ev.on('mission:end', (r) => {
    if (r?.outcome !== 'success') return;
    if (startVictory(false)) syncMode();
  });
  const dropAll = () => { clearAll(S); mc.m = null; kc.victim = null; syncMode(); };
  ev.on('mission:start', () => { dropAll(); kc.cooldown = 0; kc.lastKillValid = false; sinceHit = 99; resetFeel(); });
  ev.on('mission:abort', dropAll);
  ev.on('player:down', dropAll);
  ev.on('damage', (e) => {
    const p = world.player; if (!p || e?.target !== p) return;
    sinceHit = 0;
    // a hit always hands the view back to the pilot
    if (S.overlay === 'kill' || S.overlay === 'missile') { tr.pendingCut = true; endOverlay(S, S.overlay); syncMode(); }
    if (!feelOn || reduced) return;
    const amt = clamp((e.amount || 0) / (p.maxHp || 100) * 3, 0.15, 1);
    let sx = 0, sy = 0;
    if (e.position) { t5.copy(e.position).sub(P).applyQuaternion(q2.copy(cam.quaternion).invert()); const l = t5.length() || 1; sx = t5.x / l; sy = t5.y / l; }
    else { sx = rnd() * 2 - 1; sy = 0.3; }
    const k = FEEL.hitKick * amt;
    F.yaw.v += (sx >= 0 ? 1 : -1) * k * (0.5 + 0.5 * Math.abs(sx));     // pushed away from the hit (+yaw = turn left)
    F.pitch.v += -sy * k * 0.6 + k * 0.25;
    F.roll.v += (sx >= 0 ? -1 : 1) * k * 0.7;
  });
  ev.on('rwr:launch', (e) => {
    if (e?.target === world.player && (S.overlay === 'kill' || S.overlay === 'missile')) { tr.pendingCut = true; endOverlay(S, S.overlay); syncMode(); }
  });
  ev.on('missile:launch', (e) => {
    if (e?.shooter !== world.player) return;
    mc.newest = e.missile || null;
    if (!feelOn || reduced) return;
    F.pitch.v += FEEL.launchKick; F.roll.v += (rnd() - 0.5) * 0.2; F.fov.v -= FEEL.fovPunch;
  });
  ev.on('bullet:near', (e) => {
    if (e?.target !== world.player || !feelOn || reduced) return;
    const k = FEEL.nearKick * 0.5 * clamp(1 - (e.distance || 10) / 16, 0.3, 1);
    F.yaw.v += (rnd() - 0.5) * 2 * k; F.pitch.v += (rnd() - 0.5) * k;
  });
  function rnd() { F.seed = (F.seed * 16807) % 2147483647; return F.seed / 2147483647; }    // own stream: never combat.rng
  function resetFeel() { F.yaw.x = F.yaw.v = F.pitch.x = F.pitch.v = F.roll.x = F.roll.v = F.fov.x = F.fov.v = 0; F.gun = F.buffet = 0; F.nearObj = F.jolted = null; F.nearD = 1e9; }

  // ================================================================== per frame
  function update(realDt) {
    const dt = Number.isFinite(realDt) ? clamp(realDt, 0, 0.1) : 0;
    const rig = ctx.cameraRig;
    if (!combat.active || !rig || !cam) { if (api.mode) dropAll(); finishNoOverride(); return; }
    const p = world.player;
    if (!p || !p.alive || !p.state) { if (api.mode) dropAll(); finishNoOverride(); return; }   // the simulator's crash camera owns it
    const paused = !!ctx.time?.paused;
    const sdt = paused ? 0 : dt;
    clk += sdt; sinceHit += sdt; kc.cooldown = Math.max(0, kc.cooldown - sdt);
    P.copy(p.state.position);

    // screens / hangar framing: no combat view at all (victory ends here when the debrief opens)
    const rm = rig.mode;
    if (rm === 'showcase' || combat.ui?.isOpen) {
      if (S.overlay || S.queued) { clearOverlays(S); syncMode(); }
      finishNoOverride(); return;
    }
    if (S.base === 'padlock' && rm !== 'chase' && rm !== 'cockpit' && !S.overlay) { setBase(S, null); syncMode(); }

    // overlays that end by themselves or for safety
    if (S.overlay === 'kill') {
      kc.t += sdt;
      if (kc.t >= T.killDur || (!paused && kc.t > 0.25 && !safe())) { tr.pendingCut = true; endOverlay(S, 'kill'); kc.victim = null; syncMode(); }
    }
    if (S.overlay === 'missile') {
      if (!missileLive(mc.m)) {
        const next = newestPlayerMissile();
        if (mc.hold < 0 && next && next !== mc.m) { mc.m = next; mc.fresh = true; }
        else { if (mc.hold < 0) mc.hold = 0; mc.hold += sdt; if (mc.hold > T.missileHold) { tr.pendingCut = true; endOverlay(S, 'missile'); mc.m = null; syncMode(); } }
      }
      if (S.overlay === 'missile' && !paused && !safe()) { tr.pendingCut = true; endOverlay(S, 'missile'); mc.m = null; syncMode(); }
    }
    if (S.overlay === 'victory') vc.t += sdt;

    // rig pose this frame (world)
    ctx.world.toWorld(cam.position, rigPose.pos); rigPose.quat.copy(cam.quaternion); rigPose.fov = cam.fov; rigPose.near = cam.near;
    rigPose.interior = rigInteriorFor(rm);

    const mode = currentMode(S);
    const view = mode === 'padlock' ? (rm === 'cockpit' ? 'padlock-cockpit' : 'padlock-chase') : mode;
    const size = sizeFor(p.def?.geometry);

    // the view's own pose
    let have = false;
    if (view === 'padlock-chase') have = computePadChase(p, size, dt);
    else if (view === 'padlock-cockpit') have = computePadCockpit(p, dt);
    else if (view === 'missile') have = computeMissile(dt);
    else if (view === 'kill') have = computeKill(dt, size);
    else if (view === 'victory') have = computeVictory(p, size, dt, sdt);
    if (view && (!have || !finitePose(tgt.pos, tgt.quat, tgt.fov))) { have = false; }
    const target = have ? tgt : rigPose;
    const tView = have ? view : null;

    // transitions
    if (tView !== lastView) {
      startTransition(tView);
      lastView = tView;
    }
    if (tr.t < tr.dur) {
      tr.t += dt;
      if (tr.cut || reduced) tr.t = tr.dur;
      else {
        const dist = t1.copy(P).add(fromOff).distanceTo(target.pos);
        if (shouldCut(fromInterior, target.interior, dist)) tr.t = tr.dur;
      }
    }
    const blending = tr.t < tr.dur;
    if (!have && !blending) {
      // mode null and nothing left to ease out of: the rig's pose stands, plus combat feel if any
      applyFeelOnly(p, rm, dt, sdt);
      return;
    }
    if (blending) blendInto(outP, target, easeInOut(tr.t / tr.dur), size);
    else copyPose(outP, target);

    // final guards: out of the terrain, out of the player's airframe, finite
    if (!outP.interior) {
      const g = groundY(outP.pos) + 2.5; if (outP.pos.y < g) outP.pos.y = g;
      t1.copy(outP.pos).sub(P); const d = t1.length(), minR = 0.75 * size.big;
      if (d < minR && view !== 'kill') { if (d > 1e-3) outP.pos.copy(P).addScaledVector(t1, minR / d); else outP.pos.copy(rigPose.pos); }
    }
    if (!finitePose(outP.pos, outP.quat, outP.fov)) { resetViews(); finishNoOverride(); return; }

    stepFeel(p, rm, dt, sdt, view);
    applyPose(outP, rig, dt, have && !blending ? view : view || 'blend');
  }

  function copyPose(o, s) { o.pos.copy(s.pos); o.quat.copy(s.quat); o.fov = s.fov; o.near = s.near; o.interior = s.interior; return o; }

  function startTransition(toView) {
    const src = shownValid && overriding ? shown : rigPose;
    fromOff.copy(src.pos).sub(P); fromQ.copy(src.quat); fromFov = src.fov; fromNear = src.near; fromInterior = src.interior;
    tr.view = toView; tr.t = 0;
    tr.dur = toView === 'victory' ? T.victorySwoop : toView ? T.blendIn : T.blendOut;
    tr.cut = tr.pendingCut; tr.pendingCut = false;
    if (reduced || (!toView && !overriding)) tr.t = tr.dur;
  }

  // pose interpolation: on a sphere around the player for outside views (never through the jet), quaternion slerp inside
  function blendInto(o, b, e, size) {
    o.interior = e < 0.5 ? fromInterior : b.interior;
    o.fov = fromFov + (b.fov - fromFov) * e; o.near = Math.min(fromNear, b.near);
    if (!fromInterior && !b.interior) {
      t2.copy(b.pos).sub(P);
      t3.set(1, 0, 0).applyQuaternion(world.player.state.quaternion);
      blendOffset(t1, fromOff, t2, e, 0.9 * size.big, t3);
      o.pos.copy(P).add(t1);
      // aim: each end looks at a point about as far ahead as it is from the player; blend the aim, look at it
      t4.set(0, 0, -1).applyQuaternion(fromQ).multiplyScalar(fromOff.length()).add(fromOff).add(P);
      t5.set(0, 0, -1).applyQuaternion(b.quat).multiplyScalar(t2.length()).add(b.pos);
      t4.lerp(t5, e);
      q1.copy(fromQ).slerp(b.quat, e); t5.set(0, 1, 0).applyQuaternion(q1);
      if (t4.distanceToSquared(o.pos) > 1e-4) lookAtQuat(o.quat, o.pos, t4, t5); else o.quat.copy(q1);
    } else {
      o.pos.copy(P).add(fromOff).lerp(b.pos, e);
      o.quat.copy(fromQ).slerp(b.quat, e);
    }
  }

  // ------------------------------------------------------------------ views
  function liveTarget(p) { const t = p.target; return t && t.alive !== false && t.state?.position ? t : null; }

  function computePadChase(p, size, dt) {
    const T0 = liveTarget(p);
    if (T0 !== pad.target) { pad.target = T0; }                    // a new target: the LOS tracker eases over to it
    pad.w = damp(pad.w, T0 ? 1 : 0, T0 ? 3 : 2, dt);
    if (T0) {
      t1.copy(T0.state.position).sub(P); const R = t1.length();
      if (R > 1) { t1.multiplyScalar(1 / R); stepLos(los, t1, dt); }
    }
    if (!los.valid) {
      // no target yet: hold the LOS on the flight direction so blending in later starts from behind the jet
      stepLos(los, p.forward, dt);
    }
    dirFromAzEl(los.az, los.el, pad.F);
    padlockUp(t2, p.up, p.state.roll || 0);
    pad.up.lerp(t2, dampK(4, dt)).normalize();
    const dist = T.padDist * size.big;
    // FOV: a little wider when the bandit is far off the nose, and always wide enough to hold it
    let fovT = T.padFov;
    if (T0) {
      const off = Math.acos(clamp(p.forward.dot(t1.copy(T0.state.position).sub(P).normalize()), -1, 1));
      fovT += T.padFovWide * smoothstep(35 * DEG, 140 * DEG, off);
    }
    if (reduced) fovT = 66;
    padlockFrame(pad.pose, P, pad.F, pad.up, dist, pad.fov, T.padFrac);
    if (T0) {
      const need = fovToContain(angleFromAxis(pad.pose.quat, pad.pose.pos, T0.state.position), cam.aspect || 16 / 9);
      fovT = Math.max(fovT, Math.min(need, 88));
    }
    pad.fov = reduced ? fovT : damp(pad.fov, fovT, 2.2, dt);
    pad.fov = clamp(pad.fov, 35, 90);
    padlockFrame(pad.pose, P, pad.F, pad.up, dist, pad.fov, T.padFrac);
    pad.pose.fov = pad.fov; pad.pose.near = clamp(size.L * 0.05, 0.8, 2); pad.pose.interior = false;
    const g = groundY(pad.pose.pos) + 3; if (pad.pose.pos.y < g) pad.pose.pos.y = g;
    // without a target the view rests on the rig's own chase camera
    if (pad.w > 0.999) copyPose(tgt, pad.pose);
    else {
      t2.copy(rigPose.pos).sub(P); t3.copy(pad.pose.pos).sub(P); t4.set(1, 0, 0).applyQuaternion(p.state.quaternion);
      blendOffset(t1, t2, t3, pad.w, 0.9 * size.big, t4);
      tgt.pos.copy(P).add(t1); tgt.quat.copy(rigPose.quat).slerp(pad.pose.quat, pad.w);
      tgt.fov = rigPose.fov + (pad.fov - rigPose.fov) * pad.w; tgt.near = pad.pose.near; tgt.interior = false;
    }
    return true;
  }

  function computePadCockpit(p, dt) {
    const T0 = liveTarget(p);
    if (T0) { t1.copy(T0.state.position).sub(P).applyQuaternion(q1.copy(p.state.quaternion).invert()); neckTarget(neck, t1, nt); }
    else { nt.yaw = 0; nt.pitch = 0; neck.fwd = true; }
    if (reduced) { neck.yaw = nt.yaw; neck.pitch = nt.pitch; } else stepNeck(neck, nt.yaw, nt.pitch, dt);
    eul.set(neck.pitch, -neck.yaw, 0, 'YXZ');
    q2.setFromEuler(eul);
    q1.copy(p.state.quaternion).multiply(q2);
    // looking ahead the rig's own cockpit view stands (with its look controls and shake); the head takes over as it turns
    const w = smoothstep(0.5 * DEG, 10 * DEG, Math.abs(neck.yaw) + Math.abs(neck.pitch));
    tgt.quat.copy(rigPose.quat).slerp(q1, w);
    // a little lean into the look (the head moves, the eye stays inside the canopy)
    const ay = saturate(Math.abs(neck.yaw) / (150 * DEG));
    t2.set(0.06 * Math.sin(neck.yaw), 0.025 * ay + 0.02 * saturate(neck.pitch / (60 * DEG)), 0.03 * ay).applyQuaternion(p.state.quaternion);
    tgt.pos.copy(rigPose.pos).add(t2);
    tgt.fov = rigPose.fov; tgt.near = rigPose.near; tgt.interior = true;
    return true;
  }

  function computeMissile(dt) {
    const m = mc.m;
    if (missileLive(m)) {
      const M = m.state.position;
      t1.copy(m.state.velocity || t1.set(0, 0, 0));
      if (t1.lengthSq() < 1) t1.set(0, 0, -1).applyQuaternion(m.state.quaternion);
      t1.normalize();
      if (mc.fresh) mc.Fs.copy(t1); else mc.Fs.lerp(t1, dampK(reduced ? 30 : 7, dt)).normalize();
      tgt.pos.copy(M).addScaledVector(mc.Fs, -T.missileBack).addScaledVector(Y, T.missileUp);
      // look down the missile's path, leaning toward its target when the target is ahead
      t2.copy(mc.Fs);
      const tp = m.target?.state?.position;
      if (tp) { t3.copy(tp).sub(M); const l = t3.length(); if (l > 1) { t3.multiplyScalar(1 / l); if (t3.dot(mc.Fs) > 0.2) t2.multiplyScalar(0.62).addScaledVector(t3, 0.38).normalize(); } }
      t4.copy(tgt.pos).addScaledVector(t2, 100);
      lookAtQuat(q1, tgt.pos, t4, Y);
      if (mc.fresh) mc.q.copy(q1); else mc.q.slerp(q1, dampK(reduced ? 30 : 9, dt));
      mc.pos.copy(tgt.pos); mc.last.copy(M); mc.fresh = false;
    } else {
      // it is gone: hold where we were, looking at where it ended
      tgt.pos.copy(mc.pos);
      if (mc.last.distanceToSquared(mc.pos) > 1) { lookAtQuat(q1, mc.pos, mc.last, Y); mc.q.slerp(q1, dampK(5, dt)); }
    }
    tgt.quat.copy(mc.q); tgt.fov = T.missileFov; tgt.near = 0.5; tgt.interior = false;
    const g = groundY(tgt.pos) + 2; if (tgt.pos.y < g) { tgt.pos.y = g; mc.pos.y = g; }
    return true;
  }

  function computeKill(dt, size) {
    const v = kc.victim;
    if (v?.state?.position && (v.alive !== false || world.wrecks.includes(v))) kc.last.copy(v.state.position);
    tgt.pos.copy(kc.pos0).addScaledVector(kc.vel, kc.t);
    const g = groundY(tgt.pos) + 6; if (tgt.pos.y < g) tgt.pos.y = g;
    lookAtQuat(q1, tgt.pos, kc.last, Y);
    kc.q.slerp(q1, dampK(reduced ? 30 : 7, dt));
    const fovT = trackFov(kc.size, tgt.pos.distanceTo(kc.last), 0.3, 14, 52);
    kc.fov = reduced ? fovT : damp(kc.fov, fovT, 3, dt);
    tgt.quat.copy(kc.q); tgt.fov = kc.fov; tgt.near = 1; tgt.interior = false;
    return true;
  }

  function computeVictory(p, size, dt, sdt) {
    if (!reduced) vc.az += vc.side * T.victoryRate * DEG * sdt;
    const dist = T.victoryDist * size.big;
    dirFromAzEl(vc.az, T.victoryEl * DEG, t1);
    tgt.pos.copy(P).addScaledVector(t1, dist);
    const g = groundY(tgt.pos) + 3; if (tgt.pos.y < g) tgt.pos.y = g;
    t2.copy(P).addScaledVector(Y, 0.12 * size.H);
    lookAtQuat(tgt.quat, tgt.pos, t2, Y);
    tgt.fov = T.victoryFov; tgt.near = clamp(size.L * 0.05, 0.8, 2); tgt.interior = false;
    return true;
  }

  // ------------------------------------------------------------------ feel
  function feelAllowed(rm, view) {
    if (!feelOn || reduced) return false;
    if (view === 'kill' || view === 'victory' || view === 'missile') return false;
    return rm === 'chase' || rm === 'cockpit' || rm === 'wing';
  }
  function stepFeel(p, rm, dt, sdt, view) {
    const st = p.state;
    const firing = !!p.loadout?.gun?.firing && !ctx.time?.paused;
    F.gun = damp(F.gun, firing ? 1 : 0, firing ? 22 : 10, dt);
    const aoa = Math.abs(st.aoa || 0), g = st.gLoad || 1;
    let buf = smoothstep(13 * DEG, 24 * DEG, aoa) + 0.6 * smoothstep(6.5, 9, g);
    if (st.stalled || st.stallWarning) buf *= 0.3;                        // the rig already shakes for the stall
    F.buffet = damp(F.buffet, ctx.time?.paused ? 0 : buf, 4, dt);
    nearMiss(p);
    springStep(F.yaw, dt); springStep(F.pitch, dt); springStep(F.roll, dt, 20, 0.6); springStep(F.fov, dt, 16, 0.7);
  }
  function nearMiss(p) {
    // closest missile (not just fired by us) or other aircraft; jolt once as it passes, scaled by closing speed
    let best = null, bd = 90;
    const ms = combat.weapons?.missiles;
    if (ms) for (let i = 0; i < ms.length; i++) { const m = ms[i]; if (m.owner === p && (m.age ?? 9) < 2) continue; const d = m.state.position.distanceTo(P); if (d < bd) { bd = d; best = m; } }
    const ac = world.aircraft;
    for (let i = 0; i < ac.length; i++) { const a = ac[i]; if (a === p) continue; const d = a.state.position.distanceTo(P); if (d < bd) { bd = d; best = a; } }
    if (best !== F.nearObj) { F.nearObj = best; F.nearD = bd; return; }
    if (!best) return;
    const lim = best.kind === 'missile' ? 40 : 70;
    if (bd > F.nearD + 0.01 && F.nearD < lim && F.jolted !== best) {
      F.jolted = best;
      const rel = t1.copy(best.state.velocity || t1.set(0, 0, 0)).sub(p.state.velocity).length();
      const k = FEEL.nearKick * clamp(rel / 250, 0.3, 1.4) * (1 - F.nearD / (lim * 1.2));
      if (feelOn && !reduced) { F.yaw.v += (rnd() - 0.5) * 2 * k; F.pitch.v += (rnd() - 0.3) * k; F.roll.v += (rnd() - 0.5) * k; }
    }
    F.nearD = bd;
  }
  /** Writes the feel rotation into q2 and returns its size (rad) and the FOV offset via F.fovOut. */
  function feelRotation(rm, view) {
    if (!feelAllowed(rm, view)) { F.fovOut = 0; return 0; }
    const inside = rm === 'cockpit' || view === 'padlock-cockpit';
    const ga = F.gun * (inside ? FEEL.gunCockpit : FEEL.gunChase);
    const ba = F.buffet * FEEL.buffet;
    let yaw = F.yaw.x + ga * band(clk, 16, 1) + ba * band(clk, 7.5, 4);
    let pitch = F.pitch.x + ga * band(clk, 19, 2) + ga * 0.4 + ba * band(clk, 8.7, 5);
    let roll = F.roll.x + ga * 0.5 * band(clk, 13, 3) + ba * 0.6 * band(clk, 6.1, 6);
    yaw = clamp(yaw, -0.05, 0.05); pitch = clamp(pitch, -0.05, 0.05); roll = clamp(roll, -0.06, 0.06);
    eul.set(pitch, yaw, roll, 'YXZ'); q2.setFromEuler(eul);
    F.fovOut = clamp(F.fov.x, -2.5, 2.5);
    return Math.abs(yaw) + Math.abs(pitch) + Math.abs(roll) + Math.abs(F.fovOut) * 0.01;
  }
  function applyFeelOnly(p, rm, dt, sdt) {
    stepFeel(p, rm, dt, sdt, null);
    restoreInterior();
    overriding = false; shownValid = false; velValid = false;
    const amt = feelRotation(rm, null);
    if (amt < 1e-6) return;                               // nothing to add: leave the rig's camera exactly as posed
    cam.quaternion.multiply(q2);
    if (F.fovOut) { const f = clamp(cam.fov + F.fovOut, 20, 100); if (Math.abs(f - cam.fov) > 1e-3) { cam.fov = f; cam.updateProjectionMatrix(); } }
    cam.updateMatrixWorld();
  }

  // ------------------------------------------------------------------ apply
  function applyPose(o, rig, dt, view) {
    const amt = feelRotation(rig.mode, view);
    ctx.world.toRender(o.pos, cam.position);
    cam.quaternion.copy(o.quat);
    if (amt >= 1e-6) cam.quaternion.multiply(q2);
    cam.quaternion.normalize();
    const fov = clamp(o.fov + (amt >= 1e-6 ? F.fovOut : 0), 15, 100);
    let proj = false;
    if (Math.abs(cam.fov - fov) > 1e-3) { cam.fov = fov; proj = true; }
    if (Math.abs(cam.near - o.near) > 1e-4) { cam.near = o.near; proj = true; }
    if (proj) cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    // keep the listener (audio) and the simulator HUD's camera position with what is on screen
    {
      if (velValid && dt > 1e-4) { t1.copy(o.pos).sub(velPrev).multiplyScalar(1 / dt); if (t1.lengthSq() > 4e6) camVel.set(0, 0, 0); else camVel.lerp(t1, dampK(10, dt)); }
      else camVel.copy(world.player.state.velocity);
      velPrev.copy(o.pos); velValid = !(tr.cut && tr.t <= dt);
      rig.worldPosition?.copy?.(o.pos);
      rig.velocity?.copy?.(camVel);
    }
    if (o.interior !== !!rig.isInterior) { rig.isInterior = o.interior; interiorTouched = true; }
    copyPose(shown, o); shownValid = true; overriding = true;
  }
  function restoreInterior() {
    const rig = ctx.cameraRig;
    if (interiorTouched && rig) { rig.isInterior = rigInteriorFor(rig.mode); }
    interiorTouched = false;
  }
  function finishNoOverride() {
    restoreInterior();
    overriding = false; shownValid = false; velValid = false; lastView = null; tr.t = tr.dur = 0;
  }
  function resetViews() { los.valid = false; pad.w = 0; neck.yaw = neck.pitch = 0; neck.fwd = true; mc.fresh = true; }

  return api;
}
