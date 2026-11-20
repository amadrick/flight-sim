// COMBAT EFFECTS — tracers, muzzle flashes, hits, missiles (bodies, motor flames, smoke trails), flares, warhead
// detonations, battle-damage smoke and fire, kill fireballs and debris, burning falling wrecks and their ground impact,
// AI aircraft afterburners / contrails / wingtip vapour / night lights, far-aircraft glints.
// API (COMBAT.md §10): createCombatFx(combat) -> { update(dt) }  (+ additive extras documented in README.md).
//
// Systems (each ONE draw call, hidden when empty — nothing draws or uploads while no mission runs):
//   sprites   emissive / impostor batch: tracers, muzzle flashes, motor + afterburner + fire flames, flares, lights, dots
//   ribbons   pooled volumetric tube trails: missile smoke, damage / wreck smoke, flare smoke, debris trails, contrails,
//             wingtip vapour (ribbons.js, ribbon-pool.js)
//   ps        short-lived GPU particles (sparks, flame licks, flashes, hit puffs) — effects/particles.js
//   smoke     long-lived GPU particles (explosion smoke, smoke columns)
//   missiles  instanced lit missile bodies       debris   instanced lit tumbling fragments
//   fireballs neural volumetric fireball (effects/explosion.js) — ≤ 3 boxes while a kill / impact fireball lives
// World-space history is anchored (effects/anchor.js) so it survives 'originShift'.
import * as THREE from 'three';
import { ParticleSystem } from '../../effects/particles.js';
import * as E from '../../effects/emitters.js';
import { createFireballSystem } from '../../effects/explosion.js';
import { airframeColour } from '../../effects/debris.js';
import { createFxShared } from './shared.js';
import { createRibbons, STYLE } from './ribbons.js';
import { createSprites, SPR } from './sprites.js';
import { createMissileMesh } from './meshes.js';
import { createDebris } from './debris.js';
import * as R from './recipes.js';
import { gunPort } from '../weapons/specs.js';

const GUN_SCALE = { m61: 1, gau22: 1.3, gau8: 2 };

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const rnd = Math.random;
const FWD = new THREE.Vector3(0, 0, -1);
const DUST = [0.55, 0.48, 0.38];

export async function createCombatFx(combat) {
  const ctx = combat.ctx, W = combat.weapons, world = combat.world;
  const raw = ctx.params?.raw || {};
  const S = createFxShared(ctx);
  // our own fire light (independent of the simulator effects' light even when the uniform block is shared)
  const light = { uFxLightPos: { value: new THREE.Vector3() }, uFxLightColor: { value: new THREE.Color(0, 0, 0) } };
  const U = { ...S.uniforms, ...light };
  const q0 = () => clamp(ctx.quality?.particles ?? 1, 0.1, 1.5);

  const ps = new ParticleSystem(ctx, U, S.header, S.anchor, 6144, 'cfx-particles');
  const smoke = new ParticleSystem(ctx, U, S.header, S.anchor, 3072, 'cfx-smoke');
  ps.mesh.visible = smoke.mesh.visible = false;
  const ribbons = createRibbons(ctx, U, S.header, S.anchor);
  const sprites = createSprites(ctx, U, S.header, 2048);
  const missileMesh = createMissileMesh(ctx, 48);
  const debris = createDebris(ctx, ribbons, 128, sprites);
  let fireballs = null;
  try { fireballs = raw.cfxfb === '0' ? null : createFireballSystem(ctx, U, S.header, 3); } catch (err) { console.warn('[combat fx] neural fireball unavailable', err); fireballs = null; }
  let fbWarm = false;

  // ---- scratch (no per-frame allocations) ----
  const v = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), rp = new THREE.Vector3(), rp2 = new THREE.Vector3();
  const fwd = new THREE.Vector3(), back = new THREE.Vector3(), camW = new THREE.Vector3(), camVel = new THREE.Vector3(), wind = new THREE.Vector3();
  const m4 = new THREE.Matrix4(), sc3 = new THREE.Vector3(), gnd = {}, lightOut = { pos: new THREE.Vector3(), color: new THREE.Color(), intensity: 0, distance: 0 };
  const bestLight = { pos: new THREE.Vector3(), r: 0, g: 0, b: 0, I: 0, score: 0 };
  const muzzleV = new THREE.Vector3();

  // ---- per-entity records (allocated when an entity is first seen — a spawn event, not per frame) ----
  const acRecs = new Map(), misRecs = new Map(), flareRecs = new Map();
  let frame = 0;
  const groundFires = [];      // { t, pos, fireAcc, smokeAcc, scale }
  const flashes = [];          // light flashes { t, pos (world), I, r, g, b, life }
  for (let i = 0; i < 8; i++) flashes.push({ t: 1e9, pos: new THREE.Vector3(), I: 0, life: 0.5, r: 1, g: 0.6, b: 0.3 });
  let flashCursor = 0;
  let lastActive = -1e9;

  function lightFlash(pos, I, life, r = 1, g = 0.6, b = 0.3) {
    const f = flashes[flashCursor]; flashCursor = (flashCursor + 1) % flashes.length;
    f.t = 0; f.pos.copy(pos); f.I = I; f.life = life; f.r = r; f.g = g; f.b = b;
  }

  function engineList(def) {
    const g = def?.geometry || {};
    const ens = (g.engines && g.engines.length ? g.engines : [{ nozzle: [0, 0, g.tailZ ?? 6], nozzleRadius: 0.5 }]);
    return ens.map((en) => ({ nozzle: en.nozzle || [0, 0, g.tailZ ?? 6], r: en.nozzleRadius || 0.5 }));
  }
  function isAfterburning(def) {
    return /afterburn/i.test(def?.specs?.engineType || '') || (def?.specs?.thrustMax > (def?.specs?.thrustDry || Infinity) * 1.05) || !!def?.sound?.afterburner;
  }
  function acRec(e) {
    let r = acRecs.get(e);
    if (r) return r;
    const def = e.def || {}, g = def.geometry || {};
    const engines = engineList(def);
    let cx = 0, cy = 0, cz = 0;
    for (const en of engines) { cx += en.nozzle[0]; cy += en.nozzle[1]; cz += en.nozzle[2]; }
    cx /= engines.length; cy /= engines.length; cz /= engines.length;
    const spread = engines.reduce((m, en) => Math.max(m, Math.abs(en.nozzle[0] - cx)), 0);
    r = {
      e, engines, isAB: isAfterburning(def), centre: [cx, cy, cz + 0.6], spread,
      span: g.span || 10, length: g.length || 15, scale: clamp((g.length || 15) / 15, 0.6, 2.5),
      tips: (g.wingtips || []).slice(0, 2),
      lights: g.lights || null,
      contrail: ribbons.ribbon('long', STYLE.CONTRAIL, { spacingMin: 4, spacingMax: 60, maxDt: 0.4 }),
      tipR: [ribbons.ribbon('short', STYLE.WINGTIP, { spacingMin: 1.5, spacingMax: 12, maxDt: 0.06 }), ribbons.ribbon('short', STYLE.WINGTIP, { spacingMin: 1.5, spacingMax: 12, maxDt: 0.06 })],
      dmg: null, dmgStyle: -1, fireAcc: { v: 0 }, fireAcc2: { v: 0 }, gunAcc: { v: 0 }, seen: 0, seed: rnd(), bigGun: 1, port: gunPort(def), leakR: null, wingPt: [0, 0, 0],
      deadT: -1,
    };
    acRecs.set(e, r);
    return r;
  }
  function releaseAc(r) {
    const now = ctx.time.now;
    r.contrail.release(now); r.tipR[0].release(now); r.tipR[1].release(now);
    if (r.dmg) r.dmg.release(now);
    if (r.leakR) r.leakR.release(now);
  }

  function bodyPoint(s, b, out) { return out.set(b[0], b[1], b[2]).applyQuaternion(s.quaternion).add(s.position); }
  function humidity(alt, overWater) {
    const w = ctx.weather || {};
    let h = 0.18 + 0.55 * (w.cloudCoverage || 0) + 0.45 * (w.precipitation || 0);
    if (overWater) h += 0.15;
    h *= alt < 2500 ? 1 : Math.exp(-(alt - 2500) / 3000);
    return clamp(h, 0, 1);
  }
  function considerLight(px, py, pz, I, r, g, b) {
    // pick the light that matters most to the viewer: intensity over distance² from the camera
    const dx = px - camW.x, dy = py - camW.y, dz = pz - camW.z;
    const sc = I / (dx * dx + dy * dy + dz * dz + 400);
    if (sc > bestLight.score) { bestLight.score = sc; bestLight.pos.set(px, py, pz); bestLight.I = I; bestLight.r = r; bestLight.g = g; bestLight.b = b; }
  }

  // =============================================================================================== aircraft
  function updateAircraft(e, dt, q, night, isWreck) {
    const s = e.state; if (!s) return;
    const r = acRec(e); r.seen = frame;
    const alive = e.alive;
    const ai = !e.isPlayer;
    fwd.copy(FWD).applyQuaternion(s.quaternion);
    ctx.world.toRender(s.position, rp);
    const dCam = s.position.distanceTo(camW);
    const crashed = !!s.crashed || !alive;
    const onGround = !!s.onGround;
    const hidden = !!e.hidden;

    // ---------- engines: afterburner flame + glow, dry nozzle glow at night ----------
    if (ai && alive && !crashed && !hidden) {
      for (let i = 0; i < r.engines.length; i++) {
        const en = r.engines[i], st = s.engines?.[i];
        if (st && st.running === false) continue;
        const ab = r.isAB ? clamp(st?.afterburner ?? 0, 0, 1) : 0;
        bodyPoint(s, en.nozzle, v); ctx.world.toRender(v, rp2);
        if (ab > 0.02) {
          const L = en.r * (5 + 9 * ab);
          const I = 12 + 24 * ab;
          sprites.add(SPR.FLAME, rp2.x, rp2.y, rp2.z, en.r * 0.82, I, I * 0.78, I * 0.62, -fwd.x * L, -fwd.y * L, -fwd.z * L, r.seed + i, 0.9, 0.5 + 0.5 * ab);
          // the hot nozzle / plume glow that gives the bandit away at range (energy-conserving minimum size)
          const G = 10 + 30 * ab * (0.9 + 0.1 * rnd());
          sprites.add(SPR.GLOW, rp2.x - fwd.x * en.r, rp2.y - fwd.y * en.r, rp2.z - fwd.z * en.r, en.r * 2.2, G, G * 0.55, G * 0.25, 0, 0, 0, 0, 1.6, 0.6 + night);
          if (dCam < 400) considerLight(v.x, v.y, v.z, 10 * ab, 1, 0.55, 0.25);
        } else if (night > 0.2) {
          const egt = clamp((st?.egt ?? 650) / 900, 0.3, 1) * clamp(st?.n1 ?? 0.8, 0.2, 1);
          const G = 1.6 * egt * night;
          sprites.add(SPR.GLOW, rp2.x - fwd.x * 0.2, rp2.y - fwd.y * 0.2, rp2.z - fwd.z * 0.2, en.r * 0.9, G, G * 0.35, G * 0.12, 0, 0, 0, 0, 1.0, 0.3);
        }
      }
    }

    // ---------- contrail (high, cold air) and wingtip vapour (high g) — AI only; the player's are the simulator's ----------
    if (ai && alive && !crashed && !onGround && !hidden) {
      const alt = s.position.y;
      const isaT = Math.max(-56.5, 15 - 6.5 * alt / 1000);
      const form = raw.cfxcontrail === '1' ? 1 : smooth(-37, -47, isaT);
      if (form > 0.02) {
        bodyPoint(s, r.centre, v);
        const persist = clamp(0.25 + 0.9 * (ctx.weather?.cirrus || 0) + 0.3 * (ctx.weather?.cloudCoverage || 0), 0, 1);
        const thr = clamp(s.engines?.[0]?.thrust != null ? s.engines[0].thrust / (e.def?.specs?.thrustDry || 1e5) : s.throttle ?? 0.8, 0, 1.6);
        ribbons.emit(r.contrail, v, form * clamp(0.5 + 0.7 * thr, 0, 1.3) * (0.7 + 0.5 * persist), 0.7 + r.spread * 0.8, 0, 0, STYLE.CONTRAIL, 0);
      } else r.contrail.stop();
      ctx.world.groundAt(s.position.x, s.position.z, gnd);
      const hum = humidity(alt, gnd.type === 'water');
      const gl = Math.abs(s.gLoad ?? 1);
      const qbar = 0.5 * 1.225 * Math.exp(-alt / 8500) * (s.tas || 0) ** 2;
      const tipK = raw.cfxvapor === '1' ? 1 : clamp(hum * 1.4 + 0.1, 0, 1) * smooth(4.2 - hum * 1.5, 7.0 - hum * 2, gl) * smooth(2000, 9000, qbar);
      for (let i = 0; i < 2; i++) {
        if (tipK > 0.03 && r.tips[i]) { bodyPoint(s, r.tips[i], v); ribbons.emit(r.tipR[i], v, tipK * 2.5, 0.09, 0, 0, STYLE.WINGTIP, 0); }
        else r.tipR[i].stop();
      }
    } else { r.contrail.stop(); r.tipR[0].stop(); r.tipR[1].stop(); }

    // ---------- battle damage: grey → black smoke trail, licking fire; wrecks burn all the way down ----------
    const dmg = e.damage || null;
    let smokeK = clamp(dmg?.smoke ?? 0, 0, 1), fireK = clamp(dmg?.fire ?? 0, 0, 1);
    if (raw.cfxdmg) { smokeK = Math.max(smokeK, +raw.cfxdmg); fireK = Math.max(fireK, +raw.cfxdmg > 0.75 ? +raw.cfxdmg : 0); }
    if (isWreck || (e.isPlayer && !alive)) { smokeK = 1; fireK = Math.max(fireK, 0.9); }
    const burnOut = isWreck && onGround;
    if ((smokeK > 0.02 || fireK > 0.02) && !hidden && !burnOut && !(onGround && !alive)) {
      // source: the engine bay (the dead engine if the weapons module says which), slightly behind the nozzle
      let src = r.centre;
      const eo = dmg?.engineOut, parts = dmg?.parts;
      if (Array.isArray(eo)) { for (let i = 0; i < eo.length && i < r.engines.length; i++) if (eo[i]) { src = r.engines[i].nozzle; break; } }
      if (src === r.centre && parts && !isWreck) {
        // smoke from the worst-hit part: a wing root, or the engine bay
        const wl = parts.wingL || 0, wr = parts.wingR || 0;
        let en = 0; if (Array.isArray(parts.engines)) for (let k = 0; k < parts.engines.length; k++) en = Math.max(en, parts.engines[k] || 0);
        if (Math.max(wl, wr) > en + 0.15 && Math.max(wl, wr) > (parts.fuselage || 0)) {
          const tip = r.tips[wl > wr ? 0 : 1];
          if (tip) { r.wingPt[0] = tip[0] * 0.45; r.wingPt[1] = tip[1]; r.wingPt[2] = tip[2] + 0.5; src = r.wingPt; }
        }
      }
      bodyPoint(s, src, v);
      const fire = fireK > 0.12;
      const style = fire ? STYLE.FIRE : STYLE.DAMAGE;
      if (r.dmgStyle !== style && r.dmg) { r.dmg.stop(); }
      if (!r.dmg) r.dmg = ribbons.ribbon('long', style, { spacingMin: 2, spacingMax: 30, maxDt: 0.15 });
      if (r.dmgStyle !== style) { r.dmg.life = ribbons.styles[style].A[0]; r.dmgStyle = style; }
      const shade = fire ? 1 : clamp((smokeK - 0.25) / 0.6, 0, 1);
      const big = isWreck || !alive ? 1.6 : 1;
      ribbons.emit(r.dmg, v, (0.45 + 0.9 * smokeK) * big, (0.35 + 0.9 * smokeK + 0.5 * fireK) * r.scale * big, fireK, fire ? 1.0 : 0.3, style, shade);
      if (fire) {
        // licking flame tongue streaming back from the source (relative wind), plus flame particles
        ctx.world.toRender(v, rp2);
        back.copy(s.velocity); const sp = back.length();
        if (sp > 1) back.multiplyScalar(-1 / sp); else back.set(0, 1, 0);
        const L = (2.5 + 7 * fireK) * r.scale * (isWreck ? 1.3 : 1) * clamp(sp / 150, 0.4, 1.3);
        const I = (3 + 5 * fireK) * (0.85 + 0.3 * rnd());
        sprites.add(SPR.FLAME, rp2.x, rp2.y, rp2.z, (0.45 + 0.55 * fireK) * r.scale * big, I, I * 0.6, I * 0.3, back.x * L, back.y * L, back.z * L, r.seed * 7 + frame * 0.01, 1.0, -1);
        sprites.add(SPR.GLOW, rp2.x, rp2.y, rp2.z, (1.5 + 1.5 * fireK) * r.scale, I * 0.05, I * 0.025, I * 0.01, 0, 0, 0, 0, 1.2, 0.8);
        if (dt > 0) R.fireLicks(ps, v, s.velocity, back, (14 + 22 * fireK) * big, dt, q, r.fireAcc, (0.6 + 0.6 * fireK) * r.scale * big);
        if (dt > 0 && (isWreck || !alive)) { v2.copy(s.position); R.fireLicks(ps, v2, s.velocity, back, 18, dt, q, r.fireAcc2, 1.1 * r.scale); }
        considerLight(v.x, v.y, v.z, 30 * fireK * big, 1, 0.5, 0.2);
      }
    } else if (r.dmg) { r.dmg.stop(); }

    // ---------- fuel leak: thin white vapour trail from a wing ----------
    const leak = clamp(dmg?.leak ?? 0, 0, 1);
    if (leak > 0.02 && alive && !hidden && !onGround) {
      if (!r.leakR) r.leakR = ribbons.ribbon('short', STYLE.LEAK, { spacingMin: 2, spacingMax: 14, maxDt: 0.1 });
      const tip = r.tips[(dmg?.parts?.wingR || 0) > (dmg?.parts?.wingL || 0) ? 1 : 0] || r.centre;
      r.wingPt[0] = tip[0] * 0.6; r.wingPt[1] = tip[1]; r.wingPt[2] = tip[2] + 0.8;
      bodyPoint(s, r.wingPt, v);
      ribbons.emit(r.leakR, v, 0.3 + 0.9 * leak, 0.12, 0, 0, STYLE.LEAK, 0);
    } else if (r.leakR) r.leakR.stop();

    // ---------- gun: muzzle flash + gun smoke ----------
    const gun = e.loadout?.gun;
    r.bigGun = GUN_SCALE[gun?.type] ?? (/a10/i.test(e.def?.id || '') ? 2 : 1);
    if (alive && gun?.firing && !hidden) {
      if (W?.muzzleOf) W.muzzleOf(e, muzzleV);
      else bodyPoint(s, r.port, muzzleV);
      const big = r.bigGun;
      if (rnd() < 0.8) {
        ctx.world.toRender(muzzleV, rp2);
        const I = 70 * (0.6 + 0.6 * rnd()) * big;
        sprites.add(SPR.FLASH, rp2.x + fwd.x * 0.4 * big, rp2.y + fwd.y * 0.4 * big, rp2.z + fwd.z * 0.4 * big, (0.7 + 0.5 * rnd()) * big, I, I * 0.8, I * 0.55, 0, 0, 0, rnd(), 1.2, 0);
        sprites.add(SPR.GLOW, rp2.x, rp2.y, rp2.z, 1.6 * big, I * 0.1, I * 0.07, I * 0.04, 0, 0, 0, 0, 1.0, 1);
      }
      if (dt > 0) R.gunSmoke(ps, muzzleV, s.velocity, 70 * big, dt, q, r.gunAcc, big);
      if (dCam < 300) considerLight(muzzleV.x, muzzleV.y, muzzleV.z, 30 * big, 1, 0.75, 0.45);
    }

    // ---------- far-aircraft glint impostor + navigation lights (AI) ----------
    if (ai && alive && !hidden && dCam > 600) {
      sprites.add(SPR.DOT, rp.x, rp.y, rp.z, 1, 0.42, 0.44, 0.46, e.up?.x ?? 0, e.up?.y ?? 1, e.up?.z ?? 0, 1, 1.35, r.span);
    }
    if (ai && alive && !hidden && night > 0.25 && r.lights) {
      const L = r.lights, k = smooth(0.25, 0.6, night);
      const navI = 25 * k;
      if (L.navLeft) { bodyPoint(s, L.navLeft, v); ctx.world.toRender(v, rp2); sprites.add(SPR.GLOW, rp2.x, rp2.y, rp2.z, 0.12, navI, navI * 0.04, navI * 0.02, 0, 0, 0, 0, 1.1, 0.5); }
      if (L.navRight) { bodyPoint(s, L.navRight, v); ctx.world.toRender(v, rp2); sprites.add(SPR.GLOW, rp2.x, rp2.y, rp2.z, 0.12, navI * 0.05, navI, navI * 0.35, 0, 0, 0, 0, 1.1, 0.5); }
      if (L.tail) { bodyPoint(s, L.tail, v); ctx.world.toRender(v, rp2); sprites.add(SPR.GLOW, rp2.x, rp2.y, rp2.z, 0.1, navI * 0.6, navI * 0.6, navI * 0.6, 0, 0, 0, 0, 1.0, 0.4); }
      const sp = L.strobe || L.beacon;
      const ph = (ctx.time.now * 1.1 + r.seed) % 1;
      if (sp && ph < 0.06) { bodyPoint(s, sp, v); ctx.world.toRender(v, rp2); const I = 260 * k; sprites.add(SPR.GLOW, rp2.x, rp2.y, rp2.z, 0.15, I, I, I, 0, 0, 0, 0, 1.4, 1.2); }
    }
  }

  // stale-record sweeps (defined once: no closures per frame)
  function sweepMissile(r, m) { if (r.seen !== frame) { r.rb.release(ctx.time.now); misRecs.delete(m); } }
  function sweepFlare(r, f) { if (r.seen !== frame) { r.rb.release(ctx.time.now); flareRecs.delete(f); } }
  function sweepAc(r, e) { if (r.seen !== frame) { releaseAc(r); acRecs.delete(e); } }

  // =============================================================================================== missiles
  function updateMissiles(dt, q) {
    let n = 0;
    const list = W?.missiles || [];
    for (let i = 0; i < list.length; i++) {
      const m = list[i]; if (!m?.state) continue;
      let r = misRecs.get(m);
      if (!r) {
        r = { rb: ribbons.ribbon('long', STYLE.MISSILE, { spacingMin: 3, spacingMax: 70, maxDt: 0.3 }), seen: 0, seed: rnd(), wasMotor: true, launched: false };
        misRecs.set(m, r);
      }
      r.seen = frame;
      const s = m.state, spec = m.spec || {};
      const radar = (spec.seeker || m.type) === 'radar';
      const len = spec.length ?? (radar ? 3.66 : 2.87), rad = spec.diameter ? spec.diameter / 2 : (radar ? 0.089 : 0.064);
      fwd.copy(FWD).applyQuaternion(s.quaternion);
      ctx.world.toRender(s.position, rp);
      if (n < 48) {
        m4.compose(rp, s.quaternion, sc3.set(rad, rad, len));
        missileMesh.setMatrixAt(n++, m4);
      }
      const age = m.age ?? 0;
      const burn = spec.burnTime ?? (spec.motor ? (spec.motor.boost?.[1] || 0) + ((spec.motor.sustain?.[0] || 0) > 0 ? spec.motor.sustain[1] || 0 : 0) : (radar ? 6 : 4.5));
      const motor = m.motor ?? (age < burn);
      v.copy(s.position).addScaledVector(fwd, -len * 0.5);   // nozzle (world)
      ctx.world.toRender(v, rp2);
      if (motor) {
        const ign = clamp(age / 0.15, 0.2, 1);
        const I = 160 * ign * (0.9 + 0.2 * rnd());
        const L = (2.2 + 1.4 * rnd() * 0.3) * (radar ? 1.2 : 1);
        sprites.add(SPR.FLAME, rp2.x, rp2.y, rp2.z, rad * 2.6, I, I * 0.85, I * 0.65, -fwd.x * L, -fwd.y * L, -fwd.z * L, r.seed, 1.0, 0.3);
        sprites.add(SPR.GLOW, rp2.x - fwd.x * 0.5, rp2.y - fwd.y * 0.5, rp2.z - fwd.z * 0.5, 1.4, I * 0.35, I * 0.25, I * 0.14, 0, 0, 0, 0, 1.8, 1.0);
        ribbons.emit(r.rb, v, 1.0, radar ? 0.42 : 0.34, 1, 0, STYLE.MISSILE, 0);
        considerLight(v.x, v.y, v.z, 80, 1, 0.7, 0.4);
      } else {
        // burnout: the trail thins to a faint wisp (residual smoke from the hot motor), then stops
        const tAfter = age - burn;
        if (m.motor === false && r.wasMotor) r.offAt = age;
        const ta = m.motor === false ? age - (r.offAt ?? age) : tAfter;
        if (ta < 2.5) ribbons.emit(r.rb, v, 0.25 * (1 - ta / 2.5) + 0.05, 0.14, 0, 0, STYLE.MISSILE, 0.15);
        else r.rb.stop();
      }
      r.wasMotor = motor;
    }
    missileMesh.count = n;
    missileMesh.visible = n > 0;
    if (n) missileMesh.instanceMatrix.needsUpdate = true;
    misRecs.forEach(sweepMissile);
  }

  // =============================================================================================== flares
  function updateFlares(dt, q) {
    const list = W?.flares || [];
    for (let i = 0; i < list.length; i++) {
      const f = list[i]; if (!f?.state) continue;
      let r = flareRecs.get(f);
      if (!r) { r = { rb: ribbons.ribbon('short', STYLE.FLARE, { spacingMin: 1.5, spacingMax: 10, maxDt: 0.08 }), seen: 0, seed: rnd() }; flareRecs.set(f, r); }
      r.seen = frame;
      const life = f.life || 4.5, t = clamp((f.age || 0) / life, 0, 1);
      const burn = f.heat != null ? clamp(f.heat, 0, 1) : clamp((f.age || 0) / 0.08, 0, 1) * (1 - smooth(0.78, 1, t));
      if (burn <= 0.01) { r.rb.stop(); continue; }
      ctx.world.toRender(f.state.position, rp);
      const fl = 0.75 + 0.25 * Math.sin(ctx.time.now * 47 + r.seed * 30) * Math.sin(ctx.time.now * 29 + r.seed * 11) + 0.1 * rnd();
      const I = 900 * burn * fl;
      sprites.add(SPR.GLOW, rp.x, rp.y, rp.z, 0.45, I, I * 0.95, I * 0.86, 0, 0, 0, 0, 2.0, 1.5);
      sprites.add(SPR.GLOW, rp.x, rp.y, rp.z, 4.0, I * 0.01, I * 0.009, I * 0.007, 0, 0, 0, 0, 3.0, 1.0);
      ribbons.emit(r.rb, f.state.position, 1.1 * (1 - 0.4 * t), 0.35, burn, 0, STYLE.FLARE, 0);
      considerLight(f.state.position.x, f.state.position.y, f.state.position.z, 150 * burn, 1, 0.95, 0.85);
    }
    flareRecs.forEach(sweepFlare);
  }

  // =============================================================================================== tracers
  function updateTracers() {
    const B = W?.bullets; if (!B) return;
    const lifeDef = W.specs?.gun?.life || 2.2;
    for (let i = 0; i < B.n; i++) {
      const b = B.items[i]; if (!b.tracer) continue;
      ctx.world.toRender(b.position, rp);
      // motion-blur streak: the distance travelled relative to the camera during ~1/50 s, never longer than the flight so far
      v.copy(b.velocity).sub(camVel);
      const sp = v.length();
      const len = Math.min(sp * 0.02, sp * (b.age || 0) + 0.5);
      if (sp > 1) v.multiplyScalar(-len / sp);
      const age = b.age || 0, life = b.life || lifeDef;
      const fade = (1 - smooth(life * 0.75, life, age)) * clamp(age / 0.02, 0.3, 1);
      const red = b.team === 'red';
      const I = 140 * fade;
      const big = b.gun === 'gau8' ? 1.6 : b.gun === 'gau22' ? 1.25 : 1;
      if (red) sprites.add(SPR.STREAK, rp.x, rp.y, rp.z, 0.06 * big, I * 0.75, I, I * 0.35, v.x, v.y, v.z, 0, 0.9, 0);
      else sprites.add(SPR.STREAK, rp.x, rp.y, rp.z, 0.06 * big, I, I * 0.55, I * 0.25, v.x, v.y, v.z, 0, 0.9, 0);
    }
  }

  // =============================================================================================== explosions
  function airframeTint(e) {
    if (!e._cfxColour) { e._cfxColour = new THREE.Color(0.5, 0.52, 0.55); try { airframeColour(e.object3D, e._cfxColour); } catch { /* keep grey */ } }
    return e._cfxColour;
  }
  function windDir(pos, out) {
    if (ctx.weather?.windAt) ctx.weather.windAt(pos, out); else out.copy(ctx.weather?.wind || v3.set(0, 0, 0));
    out.y = 0; return out;
  }
  function warmFireballs() {
    if (fbWarm || !fireballs) return;
    fbWarm = true;
    try { fireballs.warm(); } catch (err) { console.warn('[combat fx] fireball warm-up failed', err); fireballs = null; }
  }

  /** Mid-air kill: fireball, sparks, debris; scale by weapon. Public as fx.explodeAircraft(victim, weapon, info). */
  function explodeAircraft(victim, weapon, info) {
    const s = victim.state; if (!s) return;
    const r = acRec(victim);
    const q = q0();
    const missile = weapon === 'missile';
    const gone = !!(info?.disintegrated || victim.hidden);
    const k = gone ? 1.35 : missile ? 1.0 : 0.6;
    const pos = v.copy(s.position);
    const vol = !!fireballs && raw.cfxairfb === '1';
    R.airFireball(ps, smoke, pos, s.velocity, r.scale * k, q, vol);
    if (fireballs && raw.cfxairfb === "1") {   // neural fireball reads as a sooty pool fire mid-air: particles carry air kills
      warmFireballs();
      if (fireballs) {
        windDir(pos, wind);
        const ws = wind.length();
        const D = (gone ? 26 : 17) * Math.cbrt(r.scale);
        const dir = ws > 2 ? v2.copy(wind).multiplyScalar(1 / ws) : v2.set(s.velocity.x, 0, s.velocity.z).normalize();
        fireballs.spawn({ worldPos: pos.clone(), D, tStar: Math.sqrt(D / 9.81), windDir: dir, fw: clamp(ws / Math.sqrt(9.81 * D), 0, 1.2), ui: 0.3, mirror: true,
          drift: v3.copy(s.velocity).multiplyScalar(0.1).add(wind), life: 45 });
      }
    }
    const n = Math.round((gone ? 34 : missile ? 16 : 8) * Math.max(0.5, q));
    debris.burst(pos, s.velocity, n, { colour: airframeTint(victim), size: r.length * 0.06, spread: missile || gone ? 55 : 30, burnFrac: 0.45,
      ribbons: gone ? 6 : missile ? 4 : 2, big: gone ? 5 : 0, span: r.span, length: r.length });
    lightFlash(pos, 4000 * k * r.scale, 0.6, 1, 0.6, 0.3);
    r.deadT = ctx.time.now;
  }

  /** Wreck reached the ground / water. Public as fx.groundImpact(entity, position). */
  function groundImpact(e, position) {
    const q = q0();
    const r = e ? acRec(e) : null;
    const scale = r ? r.scale : 1;
    const pos = v.copy(position);
    ctx.world.groundAt(pos.x, pos.z, gnd);
    const water = gnd.type === 'water';
    const vel = e?.state?.velocity || v3.set(0, -50, 0);
    if (water) {
      pos.y = ctx.water?.heightAt?.(pos.x, pos.z) ?? Math.max(0, gnd.height);
      R.splashColumn(ps, smoke, pos, vel, scale, q);
      lightFlash(pos, 0, 0.1);
      return;
    }
    pos.y = Math.max(pos.y, gnd.height) + 0.5;
    E.explosion(ps, smoke, pos, vel, scale, q);
    R.flash(ps, pos, null, 60 * scale, 200, 1, 0.75, 0.45, 0.4);
    if (fireballs) {
      warmFireballs();
      if (fireballs) {
        windDir(pos, wind);
        const ws = wind.length();
        const fuel = e?.state?.fuel ?? 2000;
        const D = clamp(5.8 * Math.cbrt(Math.max(200, fuel * 0.45)), 22, 60);
        const dir = ws > 2 ? v2.copy(wind).multiplyScalar(1 / ws) : v2.set(vel.x, 0, vel.z).normalize();
        if (dir.lengthSq() < 0.5) dir.set(1, 0, 0);
        const vh = Math.hypot(vel.x, vel.z);
        fireballs.spawn({ worldPos: v3.set(pos.x, pos.y - 0.5, pos.z).clone(), D, tStar: Math.sqrt(D / 9.81), windDir: dir, fw: clamp(ws / Math.sqrt(9.81 * D), 0, 1.2),
          ui: clamp(0.4 * vh / Math.sqrt(9.81 * D), 0, 2.5), life: 120 });
      }
    }
    debris.burst(pos, v2.set(vel.x * 0.3, Math.abs(vel.y) * 0.2 + 15, vel.z * 0.3), Math.round(8 * Math.max(0.5, q)), { colour: e ? airframeTint(e) : null, size: (r?.length || 15) * 0.05, spread: 25, burnFrac: 0.5, ribbons: 2, span: r?.span, length: r?.length });
    let gf = groundFires.find((f) => f.t > 200);
    if (!gf) { gf = { t: 0, pos: new THREE.Vector3(), fireAcc: 0, smokeAcc: 0, scale: 1 }; if (groundFires.length < 8) groundFires.push(gf); else gf = groundFires[0]; }
    gf.t = 0; gf.pos.copy(pos); gf.fireAcc = 0; gf.smokeAcc = 0; gf.scale = scale;
    lightFlash(pos, 8000 * scale, 1.2, 1, 0.55, 0.25);
  }

  // =============================================================================================== events
  const offs = [];
  const on = (n, f) => { const off = combat.events.on(n, (p) => { try { f(p || {}); } catch (err) { console.warn('[combat fx]', n, err); } }); if (typeof off === 'function') offs.push(off); };
  on('bullet:hit', ({ position, target, gun }) => {
    if (!position) return;
    const big = gun === 'gau8' ? 1.7 : gun === 'gau22' ? 1.25 : 1;
    R.bulletHit(ps, smoke, position, target?.state?.velocity || null, q0(), big);
    lightFlash(position, 400 * big, 0.08, 1, 0.8, 0.6);
  });
  on('bullet:ground', ({ position }) => {
    if (!position) return;
    ctx.world.groundAt(position.x, position.z, gnd);
    R.groundStrike(ps, position, gnd.type === 'water', q0(), DUST);
  });
  on('missile:launch', ({ missile, shooter }) => {
    const s = missile?.state; if (!s) return;
    back.copy(FWD).applyQuaternion(shooter?.state?.quaternion || s.quaternion).negate();
    R.launchPuff(ps, smoke, s.position, s.velocity, back, q0());
    lightFlash(s.position, 300, 0.25, 1, 0.75, 0.45);
  });
  on('missile:hit', ({ position, target, missile }) => {
    if (!position) return;
    R.warhead(ps, smoke, position, target?.state?.velocity ? v.copy(target.state.velocity).multiplyScalar(0.6) : missile?.state?.velocity || null, q0(), 1);
    lightFlash(position, 2500, 0.35, 1, 0.75, 0.45);
  });
  on('missile:miss', ({ position, missile, reason, detonated }) => {
    if (detonated === false && reason !== 'ground') return;   // a dud / lost missile just falls: no burst
    if (!position || reason === 'ground') {
      if (position && reason === 'ground') { ctx.world.groundAt(position.x, position.z, gnd); R.groundStrike(ps, position, gnd.type === 'water', q0() * 3, DUST); R.warhead(ps, smoke, position, null, q0(), 0.5); }
      return;
    }
    R.warhead(ps, smoke, position, missile?.state?.velocity ? v.copy(missile.state.velocity).multiplyScalar(0.3) : null, q0(), 0.5);
    lightFlash(position, 1200, 0.3, 1, 0.75, 0.45);
  });
  on('kill', ({ victim, weapon, info }) => {
    if (!victim || victim.kind !== 'aircraft') return;
    if (victim.isPlayer) return;    // the simulator runs the player's own crash sequence; we only trail the falling jet
    explodeAircraft(victim, weapon, info);
  });
  on('wreck:impact', ({ entity, position }) => { if (position) groundImpact(entity, position); });
  on('mission:start', () => { clearAll(); if (S.owned) S.anchor.reset(); });
  on('mission:abort', () => clearAll());

  function clearAll() {
    ps.clear(); smoke.clear(); ribbons.clear(); sprites.clear(); debris.clear(); fireballs?.clear();
    ps.mesh.visible = smoke.mesh.visible = false;
    missileMesh.count = 0; missileMesh.visible = false;
    acRecs.clear(); misRecs.clear(); flareRecs.clear();
    groundFires.length = 0;
    for (const f of flashes) f.t = 1e9;
    light.uFxLightColor.value.setRGB(0, 0, 0);
  }

  // =============================================================================================== frame
  function update(dt) {
    frame++;
    if (!combat.active && ctx.time.now > lastActive + 2) return;
    if (combat.active) lastActive = ctx.time.now;
    S.refresh();
    const q = q0(), night = ctx.env?.nightFactor || 0;
    // camera (last frame's rig position; good enough for LOD / light choice)
    camW.copy(ctx.camera.position).add(ctx.world.origin);
    if (ctx.cameraRig?.velocity) camVel.copy(ctx.cameraRig.velocity); else camVel.set(0, 0, 0);
    bestLight.score = 0; bestLight.I = 0;
    sprites.begin();

    updateTracers();
    for (let i = 0; i < world.aircraft.length; i++) updateAircraft(world.aircraft[i], dt, q, night, false);
    for (let i = 0; i < world.wrecks.length; i++) updateAircraft(world.wrecks[i], dt, q, night, true);
    const p = world.player;
    if (p && !p.alive && p.state && !p.state.onGround && world.wrecks.indexOf(p) < 0) updateAircraft(p, dt, q, night, false);
    acRecs.forEach(sweepAc);
    updateMissiles(dt, q);
    updateFlares(dt, q);

    debris.update(dt, ps, smoke, q);
    if (dt > 0) {
      for (const gf of groundFires) {
        if (gf.t > 200) continue;
        const fire = E.wreckUpdate(ps, smoke, gf, dt, q, gf.scale);
        if (fire > 0.01) considerLight(gf.pos.x, gf.pos.y + 4, gf.pos.z, 4000 * fire * gf.scale, 1, 0.5, 0.2);
      }
    }
    if (fireballs) {
      fireballs.update(dt);
      const l = fireballs.light(lightOut);
      if (l) { v.copy(l.pos).add(ctx.world.origin); considerLight(v.x, v.y, v.z, l.intensity * 0.35, l.color.r, l.color.g, l.color.b); }
    }
    for (const f of flashes) {
      if (f.t > f.life) continue;
      f.t += dt;
      const k = Math.exp(-f.t * 4 / f.life);
      considerLight(f.pos.x, f.pos.y, f.pos.z, f.I * k, f.r, f.g, f.b);
    }
    if (bestLight.I > 0) {
      ctx.world.toRender(bestLight.pos, light.uFxLightPos.value);
      light.uFxLightColor.value.setRGB(bestLight.r, bestLight.g, bestLight.b).multiplyScalar(bestLight.I * 0.5);
    } else light.uFxLightColor.value.setRGB(0, 0, 0);

    sprites.flush();
    ribbons.flush();
    ps.flush(); smoke.flush();
    if (dbgOff) { if (dbgOff.has('sprites')) sprites.mesh.visible = false; if (dbgOff.has('ribbons')) ribbons.mesh.visible = false; if (dbgOff.has('ps')) ps.mesh.visible = false; if (dbgOff.has('smoke')) smoke.mesh.visible = false; }
  }
  const dbgOff = raw.cfxoff ? new Set(String(raw.cfxoff).split(',')) : null;

  const fx = {
    update(dt) { try { update(dt); } catch (err) { if (!fx._warned) { fx._warned = true; console.warn('[combat fx] update failed', err); } } },
    explodeAircraft, groundImpact,
    /** Generic explosion at a world position (missions / ground units): scale ~ 1 for a fighter-sized blast. */
    explode(worldPos, scale = 1, opts = {}) {
      const q = q0();
      R.airFireball(ps, smoke, worldPos, opts.velocity || v3.set(0, 0, 0), scale, q, false);
      if (opts.debris !== false) debris.burst(worldPos, opts.velocity || v3.set(0, 0, 0), Math.round(8 * scale * Math.max(0.5, q)), { size: 1.2 * scale, spread: 35 * scale, burnFrac: 0.5, ribbons: 2 });
      lightFlash(worldPos, 4000 * scale, 0.6);
    },
    clear: clearAll,
    stats() {
      return {
        drawCalls: [sprites.mesh, ribbons.mesh, ps.mesh, smoke.mesh, missileMesh, debris.mesh].filter((m) => m.visible).length + (fireballs ? fireballs.pool.filter((f) => f.active).length : 0),
        sprites: sprites.count, missiles: missileMesh.count, debris: debris.live, aircraft: acRecs.size, trailsLive: ribbons.pool.slices.filter((s) => s.owner).length,
        fireballs: fireballs ? fireballs.pool.filter((f) => f.active).length : -1,
      };
    },
    dispose() {
      for (const o of offs) o();
      ps.dispose(); smoke.dispose(); ribbons.dispose(); sprites.dispose(); debris.dispose(); fireballs?.dispose();
      ctx.scene.remove(missileMesh); missileMesh.geometry.dispose(); missileMesh.material.dispose(); S.dispose();
    },
  };
  return fx;
}
