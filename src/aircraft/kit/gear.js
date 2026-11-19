// Aircraft kit — landing gear: oleo struts, torque links, wheels / bogies, doors, retraction, arrestor hook.
import * as THREE from 'three';
import { Mesh, lathe, tube, prism, ellipsoid } from './mesh.js';
import { FINISH } from './atlas.js';
import { seq } from './rig.js';

const DEG = Math.PI / 180;
const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const A = (v) => [v.x, v.y, v.z];

/** A wheel (tyre + hub) centred at the origin with its axle along X. opts: { radius, width, rim = .55 (fraction), uvTyre, uvHub, segments } */
export function wheel(o) {
  const R = o.radius, w = o.width ?? R * 0.55, rr = R * (o.rim ?? 0.56), hw = w / 2, seg = o.segments ?? 24;
  const tyre = lathe([
    [rr, -hw * 0.72, 1], [rr + (R - rr) * 0.35, -hw * 0.98], [R * 0.9, -hw], [R * 0.985, -hw * 0.72], [R, -hw * 0.3], [R, hw * 0.3],
    [R * 0.985, hw * 0.72], [R * 0.9, hw], [rr + (R - rr) * 0.35, hw * 0.98], [rr, hw * 0.72, 1],
  ], { segments: seg, uv: o.uvTyre });
  const hub = lathe([
    [0, -hw * 0.5], [rr * 0.22, -hw * 0.5, 1], [rr * 0.3, -hw * 0.34], [rr * 0.82, -hw * 0.3], [rr * 0.94, -hw * 0.66, 1], [rr, -hw * 0.72, 1],
    [rr, hw * 0.72, 1], [rr * 0.94, hw * 0.66, 1], [rr * 0.82, hw * 0.3], [rr * 0.3, hw * 0.34], [rr * 0.22, hw * 0.5, 1], [0, hw * 0.5],
  ], { segments: seg, uv: o.uvHub });
  return tyre.add(hub).rotateY(Math.PI / 2);
}

/**
 * Build one landing-gear unit and register its animation on the rig.
 * spec: {
 *   name, index,                 index into geometry.gear / state.gear
 *   contact: [x, y, z],          tyre contact point when parked (geometry.gear[i].pos)
 *   wheelRadius, wheelWidth,
 *   wheels = [0],                wheel positions along the axle (metres from the strut axis; e.g. [-0.22, 0.22] for twins)
 *   axles = [0],                 axle positions along Z for bogies (e.g. [-0.7, 0.7])
 *   pivot: [x, y, z],            trunnion (top of the strut, where it rotates to retract)
 *   stroke = 0.25, staticFrac = 0.35 (how much of the stroke is used when parked),
 *   strutR = 0.05, pistonR,
 *   retract: { axis, angle (deg) } | { to: [x, y, z] (stowed axle position), twist = 0 (deg about the strut) },
 *   window = [0.25, 0.9],        part of surfaces.gear (0 up … 1 down) over which the leg swings
 *   steer = false,               nose-wheel steering from state.gear[i].steer
 *   links = 'rear',              torque links: 'front' | 'rear' | 'left' | 'right' | 'none'
 *   fork = 'axle',               'axle' (wheels on a cross axle) | 'fork' (wheel between two arms) | 'half' (single-sided arm, offset wheel)
 *   axleTilt = false,             true: wheel axle square to the strut (default: horizontal, wheels upright even on a splayed leg)
 *   brace: [x, y, z] | null,     airframe end of a drag/side brace drawn from the strut
 *   doors: [{ name, mesh, hinge: { a, b }, ref, open = 90 (deg), toward = [0, -1, 0], closes = false, window, onLeg = false, key }],
 *   lamps: [{ kind, pos, color, size }]   lamps mounted on the leg
 *   uv: { strut, piston, tyre, hub, link }   swatch UVs (defaults from atlas finishes)
 * }
 */
export function buildGear(rig, atlas, spec) {
  const ctx = rig.ctx, P = V(spec.pivot), R = spec.wheelRadius, wW = spec.wheelWidth ?? R * 0.55;
  const contact = V(spec.contact), C = contact.clone().add(new THREE.Vector3(0, R, 0));     // axle / bogie centre when parked
  const stroke = spec.stroke ?? 0.25, sFrac = spec.staticFrac ?? 0.35, eStatic = stroke * (1 - sFrac);
  const d = C.clone().sub(P), Lp = d.length(); d.normalize();
  const strutR = spec.strutR ?? 0.05, pistonR = spec.pistonR ?? strutR * 0.62;
  const uv = Object.assign({
    strut: atlas.swatch('gear.strut', FINISH.gearWhite), piston: atlas.swatch('gear.chrome', FINISH.chrome), tyre: atlas.swatch('gear.tyre', FINISH.rubber),
    hub: atlas.swatch('gear.hub', FINISH.gearWhite), link: atlas.swatch('gear.link', FINISH.anodised), dark: atlas.swatch('gear.dark', FINISH.darkGrey),
  }, spec.uv || {});
  const wheelsX = spec.wheels || [0], axlesZ = spec.axles || [0], fork = spec.fork || 'axle';
  const bogie = axlesZ.length > 1;
  // strut layout along the axis: P ... B (bottom of the outer cylinder) ... piston ... C
  const pistonVisible = eStatic + Math.max(0.06, fork === 'axle' && !bogie ? R * 0.25 : R * 0.9);
  const Lo = Math.max(Lp * 0.3, Lp - pistonVisible), B = P.clone().addScaledVector(d, Lo);
  // a lateral reference perpendicular to the strut: the axle direction (body X made perpendicular to d)
  const ax = new THREE.Vector3(1, 0, 0).addScaledVector(d, -d.x).normalize();
  const fwd = new THREE.Vector3().crossVectors(ax, d).normalize();          // roughly body -Z or +Z, perpendicular to strut and axle
  if (fwd.z > 0) fwd.negate();                                              // make it point toward the nose
  // wheel axle: horizontal by default so wheels stay upright on splayed legs; spec.axleTilt = true keeps it square to the strut
  const axW = spec.axleTilt ? ax : new THREE.Vector3(-fwd.z, 0, fwd.x).normalize();

  // ---- nodes ---------------------------------------------------------------------------------------------------------------
  const leg = rig.node(spec.name + '.leg', { pivot: A(P) });
  const outer = new Mesh();
  outer.add(tube(A(P), A(B), strutR, strutR, { segments: 14, uv: uv.strut }));
  outer.add(tube(A(B.clone().addScaledVector(d, -0.05)), A(B.clone().addScaledVector(d, 0.012)), strutR * 1.18, strutR * 1.18, { segments: 14, uv: uv.strut }));
  outer.add(tube(A(P.clone().addScaledVector(d, 0.02)), A(P.clone().addScaledVector(d, 0.12)), strutR * 1.3, strutR * 1.15, { segments: 14, uv: uv.strut }));
  // trunnion cross tube along the retraction axis
  let rAxis = null, rAngle = 0;
  const rt = spec.retract || {};
  if (rt.to) {
    const v1 = C.clone().sub(P).normalize(), v2 = V(rt.to).sub(P).normalize();
    rAxis = new THREE.Vector3().crossVectors(v1, v2).normalize(); rAngle = Math.acos(Math.min(1, Math.max(-1, v1.dot(v2))));
  } else if (rt.axis) { rAxis = V(rt.axis).normalize(); rAngle = (rt.angle ?? 90) * DEG; }
  if (rAxis) outer.add(tube(A(P.clone().addScaledVector(rAxis, -strutR * 2.6)), A(P.clone().addScaledVector(rAxis, strutR * 2.6)), strutR * 0.9, strutR * 0.9, { segments: 10, uv: uv.strut }));
  if (spec.brace) {
    const b0 = P.clone().addScaledVector(d, Lo * 0.62), b1 = V(spec.brace), mid = b0.clone().lerp(b1, 0.5);
    outer.add(tube(A(b0), A(mid), strutR * 0.5, strutR * 0.5, { segments: 8, uv: uv.link }));
    outer.add(tube(A(mid), A(b1), strutR * 0.42, strutR * 0.42, { segments: 8, uv: uv.link }));
    outer.add(ellipsoid(strutR * 0.62, strutR * 0.62, strutR * 0.62, { segments: 8, rings: 4, uv: uv.link }).translate(mid.x, mid.y, mid.z));
  }
  if (spec.extra) outer.add(spec.extra);
  rig.part(spec.name + '.strut', outer, { parent: leg, pivot: A(P) });
  for (const L of spec.lamps || []) rig.lamp(L.kind, L.pos, { ...L, parent: leg });

  // steer / twist node: rotates about the strut axis through B
  const steer = rig.node(spec.name + '.steer', { parent: leg, pivot: A(B) });
  const pistonN = rig.node(spec.name + '.piston', { parent: steer, pivot: A(C) });
  const pm = new Mesh();
  const pTop = B.clone().addScaledVector(d, -Math.min(stroke + 0.05, Lo * 0.8));
  const pEnd = bogie || fork !== 'axle' ? C.clone().addScaledVector(d, -R * (bogie ? 0.25 : 1.12)) : C;
  pm.add(tube(A(pTop), A(pEnd), pistonR, pistonR, { segments: 12, uv: uv.piston }));
  const xMin = Math.min(...wheelsX), xMax = Math.max(...wheelsX);
  const axleAt = (z) => C.clone().addScaledVector(fwd, -z);                 // bogie axles spread fore/aft (z > 0 = aft)
  if (bogie) {
    const zMin = Math.min(...axlesZ), zMax = Math.max(...axlesZ);
    pm.add(tube(A(axleAt(zMin)), A(axleAt(zMax)), pistonR * 1.25, pistonR * 1.25, { segments: 10, uv: uv.strut }));       // bogie beam
    pm.add(tube(A(pEnd), A(C), pistonR * 1.35, pistonR * 1.5, { segments: 10, uv: uv.strut }));
  }
  for (const z of axlesZ) {
    const c = axleAt(z);
    if (fork === 'fork') {
      const hw = wW * 0.5 + 0.035, top = pEnd;
      pm.add(tube(A(top.clone().addScaledVector(axW, -hw)), A(top.clone().addScaledVector(axW, hw)), pistonR * 1.1, pistonR * 1.1, { segments: 8, uv: uv.strut }));
      for (const sgn of [-1, 1]) pm.add(tube(A(top.clone().addScaledVector(axW, sgn * hw)), A(c.clone().addScaledVector(axW, sgn * hw)), pistonR * 0.8, pistonR * 0.7, { segments: 8, uv: uv.strut }));
      pm.add(tube(A(c.clone().addScaledVector(axW, -hw - 0.01)), A(c.clone().addScaledVector(axW, hw + 0.01)), pistonR * 0.6, pistonR * 0.6, { segments: 8, uv: uv.link }));
    } else if (fork === 'half') {
      const sgn = Math.sign(wheelsX[0]) || 1, arm = c.clone().addScaledVector(axW, -sgn * 0.0);
      pm.add(tube(A(pEnd), A(arm), pistonR * 1.05, pistonR * 0.95, { segments: 10, uv: uv.strut }));
      pm.add(tube(A(arm), A(c.clone().addScaledVector(axW, wheelsX[0] + sgn * wW * 0.3)), pistonR * 0.8, pistonR * 0.8, { segments: 8, uv: uv.link }));
    } else {
      pm.add(tube(A(c.clone().addScaledVector(axW, xMin - wW * 0.45)), A(c.clone().addScaledVector(axW, xMax + wW * 0.45)), pistonR * 0.75, pistonR * 0.75, { segments: 10, uv: uv.link }));
      if (!bogie) pm.add(ellipsoid(pistonR * 1.5, pistonR * 1.5, pistonR * 1.5, { segments: 10, rings: 5, uv: uv.strut }).translate(c.x, c.y, c.z));
    }
  }
  rig.part(spec.name + '.rod', pm, { parent: pistonN, pivot: A(C) });
  // wheels: one spinning node per axle
  const spinners = [];
  for (const z of axlesZ) {
    const c = axleAt(z), wm = new Mesh();
    for (const x of wheelsX) {
      const one = wheel({ radius: R, width: wW, uvTyre: uv.tyre, uvHub: uv.hub, segments: spec.wheelSegments ?? 24 });
      // align the wheel's X axle with `axW`
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), axW);
      one.transform(new THREE.Matrix4().makeRotationFromQuaternion(q)).translate(c.x + axW.x * x, c.y + axW.y * x, c.z + axW.z * x);
      wm.add(one);
    }
    spinners.push(rig.part(`${spec.name}.wheel${spinners.length}`, wm, { parent: pistonN, pivot: A(c) }));
  }
  // torque links
  let linkU = null, linkL = null, linkGeom = null;
  const linkSide = spec.links ?? 'rear';
  if (linkSide !== 'none') {
    const s = linkSide === 'front' ? fwd.clone() : linkSide === 'rear' ? fwd.clone().negate() : linkSide === 'left' ? ax.clone().negate() : ax.clone();
    const U0 = B.clone().addScaledVector(s, strutR * 1.1), L0 = (fork === 'axle' && !bogie ? C.clone().addScaledVector(d, -R * 0.32) : pEnd.clone()).addScaledVector(s, pistonR * 1.1);
    const Dp = U0.distanceTo(L0), Dmax = Dp + stroke * sFrac, len = Math.max(0.52 * Dmax, 0.5 * Dmax + 0.015);
    const w = new THREE.Vector3().crossVectors(d, s).normalize();
    const theta = (D) => Math.acos(Math.min(1, Math.max(0, (D / 2) / len)));
    const th0 = theta(Dp), apex = U0.clone().addScaledVector(d, len * Math.cos(th0)).addScaledVector(s, len * Math.sin(th0));
    const mkLink = (from) => {
      // tapered flat link in the plane (d, s), thickness along w
      const dir = apex.clone().sub(from).normalize(), up = new THREE.Vector3().crossVectors(w, dir).normalize(), wd = strutR * 1.5;
      const m = new Mesh(), q = (t, o) => from.clone().addScaledVector(dir, t * len).addScaledVector(up, o);
      const pts = [q(0, -0.022), q(1, -0.012), q(1, 0.012), q(0, 0.022)];
      for (const sg of [-1, 1]) {
        const n = w.clone().multiplyScalar(sg), i0 = m.vertexCount;
        for (const p of pts) { const pp = p.clone().addScaledVector(w, sg * wd * 0.5); m.vert(pp.x, pp.y, pp.z, n.x, n.y, n.z, uv.link[0], uv.link[1]); }
        if (sg > 0) m.quad(i0, i0 + 1, i0 + 2, i0 + 3); else m.quad(i0 + 3, i0 + 2, i0 + 1, i0);
      }
      for (let i = 0; i < 4; i++) {
        const a = pts[i], b = pts[(i + 1) % 4], e = b.clone().sub(a), n = new THREE.Vector3().crossVectors(e, w).normalize(), i0 = m.vertexCount;
        for (const [p, sg] of [[a, -1], [b, -1], [b, 1], [a, 1]]) { const pp = p.clone().addScaledVector(w, sg * wd * 0.5); m.vert(pp.x, pp.y, pp.z, n.x, n.y, n.z, uv.link[0], uv.link[1]); }
        m.quad(i0, i0 + 1, i0 + 2, i0 + 3);
      }
      return m;
    };
    linkU = rig.part(spec.name + '.linkU', mkLink(U0), { parent: steer, pivot: A(U0) });
    linkL = rig.part(spec.name + '.linkL', mkLink(L0), { parent: pistonN, pivot: A(L0) });
    linkGeom = { w, th0, theta, Dp };
  }
  // doors
  const doors = [];
  for (const dr of spec.doors || []) {
    if (dr.onLeg) { rig.part(dr.name, dr.mesh, { parent: leg, pivot: A(P), key: dr.key }); continue; }
    const node = rig.part(dr.name, dr.mesh, { pivot: dr.hinge.a, key: dr.key });
    const set = rig.hinge(node, dr.hinge.a, dr.hinge.b, { ref: dr.ref, toward: dr.toward || [0, -1, 0] });
    doors.push({ set, open: (dr.open ?? 90) * DEG, closes: !!dr.closes, window: dr.window, fn: dr.fn });
  }

  // ---- animation ---------------------------------------------------------------------------------------------------------
  const win = spec.window || [0.25, 0.9];
  const qA = new THREE.Quaternion(), qB = new THREE.Quaternion(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const twist = (rt.twist ?? 0) * DEG;
  let ext = eStatic, spin = 0, rate = 0, first = true;
  const idx = spec.index ?? 0;
  rig.onUpdate((S, dt) => {
    const g = S.sf.gear, down = seq(g, win[0], win[1]);
    leg.visible = g > 0.012;
    for (const D of doors) {
      const f = D.fn ? D.fn(g) : D.closes ? Math.min(seq(g, 0.02, win[0]), 1 - seq(g, win[1], 0.99)) : seq(g, D.window ? D.window[0] : 0.02, D.window ? D.window[1] : win[0] + 0.05);
      D.set(D.open * f);
    }
    if (!leg.visible) return;
    if (rAxis) leg.quaternion.setFromAxisAngle(rAxis, rAngle * (1 - down)); else leg.quaternion.identity();
    // oleo extension (metres of piston showing beyond fully compressed)
    const gs = S.gear[idx] || {}; let target;
    const st = S.raw;
    if (gs.onGround && g > 0.98 && ctx?.world?.groundHeightAt && st && st.position && st.quaternion) {
      tmp.copy(contact).applyQuaternion(st.quaternion).add(st.position);
      tmp2.copy(d).applyQuaternion(st.quaternion);
      const h = ctx.world.groundHeightAt(tmp.x, tmp.z);
      target = eStatic + (h - tmp.y) / Math.min(-0.3, tmp2.y);
    } else if (S.hasGearState) target = gs.onGround ? stroke * (1 - gs.compression) : stroke;
    else target = S.onGround ? eStatic : stroke;
    target = Math.min(stroke, Math.max(0, target));
    ext = first || dt <= 0 ? target : ext + (target - ext) * (1 - Math.exp(-30 * dt)); first = false;
    const off = ext - eStatic;
    pistonN.position.set(pistonN.userData.rest.x + d.x * off, pistonN.userData.rest.y + d.y * off, pistonN.userData.rest.z + d.z * off);
    // steering + stow twist about the strut axis
    const sa = (spec.steer ? (gs.steer || 0) * (spec.steerSign ?? 1) : 0) * down + twist * (1 - down);   // + = nose right (rotation about the downward strut axis)
    steer.quaternion.setFromAxisAngle(d, sa);
    if (linkGeom) {
      const dth = linkGeom.theta(linkGeom.Dp + off) - linkGeom.th0;
      qA.setFromAxisAngle(linkGeom.w, dth); linkU.quaternion.copy(qA);
      qB.setFromAxisAngle(linkGeom.w, -dth); linkL.quaternion.copy(qB);
    }
    // wheel spin
    if (gs.onGround) rate = isNaN(gs.wheelSpeed) ? S.groundSpeed / R : gs.wheelSpeed; else if (!isNaN(gs.wheelSpeed) && gs.wheelSpeed !== 0) rate = gs.wheelSpeed; else rate *= Math.exp(-0.6 * dt);
    spin = (spin - rate * dt) % (Math.PI * 2);
    for (const w of spinners) w.quaternion.setFromAxisAngle(axW, spin);
  });
  pistonN.userData.rest = pistonN.position.clone();
  return { leg, steer, piston: pistonN, wheels: spinners, axis: d, axle: axW, stroke, pivot: P, bottom: B };
}

/** Swing-axis helper: axis and angle (deg) that rotate the point `from` about `pivot` onto the direction of `to`. */
export function swing(pivot, from, to) {
  const v1 = V(from).sub(V(pivot)).normalize(), v2 = V(to).sub(V(pivot)).normalize();
  return { axis: A(new THREE.Vector3().crossVectors(v1, v2).normalize()), angle: Math.acos(Math.min(1, Math.max(-1, v1.dot(v2)))) / DEG };
}

/**
 * Arrestor hook: a bar hinged at `pivot` lying along +Z (aft) for `length`, with a shoe at the end. Returns a Mesh in body
 * coords (stowed position); hinge it about the X axis through the pivot: down angle ≈ 55° × surfaces.hook.
 */
export function arrestorHook(o) {
  const p = o.pivot, L = o.length ?? 2, r = o.radius ?? 0.035, uv = o.uv, m = new Mesh();
  m.add(tube(p, [p[0], p[1], p[2] + L], r, r * 0.8, { segments: 8, uv }));
  m.add(prism([[p[2] + L - 0.06, p[1] + r], [p[2] + L + 0.12, p[1] + r * 0.6], [p[2] + L + 0.14, p[1] - r * 2.2], [p[2] + L + 0.02, p[1] - r * 2.6], [p[2] + L - 0.08, p[1] - r]], p[0] - r * 1.3, p[0] + r * 1.3, o.uvShoe || uv));
  return m;
}

