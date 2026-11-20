// Pooled tumbling debris for mid-air kills (one InstancedMesh → one draw). Ballistic flight with quadratic drag and
// tumbling; burning pieces glow (emissive heat), shed smoke puffs and — the biggest few — a continuous smoke/fire
// ribbon. Pieces disappear when they reach the ground or water (a small dust/spray puff) or after their life.
// No allocations per frame; records are preallocated.
import * as THREE from 'three';
import { KIND } from '../../effects/particles.js';
import { createDebrisMesh } from './meshes.js';
import { STYLE } from './ribbons.js';

const rnd = Math.random, sgn = () => rnd() * 2 - 1;

export function createDebris(ctx, ribbons, capacity = 128) {
  const mesh = createDebrisMesh(ctx, capacity);
  const heatAttr = mesh.userData.heat;
  const pieces = [];
  for (let i = 0; i < capacity; i++) {
    pieces.push({ alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), w: new THREE.Vector3(), q: new THREE.Quaternion(),
      s: new THREE.Vector3(1, 1, 1), c: new THREE.Color(), heat: 0, burn: false, t: 0, life: 20, kd: 0.01, acc: { v: 0, f: 0 }, rb: null, size: 1 });
  }
  const m4 = new THREE.Matrix4(), v = new THREE.Vector3(), r = new THREE.Vector3(), dq = new THREE.Quaternion(), g = {};
  let live = 0, cursor = 0;

  function take() {
    for (let k = 0; k < capacity; k++) { const pc = pieces[(cursor + k) % capacity]; if (!pc.alive) { cursor = (cursor + k + 1) % capacity; return pc; } }
    // pool full: recycle the oldest
    let o = pieces[0]; for (const pc of pieces) if (pc.t > o.t) o = pc;
    if (o.rb) { o.rb.release(ctx.time.now); o.rb = null; }
    return o;
  }

  const sys = {
    mesh,
    get live() { return live; },
    /**
     * Throw n pieces from world position pos with base velocity vel. o: { colour (THREE.Color), size (m, typical chunk),
     * spread (m/s), burnFrac, ribbons (max pieces with a ribbon trail), big (number of large airframe sections), span, length }
     */
    burst(pos, vel, n, o) {
      let ribbonsLeft = o.ribbons ?? 0;
      for (let i = 0; i < n; i++) {
        const pc = take();
        const big = i < (o.big || 0);
        pc.alive = true; pc.t = 0; pc.life = 18 + rnd() * 10;
        const sz = big ? (o.length || 15) * (0.18 + rnd() * 0.12) : (o.size || 1) * (0.25 + rnd() * rnd() * 1.6);
        pc.size = sz;
        // plates (thin), spars (long), lumps
        const kind = big ? (i % 2 ? 0 : 2) : (rnd() * 3) | 0;
        if (kind === 0) pc.s.set(sz, sz * 0.12, sz * (0.6 + rnd() * 0.6));
        else if (kind === 1) pc.s.set(sz * 0.2, sz * 0.2, sz * 1.4);
        else pc.s.set(sz * (0.5 + rnd() * 0.4), sz * (0.45 + rnd() * 0.3), sz * (0.8 + rnd() * 0.5));
        if (big && kind === 2) pc.s.set(sz * 0.32, sz * 0.32, sz);         // fuselage section
        pc.p.copy(pos); pc.p.x += sgn() * (o.span || 8) * 0.25; pc.p.y += sgn() * 1.5; pc.p.z += sgn() * (o.span || 8) * 0.25;
        const spread = (o.spread ?? 40) * (big ? 0.35 : 1);
        pc.v.copy(vel).multiplyScalar(big ? 0.9 + rnd() * 0.08 : 0.6 + rnd() * 0.35);
        pc.v.x += sgn() * spread; pc.v.y += sgn() * spread * 0.8 + spread * 0.2; pc.v.z += sgn() * spread;
        pc.w.set(sgn(), sgn(), sgn()).multiplyScalar((big ? 1.5 : 6) / Math.max(0.4, Math.sqrt(sz)));
        pc.q.set(sgn(), sgn(), sgn(), sgn()).normalize();
        // light pieces (plates) decelerate much faster than lumps
        pc.kd = (kind === 0 ? 0.03 : 0.012) / Math.max(0.3, sz);
        const k = 0.6 + rnd() * 0.5;
        pc.c.copy(o.colour || r.set(0.5, 0.52, 0.55)).multiplyScalar(k);
        pc.burn = big || rnd() < (o.burnFrac ?? 0.4);
        pc.heat = pc.burn ? 0.9 + rnd() * 0.3 : 0.3 + rnd() * 0.3;
        pc.acc.v = 0; pc.acc.f = 0;
        if (pc.rb) { pc.rb.release(ctx.time.now); pc.rb = null; }
        if (pc.burn && ribbonsLeft > 0) { pc.rb = ribbons.ribbon('short', STYLE.DEBRIS, { spacingMin: 1.5, spacingMax: 12, maxDt: 0.12 }); ribbonsLeft--; }
      }
    },
    update(dt, ps, smoke, q) {
      live = 0;
      if (dt <= 0) { sys.upload(); return; }
      for (const pc of pieces) {
        if (!pc.alive) continue;
        pc.t += dt;
        const sp = pc.v.length();
        pc.v.addScaledVector(pc.v, -pc.kd * sp * dt); pc.v.y -= 9.81 * dt;
        pc.p.addScaledVector(pc.v, dt);
        const wl = pc.w.length();
        if (wl > 1e-5) { dq.setFromAxisAngle(r.copy(pc.w).multiplyScalar(1 / wl), wl * dt); pc.q.premultiply(dq); }
        pc.heat = Math.max(0, pc.heat - dt * (pc.burn ? 0.05 : 0.5));
        ctx.world.groundAt(pc.p.x, pc.p.z, g);
        let gh = g.height; const water = g.type === 'water';
        if (water) gh = ctx.water?.heightAt?.(pc.p.x, pc.p.z) ?? gh;
        if (pc.p.y <= gh + 0.2 || pc.t > pc.life) {
          if (pc.p.y <= gh + 0.5 && pc.size > 0.4) {
            const p = ps.p;   // impact puff
            p.kind = water ? KIND.VAPOR : KIND.SMOKE; p.life = 2 + rnd() * 2; p.size0 = pc.size; p.size1 = pc.size * 5 + 2; p.drag = 1.5; p.buoy = water ? -3 : 0.5;
            p.delay = 0; p.r = water ? 0.95 : 0.5; p.g = water ? 0.97 : 0.44; p.b = water ? 1 : 0.36; p.opacity = 0.6; p.emissive = 0; p.aux = 0;
            ps.spawn(v.set(pc.p.x, gh + 0.5, pc.p.z), r.set(sgn() * 2, water ? 8 : 3, sgn() * 2));
          }
          pc.alive = false;
          if (pc.rb) { pc.rb.release(ctx.time.now); pc.rb = null; }
          continue;
        }
        live++;
        // trail
        const burning = pc.burn && pc.t < 14;
        if (pc.rb) {
          if (burning) ribbons.emit(pc.rb, pc.p, 0.9 * Math.min(1, pc.size + 0.3), 0.25 + pc.size * 0.25, pc.heat, 0.5, STYLE.DEBRIS, 0);
          else { pc.rb.release(ctx.time.now); pc.rb = null; }
        } else if (sp > 6 && pc.t < 8) {
          pc.acc.v += (burning ? 16 : 5) * dt * q;
          while (pc.acc.v >= 1) {
            pc.acc.v -= 1;
            const p = smoke.p;
            p.kind = KIND.SMOKE; p.life = 4 + rnd() * 4; p.size0 = 0.3 + pc.size * 0.4; p.size1 = 2.5 + pc.size * 3; p.drag = 1.4; p.buoy = 0.8;
            p.delay = rnd() * dt; const c = burning ? 0.06 + rnd() * 0.04 : 0.3 + rnd() * 0.1; p.r = c; p.g = c; p.b = c; p.opacity = burning ? 0.65 : 0.3; p.emissive = 0; p.aux = 0;
            smoke.spawn(v.copy(pc.p).addScaledVector(pc.v, -dt * rnd()), r.copy(pc.v).multiplyScalar(0.05));
          }
        }
        if (burning && pc.heat > 0.25) {
          pc.acc.f += 22 * dt * Math.max(0.5, q);
          while (pc.acc.f >= 1) {
            pc.acc.f -= 1;
            const f = ps.p;
            f.kind = KIND.FIRE; f.life = 0.3 + rnd() * 0.4; f.size0 = 0.3 + pc.size * 0.3; f.size1 = 1.2 + pc.size; f.drag = 2.5; f.buoy = 2;
            f.delay = 0; f.r = 0.15; f.g = 0.12; f.b = 0.1; f.opacity = 0.8; f.emissive = 25 + rnd() * 25; f.aux = 0;
            ps.spawn(v.copy(pc.p).addScaledVector(pc.v, -dt * rnd()), r.copy(pc.v).multiplyScalar(0.3));
          }
        }
      }
      sys.upload();
    },
    upload() {
      let n = 0;
      for (const pc of pieces) {
        if (!pc.alive) continue;
        ctx.world.toRender(pc.p, v);
        m4.compose(v, pc.q, pc.s);
        mesh.setMatrixAt(n, m4);
        mesh.setColorAt(n, pc.c);
        heatAttr.array[n] = pc.heat;
        n++;
      }
      mesh.count = n;
      mesh.visible = n > 0;
      if (n) { mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; heatAttr.needsUpdate = true; }
    },
    clear() { for (const pc of pieces) { pc.alive = false; pc.rb = null; } mesh.count = 0; mesh.visible = false; live = 0; },
    dispose() { ctx.scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); },
  };
  return sys;
}
