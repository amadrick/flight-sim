// Visual effects: afterburner plumes, contrails, vapour, ground interaction, crash, aircraft lights, rain, lightning.
// API: createEffects(ctx) -> { update(dt), dispose(), stats() }
//
// Foundation: one shared GPU particle system (instanced quads integrated analytically in the vertex shader, pooled
// ring buffer), a long-lived smoke system, volumetric tube trails, ray-marched body-fixed volumes (plumes, vapour).
// Everything draws on LAYERS.POST with premultiplied-alpha HDR output; world-space history is anchored so it survives
// originShift. Counts scale with ctx.quality.particles. See INTEGRATION.md for budgets and pipeline notes.
//
// Debug URL params (test harness only): fx=ab,contrail,vapor,cone,crash,touchdown,rain,lights,lightning,spray,sparks,
//   dust,smoke,boom   fxtm=1 (tone map in-shader for the stub pipeline)   fxcam=side|front|rear|far|low|top|cockpit
//   fxdist=<m>  fxexp=<exposure>
import * as THREE from 'three';
import { createNoise3D, createPuffTexture } from './noise.js';
import { createSharedUniforms, sharedHeader } from './fxglsl.js';
import { createAnchor } from './anchor.js';
import { ParticleSystem } from './particles.js';
import { Trail } from './trails.js';
import { Plume, createPlumeMaterial, createPlumeGeometry } from './plume.js';
import { createAircraftLights } from './lights.js';
import { createVapor } from './vapor.js';
import { createRain, createLightning } from './weatherfx.js';
import * as E from './emitters.js';

const DEG = Math.PI / 180;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export async function createEffects(ctx) {
  const raw = ctx.params?.raw || {};
  const dbg = new Set(String(raw.fx || '').split(',').filter(Boolean));
  const force = (k) => dbg.has(k) || dbg.has('all');

  const tex = { noise3D: createNoise3D(), puff: createPuffTexture() };
  const shared = createSharedUniforms(ctx, tex);
  if (raw.fxtm === '1') { shared.uFxPreviewTM.value = 1; shared.uFxPreviewExposure.value = +raw.fxexp || 1; }
  const header = sharedHeader(ctx);
  const anchor = createAnchor(ctx, shared);
  const q0 = () => clamp(ctx.quality?.particles ?? 1, 0.1, 1.5);

  // ---- systems (allocated once at max capacity; emission rates scale with quality) ----
  const ps = new ParticleSystem(ctx, shared, header, anchor, 12288, 'fx-particles');
  const smoke = new ParticleSystem(ctx, shared, header, anchor, 3072, 'fx-smoke');
  const plumeGeo = createPlumeGeometry();

  // dynamic lights: created ONCE and kept in the scene (constant light count → no material recompiles)
  const fxLight = new THREE.PointLight(0xff8a3a, 0, 120, 2);
  fxLight.name = 'fx-light'; fxLight.castShadow = false; ctx.scene.add(fxLight);
  const lights = createAircraftLights(ctx, shared, header);
  const rain = createRain(ctx, shared, header);
  const lightning = createLightning(ctx, shared, header);

  // ---- per-session state ----
  let P = null;          // attached player rig
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmp3 = new THREE.Vector3(), camW = new THREE.Vector3();
  const vFwd = new THREE.Vector3(), vRight = new THREE.Vector3(), vUp = new THREE.Vector3(), lat = new THREE.Vector3();
  const ground = {};
  const wrecks = [];     // burning wrecks { t, pos, fireAcc, smokeAcc, scale }
  const flash = { t: 1e9, pos: new THREE.Vector3(), I: 0 };
  const offs = [];

  function attach(player) {
    detach();
    if (!player) return;
    const def = player.def, g = def.geometry || {};
    const isAB = /afterburn/i.test(def.specs?.engineType || '') || (def.specs?.thrustMax > (def.specs?.thrustDry || Infinity) * 1.05) || !!def.sound?.afterburner;
    const lowBypass = isAB || ['fighter', 'attack', 'recon'].includes(def.category);
    const group = new THREE.Group(); group.name = 'fx-body';
    player.visual.object3D.add(group);
    const engines = (g.engines || []).map((en, i) => {
      const plume = new Plume(plumeGeo, createPlumeMaterial(shared, header), en, isAB, lowBypass, i * 3.7 + 1.3);
      group.add(plume.mesh);
      const trail = new Trail(ctx, shared, header, anchor, 2048, { life: 60, diff: 10, sink: 1.8, formStart: 0.04, formEnd: 0.3, sigma: 5, albedo: [1, 1, 1], g: 0.72, mergeTau: 14, wobble: 1, spacingMin: 3, spacingMax: 60, maxDt: 0.4 });
      return { def: en, plume, trail, acc: { v: 0 }, hazeAcc: { v: 0 }, blastAcc: { v: 0 }, wasRunning: true };
    });
    const tips = (g.wingtips || []).map(() => new Trail(ctx, shared, header, anchor, 384, { life: 2.6, diff: 0.25, sink: 0.4, formStart: 0.0, formEnd: 0.08, sigma: 0.8, albedo: [1, 1, 1], g: 0.75, mergeTau: 1, wobble: 0, spacingMin: 1.5, spacingMax: 12, maxDt: 0.05 }));
    const smokeTrail = new Trail(ctx, shared, header, anchor, 1024, { life: 25, diff: 2.5, sink: 0, formStart: 0, formEnd: 0.05, sigma: 6, albedo: [0.85, 0.85, 0.86], g: 0.4, mergeTau: 1, wobble: 0.2, spacingMin: 2, spacingMax: 25, maxDt: 0.2 });
    const vapor = createVapor(ctx, shared, header, def, group);
    lights.attach(player, group);
    P = {
      player, def, g, group, engines, tips, smokeTrail, vapor, isAB, lowBypass,
      gearAcc: (g.gear || []).map(() => ({ v: 0 })), dustAcc: (g.gear || []).map(() => ({ v: 0 })),
      sparkAcc: { v: 0 }, sprayAcc: { v: 0 }, wasOnGround: player.state.onGround, prevMach: player.state.mach || 0,
      crashed: false, scale: clamp((g.length || 15) / 15, 0.6, 3),
    };
    anchor.update();
  }

  function detach() {
    if (!P) return;
    for (const e of P.engines) { e.plume.dispose(); e.trail.dispose(); }
    for (const t of P.tips) t.dispose();
    P.smokeTrail.dispose();
    P.vapor.dispose();
    lights.detach();
    P.group.removeFromParent();
    P = null;
  }

  function clearAll() {
    ps.clear(); smoke.clear(); wrecks.length = 0; flash.t = 1e9; lightning.clear(); fxLight.intensity = 0;
  }

  offs.push(ctx.events.on('session:start', (pl) => { clearAll(); attach(pl || ctx.player); }));
  offs.push(ctx.events.on('session:end', () => { detach(); clearAll(); }));
  offs.push(ctx.events.on('touchdown', (e) => onTouchdown(e || {})));
  offs.push(ctx.events.on('crash', (e) => onCrash(e || {})));
  offs.push(ctx.events.on('sonicBoom', () => onBoom()));
  offs.push(ctx.events.on('lightning', (e) => lightning.strike(e || {})));
  if (ctx.player) attach(ctx.player);

  function onTouchdown(e) {
    if (!P) return;
    const s = P.player.state, gear = P.g.gear || [];
    const idx = Number.isInteger(e.gear) ? [e.gear] : gear.map((_, i) => i).filter(i => i > 0 || gear.length === 1);
    const sink = Math.abs(e.verticalSpeed ?? s.verticalSpeed ?? 2);
    for (const i of idx) {
      const gw = gear[i]; if (!gw) continue;
      E.bodyToWorld(s, gw.pos, tmp);
      ctx.world.groundAt(tmp.x, tmp.z, ground); tmp.y = Math.max(tmp.y, ground.height);
      if (ground.type === 'water') E.waterSpray(ps, tmp, s.velocity, vFwd.set(0, 0, 1).applyQuaternion(s.quaternion), 1, 0.1, q0(), { v: 0 });
      else E.tyreSmoke(ps, s, tmp, sink, s.groundSpeed || 0, q0());
    }
  }

  function onCrash(e) {
    if (!P || P.crashed) return;
    P.crashed = true;
    const s = P.player.state;
    tmp.copy(s.position);
    ctx.world.groundAt(tmp.x, tmp.z, ground);
    const nearGround = tmp.y - ground.height < 40;
    if (nearGround) tmp.y = Math.max(ground.height + 1, tmp.y - (P.g.cgHeight || 1) * 0.5);
    const water = ground.type === 'water' || /ditch/i.test(e.reason || '');
    if (water && nearGround) {
      tmp.y = (ctx.water?.heightAt?.(tmp.x, tmp.z) ?? 0) + 0.5;
      E.splash(ps, tmp, s.velocity, P.scale, q0());
    } else {
      E.explosion(ps, smoke, tmp, s.velocity, P.scale, q0());
      flash.t = 0; flash.pos.copy(tmp); flash.I = 1;
      if (nearGround) wrecks.push({ t: 0, pos: tmp.clone(), fireAcc: 0, smokeAcc: 0, scale: P.scale });
    }
    for (const en of P.engines) en.trail.stop();
  }

  function onBoom() {
    if (!P) return;
    const s = P.player.state;
    E.shockRing(ps, s.position, s.velocity, q0());
    P.vapor.boom();
  }

  function humidity(alt, overWater) {
    const w = ctx.weather;
    let h = 0.18 + 0.55 * (w.cloudCoverage || 0) + 0.45 * (w.precipitation || 0);
    if (overWater) h += 0.15;
    h *= alt < 2500 ? 1 : Math.exp(-(alt - 2500) / 3000);
    return clamp(h, 0, 1);
  }

  // ---------------------------------------------------------------------------------------------------------------
  function updatePlayer(dt) {
    const s = P.player.state, now = ctx.time.now, q = q0();
    const camPos = ctx.camera.getWorldPosition(tmp3);
    vFwd.set(0, 0, -1).applyQuaternion(s.quaternion);
    vRight.set(1, 0, 0).applyQuaternion(s.quaternion);
    vUp.set(0, 1, 0).applyQuaternion(s.quaternion);
    lat.set(vRight.x, 0, vRight.z); if (lat.lengthSq() < 1e-6) lat.set(1, 0, 0); lat.normalize();
    const alt = s.position.y;
    ctx.world.groundAt(s.position.x, s.position.z, ground);
    const gType = ground.type, gH = ground.height;
    const overWater = gType === 'water';
    const hum = humidity(alt, overWater);
    const crashed = s.crashed || P.crashed;
    if (force('ab')) ctx.controls.throttle = 1;

    // ---- engines: plumes, contrails, haze, jet-blast dust ----
    const isaT = Math.max(-56.5, 15 - 6.5 * alt / 1000);
    const contrailForm = force('contrail') ? 1 : smooth(-37, -47, isaT);
    const persist = clamp(0.25 + 0.9 * (ctx.weather.cirrus || 0) + 0.3 * (ctx.weather.cloudCoverage || 0), 0, 1);
    const thrustRef = (P.def.specs?.thrustDry || 1e5);
    let abSum = 0;
    for (let i = 0; i < P.engines.length; i++) {
      const e = P.engines[i], en = s.engines?.[i];
      e.plume.update(en, s, camPos, q, dt, now);
      abSum += e.plume.ab;
      const thr = clamp((en?.thrust ?? 0) / thrustRef, 0, 1.6);
      const running = en ? en.running !== false : true;
      E.bodyToWorld(s, e.def.nozzle, tmp);
      if (running && !e.wasRunning) E.engineStartPuff(ps, tmp, vFwd.clone().negate(), q);
      e.wasRunning = running;
      // contrail
      const strength = crashed || s.onGround || !running ? 0 : contrailForm * clamp(0.3 + 0.8 * thr, 0, 1.3);
      if (strength > 0.02) {
        const tr = e.trail, u = tr.uniforms;
        u.uLife.value = 25 + 120 * persist; tr.opts.life = u.uLife.value;
        u.uDiff.value = 1.5 + 12 * persist;
        const r0 = e.def.nozzleRadius || 0.5;
        const nx = e.def.nozzle[0];
        const vortex = (Math.PI / 8) * (P.g.span || 10);
        const merge = Math.abs(nx) > 0.5 ? Math.sign(nx) * vortex - nx : 0;
        tr.emit(tmp, strength, Math.max(0.6, r0 * 1.1), lat, merge);
      } else e.trail.stop();
      // on-ground effects behind the nozzle
      if (s.onGround && running && thr > 0.15) {
        const back = tmp2.set(0, 0, 1).applyQuaternion(s.quaternion); back.y = 0; back.normalize();
        const behind = tmp.clone().addScaledVector(back, 6 + 14 * thr);
        ctx.world.groundAt(behind.x, behind.z, ground);
        behind.y = ground.height + 0.6;
        if (ground.type === 'terrain' && thr > 0.45) E.dust(ps, behind, back.clone().multiplyScalar(12 + 20 * thr), 40 * thr, dt, q, e.blastAcc, [0.55, 0.47, 0.36], 1.2);
        else if (thr > 0.6) E.jetExhaustHaze(ps, behind, back.clone().multiplyScalar(14 * thr), 18 * thr, dt, q, e.blastAcc);
      }
    }

    // ---- display smoke (debug / airshow toggle) ----
    if (force('smoke') && !crashed && !s.onGround) {
      E.bodyToWorld(s, [0, 0, (P.g.tailZ || 6) + 1], tmp);
      P.smokeTrail.emit(tmp, 1.2, 0.8, lat, 0);
    } else P.smokeTrail.stop();

    // ---- wingtip vortices ----
    const gl = Math.abs(s.gLoad ?? 1), aoa = Math.abs(s.aoa || 0);
    const qbar = 0.5 * 1.225 * Math.exp(-alt / 8500) * (s.tas || 0) ** 2;
    const tipK = force('vapor') ? 1 : clamp(hum * 1.3 - 0.15, 0, 1) * smooth(3.0 - hum * 1.5, 6.5 - hum * 2, gl) * smooth(2000, 9000, qbar);
    P.tips.forEach((t, i) => {
      if (tipK > 0.03 && !crashed && !s.onGround) { E.bodyToWorld(s, P.g.wingtips[i], tmp); t.emit(tmp, tipK * 3.5, 0.18, lat, 0); }
      else t.stop();
    });

    // ---- body vapour volumes (overwing, LERX, vapour cone) ----
    const fighter = ['fighter', 'attack'].includes(P.def.category);
    const wingV = force('vapor') ? 1 : clamp(hum * 1.4 - 0.1, 0, 1) * smooth(3.5 - hum * 1.8, 7.5 - hum * 2.5, gl) * smooth(3000, 12000, qbar);
    const lerxV = !fighter ? 0 : force('vapor') ? 1 : clamp(hum * 1.5, 0, 1) * smooth(14 * DEG, 24 * DEG, aoa) * smooth(2500, 8000, qbar);
    const m = s.mach || 0;
    const coneV = force('cone') ? 1 : clamp(hum * 1.6 - 0.05, 0, 1) * Math.exp(-(((m - 0.99) / 0.035) ** 2)) * smooth(0, 1500, alt < 6000 ? 1500 : 0);
    if ((P.prevMach < 1 && m >= 1) && !force('boom')) { /* physics normally emits sonicBoom */ }
    P.prevMach = m;
    P.vapor.update(dt, crashed ? 0 : wingV, crashed ? 0 : lerxV, crashed ? 0 : coneV, s, camPos, q);

    // ---- ground interaction ----
    const gear = P.g.gear || [];
    for (let i = 0; i < gear.length; i++) {
      const gs = s.gear?.[i];
      const onG = gs ? gs.onGround : s.onGround;
      if (!onG || crashed) continue;
      E.bodyToWorld(s, gear[i].pos, tmp);
      ctx.world.groundAt(tmp.x, tmp.z, ground); tmp.y = ground.height;
      const skid = force('touchdown') ? 0 : (gs?.skid || 0);
      if (skid > 0.15 && s.groundSpeed > 3) E.skidSmoke(ps, s, tmp, skid, dt, q, P.gearAcc[i]);
      if (ground.type === 'terrain' && s.groundSpeed > 6) E.dust(ps, tmp, tmp2.copy(s.velocity).multiplyScalar(0.2), clamp(s.groundSpeed, 0, 60) * 0.7, dt, q, P.dustAcc[i], [0.52, 0.45, 0.35], 0.7);
    }
    // belly slide sparks (gear up on the ground) or forced
    if ((s.onGround && (s.surfaces?.gear ?? 1) < 0.3 && s.groundSpeed > 4 && !overWater) || force('sparks')) {
      E.bodyToWorld(s, [0, -(P.g.cgHeight || 1.5) * 0.8, 0], tmp);
      E.sparks(ps, tmp, s.velocity, 120 + s.groundSpeed * 2, dt, q, P.sparkAcc);
    }
    // water spray / rooster tail when very low over water
    const wH = overWater ? (ctx.water?.heightAt?.(s.position.x, s.position.z) ?? 0) : 0;
    const hWater = alt - wH - (P.g.cgHeight || 1.5) * 0.5;
    if ((overWater && hWater < 25 && s.tas > 30 && !crashed) || force('spray')) {
      const k = force('spray') ? 1 : clamp(1 - hWater / 25, 0, 1) ** 2 * clamp(s.tas / 120, 0, 1.5);
      tmp.set(s.position.x, wH + 0.3, s.position.z);
      tmp.addScaledVector(tmp2.set(-vFwd.x, 0, -vFwd.z).normalize(), (P.g.length || 15) * 0.3);
      E.waterSpray(ps, tmp, s.velocity, tmp2, k, dt, q, P.sprayAcc);
    }
    // touchdown detection fallback (stub physics doesn't emit 'touchdown')
    if (s.onGround && !P.wasOnGround && !crashed && P.touchFallback !== false) {
      if (!P.sawTouchdownEvent) onTouchdown({ verticalSpeed: P.lastVs });
    }
    P.wasOnGround = s.onGround; P.lastVs = s.verticalSpeed;

    // ---- fx light (afterburner glow on the tail / ground at night) ----
    return abSum;
  }

  // mark that physics emits real touchdown events, so the fallback doesn't double up
  offs.push(ctx.events.on('touchdown', () => { if (P) P.sawTouchdownEvent = true; }));

  let debugFired = false, frameN = 0;
  function debugActions() {
    frameN++;
    if (!P) return;
    const s = P.player.state;
    if (!debugFired && frameN > 2) {
      debugFired = true;
      if (force('crash')) ctx.events.emit('crash', { reason: 'test' });
      if (force('touchdown')) { onTouchdown({ verticalSpeed: -3 }); }
      if (force('boom')) ctx.events.emit('sonicBoom');
    }
    if (force('lightning') && frameN % 20 === 3) {
      const p = new THREE.Vector3().copy(s.position).add(new THREE.Vector3(1500, 0, -2500).applyAxisAngle(new THREE.Vector3(0, 1, 0), -s.heading));
      p.y = Math.max(ctx.weather.cloudBase, 1200);
      ctx.events.emit('lightning', { worldPos: p, intensity: 1 });
    }
    if (force('rain')) { ctx.weather.precipitation = Math.max(ctx.weather.precipitation, 0.9); ctx.weather.target.precipitation = Math.max(ctx.weather.target.precipitation || 0, 0.9); }
    if (force('lights')) { s.lights.landing = true; s.lights.nav = s.lights.strobe = s.lights.beacon = true; }
  }

  // debug camera (screenshots only): moves the camera after the rig and refreshes the camera frame uniforms
  const dcam = raw.fxcam;
  function debugCamera() {
    if (!dcam || !P) return;
    const s = P.player.state, cam = ctx.camera, L = P.g.length || 15;
    const d = +raw.fxdist || L * 1.6;
    ctx.world.toRender(s.position, tmp);
    const fw = tmp2.set(0, 0, -1).applyQuaternion(s.quaternion), rt = vRight.set(1, 0, 0).applyQuaternion(s.quaternion), up = vUp.set(0, 1, 0).applyQuaternion(s.quaternion);
    const look = tmp3.copy(tmp);
    if (dcam === 'side') { cam.position.copy(tmp).addScaledVector(rt, d).addScaledVector(fw, -L * 0.35).addScaledVector(up, L * 0.08); look.addScaledVector(fw, -L * 0.45); }
    else if (dcam === 'rear') { cam.position.copy(tmp).addScaledVector(fw, -d * 1.3).addScaledVector(rt, d * 0.35).addScaledVector(up, d * 0.18); look.addScaledVector(fw, -L * 0.3); }
    else if (dcam === 'front') { cam.position.copy(tmp).addScaledVector(fw, d).addScaledVector(rt, d * 0.4).addScaledVector(up, d * 0.15); }
    else if (dcam === 'far') { cam.position.copy(tmp).addScaledVector(rt, d * 6).addScaledVector(fw, d * 2).addScaledVector(up, -d * 0.6); look.addScaledVector(fw, -d * 4); }
    else if (dcam === 'low') { cam.position.copy(tmp).addScaledVector(rt, d * 0.8).addScaledVector(fw, -d * 0.6); cam.position.y = Math.max(tmp.y - d, 2); look.addScaledVector(fw, -d * 0.5); }
    else if (dcam === 'top') { cam.position.copy(tmp).addScaledVector(up, d).addScaledVector(fw, -L * 0.4).addScaledVector(rt, 0.01); look.addScaledVector(fw, -L * 0.4); }
    else if (dcam === 'cockpit') { cam.position.copy(tmp).add(tmp2.fromArray(P.g.pilotEye || [0, 1, -4]).applyQuaternion(s.quaternion)); cam.quaternion.copy(s.quaternion); }
    if (dcam !== 'cockpit') { cam.up.set(0, 1, 0); cam.lookAt(look); }
    cam.updateMatrixWorld(true);
    const u = ctx.uniforms.frame;
    u.uCameraPos.value.setFromMatrixPosition(cam.matrixWorld);
    u.uCameraWorld.value.copy(cam.matrixWorld);
    u.uViewMatrix.value.copy(cam.matrixWorldInverse);
  }

  const fx = {
    update(dt) {
      debugActions();
      debugCamera();
      anchor.update();
      const night = ctx.env.nightFactor || 0;
      shared.uFxNight.value = night;
      const s = ctx.player?.state;
      if (s) ctx.weather.windAt(s.position, shared.uFxWind.value); else shared.uFxWind.value.copy(ctx.weather.wind);
      const q = q0();
      let abSum = 0;
      if (P && ctx.player === P.player) abSum = updatePlayer(dt);
      // wrecks (fire + smoke columns)
      let fire = 0, firePos = null;
      for (const w of wrecks) { const f = E.wreckUpdate(ps, smoke, w, dt, q, w.scale); if (f > fire) { fire = f; firePos = w.pos; } }
      // fx light priority: lightning > explosion flash > wreck fire > afterburner
      const lf = lightning.update(dt);
      flash.t += dt;
      const fl = flash.t < 3 ? Math.exp(-flash.t * 2.2) : 0;
      if (lf > 0.02) {
        ctx.world.toRender(lightning.flashPos, fxLight.position);
        fxLight.color.setRGB(0.8, 0.85, 1); fxLight.intensity = 4e6 * lf; fxLight.distance = 12000;
      } else if (fl > 0.01) {
        ctx.world.toRender(flash.pos, fxLight.position); fxLight.position.y += 8;
        fxLight.color.setRGB(1, 0.6, 0.3); fxLight.intensity = 9e4 * fl * (P?.scale || 1); fxLight.distance = 900;
      } else if (fire > 0.01 && firePos) {
        ctx.world.toRender(firePos, fxLight.position); fxLight.position.y += 4;
        fxLight.color.setRGB(1, 0.5, 0.2); fxLight.intensity = 4000 * fire * (0.8 + 0.3 * Math.random()); fxLight.distance = 400;
      } else if (abSum > 0.01 && P) {
        const e0 = P.engines[0].def;
        E.bodyToWorld(P.player.state, [e0.nozzle[0] * 0.5, e0.nozzle[1] - 0.5, e0.nozzle[2] + 4], tmp);
        ctx.world.toRender(tmp, fxLight.position);
        fxLight.color.setRGB(1, 0.55, 0.25); fxLight.intensity = 60 * abSum * (0.9 + 0.2 * Math.random()); fxLight.distance = 80;
      } else fxLight.intensity = 0;
      shared.uFxLightPos.value.copy(fxLight.position);
      shared.uFxLightColor.value.copy(fxLight.color).multiplyScalar(fxLight.intensity * 0.5);
      lights.update(dt, P?.player?.state || null, night);
      rain.update(dt, P?.player?.state || null);
      ps.flush(); smoke.flush();
      if (P) { for (const e of P.engines) e.trail.flush(); for (const t of P.tips) t.flush(); P.smokeTrail.flush(); }
    },
    stats() {
      return { trailHeads: P ? P.engines.map(e => [e.trail.head, e.trail.active, e.trail.array.slice(e.trail.head * 12, e.trail.head * 12 + 12)]) : null, now: ctx.time.now, particles: ps.capacity + smoke.capacity, trails: P ? P.engines.length + P.tips.length + 1 : 0, attached: !!P, wrecks: wrecks.length };
    },
    dispose() {
      detach(); for (const o of offs) o();
      ps.dispose(); smoke.dispose(); plumeGeo.dispose(); ctx.scene.remove(fxLight);
      lights.dispose(); rain.dispose(); lightning.dispose(); tex.noise3D.dispose(); tex.puff.dispose();
    },
  };
  return fx;
}
