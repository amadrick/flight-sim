// Combat HUD — symbology drawn over the world on the overlay canvas: aircraft / missile markers, target designator,
// off-screen cues and target locator line, gun sight (bullet-stream funnel + lead pipper), missile seeker / lock /
// launch-zone scale, threat warnings, hit markers, splash stamps, damage indicators. Every world point goes through
// the real camera (createProjector in math.js), so it registers in chase, cockpit, flyby and orbit views alike.
import * as THREE from 'three';
import { F, strCache } from '../../ui/hud/common.js';
import { angleOff } from '../util.js';
import { edgeClamp, outsideEllipse, launchZone, aspectWord, timeToImpact, clamp, NM, KT, FT, RAD, DEG } from './math.js';

const TAU = Math.PI * 2;
const HALF_SPAN = 5.5;                 // m: funnel half-width (a typical fighter's half wingspan)
const STREAM_T = 1.9;                  // s of bullet flight shown in the stream
const HIT_STR = strCache((k) => 'HIT ×' + k);
const TTI_STR = strCache((k) => k + 's');
const DEG_STR = strCache((k) => k + '°');
const KFT_STR = strCache((k) => (k > 0 ? '▲' : k < 0 ? '▼' : '') + (Math.abs(k) / 10).toFixed(1));   // k = kft × 10
const _up = new Map();
const upper = (s) => { if (!s) return ''; let u = _up.get(s); if (u === undefined) { u = String(s).toUpperCase(); _up.set(s, u); } return u; };
const VC_STR = strCache((k) => (k >= 0 ? '+' : '−') + Math.abs(k));

export function createOverlay(H) {
  const { P } = H;
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), q1 = new THREE.Quaternion();
  const E = { x: 0, y: 0, a: 0 };
  const geo = { range: 0, closure: 0, ata: 0, aspect: 0 };
  const LZ = {};
  const gs = { point: new THREE.Vector3(), tof: 0, range: 0, inRange: false };
  const traj = new THREE.Vector3();
  // screen buffers for the bullet stream
  const NS = 40;
  const sx = new Float32Array(NS), sy = new Float32Array(NS), lx = new Float32Array(NS), ly = new Float32Array(NS), rx = new Float32Array(NS), ry = new Float32Array(NS);
  let g = null, o = null;

  // ---- projection helpers -----------------------------------------------------------------------------
  function proj(p) { return P.point(p.x - o.x, p.y - o.y, p.z - o.z); }
  /** project, and report whether the point should be drawn as an edge cue instead */
  function onScreen(p, m) {
    if (!proj(p)) return false;
    return !outsideEllipse(P.x, P.y, P.cx, P.cy, H.ax + m, H.ay + m) && P.x > 4 && P.y > 4 && P.x < H.W - 4 && P.y < H.H - 4;
  }

  // ---- primitives -------------------------------------------------------------------------------------
  function corners(x, y, s, k) {
    g.moveTo(x - s, y - s + k); g.lineTo(x - s, y - s); g.lineTo(x - s + k, y - s);
    g.moveTo(x + s - k, y - s); g.lineTo(x + s, y - s); g.lineTo(x + s, y - s + k);
    g.moveTo(x + s, y + s - k); g.lineTo(x + s, y + s); g.lineTo(x + s - k, y + s);
    g.moveTo(x - s + k, y + s); g.lineTo(x - s, y + s); g.lineTo(x - s, y + s - k);
  }
  function diamond(x, y, r) { g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); }
  function chevron(x, y, a, s) {
    const ca = Math.cos(a), sa = Math.sin(a);
    g.moveTo(x - ca * s - sa * s * 0.8, y - sa * s + ca * s * 0.8); g.lineTo(x, y); g.lineTo(x - ca * s + sa * s * 0.8, y - sa * s - ca * s * 0.8);
  }
  function arrowHead(x, y, a, s) {
    const ca = Math.cos(a), sa = Math.sin(a);
    g.moveTo(x, y); g.lineTo(x - ca * s - sa * s * 0.6, y - sa * s + ca * s * 0.6); g.lineTo(x - ca * s * 0.62, y - sa * s * 0.62); g.lineTo(x - ca * s + sa * s * 0.6, y - sa * s - ca * s * 0.6); g.closePath();
  }
  function text(t, x, y, col, font, align = 'left', base = 'middle') { g.font = font; g.fillStyle = col; g.textAlign = align; g.textBaseline = base; g.fillText(t, x, y); }
  function flashOn(rate) { return H.reduced || (H.t * rate) % 1 < 0.62; }

  /** Off-screen cue on the ellipse toward the last projected point; returns its position in E. */
  function edgeCue(col, size, label, labelCol) {
    edgeClamp(P.dx, P.dy, P.cx, P.cy, H.ax, H.ay, E);
    g.strokeStyle = col; g.lineWidth = 2.2; g.beginPath(); chevron(E.x, E.y, E.a, size); chevron(E.x - Math.cos(E.a) * size * 0.75, E.y - Math.sin(E.a) * size * 0.75, E.a, size); g.stroke();
    if (label) {
      const lx = E.x - Math.cos(E.a) * size * 2.6, ly = E.y - Math.sin(E.a) * size * 2.6;
      text(label, lx, ly, labelCol || col, H.fontS, 'center');
    }
    return E;
  }

  // ---- markers ----------------------------------------------------------------------------------------
  function drawAircraft(p) {
    const ps = p.state.position, tgt = p.target;
    for (const e of H.combat.world.aircraft) {
      if (e === p || e === tgt || e.hidden) continue;
      const hostile = e.team !== p.team && e.team !== 'neutral';
      const col = hostile ? H.C.red : H.C.blue;
      const r = e.state.position.distanceTo(ps);
      const threat = hostile && (H.lockers.indexOf(e) >= 0 || (H.six === e));
      if (!onScreen(e.state.position, 0)) {
        if (H.cine) continue;
        if (threat) edgeCue(H.C.red, 9, H.six === e ? 'SIX' : 'LOCK', H.C.amber);
        else if (hostile && r < 4000) { edgeClamp(P.dx, P.dy, P.cx, P.cy, H.ax, H.ay, E); g.fillStyle = col; g.beginPath(); diamond(E.x, E.y, 3.5); g.fill(); }
        continue;
      }
      const x = P.x, y = P.y;
      // angular size of the airframe, clamped to a readable box
      const s = clamp((e.radius || 6) * 1.1 * P.ppr / Math.max(1, -P.vz), 7, 26);
      g.strokeStyle = col; g.lineWidth = 1.6; g.beginPath();
      if (hostile) {
        if (r < 7000) corners(x, y, s, s * 0.55);
        else { diamond(x, y, 4); }
      } else {
        // friends: a ring (near) or a dot-ring (far)
        const rr = r < 5000 ? s * 0.8 : 3;
        g.moveTo(x + rr, y); g.arc(x, y, rr, 0, TAU);
      }
      g.stroke();
      if (threat) { g.strokeStyle = H.C.amber; g.lineWidth = 1.2; g.beginPath(); g.arc(x, y, s + 6, 0, TAU); g.stroke(); }
      if (r < (hostile ? 9000 : 12000) && e.callsign) {
        text(e.callsign, x + s + 5, y - s * 0.4, col, H.fontXS);
        text(F.tenth(Math.round(r / NM * 10)), x + s + 5, y + s * 0.4 + 4, col, H.fontXS);
      }
    }
    // missiles in flight
    for (const m of H.combat.weapons.missiles) {
      if (!m.alive) continue;
      const atMe = m.target === p, mine = m.owner === p;
      if (!onScreen(m.state.position, 0)) continue;
      const x = P.x, y = P.y;
      if (atMe) {
        g.strokeStyle = H.C.red; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 11, 0, TAU);
        g.moveTo(x - 6, y - 6); g.lineTo(x + 6, y + 6); g.moveTo(x + 6, y - 6); g.lineTo(x - 6, y + 6); g.stroke();
      } else if (mine) {
        g.strokeStyle = H.C.fg; g.lineWidth = 1.4; g.beginPath(); diamond(x, y, 5); g.stroke();
        const t = m.target;
        if (t && t.alive) {
          v1.copy(t.state.position).sub(m.state.position); const d = v1.length();
          const c = d > 1 ? -(v1.x * (t.state.velocity.x - m.state.velocity.x) + v1.y * (t.state.velocity.y - m.state.velocity.y) + v1.z * (t.state.velocity.z - m.state.velocity.z)) / d : 0;
          const tti = m.tgo > 0 ? m.tgo : timeToImpact(d, c);
          if (tti < 99) text(TTI_STR(Math.ceil(tti)), x + 8, y, H.C.fg, H.fontXS);
        }
      } else {
        g.fillStyle = m.team === p.team ? H.C.blue : H.C.red; g.fillRect(Math.round(x) - 2, Math.round(y) - 2, 4, 4);
      }
    }
  }

  function drawPoint(pos, col, label, sub, shape) {
    if (onScreen(pos, 0)) {
      g.strokeStyle = col; g.lineWidth = 1.8; g.beginPath();
      if (shape === 'ring') g.arc(P.x, P.y, 9, 0, TAU); else diamond(P.x, P.y, 8);
      g.stroke();
      g.fillStyle = col; g.fillRect(Math.round(P.x) - 1, Math.round(P.y) - 1, 2, 2);
      if (label) text(label, P.x, P.y - 14, col, H.fontXS, 'center', 'alphabetic');
      if (sub) text(sub, P.x, P.y + 22, col, H.fontXS, 'center', 'alphabetic');
    } else {
      edgeClamp(P.dx, P.dy, P.cx, P.cy, H.ax * 0.96, H.ay * 0.96, E);
      g.strokeStyle = col; g.lineWidth = 1.8; g.beginPath(); diamond(E.x, E.y, 6); g.stroke();
      if (sub) text(sub, E.x - Math.cos(E.a) * 20, E.y - Math.sin(E.a) * 20, col, H.fontXS, 'center');
    }
  }
  function drawMission(p) {
    const d = H.combat.director || {};
    const ps = p.state.position;
    const wp = d.waypoint;
    if (wp?.position) {
      const r = Math.hypot(wp.position.x - ps.x, wp.position.z - ps.z) / NM;
      drawPoint(wp.position, H.C.mag, wp.label || '', r < 100 ? F.tenth(Math.round(r * 10)) : F.int(r));
    }
    if (Array.isArray(d.markers)) {
      for (let i = 0; i < d.markers.length && i < 8; i++) {
        const mk = d.markers[i]; const pos = mk?.position || mk?.entity?.state?.position; if (!pos) continue;
        drawPoint(pos, mk.color || H.C.amber, mk.label || '', null, 'ring');
      }
    }
  }

  // ---- target designator ------------------------------------------------------------------------------
  function drawTarget(p) {
    H.tgtOn = false;
    const t = p.target; if (!t || !t.alive) return;
    const L = p.lock || {};
    const locked = L.state === 'locked' && L.target === t, acq = L.state === 'acquiring' && L.target === t;
    H.geometry(p.state, t.state, geo);
    const col = H.C.red;
    if (!onScreen(t.state.position, 0)) {
      if (H.cine) return;              // a cinematic view: "turn this way" cues would point the wrong way
      // off-screen: chevrons on the ellipse + target locator line from the centre
      const cue = edgeCue(locked ? H.C.red : H.C.redHi, 13, null);
      const ex = cue.x, ey = cue.y, a = cue.a, ca = Math.cos(a), sa = Math.sin(a);
      const r0 = Math.min(H.W, H.H) * 0.06, r1 = Math.min(H.W, H.H) * 0.2;
      g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.moveTo(P.cx + ca * r0, P.cy + sa * r0); g.lineTo(P.cx + ca * r1, P.cy + sa * r1); g.stroke();
      g.beginPath(); arrowHead(P.cx + ca * (r1 + 9), P.cy + sa * (r1 + 9), a, 10); g.fillStyle = col; g.fill();
      text(DEG_STR(Math.round(geo.ata * RAD)), P.cx + ca * (r1 + 24), P.cy + sa * (r1 + 24), H.C.fg, H.fontS, 'center');
      // range + call sign inside the edge cue
      const lx = ex - ca * 34, ly = ey - sa * 34;
      if (!H.compact) text(t.callsign || 'TGT', lx, ly - 7, H.C.fg, H.fontXS, 'center');
      text(F.tenth(Math.round(geo.range / NM * 10)), lx, H.compact ? ly : ly + 7, col, H.fontS, 'center');
      return;
    }
    const x = P.x, y = P.y, depth = -P.vz;
    let s = clamp((t.radius || 6) * 1.3 * P.ppr / Math.max(1, depth), 13, 34);
    // lock snap: the box closes in from wide when the lock comes on
    if (H.lockSnap > 0 && !H.reduced) s *= 1 + 1.6 * H.lockSnap * H.lockSnap;
    g.lineWidth = locked ? 2.4 : 1.8; g.strokeStyle = col;
    g.beginPath(); corners(x, y, s, s * (locked ? 0.7 : 0.45)); g.stroke();
    if (locked) { g.beginPath(); diamond(x, y, 5); g.fillStyle = col; g.fill(); }
    // aspect cue: where the target is heading (projected 2 s ahead), from the box centre
    v1.copy(t.state.velocity).multiplyScalar(2).add(t.state.position);
    const tx = x, ty = y;
    if (proj(v1)) {
      let dx = P.x - tx, dy = P.y - ty; const l = Math.hypot(dx, dy);
      if (l > 2) { const k = Math.min(l, s * 2.2) / l; dx *= k; dy *= k; g.strokeStyle = col; g.lineWidth = 1.6; g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx + dx, ty + dy); g.stroke(); }
    }
    // data block
    const bx = tx + s + 15, fs = H.fs;
    text(t.callsign || 'TGT', bx, ty - s + fs * 0.5, H.C.fg, H.fontB, 'left');
    text(upper(t.def?.id), bx, ty - s + fs * 1.7, H.C.dim, H.fontXS, 'left');
    const rn = geo.range / NM;
    text(rn < 10 ? F.tenth(Math.round(rn * 10)) : F.int(rn), bx, ty + fs * 0.25, col, H.fontS);
    text('NM', bx + (rn < 10 ? 3 : 2) * H.cw + 4, ty + fs * 0.25, H.C.dim, H.fontXS);
    const vc = Math.round(geo.closure / KT / 10) * 10;
    text(VC_STR(vc), bx, ty + fs * 1.4, H.C.fg, H.fontXS);
    const dAlt = Math.round((t.state.position.y - p.state.position.y) / FT / 100);
    text(KFT_STR(dAlt), bx + 5 * H.cwXS + 6, ty + fs * 1.4, H.C.fg, H.fontXS);
    text(aspectWord(geo.aspect), bx, ty + fs * 2.55, H.C.amber, H.fontXS);
    // hits on this target
    if (H.hit.count > 0 && H.hit.target === t && H.hit.tt > 0) {
      text(HIT_STR(H.hit.count), tx, ty + s + fs * 1.1, H.C.hud, H.fontB, 'center');
      if (H.hit.part) text(upper(H.hit.part), tx, ty + s + fs * 2.3, H.C.hud, H.fontXS, 'center');
    }
    // missile seeker: acquiring circle closes on the target
    if (H.cine) { /* no seeker / lock rings off the nose */ }
    else if (acq) {
      const k = clamp(L.progress || 0, 0, 1), rr = s + 8 + (1 - k) * 34;
      g.strokeStyle = H.C.amber; g.lineWidth = 1.6;
      if (flashOn(5)) { g.setLineDash([4, 5]); g.beginPath(); g.arc(tx, ty, rr, 0, TAU); g.stroke(); g.setLineDash([]); }
      g.lineWidth = 3; g.beginPath(); g.arc(tx, ty, s + 8, -Math.PI / 2, -Math.PI / 2 + TAU * k); g.stroke();
    } else if (locked) {
      g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.arc(tx, ty, s + 8, 0, TAU); g.stroke();
      text('LOCK', tx, ty - s - 13, col, H.fontB, 'center', 'alphabetic');
    }
    H.tgtX = tx; H.tgtY = ty; H.tgtS = s; H.tgtOn = true;
  }

  // ---- gun sight --------------------------------------------------------------------------------------
  /** world point of the stream sample: a round fired `age` s ago from history entry h */
  function streamPoint(h, age, out) {
    const W = H.combat.weapons, Vm = H.player.loadout?.gun?.spec?.muzzleVelocity || W.specs?.gun?.muzzleVelocity || 1030;
    if (H.trajFn) {
      H.trajFn(H.player, age, traj);
      out.copy(traj).applyQuaternion(h.q).add(h.p);
      if (!H.trajHasVel) out.addScaledVector(h.v, age);
    } else {
      out.set(0, 0, -Vm * age).applyQuaternion(h.q).add(h.p).addScaledVector(h.v, age);
      out.y -= 4.903 * age * age;
    }
    return out;
  }

  function drawGun(p) {
    const W = H.combat.weapons, t = p.target, ps = p.state.position;
    const gun = p.loadout?.gun, firing = !!(gun?.firing || p.trigger);
    const tr = t && t.alive ? t.state.position.distanceTo(ps) : Infinity;
    const gunRange = gun?.spec?.range || W.specs?.gun?.range || 1800;
    const show = firing || tr < gunRange * 1.5;
    // boresight (gun cross) at the target's range (or 1000 m), projected so it is right in every camera
    const bd = isFinite(tr) ? clamp(tr, 300, 3000) : 1000;
    v1.copy(p.forward).multiplyScalar(bd).add(ps);
    let bx = NaN, by = NaN;
    if (proj(v1)) { bx = P.x; by = P.y; }
    const col = H.C.hud;
    if (!H.interior && bx === bx && (show || H.alwaysCross)) {
      const a = 9, gp = 3;
      g.strokeStyle = col; g.lineWidth = 1.6; g.beginPath();
      g.moveTo(bx - a, by); g.lineTo(bx - gp, by); g.moveTo(bx + gp, by); g.lineTo(bx + a, by);
      g.moveTo(bx, by - a); g.lineTo(bx, by - gp); g.moveTo(bx, by + gp); g.lineTo(bx, by + a * 0.6); g.stroke();
    }
    H.boreX = bx; H.boreY = by;
    if (!show) return;
    // bullet stream: where rounds fired over the last ~2 s are now (with the aircraft's real manoeuvring history)
    const hist = H.gunHist, n = hist.n;
    let k = 0;
    // the funnel only helps with the nose near the target (or while firing); in a hard turn off-target it is clutter
    const nearNose = firing || (t && t.alive && angleOff(p.state, t.state.position) < 35 * DEG);
    if (n > 1 && nearNose) {
      const step = Math.max(1, Math.floor(n / NS));
      for (let i = 0; i < n && k < NS; i += step) {
        const h = hist.at(i);                  // i = 0 newest
        const age = H.time - h.t + 0.08;
        if (age > STREAM_T) break;
        streamPoint(h, age, v2);
        if (!proj(v2)) { if (k) break; else continue; }
        sx[k] = P.x; sy[k] = P.y;
        v3.copy(p.right).multiplyScalar(HALF_SPAN).add(v2);
        if (!proj(v3)) break;
        const hx = P.x - sx[k], hy = P.y - sy[k];
        lx[k] = sx[k] - hx; ly[k] = sy[k] - hy; rx[k] = sx[k] + hx; ry[k] = sy[k] + hy;
        k++;
      }
    }
    if (k > 2) {
      g.strokeStyle = col; g.lineWidth = 1.4; g.globalAlpha = firing ? 0.95 : 0.7;
      g.beginPath(); g.moveTo(lx[0], ly[0]); for (let i = 1; i < k; i++) g.lineTo(lx[i], ly[i]);
      g.moveTo(rx[0], ry[0]); for (let i = 1; i < k; i++) g.lineTo(rx[i], ry[i]); g.stroke();
      g.globalAlpha = 1;
    }
    // lead-computing pipper on the designated target
    if (!(t && t.alive && tr < gunRange * 1.5)) return;
    W.gunSolution(p, t, gs);
    if (!gs.point || !proj(gs.point)) return;
    const px = P.x, py = P.y;
    // aim error: angle between the gun line and the solution point
    v1.copy(gs.point).sub(ps).normalize();
    const err = Math.acos(clamp(v1.dot(p.forward), -1, 1));
    const tol = Math.atan2((t.radius || 6) * 0.8, Math.max(50, tr)) + 0.25 * DEG;
    const inRange = gs.inRange ?? tr < gunRange;
    const shoot = inRange && err < tol;
    const R = 13;
    g.strokeStyle = shoot ? H.C.fg : col; g.lineWidth = shoot ? 2.4 : 1.8;
    g.beginPath(); g.arc(px, py, R, 0, TAU); g.stroke();
    g.fillStyle = shoot ? H.C.fg : col; g.fillRect(Math.round(px) - 1.5, Math.round(py) - 1.5, 3, 3);
    // range arc: full circle = max gun range, unwinding as the target closes
    const rf = clamp(tr / gunRange, 0, 1);
    g.lineWidth = 3; g.strokeStyle = inRange ? col : H.C.amber; g.beginPath(); g.arc(px, py, R + 5, -Math.PI / 2, -Math.PI / 2 + TAU * rf); g.stroke();
    // steering line from the gun cross to the pipper
    if (bx === bx && Math.hypot(px - bx, py - by) > R + 12) {
      g.strokeStyle = col; g.lineWidth = 1; g.setLineDash([3, 5]); g.beginPath(); g.moveTo(bx, by); g.lineTo(px, py); g.stroke(); g.setLineDash([]);
    }
    if (shoot) {
      H.cue = 'SHOOT'; H.cueCol = H.C.hud; H.cueGun = true;
    }
  }

  // ---- missile employment -----------------------------------------------------------------------------
  function drawMissile(p) {
    const lo = p.loadout, L = p.lock, t = p.target; if (!lo || !L) return;
    const sel = lo.selected, n = lo.missiles?.[sel] ?? 0;
    const spec = H.combat.weapons.specs?.missiles?.[sel];
    const tAlive = t && t.alive;
    // uncaged seeker circle at the boresight while searching
    if (tAlive && L.state === 'none' && n > 0 && H.boreX === H.boreX && !H.cueGun) {
      g.strokeStyle = H.C.hud; g.globalAlpha = 0.6; g.lineWidth = 1.2; g.setLineDash([5, 6]);
      g.beginPath(); g.arc(H.boreX, H.boreY, 34, 0, TAU); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
    }
    // launch-zone scale: vertical right of centre; in the cockpit a horizontal bar under the target box (the fighter
    // HUD's altitude tape owns the right of centre there)
    if (!tAlive) return;
    launchZone(L, LZ);
    const range = L.range || t.state.position.distanceTo(p.state.position);
    if (range > LZ.top * 1.8) return;
    const st = L.target === t ? L.state : 'none', inR = LZ.inRange;
    const stTxt = st === 'locked' ? 'LOCKED' : st === 'acquiring' ? 'SEEKING' : n ? 'NO LOCK' : 'EMPTY';
    const stCol = st === 'locked' ? H.C.red : st === 'acquiring' ? H.C.amber : H.C.dim;
    const short = spec?.short || upper(sel);
    if (H.interior) {
      if (!H.tgtOn) return;
      const len = 96, x0 = Math.round(H.tgtX - len / 2) + 0.5, y = Math.round(H.tgtY + H.tgtS + H.fs * 3.6) + 0.5;
      g.strokeStyle = H.C.hud; g.lineWidth = 1.4; g.beginPath();
      g.moveTo(x0, y); g.lineTo(x0 + len, y);
      g.moveTo(x0, y - 3); g.lineTo(x0, y + 3);
      g.moveTo(x0 + LZ.min * len, y); g.lineTo(x0 + LZ.min * len, y + 7);
      g.moveTo(x0 + LZ.max * len, y); g.lineTo(x0 + LZ.max * len, y + 7);
      g.stroke();
      if (LZ.ne >= 0) { g.lineWidth = 4; g.beginPath(); g.moveTo(x0 + LZ.min * len, y + 3); g.lineTo(x0 + LZ.ne * len, y + 3); g.stroke(); }
      const cx = x0 + LZ.cur * len;
      g.fillStyle = inR ? H.C.hud : H.C.dim; g.beginPath(); g.moveTo(cx, y - 2); g.lineTo(cx - 5, y - 10); g.lineTo(cx + 5, y - 10); g.closePath(); g.fill();
      text(short, x0, y + 18, H.C.hud, H.fontXS, 'left', 'alphabetic');
      text(F.int(n), x0 + short.length * H.cwXS + 4, y + 18, n ? H.C.fg : H.C.red, H.fontXS, 'left', 'alphabetic');
      text(stTxt, x0 + len, y + 18, stCol, H.fontXS, 'right', 'alphabetic');
    } else {
      const x = Math.round(P.cx + H.lzOff) + 0.5, h = H.lzH, y0 = Math.round(P.cy + h / 2) + 0.5, y1 = y0 - h;
      const yMin = y0 - LZ.min * h, yMax = y0 - LZ.max * h;
      g.strokeStyle = H.C.hud; g.lineWidth = 1.4; g.beginPath();
      g.moveTo(x, y0); g.lineTo(x, y1);
      g.moveTo(x, yMin); g.lineTo(x + 9, yMin);
      g.moveTo(x, yMax); g.lineTo(x + 9, yMax);
      g.moveTo(x - 4, y0); g.lineTo(x + 4, y0);
      g.stroke();
      if (LZ.ne >= 0) { g.lineWidth = 4; g.beginPath(); g.moveTo(x + 4, yMin); g.lineTo(x + 4, y0 - LZ.ne * h); g.stroke(); }
      const cy = y0 - LZ.cur * h;
      g.fillStyle = inR ? H.C.hud : H.C.dim; g.beginPath(); g.moveTo(x - 2, cy); g.lineTo(x - 11, cy - 5); g.lineTo(x - 11, cy + 5); g.closePath(); g.fill();
      if (range > LZ.top) { g.beginPath(); g.moveTo(x - 6, y1 - 10); g.lineTo(x - 1, y1 - 4); g.lineTo(x - 11, y1 - 4); g.closePath(); g.fill(); }
      text(F.tenth(Math.round(range / NM * 10)), x - 14, cy, inR ? H.C.hud : H.C.fg, H.fontXS, 'right');
      text(short, x - 4, y1 - 18, H.C.hud, H.fontB, 'left', 'alphabetic');
      text(F.int(n), x + short.length * H.cwB + 2, y1 - 18, n ? H.C.fg : H.C.red, H.fontB, 'left', 'alphabetic');
      text(stTxt, x - 4, y0 + 16, stCol, H.fontXS, 'left', 'alphabetic');
      if (L.tti > 0) text(TTI_STR(Math.round(L.tti)), x - 4, y0 + 30, H.C.fg, H.fontXS, 'left', 'alphabetic');
    }
    // my missiles in flight (fly-out list, outside the cockpit)
    const x = Math.round(P.cx + H.lzOff) + 0.5, y0 = Math.round(P.cy + H.lzH / 2) + 0.5;
    let yy = y0 + (L.tti > 0 ? 46 : 32), cnt = 0;
    if (H.interior) cnt = 3;
    for (const m of H.combat.weapons.missiles) {
      if (m.owner !== p || !m.alive || cnt >= 3) continue;
      const mt = m.target;
      let tti = Infinity;
      if (mt && mt.alive) {
        v1.copy(mt.state.position).sub(m.state.position); const d = v1.length();
        const c = d > 1 ? -(v1.x * (mt.state.velocity.x - m.state.velocity.x) + v1.y * (mt.state.velocity.y - m.state.velocity.y) + v1.z * (mt.state.velocity.z - m.state.velocity.z)) / d : 0;
        tti = m.tgo > 0 ? m.tgo : timeToImpact(d, c);
      }
      g.strokeStyle = H.C.fg; g.lineWidth = 1.2; g.beginPath(); diamond(x, yy - 4, 4); g.stroke();
      text(tti < 99 ? TTI_STR(Math.ceil(tti)) : '--', x + 8, yy - 4, H.C.fg, H.fontXS);
      yy += 14; cnt++;
    }
    // a launch needs a full lock: SHOOT whenever locked — green inside the no-escape range (or in range when none is
    // known), amber when the shot is long / likely to be defeated
    if (st === 'locked' && n > 0 && !H.cue) {
      const strong = LZ.ne >= 0 ? LZ.inNe : inR;
      H.cue = 'SHOOT'; H.cueCol = strong ? H.C.hud : H.C.amber; H.cueGun = false;
    }
  }

  // ---- threats ----------------------------------------------------------------------------------------
  function drawThreats(p) {
    const ps = p.state.position;
    const big = H.fontWarn, cy = H.warnY;
    let line = 0;
    // inbound missiles: a small cue for each, the nearest gets the big edge arrow + range / time, and the warning box
    let nearest = null, nd = Infinity;
    for (const th of H.threats) {
      if (th.type !== 'missile' || !th.missile?.state) continue;
      const d = th.missile.state.position.distanceTo(ps);
      if (d < nd) { nd = d; nearest = th.missile; }
    }
    for (const th of H.threats) {
      if (th.type !== 'missile' || !th.missile?.state || th.missile === nearest || H.cine) continue;
      if (!onScreen(th.missile.state.position, 0)) edgeCue(H.C.red, 10, null);
    }
    if (nearest) {
      const on = flashOn(2);
      const vrel = v1.copy(nearest.state.velocity).sub(p.state.velocity), los = v2.copy(ps).sub(nearest.state.position);
      const c = los.dot(vrel) / Math.max(1, nd);
      const tti = nearest.tgo > 0 ? nearest.tgo : timeToImpact(nd, c);
      // steady box, flashing word
      const w = H.warnW, hh = H.fsWarn * 1.5;
      g.fillStyle = 'rgba(70,6,0,0.55)'; g.fillRect(P.cx - w / 2, cy - hh / 2, w, hh);
      g.strokeStyle = H.C.red; g.lineWidth = 2.5; g.strokeRect(Math.round(P.cx - w / 2) + 0.5, Math.round(cy - hh / 2) + 0.5, Math.round(w), Math.round(hh));
      if (on) text('MISSILE', P.cx, cy + 1, '#ffffff', big, 'center');
      else text('MISSILE', P.cx, cy + 1, H.C.red, big, 'center');
      if (tti < 60) text(TTI_STR(Math.ceil(tti)), P.cx + w / 2 + 8, cy, H.C.red, H.fontB, 'left');
      // the missile itself: on screen a ring (drawn with the markers), off screen a big arrow on the edge
      if (!H.cine && !onScreen(nearest.state.position, 0)) {
        edgeClamp(P.dx, P.dy, P.cx, P.cy, H.ax, H.ay, E);
        g.beginPath(); arrowHead(E.x, E.y, E.a, 30); g.fillStyle = H.C.red; g.fill();
        g.strokeStyle = '#ffffff'; g.lineWidth = 1.2; g.stroke();
        const lx = E.x - Math.cos(E.a) * 46, ly = E.y - Math.sin(E.a) * 46;
        text(F.tenth(Math.round(nd / NM * 10)), lx, ly - 7, H.C.red, H.fontB, 'center');
        if (tti < 60) text(TTI_STR(Math.ceil(tti)), lx, ly + 8, '#ffffff', H.fontXS, 'center');
      } else if (!H.cine && P.front) {
        text(F.tenth(Math.round(nd / NM * 10)), P.x + 16, P.y - 12, H.C.red, H.fontB, 'left');
      }
      // what to do
      const fl = p.loadout?.flares ?? 0;
      const side = H.missileSide(p, nearest.state.position);
      const radar = (nearest.seeker || nearest.spec?.seeker || nearest.type) === 'radar';
      let prompt;
      if (H.combat.difficulty === 'rookie' && fl > 0 && !radar) prompt = H.touch ? 'FLARES!  ·  TURN HARD' : 'FLARES: V  ·  TURN HARD';
      else if (radar) prompt = side > 0 ? 'BREAK RIGHT · NOTCH' : 'BREAK LEFT · NOTCH';
      else prompt = fl > 0 ? (side > 0 ? 'FLARES · BREAK RIGHT' : 'FLARES · BREAK LEFT') : (side > 0 ? 'BREAK RIGHT' : 'BREAK LEFT');
      text(prompt, P.cx, cy + hh / 2 + H.fs * 1.3, H.C.amber, H.fontB, 'center');
      line = 2;
    }
    // locked by (no missile yet)
    if (!nearest && H.lockers.length) {
      const e = H.lockers[0];
      const w = H.fsWarn * 7.5, hh = H.fsWarn * 1.15;
      g.fillStyle = 'rgba(30,18,0,0.5)'; g.fillRect(P.cx - w / 2, cy - hh / 2, w, hh);
      g.strokeStyle = H.C.amber; g.lineWidth = 2; g.strokeRect(Math.round(P.cx - w / 2) + 0.5, Math.round(cy - hh / 2) + 0.5, Math.round(w), Math.round(hh));
      text('LOCKED', P.cx, cy + 1, H.C.amber, H.fontWarnS, 'center');
      if (e.callsign) text(e.callsign, P.cx + w / 2 + 8, cy, H.C.amber, H.fontXS, 'left');
      line = 1;
    }
    // bandit on the six
    if (H.six) {
      const y = cy + (line ? H.fsWarn * (line === 2 ? 3.1 : 2.2) : 0);
      const on = flashOn(2);
      text('BANDIT SIX', P.cx, y, on ? H.C.red : H.C.redHi, H.fontWarnS, 'center');
      // down chevrons at the bottom of the scope
      g.strokeStyle = H.C.red; g.lineWidth = 2.5; g.beginPath();
      const by = P.cy + H.ay; chevron(P.cx, by, Math.PI / 2, 12); chevron(P.cx, by - 10, Math.PI / 2, 12); g.stroke();
    }
    // incoming gunfire
    if (H.near.t > 0) {
      // above the screen centre, mirroring the shoot cue below it (clear of the warning stack and score pops)
      text('GUNS', P.cx, P.cy - H.cueOff, H.C.red, H.fontWarnS, 'center');
    }
  }

  // ---- damage, hits, splash ---------------------------------------------------------------------------
  function drawDamage() {
    // directional hit flashes: red arcs on the edge ellipse toward the source
    for (let i = 0; i < H.dmg.length; i++) {
      const d = H.dmg[i]; if (d.t <= 0) continue;
      const a = d.a, k = d.t / d.life;
      g.strokeStyle = H.C.red; g.globalAlpha = H.reduced ? 0.8 : k; g.lineWidth = 7;
      g.beginPath(); g.ellipse(P.cx, P.cy, H.ax * 0.9, H.ay * 0.9, 0, a - 0.28, a + 0.28); g.stroke();
      g.globalAlpha = 1;
    }
  }
  function drawHit() {
    if (H.hit.t <= 0 || !H.hit.target) return;
    const t = H.hit.target;
    if (!t.state || !proj(t.state.position)) return;
    const x = P.x, y = P.y, r = 7, R = 15;
    g.strokeStyle = '#ffffff'; g.lineWidth = 2.2; g.beginPath();
    g.moveTo(x - R, y - R); g.lineTo(x - r, y - r); g.moveTo(x + R, y - R); g.lineTo(x + r, y - r);
    g.moveTo(x - R, y + R); g.lineTo(x - r, y + r); g.moveTo(x + R, y + R); g.lineTo(x + r, y + r);
    g.stroke();
  }
  function drawSplash() {
    for (const s of H.splash) {
      if (s.t <= 0) continue;
      let x, y;
      if (s.entity?.state && proj(s.entity.state.position)) { x = P.x; y = P.y; s.x = x; s.y = y; } else { x = s.x; y = s.y; }
      if (!(x === x)) continue;
      const age = s.life - s.t, k = H.reduced ? 1 : clamp(age / 0.16, 0, 1);
      const sc = 1 + (1 - k) * 0.9;
      const alpha = s.t < 0.4 ? s.t / 0.4 : 1;
      g.save(); g.translate(x, y - 34); g.rotate(-0.06); g.scale(sc, sc);
      g.globalAlpha = alpha;
      const w = H.fsWarn * 4.6, hh = H.fsWarn * 1.3;
      g.strokeStyle = H.C.hud; g.lineWidth = 2.5; g.strokeRect(-w / 2, -hh / 2, w, hh);
      text('SPLASH', 0, 1, H.C.hud, H.fontWarnS, 'center');
      g.restore();
      g.globalAlpha = 1;
    }
  }

  function drawCue() {
    // central shoot / status cue under the screen centre
    const y = P.cy + H.cueOff;
    if (H.cue) {
      const on = H.cueGun ? true : flashOn(2.5);
      const w = H.fsWarn * 3.9, hh = H.fsWarn * 1.2;
      g.strokeStyle = H.cueCol; g.lineWidth = 2.2; g.strokeRect(Math.round(P.cx - w / 2) + 0.5, Math.round(y - hh / 2) + 0.5, Math.round(w), Math.round(hh));
      if (on) { g.fillStyle = 'rgba(0,30,10,0.45)'; g.fillRect(P.cx - w / 2 + 2, y - hh / 2 + 2, w - 4, hh - 4); }
      text(H.cue, P.cx, y + 1, H.cueCol, H.fontWarnS, 'center');
    } else if (H.msg.t > 0) {
      text(H.msg.text, P.cx, y, H.msg.col, H.fontB, 'center');
    }
  }

  // ---- combat cameras ---------------------------------------------------------------------------------
  /** padlock: where my nose points (and which way is "up" for the jet), so I can fly while looking at the target */
  function drawNose(p) {
    const ps = p.state.position;
    v1.copy(p.forward).multiplyScalar(1500).add(ps);
    const col = H.C.hud;
    if (onScreen(v1, 0)) {
      const x = P.x, y = P.y;
      v2.copy(p.up).multiplyScalar(160).add(v1);
      let lx = 0, ly = -1;
      if (proj(v2)) { const dx = P.x - x, dy = P.y - y, l = Math.hypot(dx, dy); if (l > 0.5) { lx = dx / l; ly = dy / l; } }
      g.strokeStyle = col; g.lineWidth = 2; g.beginPath();
      g.moveTo(x + 7, y); g.arc(x, y, 7, 0, TAU);
      // wings perpendicular to the lift vector, lift line out of the top
      g.moveTo(x - ly * 7, y + lx * 7); g.lineTo(x - ly * 18, y + lx * 18);
      g.moveTo(x + ly * 7, y - lx * 7); g.lineTo(x + ly * 18, y - lx * 18);
      g.moveTo(x + lx * 7, y + ly * 7); g.lineTo(x + lx * 26, y + ly * 26);
      g.stroke();
    } else {
      edgeClamp(P.dx, P.dy, P.cx, P.cy, H.ax * 0.92, H.ay * 0.92, E);
      g.beginPath(); arrowHead(E.x, E.y, E.a, 18); g.fillStyle = col; g.fill();
      text('NOSE', E.x - Math.cos(E.a) * 30, E.y - Math.sin(E.a) * 30, col, H.fontXS, 'center');
    }
  }
  const CAM_LABEL = { padlock: 'PADLOCK', missile: 'MISSILE CAM', kill: 'KILL CAM', victory: 'VICTORY' };
  function drawCamLabel(p) {
    const lab = CAM_LABEL[H.camMode]; if (!lab) return;
    const y = Math.round(H.camLabelY);
    const w = lab.length * H.cwB + 22, hh = H.fs * 1.8;
    g.fillStyle = 'rgba(6,10,15,0.55)'; g.fillRect(Math.round(P.cx - w / 2), y - hh / 2, Math.round(w), hh);
    g.strokeStyle = H.camMode === 'padlock' ? H.C.hud : H.C.fg; g.lineWidth = 1;
    g.strokeRect(Math.round(P.cx - w / 2) + 0.5, Math.round(y - hh / 2) + 0.5, Math.round(w), Math.round(hh));
    text(lab, P.cx, y + 1, H.camMode === 'padlock' ? H.C.hud : H.C.fg, H.fontB, 'center');
    if (H.camMode === 'missile') {
      // time to go of my newest missile in flight
      let m = null; for (const x of H.combat.weapons.missiles) if (x.owner === p && x.alive) m = x;
      if (m && m.tgo > 0 && m.tgo < 99) text(TTI_STR(Math.ceil(m.tgo)), P.cx + w / 2 + 8, y + 1, H.C.fg, H.fontB, 'left');
    }
  }

  function draw(gg, p) {
    g = gg; o = H.ctx.world.origin;
    H.cue = ''; H.cueGun = false;
    // missile / kill / victory shots are not seen from the nose: nothing boresight-referenced, no "turn this way" cues
    H.cine = H.camMode === 'missile' || H.camMode === 'kill' || H.camMode === 'victory';
    if (!H.cine) drawDamage();
    drawMission(p);
    drawAircraft(p);
    if (!H.cine) drawGun(p);
    drawTarget(p);
    if (!H.cine) drawMissile(p);
    if (H.camMode === 'padlock') drawNose(p);
    drawHit();
    drawSplash();
    drawThreats(p);
    if (!H.cine) drawCue();
    drawCamLabel(p);
  }
  /** After the player is down: splash stamps / damage only. */
  function drawDead(gg) { g = gg; o = H.ctx.world.origin; drawSplash(); }

  return { draw, drawDead };
}
