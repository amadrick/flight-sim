// Crash sequence orchestration: classify the impact, then drive the fireball volume (neural), debris, decals,
// ground effects (sparks, dust, ejecta, shock ring, spray column, wake), ground fire, embers, the fx light, and
// tell the camera / audio what happened ('crash:fx' event).
//
//   createCrashFx(ctx, { shared, header, anchor, ps, smoke }) -> { onCrash(e, player), onImpact(e), update(dt, player),
//       light(out), active(), warm(), clear(), dispose(), last }
//
// Debug / test URL params (headless screenshots): crashtest=<belly|collapse|breakup|impact|fireball|mountain|ditch|
//   water|airburst> spawns that crash at a point ahead of the camera (crashdist=<m>, default 260; crashat=<frame>,
//   default 3; crashside=1 makes it cross the view instead of running away from the camera; crashlat=<m> offsets it
//   to the right; crashrate=<x> sets the sim rate (ctx.time.timeScale) once the crash starts, so a 40 s shot does
//   not need 400 frames: main.js clamps a frame to 0.1 s; a water test sweeps around the camera for open water);
//   crashdive=1 pushes the stick forward until the aircraft hits the ground (a real physics crash).
import * as THREE from 'three';
import { classifyCrash, CRASH_TESTS } from './classify.js';
import { createFireballSystem } from '../explosion.js';
import { Decals, DECAL } from '../decals.js';
import { Debris, airframeColour } from '../debris.js';
import { KIND } from '../particles.js';
import { createFireGlow } from './glow.js';
import * as E from '../emitters.js';

const rnd = Math.random, sgn = () => rnd() * 2 - 1;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export function createCrashFx(ctx, deps) {
  const { shared, header, anchor, ps, smoke } = deps;
  const raw = ctx.params?.raw || {};
  const fireballs = createFireballSystem(ctx, shared, header, 2);
  const decals = new Decals(ctx, shared, header, anchor);
  const debris = new Debris(ctx);
  const glow = createFireGlow(ctx, shared, header);
  const g0 = {}, g1 = {};
  const v = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), n0 = new THREE.Vector3();
  const h0 = new THREE.Vector3(), h1 = new THREE.Vector3(), h2 = new THREE.Vector3();   // emitter-helper temporaries
  const fires = [];            // ground fires { pos, t, scale, life, acc, smokeAcc, emberAcc }
  let C = null;                // the current crash
  const q0 = () => clamp(ctx.quality?.particles ?? 1, 0.1, 1.5);

  // ------------------------------------------------------------------------------------------------ helpers
  function wind(pos, out) { return ctx.weather.windAt ? ctx.weather.windAt(pos, out) : out.copy(ctx.weather.wind || v3.set(0, 0, 0)); }

  function groundPoint(p, out) {
    ctx.world.groundAt(p.x, p.z, g0);
    let h = g0.height;
    if (g0.type === 'water') h = ctx.water?.heightAt?.(p.x, p.z) ?? h;
    return out.set(p.x, h, p.z);
  }

  function flash(pos, scale, I) {
    const p = ps.p;
    p.kind = KIND.GLOW; p.life = 0.3; p.size0 = 18 * scale; p.size1 = 40 * scale; p.drag = 1; p.buoy = 0; p.delay = 0;
    p.r = 1; p.g = 0.82; p.b = 0.55; p.opacity = 1; p.emissive = 300 * I; p.aux = 0;
    ps.spawn(pos, v3.set(0, 0, 0));
    p.life = 0.1; p.size0 = 45 * scale; p.size1 = 70 * scale; p.emissive = 120 * I; p.r = 1; p.g = 0.95; p.b = 0.85;
    ps.spawn(pos, v3);
  }

  function sparkBurst(pos, vel, n, speed) {
    const p = ps.p;
    for (let i = 0; i < n; i++) {
      v.set(sgn(), rnd() * 0.9 + 0.1, sgn()).normalize();
      p.kind = KIND.SPARK; p.life = 0.8 + rnd() * 2.2; p.size0 = p.size1 = 0.1 + rnd() * 0.16; p.drag = 0.3; p.buoy = -14;
      p.delay = rnd() * 0.08; p.r = 1; p.g = 0.55 + rnd() * 0.3; p.b = 0.2; p.opacity = 1; p.emissive = 40 + rnd() * 70; p.aux = 0.04;
      ps.spawn(pos, v2.copy(v).multiplyScalar(speed * (0.3 + rnd())).addScaledVector(vel, 0.3));
    }
  }

  // belly / wreck slide on pavement: a rooster tail of sparks (white-hot titanium/steel, orange aluminium), much
  // denser and longer-lived than the touchdown sparks, and visible as streaks well behind the airframe
  function slideSparks(pos, vel, rate, dt, q, acc) {
    acc.v += rate * dt * q;
    const p = ps.p;
    while (acc.v >= 1) {
      acc.v -= 1;
      const hot = rnd() < 0.35;
      p.kind = KIND.SPARK; p.life = 0.35 + rnd() * (hot ? 1.1 : 0.7); p.size0 = p.size1 = (hot ? 0.1 : 0.07) + rnd() * 0.12; p.drag = 0.45; p.buoy = -12;
      p.delay = rnd() * dt; p.r = 1; p.g = hot ? 0.85 + rnd() * 0.15 : 0.5 + rnd() * 0.25; p.b = hot ? 0.6 : 0.18; p.opacity = 1; p.emissive = (hot ? 90 : 45) + rnd() * 80; p.aux = 0.05;
      h1.copy(vel).multiplyScalar(0.45 + rnd() * 0.45); h1.x += sgn() * 7; h1.z += sgn() * 7; h1.y = 1 + rnd() * 7;
      ps.spawn(h0.set(pos.x + sgn() * 1.2, pos.y, pos.z + sgn() * 1.2), h1);
    }
  }

  // light-grey abrasion smoke and runway dust kicked up behind a scraping airframe; long-lived, it drifts downwind
  function scrapeSmoke(pos, vel, rate, dt, q, acc, colour, op) {
    acc.v += rate * dt * q;
    const sp = smoke.p;
    while (acc.v >= 1) {
      acc.v -= 1;
      sp.kind = KIND.SMOKE; sp.life = 7 + rnd() * 8; sp.size0 = 1.2 + rnd() * 1.5; sp.size1 = 9 + rnd() * 9; sp.drag = 1.4; sp.buoy = 0.7;
      sp.delay = rnd() * dt; const c = 0.9 + rnd() * 0.15; sp.r = colour[0] * c; sp.g = colour[1] * c; sp.b = colour[2] * c; sp.opacity = op * (0.7 + 0.5 * rnd()); sp.emissive = 0; sp.aux = 0;
      smoke.spawn(h0.set(pos.x + sgn() * 2, pos.y + 0.6, pos.z + sgn() * 2), h1.copy(vel).multiplyScalar(0.3 + 0.2 * rnd()).add(h2.set(sgn() * 2, 1 + rnd() * 2, sgn() * 2)));
    }
  }

  // dirt clods (dark, ballistic) + dust ejecta curtain
  function ejecta(pos, vel, scale, n, colour) {
    const p = ps.p, sp = smoke.p;
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, up = 0.5 + rnd() * 1.2;
      v.set(Math.cos(a), up, Math.sin(a)).normalize();
      p.kind = KIND.SMOKE; p.life = 1.5 + rnd() * 2.5; p.size0 = 0.3 + rnd() * 0.5; p.size1 = 0.6 + rnd() * 0.9; p.drag = 0.15; p.buoy = -9.8;
      p.delay = rnd() * 0.05; const c = 0.6 + rnd() * 0.3; p.r = colour[0] * c * 0.5; p.g = colour[1] * c * 0.5; p.b = colour[2] * c * 0.5; p.opacity = 0.95; p.emissive = 0; p.aux = 0;
      ps.spawn(pos, v2.copy(v).multiplyScalar((12 + rnd() * 30) * Math.sqrt(scale)).addScaledVector(vel, 0.25));
    }
    for (let i = 0; i < n * 0.5; i++) {
      const a = rnd() * Math.PI * 2;
      v.set(Math.cos(a), 0.4 + rnd() * 0.9, Math.sin(a)).normalize();
      sp.kind = KIND.SMOKE; sp.life = 10 + rnd() * 10; sp.size0 = 2 * scale; sp.size1 = (10 + rnd() * 10) * scale; sp.drag = 1.1; sp.buoy = 0.6;
      sp.delay = rnd() * 0.3; const c = 0.85 + rnd() * 0.2; sp.r = colour[0] * c; sp.g = colour[1] * c; sp.b = colour[2] * c; sp.opacity = 0.5; sp.emissive = 0; sp.aux = 0;
      smoke.spawn(v3.copy(pos).addScaledVector(v, 2 * scale), v2.copy(v).multiplyScalar(6 + rnd() * 14).addScaledVector(vel, 0.1));
    }
  }

  // ground-hugging shock / dust ring
  function dustRing(pos, scale, colour, speed) {
    const sp = smoke.p, n = Math.round(64 * clamp(q0(), 0.5, 1));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.1;
      sp.kind = KIND.SMOKE; sp.life = 6 + rnd() * 6; sp.size0 = 2 * scale; sp.size1 = (9 + rnd() * 8) * scale; sp.drag = 1.3; sp.buoy = 0.3;
      sp.delay = 0.05 + rnd() * 0.1; const c = 0.9 + rnd() * 0.15; sp.r = colour[0] * c; sp.g = colour[1] * c; sp.b = colour[2] * c; sp.opacity = 0.42; sp.emissive = 0; sp.aux = 0;
      smoke.spawn(v3.set(pos.x + Math.cos(a) * 3, pos.y + 1, pos.z + Math.sin(a) * 3), v2.set(Math.cos(a), 0.06, Math.sin(a)).multiplyScalar(speed * (0.85 + 0.3 * rnd())));
    }
  }

  // spray column + ring for water impacts
  function sprayColumn(pos, vel, scale, height) {
    const p = ps.p, n = Math.round(320 * clamp(q0(), 0.5, 1));
    const vUp = Math.sqrt(2 * 9.81 * height);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, r = rnd() ** 0.5;
      const col = rnd() < 0.6;
      p.kind = KIND.VAPOR; p.life = col ? 2.5 + rnd() * 3 : 1.5 + rnd() * 2; p.size0 = (col ? 4 : 2.5) * scale; p.size1 = (col ? 22 + rnd() * 18 : 10 + rnd() * 10) * scale;
      p.drag = col ? 0.25 : 0.6; p.buoy = -9.8 * (col ? 0.8 : 1); p.delay = rnd() * 0.12;
      p.r = 0.96; p.g = 0.97; p.b = 1; p.opacity = col ? 0.8 : 0.6; p.emissive = 0; p.aux = 0;
      if (col) v2.set(Math.cos(a) * r * 9, vUp * (0.55 + 0.45 * rnd()), Math.sin(a) * r * 6).addScaledVector(vel, 0.12);
      else v2.set(Math.cos(a) * (14 + rnd() * 18), 4 + rnd() * 10, Math.sin(a) * (14 + rnd() * 18)).addScaledVector(vel, 0.2);
      ps.spawn(v3.copy(pos).setY(pos.y + 0.5), v2);
    }
    // lingering mist
    const sp = smoke.p;
    for (let i = 0; i < 30 * q0(); i++) {
      sp.kind = KIND.VAPOR; sp.life = 8 + rnd() * 6; sp.size0 = 10 * scale; sp.size1 = (34 + rnd() * 20) * scale; sp.drag = 1; sp.buoy = 0.4;
      sp.delay = 0.4 + rnd() * 1.2; sp.r = 0.92; sp.g = 0.94; sp.b = 0.97; sp.opacity = 0.35; sp.emissive = 0; sp.aux = 0;
      smoke.spawn(v3.set(pos.x + sgn() * 8, pos.y + rnd() * height * 0.6, pos.z + sgn() * 8), v2.set(sgn() * 3, 1 + rnd(), sgn() * 3));
    }
  }

  function addFire(pos, scale, life, volume) {
    fires.push({ pos: pos.clone(), t: 0, scale, life, acc: 0, smokeAcc: 0, emberAcc: 0, volume });
  }

  // continuous ground fire: flames, black smoke (fewer while the volume carries the column), embers (night)
  function updateFire(f, dt, q) {
    f.t += dt;
    const life = clamp(1 - f.t / f.life, 0, 1);
    if (life <= 0 && f.t > f.life + 90) return false;
    const night = ctx.env.nightFactor || 0;
    const p = ps.p, sp = smoke.p;
    f.acc += (life > 0 ? 18 * f.scale * (0.6 + 0.4 * life) : 0) * dt * q;
    while (f.acc >= 1) {
      f.acc -= 1;
      p.kind = KIND.FIRE; p.life = 1.0 + rnd() * 1.4; p.size0 = (1.2 + rnd() * 1.8) * f.scale; p.size1 = (4 + rnd() * 5) * f.scale;
      p.drag = 2; p.buoy = 5 + rnd() * 4; p.delay = 0; p.r = 0.11; p.g = 0.09; p.b = 0.08; p.opacity = 0.8; p.emissive = 20 + rnd() * 22; p.aux = 0;
      const r = 6 * f.scale * Math.sqrt(rnd()), a = rnd() * 6.283;
      ps.spawn(v3.set(f.pos.x + Math.cos(a) * r, f.pos.y + 0.4, f.pos.z + Math.sin(a) * r), v2.set(sgn() * 1.5, 1 + rnd() * 2, sgn() * 1.5));
    }
    const volK = f.volume && fireballs.active() && f.t < 50 ? 0.35 : 1;
    const smokeRate = (f.t < f.life ? 3.5 : Math.max(0, 3.5 * (1 - (f.t - f.life) / 90))) * Math.max(0.6, f.scale) * volK;
    f.smokeAcc += smokeRate * dt * q;
    while (f.smokeAcc >= 1) {
      f.smokeAcc -= 1;
      sp.kind = KIND.SMOKE; sp.life = 26 + rnd() * 16; sp.size0 = (4 + rnd() * 3) * f.scale; sp.size1 = (30 + rnd() * 26) * f.scale;
      sp.drag = 0.6; sp.buoy = 6 + rnd() * 3; sp.delay = 0; const c = 0.035 + rnd() * 0.04 + Math.min(0.12, f.t / 900);
      sp.r = c; sp.g = c; sp.b = c * 1.04; sp.opacity = 0.82; sp.emissive = 0; sp.aux = 0;
      smoke.spawn(v3.set(f.pos.x + sgn() * 3 * f.scale, f.pos.y + 3, f.pos.z + sgn() * 3 * f.scale), v2.set(sgn() * 1.5, 2 + rnd() * 2, sgn() * 1.5));
    }
    // embers: always a few, many more at night where they read
    f.emberAcc += (life > 0 ? (6 + 30 * night) * f.scale * life : 0) * dt * q;
    while (f.emberAcc >= 1) {
      f.emberAcc -= 1;
      p.kind = KIND.SPARK; p.life = 2.5 + rnd() * 4; p.size0 = p.size1 = 0.05 + rnd() * 0.07; p.drag = 0.9; p.buoy = 2.5 + rnd() * 3;
      p.delay = 0; p.r = 1; p.g = 0.45 + rnd() * 0.25; p.b = 0.12; p.opacity = 1; p.emissive = 25 + rnd() * 40; p.aux = 0.02;
      const r = 5 * f.scale * Math.sqrt(rnd()), a = rnd() * 6.283;
      ps.spawn(v3.set(f.pos.x + Math.cos(a) * r, f.pos.y + 1 + rnd() * 3, f.pos.z + Math.sin(a) * r), v2.set(sgn() * 3, 3 + rnd() * 6, sgn() * 3));
    }
    return true;
  }

  // ------------------------------------------------------------------------------------------------ crash entry
  function inputFrom(state, def, reason, ground, normal, agl) {
    const g = def?.geometry || {};
    return {
      reason, speed: state.velocity.length(), vel: state.velocity, pitch: state.pitch || 0, roll: state.roll || 0,
      gear: state.surfaces?.gear ?? 1, fuel: state.fuel ?? undefined, mass: state.mass || undefined,
      surface: ground.type, slope: Math.acos(clamp(normal.y, -1, 1)), normal, agl,
      length: g.length || 15, span: g.span || 10,
    };
  }

  /**
   * Start the crash sequence. e = crash event payload; state = aircraft state at impact (real or synthetic);
   * player = { def, visual } (optional parts).
   */
  function start(e, state, player, override) {
    clear(false);
    const def = player?.def || { geometry: {} };
    const pos = state.position;
    ctx.world.groundAt(pos.x, pos.z, g1);
    const gtype = g1.type;
    if (ctx.world.groundNormalAt) ctx.world.groundNormalAt(pos.x, pos.z, n0); else n0.set(0, 1, 0);
    const gp = groundPoint(pos, new THREE.Vector3());
    const agl = pos.y - gp.y;
    const input = { ...inputFrom(state, def, e.reason || '', g1, n0, agl), ...(override || {}) };
    if (override?.surface === 'terrain' && override.slope) input.slope = override.slope;
    const o = classifyCrash(input);
    const scale = clamp((def.geometry?.length || 15) / 15, 0.6, 3);
    const vel = state.velocity.clone();
    const w = wind(pos, new THREE.Vector3()); w.y = 0;
    const ws = w.length();
    const vh = v.set(vel.x, 0, vel.z);
    const windDir = ws > 2 ? w.clone().normalize() : (vh.lengthSq() > 1 ? vh.clone().normalize() : new THREE.Vector3(1, 0, 0));
    const sq = Math.sqrt(9.81 * o.D);
    const fw = ws / sq, ui = clamp(0.4 * Math.abs(vh.dot(windDir)) / sq, 0, 2.5);
    C = { o, t: 0, pos: gp.clone(), vel, scale, def, player, state, lastSlide: gp.clone(), slideAcc: { v: 0 }, sparkAcc: { v: 0 }, dustAcc: { v: 0 }, smokeAcc: { v: 0 },
          sprayAcc: { v: 0 }, yaw: Math.atan2(vel.x, -vel.z), secondary: false, fireAtRest: o.kind === 'gearCollapse' && o.fire, restDone: false,
          windDir, fw, ui, synthetic: !!override };
    const colour = airframeColour(player?.visual?.object3D);
    const dirt = o.surface === 'mountain' ? [0.42, 0.4, 0.37] : o.surface === 'runway' ? [0.5, 0.49, 0.47] : [0.45, 0.38, 0.28];
    const hide = o.breakup >= 0.6;
    if (hide && player?.visual?.object3D && !override) { player.visual.object3D.visible = false; C.hidVisual = player.visual.object3D; }
    const q = q0();
    switch (o.kind) {
      case 'impact': case 'breakup': {
        const big = o.kind === 'impact';
        const fp = gp.clone(); fp.y += 0.5;
        flash(v3.copy(fp).setY(fp.y + 4), big ? scale * 1.4 : scale, big ? 1 : 0.6);
        sparkBurst(fp, vel, Math.round((big ? 160 : 70) * Math.max(0.5, q)), big ? 45 : 25);
        if (o.surface !== 'water') ejecta(fp, vel, big ? scale * 1.5 : scale, Math.round((big ? 90 : 40) * Math.max(0.5, q)), dirt);
        if (big) dustRing(fp, scale, dirt, 45);
        debris.spawn({ state, def, colour, severity: big ? 1 : 0.6, kind: o.kind, water: false, q, fire: o.fire });
        if (o.fire) fireballs.spawn({ worldPos: gp, D: o.D, tStar: o.tStar, windDir, fw, ui, life: 150 });
        decals.add(gp, C.yaw, o.D * 0.42, o.D * 0.36, DECAL.SCORCH, 0.95);
        if (o.fire) decals.add(gp, 0, Math.max(400, o.D * 8), Math.max(400, o.D * 8), DECAL.FIRELIGHT, 1, 240, 120);
        if (o.crater > 0) decals.add(gp, C.yaw + 0.4, o.crater, o.crater * 0.9, DECAL.CRATER, 1);
        if (o.fire) { const dh = new THREE.Vector3(vel.x, 0, vel.z); if (dh.lengthSq() > 1e-6) dh.normalize(); addFire(dh.multiplyScalar(Math.min(o.slide, 30) * 0.5).add(gp), scale * (big ? 1.3 : 1), big ? 75 : 55, true); }
        break;
      }
      case 'airburst': {
        flash(pos, scale * 1.5, 1);
        sparkBurst(pos, vel, Math.round(150 * Math.max(0.5, q)), 50);
        debris.spawn({ state, def, colour, severity: 1, kind: o.kind, water: false, q, fire: true });
        const dr = vel.clone().multiplyScalar(0.12).add(w);
        fireballs.spawn({ worldPos: pos.clone(), D: o.D, tStar: o.tStar, windDir, fw, ui: 0.3, mirror: true, drift: dr, life: 60 });
        break;
      }
      case 'waterImpact': {
        sprayColumn(gp, vel, scale, clamp(o.vn * 1.2 + o.speed * 0.25, 20, 90));
        debris.spawn({ state, def, colour, severity: 0.9, kind: o.kind, water: true, q, fire: false });
        decals.add(gp, C.yaw, 40 * scale, 30 * scale, DECAL.FOAM, 1, 90);
        break;
      }
      case 'ditch': {
        E.splash(ps, gp, vel, scale * 0.7, q);
        break;
      }
      case 'gearCollapse': case 'belly': {
        // first contact: a burst of sparks / dirt, a puff of scraped metal and dust, panels torn off the belly
        if (o.sparks) sparkBurst(v3.copy(gp).setY(gp.y + 0.3), vel, Math.round(140 * Math.max(0.5, q)), 18);
        if (o.dust) ejecta(gp, vel, scale * 0.6, 30, dirt);
        scrapeSmoke(gp, vel, 40, 1, Math.max(0.5, q), { v: 0 }, o.surface === 'runway' ? [0.66, 0.66, 0.68] : dirt, 0.45);
        debris.clear();
        debris.shed({ state, def, colour, n: Math.round(4 * Math.max(0.5, q)) });
        break;
      }
    }
    ctx.events.emit('crash:fx', { kind: o.kind, label: o.label, worldPos: (o.kind === 'airburst' ? pos : gp).clone(), energy: o.energy, D: o.D, fire: o.fire, water: o.water, surface: o.surface, synthetic: !!override });
    return o;
  }

  // the wreck (still the player's state) slides: scrape / turf / foam decals, sparks, dust, spray
  function updateSlide(dt, s) {
    if (!C || C.synthetic) return;
    const o = C.o;
    const p = s.position, sp = Math.hypot(s.velocity.x, s.velocity.z);
    if (s.onGround === false && o.kind !== 'ditch') return;
    const gp = groundPoint(p, v);
    const onWater = g0.type === 'water';
    const near = p.y - gp.y < 3 + (C.def.geometry?.cgHeight || 1.5);
    if (!near) return;
    const q = q0();
    if (sp > 1.5) {
      const d = C.lastSlide.distanceTo(gp);
      if (d > 3) {
        const mid = v2.copy(C.lastSlide).add(gp).multiplyScalar(0.5);
        const yaw = Math.atan2(gp.x - C.lastSlide.x, -(gp.z - C.lastSlide.z));
        const wd = (C.def.geometry?.length || 15) * 0.045 + 0.6;
        const paved = g0.type === 'runway' || g0.type === 'taxiway' || g0.type === 'apron' || g0.type === 'deck';
        if (onWater) decals.add(mid, yaw, d * 0.6 + 2, wd * 3, DECAL.FOAM, 0.8, 40);
        else if (paved) {
          decals.add(mid, yaw, d * 0.55 + 0.5, wd, DECAL.SCRAPE, 0.9);
          if (o.kind === 'gearCollapse') { // wingtip / nacelle scrape lines
            const sp2 = (C.def.geometry?.span || 10) * 0.42, c = Math.cos(yaw), si = Math.sin(yaw);
            decals.add(v3.set(mid.x + c * sp2, mid.y, mid.z + si * sp2), yaw, d * 0.55 + 0.5, 0.35, DECAL.SCRAPE, 0.6);
            decals.add(v3.set(mid.x - c * sp2, mid.y, mid.z - si * sp2), yaw, d * 0.55 + 0.5, 0.35, DECAL.SCRAPE, 0.6);
          }
        } else decals.add(mid, yaw, d * 0.55 + 0.5, wd * 1.3, DECAL.TURF, 0.95);
        C.lastSlide.copy(gp);
      }
      const paved = g0.type === 'runway' || g0.type === 'taxiway' || g0.type === 'apron' || g0.type === 'deck';
      if (onWater) E.waterSpray(ps, v3.copy(gp).setY(gp.y + 0.3), s.velocity, v2.set(-s.velocity.x, 0, -s.velocity.z).normalize(), clamp(sp / 40, 0.2, 1.3), dt, q, C.sprayAcc);
      else if (paved) {
        const k = o.kind === 'belly' || o.kind === 'gearCollapse' ? 1 : 0.6;
        slideSparks(v3.copy(gp).setY(gp.y + 0.25), s.velocity, (150 + sp * 7) * k, dt, q, C.sparkAcc);
        E.dust(ps, v3.copy(gp).setY(gp.y + 0.5), v2.copy(s.velocity).multiplyScalar(0.25), sp * 0.8, dt, q, C.dustAcc, [0.62, 0.62, 0.64], 1.2);
        scrapeSmoke(gp, s.velocity, clamp(sp / 70, 0.15, 1.2) * 40 * k, dt, q, C.smokeAcc, [0.52, 0.52, 0.54], 0.6);
      } else {
        E.dust(ps, v3.copy(gp).setY(gp.y + 0.5), v2.copy(s.velocity).multiplyScalar(0.3), sp * 1.4, dt, q, C.dustAcc, [0.47, 0.4, 0.3], 1.3);
        scrapeSmoke(gp, s.velocity, clamp(sp / 60, 0.15, 1.3) * 26, dt, q, C.smokeAcc, [0.5, 0.43, 0.33], 0.5);
      }
    } else if (!C.restDone) {
      C.restDone = true;
      if (C.fireAtRest) {
        const D = clamp(o.D * 0.6, 10, 40);
        fireballs.spawn({ worldPos: gp.clone(), D, tStar: Math.sqrt(D / 9.81), windDir: C.windDir, fw: C.fw * Math.sqrt(o.D / D), ui: 0, life: 110 });
        decals.add(gp, C.yaw, D * 0.4, D * 0.35, DECAL.SCORCH, 0.9);
        decals.add(gp, 0, 300, 300, DECAL.FIRELIGHT, 1, 200, 80);
        addFire(gp, C.scale * 0.8, 60, true);
      }
      if (onWater) decals.add(gp, C.yaw, 18 * C.scale, 14 * C.scale, DECAL.FOAM, 0.9, 60);
    }
  }

  function onImpact() {
    // wreck from an in-flight breakup reaches the ground: secondary fire + scorch where it lands
    if (!C || C.secondary || C.o.kind !== 'airburst') return;
    C.secondary = true;
    const s = C.player?.state || C.state;
    const gp = groundPoint(s.position, new THREE.Vector3());
    if (g0.type === 'water') { sprayColumn(gp, s.velocity, C.scale, 30); return; }
    flash(v3.copy(gp).setY(gp.y + 3), C.scale, 0.5);
    ejecta(gp, s.velocity, C.scale, 40, [0.45, 0.38, 0.28]);
    const D = clamp(C.o.D * 0.5, 12, 45);
    fireballs.spawn({ worldPos: gp, D, tStar: Math.sqrt(D / 9.81), windDir: C.windDir, fw: C.fw, ui: 0.5, life: 120 });
    decals.add(gp, 0, D * 0.45, D * 0.4, DECAL.SCORCH, 0.9);
    decals.add(gp, 0.7, D * 0.12 + 2, D * 0.11 + 2, DECAL.CRATER, 1);
    decals.add(gp, 0, 300, 300, DECAL.FIRELIGHT, 1, 200, 80);
    addFire(gp, C.scale, 60, true);
    ctx.events.emit('crash:fx', { kind: 'secondary', worldPos: gp.clone(), energy: C.o.energy * 0.3, D, fire: true, water: false, surface: 'grass' });
  }

  // ------------------------------------------------------------------------------------------------ test harness
  let frameN = 0, testDone = false;
  function crashTest(player) {
    const type = raw.crashtest;
    const T = CRASH_TESTS[type];
    if (!T) return;
    const cam = ctx.camera;
    const camW = ctx.world.toWorld(cam.getWorldPosition(v), new THREE.Vector3());
    const fwd = v2.set(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion())); fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const dist = +raw.crashdist || 260;
    const p = camW.clone().addScaledVector(fwd, dist);
    if (raw.crashlat) p.add(v3.set(-fwd.z, 0, fwd.x).multiplyScalar(+raw.crashlat));
    let gp = groundPoint(p, new THREE.Vector3());
    // water tests: if the aim point is dry, sweep around the camera for open water (nearest ring first)
    if (T.surface === 'water' && g0.type !== 'water') {
      search: for (let r = dist; r <= dist * 6; r += dist * 0.5) {
        for (let a = 0; a < 24; a++) {
          const an = Math.atan2(fwd.x, -fwd.z) + (a % 2 ? -1 : 1) * Math.ceil(a / 2) * Math.PI / 12;
          const q = v.set(camW.x + Math.sin(an) * r, 0, camW.z - Math.cos(an) * r);
          ctx.world.groundAt(q.x, q.z, g0);
          if (g0.type === 'water') { fwd.set(Math.sin(an), 0, -Math.cos(an)); gp = groundPoint(q, new THREE.Vector3()); break search; }
        }
      }
    }
    // velocity: test vector expressed with -Z = "away from the camera" (or across the view with crashside=1)
    const yaw = Math.atan2(fwd.x, -fwd.z) + (raw.crashside === '1' ? Math.PI / 2 : 0);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const vel = new THREE.Vector3(s * -T.vel.z, T.vel.y, -c * -T.vel.z);
    const agl = T.agl || 0;
    const position = gp.clone(); position.y += agl + (player?.def?.geometry?.cgHeight || 1.5);
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
    const state = { position, velocity: vel, quaternion: quat, pitch: 0, roll: T.roll || 0, fuel: T.fuel, mass: 12000, surfaces: { gear: T.gear }, onGround: true };
    const ov = { surface: T.surface === 'terrain' || T.surface === 'grass' ? 'terrain' : T.surface, slope: T.slope || 0, gear: T.gear, fuel: T.fuel, reason: T.reason, agl };
    if (T.surface === 'grass') ov.slope = 0;
    start({ reason: T.reason }, state, player, ov);
    C.synthetic = true;
    // slides (belly, gear collapse, ditching): move a copy of the airframe along the ground so the scrape, sparks,
    // spray and decals can be checked without flying a real approach
    if (C.o.breakup < 0.6 && player?.visual?.object3D) {
      const ghost = player.visual.object3D.clone(true);
      ghost.visible = true; ctx.scene.add(ghost);
      // gear-up slide: no legs under it; it lies on its belly with a slight list and the nose down
      if (C.o.kind === 'belly' || C.o.kind === 'ditch') ghost.traverse((ob) => { if (/\.leg$|wheel|tyre/i.test(ob.name)) ob.visible = false; });
      quat.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.05, 0.02, 0.1)));
      C.fake = { position: state.position.clone(), velocity: state.velocity.clone(), quaternion: quat, onGround: true, ghost, mu: C.o.surface === 'water' ? 0.9 : C.o.surface === 'runway' ? 0.33 : 0.6 };
      C.fake.position.y = gp.y + (C.o.surface === 'water' ? 0.2 : 0.4);
    }
    // spectator shots: the (intact, parked) player aircraft is not part of the scene being looked at
    if (raw.fxcam === 'crash' && player?.visual?.object3D) { player.visual.object3D.visible = false; C.hidVisual = player.visual.object3D; }
  }

  // ------------------------------------------------------------------------------------------------ API
  function clear(all = true) {
    if (C?.hidVisual) C.hidVisual.visible = true;
    if (C?.fake?.ghost) ctx.scene.remove(C.fake.ghost);
    C = null;
    glow.hide();
    if (all) { fireballs.clear(); decals.clear(); debris.clear(); fires.length = 0; }
    else { fireballs.clear(); debris.clear(); fires.length = 0; decals.clear(); }
  }

  const api = {
    get last() { return C?.o || null; },
    fireballs, decals, debris,
    onCrash(e, player) { return start(e || {}, player.state, player, null); },
    onImpact,
    update(dt, player) {
      frameN++;
      const s = player?.state;
      if (raw.crashtest && !testDone && frameN >= (+raw.crashat || 3)) { testDone = true; crashTest(player); if (+raw.crashrate > 0) ctx.time.timeScale = +raw.crashrate; }
      if (raw.crashdive === '1' && s && !s.crashed) { ctx.controls.pitch = -0.6; ctx.controls.throttle = 1; }
      if (C) {
        C.t += dt;
        if (s && s.crashed && player === C.player) updateSlide(dt, s);
        if (C.fake) {
          const F = C.fake, sp = Math.hypot(F.velocity.x, F.velocity.z);
          const k = sp > 0.1 ? Math.max(0, sp - F.mu * 9.81 * dt) / sp : 0;
          F.velocity.multiplyScalar(k); F.velocity.y = 0;
          F.position.addScaledVector(F.velocity, dt);
          ctx.world.toRender(F.position, F.ghost.position); F.ghost.quaternion.copy(F.quaternion);
          const was = C.synthetic; C.synthetic = false; updateSlide(dt, F); C.synthetic = was;
        }
      }
      const q = q0();
      for (let i = fires.length - 1; i >= 0; i--) if (!updateFire(fires[i], dt, q)) fires.splice(i, 1);
      debris.update(dt, ps, smoke, q);
      fireballs.update(dt);
    },
    /** fx light request: { pos (render), color, intensity, distance } or null */
    light(out) {
      const l = fireballs.light(out);
      let fire = null, fi = 0;
      for (const f of fires) { const k = clamp(1 - f.t / f.life, 0, 1) * f.scale; if (k > fi) { fi = k; fire = f; } }
      // pool fire: ~20-30 m of burning kerosene radiates tens of MW; visible share ~2e4 scene units per unit scale
      const If = fire ? 20000 * fi * (0.8 + 0.3 * rnd()) : 0;
      let r = null;
      if (l && l.intensity > If) { out.intensity *= 0.9 + 0.2 * rnd(); r = out; }
      else if (fire && If > 1) { ctx.world.toRender(fire.pos, out.pos); out.pos.y += 4; out.color.setRGB(1, 0.5, 0.2); out.intensity = If; out.distance = 1000; r = out; }
      if (raw.fxglow === '0') glow.hide(); else glow.set(r, r === out && l ? Math.max(6, (fireballs.pool.find((f) => f.active)?.D || 40) * 0.3) : 8);
      return r;
    },
    /** debug spectator camera (fxcam=crash): a fixed vantage point beside the crash, looking at the wreck / fire.
     *  Writes WORLD positions; false until a crash has happened. fxdist=<m> distance, fxcamh=<m> height,
     *  fxcamk=<m> offset along the crash heading. */
    spectator(camOut, lookOut) {
      if (!C) return false;
      if (!C.spec) {
        const u = v3.set(C.vel.x, 0, C.vel.z); if (u.lengthSq() < 1e-6) u.set(0, 0, -1); u.normalize();
        const slide = C.o.kind === 'belly' || C.o.kind === 'gearCollapse' || C.o.kind === 'ditch';
        const dist = +raw.fxdist || (slide ? 60 : C.o.fire ? 2.4 * C.o.D + 90 : 150);
        const along = raw.fxcamk !== undefined ? +raw.fxcamk : slide ? 70 : C.o.fire ? 0.3 * C.o.D : 30;
        const h = +raw.fxcamh || (slide ? 5 : 14);
        const cam = C.pos.clone().addScaledVector(u, along).add(new THREE.Vector3(-u.z, 0, u.x).multiplyScalar(dist));
        ctx.world.groundAt(cam.x, cam.z, g0); cam.y = Math.max(cam.y, g0.height) + h;
        C.spec = { cam, u: u.clone(), slide };
      }
      camOut.copy(C.spec.cam);
      if (C.spec.slide && C.fake) lookOut.copy(C.fake.position).lerp(C.pos, 0.12);
      else lookOut.copy(C.pos).setY(C.pos.y + (C.o.fire ? C.o.D * 0.45 : 8)).addScaledVector(C.spec.u, C.o.fire ? C.o.D * 0.3 : 10);
      return true;
    },
    active() { const a = !!C || fires.length > 0 || fireballs.active(); if (!a) glow.hide(); return a; },
    warm() {
      // fireball programs + one bake, and the decal program (debris uses the scene's standard material programs)
      const t0 = performance.now();
      fireballs.warm();
      const vis = decals.mesh.visible; decals.mesh.visible = true;
      try { ctx.renderer.compile(decals.mesh, ctx.camera); } catch { /* optimisation only */ }
      decals.mesh.visible = vis;
      return performance.now() - t0;
    },
    clear,
    dispose() { clear(); fireballs.dispose(); decals.dispose(); debris.dispose(); glow.dispose(); },
  };
  if (ctx.params?.test && typeof window !== 'undefined') window.__crashfx = api;   // headless debugging hook
  return api;
}
