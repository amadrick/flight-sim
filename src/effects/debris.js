// Airframe breakup: generic tumbling pieces derived from the aircraft's dimensions and paint (fuselage sections,
// wings, fin, engines, panels). Rigid-body-lite: ballistic flight with quadratic drag and tumbling, bounces and
// slides on the ground (friction by surface), sinks on water. Burning pieces trail smoke and fire and keep burning
// where they come to rest. Standard materials (sun, shadows, IBL); hot metal glows briefly through the emissive
// channel (the night-grade mask keeps that glow orange). Pieces are allocated per crash (a handful of meshes).
import * as THREE from 'three';
import { KIND } from './particles.js';

const rnd = Math.random, sgn = () => rnd() * 2 - 1;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/** Dominant paint colour of an aircraft visual (largest opaque standard material by mesh volume). */
export function airframeColour(object3D, out = new THREE.Color(0.55, 0.57, 0.6)) {
  let best = 0;
  const box = new THREE.Box3(), size = new THREE.Vector3();
  object3D?.traverse?.((o) => {
    if (!o.isMesh || !o.material || o.material.transparent || Array.isArray(o.material)) return;
    if (!o.material.color || o.material.opacity < 0.95) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    box.copy(o.geometry.boundingBox).getSize(size);
    const v = size.x * size.y * size.z * (o.scale.x * o.scale.y * o.scale.z);
    if (v > best) { best = v; out.copy(o.material.color); }
  });
  return out;
}

export class Debris {
  constructor(ctx) {
    this.ctx = ctx; this.pieces = []; this.group = new THREE.Group(); this.group.name = 'fx-debris';
    ctx.scene.add(this.group);
    this._g = {}; this._v = new THREE.Vector3(); this._w = new THREE.Vector3(); this._q = new THREE.Quaternion();
    this.ground = {}; this.acc = { v: 0 };
  }
  _geo(kind) {
    if (this._g[kind]) return this._g[kind];
    let g;
    if (kind === 'cyl') { g = new THREE.CylinderGeometry(1, 0.85, 1, 10, 1, false); g.rotateX(Math.PI / 2); }
    else if (kind === 'cone') { g = new THREE.CylinderGeometry(0.25, 1, 1, 10, 1, false); g.rotateX(Math.PI / 2); }
    else if (kind === 'wing') {   // tapered plate
      const s = new THREE.Shape(); s.moveTo(-0.5, -0.5); s.lineTo(0.5, -0.2); s.lineTo(0.5, 0.15); s.lineTo(-0.5, 0.5); s.closePath();
      g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false }); g.translate(0, 0, -0.5); g.rotateX(Math.PI / 2);
    } else if (kind === 'panel') { g = new THREE.BoxGeometry(1, 1, 1); const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (1 + 0.3 * Math.sin(i * 7.1)), p.getY(i), p.getZ(i) * (1 + 0.3 * Math.cos(i * 3.3))); g.computeVertexNormals(); }
    else g = new THREE.BoxGeometry(1, 1, 1);
    this._g[kind] = g; return g;
  }
  /**
   * Break the airframe. o = { state (aircraft state at impact), def, colour (THREE.Color), severity 0..1 (impact = 1),
   *   kind (crash kind), water (bool), q (quality 0.4..1) }
   */
  spawn(o) {
    this.clear();
    const s = o.state, g = o.def.geometry || {}, L = g.length || 15, span = g.span || 10, H = g.height || 4;
    const chord = (g.wingArea || span * L * 0.12) / span;
    const r = Math.max(0.6, L * 0.05), sev = o.severity;
    const k = sev > 0.8 ? 0.65 : 1;     // high energy: smaller sections
    const specs = [];
    const add = (geo, sx, sy, sz, at, burn = false, metal = 0.5) => specs.push({ geo, sx, sy, sz, at, burn, metal });
    add('cone', r, r, L * 0.32 * k, [0, 0, -L * 0.3], false);           // nose / forward fuselage
    add('cyl', r, r, L * 0.3 * k, [0, 0, 0], true);                      // centre section (fuel tanks)
    add('cyl', r * 0.85, r * 0.85, L * 0.3 * k, [0, 0, L * 0.3], false); // aft fuselage
    add('wing', span * 0.45 * k, chord * 0.12, chord, [span * 0.25, 0, 0], true);
    add('wing', span * 0.45 * k, chord * 0.12, chord, [-span * 0.25, 0, 0], true);
    add('box', 0.25, H * 0.45, L * 0.14, [0, H * 0.35, L * 0.4], false); // fin
    for (const en of (g.engines || []).slice(0, 4)) {
      const nr = (en.nozzleRadius || 0.5) * 1.25;
      add('cyl', nr, nr, Math.max(2, L * 0.13), en.nozzle ? [en.nozzle[0], en.nozzle[1], en.nozzle[2] - L * 0.08] : [0, 0, L * 0.3], true, 0.7);
    }
    const nSmall = Math.round((sev > 0.8 ? 14 : 5) * clamp(o.q ?? 1, 0.4, 1));
    for (let i = 0; i < nSmall; i++) add('panel', 0.4 + rnd() * r * 1.2, 0.06 + rnd() * 0.1, 0.4 + rnd() * r * 1.5, [sgn() * span * 0.3, 0, sgn() * L * 0.4], rnd() < 0.25, 0.6);
    const base = o.colour || new THREE.Color(0.55, 0.57, 0.6);
    const v0 = s.velocity, speed = v0.length();
    const keep = sev > 0.8 ? 0.35 : 0.75;            // fraction of the impact velocity the pieces keep
    for (const sp of specs) {
      const m = new THREE.MeshStandardMaterial({ color: base.clone().multiplyScalar(0.85 + 0.25 * rnd()), roughness: 0.6, metalness: sp.metal * 0.6, emissive: new THREE.Color(1, 0.35, 0.08), emissiveIntensity: 0 });
      const mesh = new THREE.Mesh(this._geo(sp.geo), m);
      mesh.scale.set(sp.sx, sp.sy, sp.sz);
      mesh.castShadow = true; mesh.receiveShadow = true;
      const p = new THREE.Vector3().fromArray(sp.at).applyQuaternion(s.quaternion).add(s.position);
      const v = v0.clone().multiplyScalar(keep * (0.7 + 0.5 * rnd()));
      const spread = (sev > 0.8 ? 0.45 : 0.18) * speed + 6;
      v.x += sgn() * spread * 0.6; v.z += sgn() * spread * 0.6; v.y = Math.abs(v.y) * 0.25 + rnd() * spread * (sp.geo === 'panel' ? 0.9 : 0.4) + 3;
      if (o.water) v.y *= 0.5;
      const size = Math.cbrt(sp.sx * sp.sy * sp.sz);
      const w = new THREE.Vector3(sgn(), sgn(), sgn()).multiplyScalar((sev > 0.8 ? 9 : 4) / (0.6 + size));
      this.ctx.world.toRender(p, mesh.position); mesh.quaternion.copy(s.quaternion);
      this.group.add(mesh);
      this.pieces.push({ mesh, mat: m, p, v, w, size, radius: Math.max(sp.sx, sp.sy, sp.sz) * 0.5, burn: sp.burn && (o.fire !== false), settled: false, heat: sp.burn ? 1 : 0.4, t: 0, trail: { v: 0 }, fire: { v: 0 }, bounces: 0 });
    }
    return this.pieces;
  }
  update(dt, ps, smoke, q) {
    if (!this.pieces.length || dt <= 0) return;
    const ctx = this.ctx, G = this.ground, v3 = this._v;
    for (const pc of this.pieces) {
      ctx.world.toRender(pc.p, pc.mesh.position);
      pc.t += dt;
      pc.heat = Math.max(0, pc.heat - dt * (pc.burn ? 0.02 : 0.25));
      pc.mat.emissiveIntensity = pc.heat * pc.heat * 3;
      const sc = clamp(1 - pc.t / 6, 0.25, 1); pc.mat.color.multiplyScalar(1 - dt * 0.12 * (sc > 0.25 ? 1 : 0)); // soot darkening
      if (!pc.settled) {
        const sp = pc.v.length();
        const kd = 0.012 / Math.max(0.4, pc.size);
        pc.v.addScaledVector(pc.v, -kd * sp * dt); pc.v.y -= 9.81 * dt;
        pc.p.addScaledVector(pc.v, dt);
        // tumble
        const wl = pc.w.length();
        if (wl > 1e-4) { this._q.setFromAxisAngle(v3.copy(pc.w).multiplyScalar(1 / wl), wl * dt); pc.mesh.quaternion.premultiply(this._q); }
        ctx.world.groundAt(pc.p.x, pc.p.z, G);
        let gh = G.height;
        const water = G.type === 'water';
        if (water) gh = ctx.water?.heightAt?.(pc.p.x, pc.p.z) ?? 0;
        const rest = gh + pc.radius * 0.35;
        if (pc.p.y < rest) {
          pc.p.y = rest;
          if (water) { pc.v.multiplyScalar(0.3); pc.v.y = 0; pc.w.multiplyScalar(0.3); if (sp < 3) pc.settled = true; pc.burn = false; }
          else {
            const mu = G.type === 'terrain' ? 0.75 : 0.45;
            if (pc.v.y < -2 && pc.bounces < 4) { pc.v.y = -pc.v.y * 0.32; pc.bounces++; pc.w.multiplyScalar(0.6); pc.w.x += sgn() * 2; }
            else pc.v.y = 0;
            const h = Math.hypot(pc.v.x, pc.v.z), dec = mu * 9.81 * dt * 2;
            const kk = h > dec ? (h - dec) / h : 0; pc.v.x *= kk; pc.v.z *= kk;
            pc.w.multiplyScalar(Math.exp(-3 * dt));
            if (h < 0.6 && Math.abs(pc.v.y) < 0.6) { pc.settled = true; pc.v.set(0, 0, 0); }
          }
        }
        // trail: smoke (+ flame) while flying fast
        if (sp > 4) {
          pc.trail.v += (pc.burn ? 30 : 10) * dt * q * Math.min(1, sp / 30);
          while (pc.trail.v >= 1) {
            pc.trail.v -= 1;
            const p = smoke.p;
            p.kind = KIND.SMOKE; p.life = 6 + rnd() * 6; p.size0 = 0.5 + pc.size * 0.5; p.size1 = 4 + pc.size * 4; p.drag = 1.2; p.buoy = 1.2;
            p.delay = 0; const c = pc.burn ? 0.05 + rnd() * 0.04 : 0.25 + rnd() * 0.1; p.r = c; p.g = c; p.b = c; p.opacity = pc.burn ? 0.7 : 0.35; p.emissive = 0; p.aux = 0;
            smoke.spawn(pc.p, v3.copy(pc.v).multiplyScalar(0.05));
            if (pc.burn && pc.heat > 0.2) {
              const f = ps.p;
              f.kind = KIND.FIRE; f.life = 0.5 + rnd() * 0.5; f.size0 = 0.4 + pc.size * 0.3; f.size1 = 1.5 + pc.size; f.drag = 3; f.buoy = 3;
              f.delay = 0; f.r = 0.15; f.g = 0.12; f.b = 0.1; f.opacity = 0.8; f.emissive = 25 + rnd() * 20; f.aux = 0;
              ps.spawn(pc.p, v3.copy(pc.v).multiplyScalar(0.1));
            }
          }
        }
        ctx.world.toRender(pc.p, pc.mesh.position);
      } else if (pc.burn && pc.t < 140) {
        // burning at rest: flames + a thin smoke column
        const life = clamp(1 - pc.t / 140, 0, 1);
        pc.fire.v += 6 * life * dt * q;
        while (pc.fire.v >= 1) {
          pc.fire.v -= 1;
          const f = ps.p;
          f.kind = KIND.FIRE; f.life = 0.9 + rnd() * 0.8; f.size0 = 0.4 + pc.size * 0.4; f.size1 = 2 + pc.size * 1.5; f.drag = 2; f.buoy = 4;
          f.delay = 0; f.r = 0.12; f.g = 0.1; f.b = 0.1; f.opacity = 0.75; f.emissive = 18 + rnd() * 18; f.aux = 0;
          ps.spawn(v3.copy(pc.p).set(pc.p.x + sgn() * pc.radius * 0.5, pc.p.y + 0.3, pc.p.z + sgn() * pc.radius * 0.5), this._w.set(sgn() * 0.5, 1 + rnd(), sgn() * 0.5));
          if (rnd() < 0.35) {
            const p = smoke.p;
            p.kind = KIND.SMOKE; p.life = 14 + rnd() * 10; p.size0 = 1 + pc.size; p.size1 = 8 + pc.size * 6; p.drag = 0.8; p.buoy = 3.5;
            p.delay = 0; const c = 0.04 + rnd() * 0.04; p.r = c; p.g = c; p.b = c; p.opacity = 0.6 * life; p.emissive = 0; p.aux = 0;
            smoke.spawn(v3.set(pc.p.x, pc.p.y + 1.5, pc.p.z), this._w.set(sgn(), 2 + rnd(), sgn()));
          }
        }
      }
    }
  }
  /** brightest burning piece (world) for the fx light fallback */
  burning(out) { for (const pc of this.pieces) if (pc.burn && pc.settled && pc.t < 120) { out.copy(pc.p); return true; } return false; }
  /** shed a few small pieces (panels, fairings) from a sliding airframe without clearing the existing ones */
  shed(o) {
    const s = o.state, g = o.def.geometry || {}, L = g.length || 15, span = g.span || 10, r = Math.max(0.6, L * 0.05);
    const base = o.colour || new THREE.Color(0.55, 0.57, 0.6);
    for (let i = 0; i < (o.n || 3); i++) {
      const m = new THREE.MeshStandardMaterial({ color: base.clone().multiplyScalar(0.8 + 0.3 * rnd()), roughness: 0.55, metalness: 0.4, emissive: new THREE.Color(1, 0.35, 0.08), emissiveIntensity: 0 });
      const mesh = new THREE.Mesh(this._geo('panel'), m);
      const sx = 0.3 + rnd() * r, sz = 0.3 + rnd() * r * 1.2;
      mesh.scale.set(sx, 0.04 + rnd() * 0.05, sz); mesh.castShadow = true; mesh.receiveShadow = true;
      const p = new THREE.Vector3(sgn() * span * 0.3, -0.3, sgn() * L * 0.35).applyQuaternion(s.quaternion).add(s.position);
      const v = s.velocity.clone().multiplyScalar(0.55 + 0.35 * rnd()); v.x += sgn() * 6; v.z += sgn() * 6; v.y = 2 + rnd() * 7;
      const w = new THREE.Vector3(sgn(), sgn(), sgn()).multiplyScalar(10);
      this.ctx.world.toRender(p, mesh.position); this.group.add(mesh);
      this.pieces.push({ mesh, mat: m, p, v, w, size: Math.cbrt(sx * sz * 0.05), radius: Math.max(sx, sz) * 0.5, burn: false, settled: false, heat: 0.15, t: 0, trail: { v: 0 }, fire: { v: 0 }, bounces: 0 });
    }
  }
  clear() {
    for (const pc of this.pieces) { this.group.remove(pc.mesh); pc.mat.dispose(); }
    this.pieces.length = 0;
  }
  onOriginShift() { /* pieces live in world coordinates; render positions follow the group offset */ }
  dispose() { this.clear(); for (const k in this._g) this._g[k].dispose(); this.ctx.scene.remove(this.group); }
}
