// COMBAT AUDIO: weapons, warnings, explosions, other jets, radio voice and the adaptive score. Procedural Web Audio only.
// API (COMBAT.md §11): createCombatAudio(combat) -> { update(dt) } plus the settings documented in README.md
// (setMusicVolume, musicEnabled, setRadioVoice, setRadioVolume, setSfxVolume, mood, info).
// Shares the simulator's AudioContext and master bus (ctx.audio.graph). Until that exists and runs, everything is a
// silent no-op; nothing here touches Web Audio or the DOM before createCombatAudio() is called.
import * as THREE from 'three';
import { Dual, distCutoff } from '../../audio/perspective.js';
import { G } from './music/synth.js';
import { createPool, gunVoice, gunTail, missileLaunch, flare, airframeHit, hitTick, nearMiss, explosion } from './sfx.js';
import { createWarnings } from './warnings.js';
import { createRadio } from './radio.js';
import { roleOf } from './radio-queue.js';
import { createJets } from './jets.js';
import { createMusic } from './music/engine.js';
import { createMood } from './music/mood.js';
import { CUE_IDS } from './music/cues.js';
import { hash } from './music/theory.js';

export const MIX = { sfx: 1.0, cockpitInt: 1.0, warnings: 1.0, warnExterior: 0.75, radio: 1.0, music: 0.8, musicPaused: 0.35, musicMenu: 0.5, duckRadio: 0.6, duckWarn: 0.75 };
const C = 340, MAX_DELAY = 20;
const SEEK = { ir: ['ir-search', 'ir-lock'], rdr: ['rdr-search', 'rdr-lock'] };

export async function createCombatAudio(combat) {
  const ctx = combat.ctx, ev = combat.events;
  const raw = ctx.params?.raw || {};
  const set = {
    musicVolume: 0.8, musicOn: raw.music !== '0', radioVoice: raw.radiovoice !== '0', radioVolume: 1, sfxVolume: 1,
  };
  let A = null, failed = false;                   // the built graph
  const mood = createMood();
  const moodIn = { dt: 0, active: false, alive: true, result: null, enemyDist: Infinity, enemyCount: 0, friendCount: 0, weaponsAgo: Infinity, lockAny: false, threat: false, hp: 1, killAgo: Infinity };
  const st = { lastWeapon: -1e9, lastKill: -1e9, lastTick: 0, lastHit: 0, lastImpact: 0, lastFlare: 0, lastDry: 0, lastNear: 0, lowAmmo: false, winchester: false,
    rwrUntil: 0, launchUntil: 0, urgentUntil: 0, missileHit: null, missileHitT: -9, hpCaution: false, clock: 0 };
  const guns = new Map();                         // shooter -> gun voice
  const threats = [], flags = { rwrLock: false, launch: false, urgent: false, fire: false };
  const camW = new THREE.Vector3(), tmpC = new THREE.Vector3(), zero = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3();
  const warn = (e) => { try { console.warn('[combat audio]', e); } catch {} };

  // ---- graph -------------------------------------------------------------------------------------------------
  function ensure() {
    if (A) return A.ac.state === 'running';
    if (failed) return false;
    const g = ctx.audio?.graph; if (!g || !g.ac) return false;
    try { A = build(g); } catch (e) { failed = true; warn(e); return false; }
    return A.ac.state === 'running';
  }
  function build(g) {
    const ac = g.ac;
    const sfxBus = G(ac, MIX.sfx * set.sfxVolume); sfxBus.connect(g.flightIn);
    const cockpitD = new Dual(ac, sfxBus, { intLP: 2600 });      // the player's own guns, launches, flares, hits on the airframe
    const worldD = new Dual(ac, sfxBus, { intLP: 800 });         // explosions, other jets, distant guns
    const warnBus = G(ac, MIX.warnings); warnBus.connect(g.flightIn);
    const radioBus = G(ac, MIX.radio); radioBus.connect(g.flightIn);
    const musicBus = G(ac, 1); musicBus.connect(g.master);         // own pause / menu ducking (the flight bus is muted in pause)
    const pool = createPool(24);
    const music = createMusic(ac, musicBus, { cue: pickCue() });
    music.setVolume(set.musicVolume * MIX.music); music.setEnabled(set.musicOn);
    return {
      ac, g, sfxBus, cockpitD, worldD, warnBus, radioBus, musicBus, pool, music,
      warnings: createWarnings(ac, warnBus),
      radio: createRadio(ac, radioBus, { voice: set.radioVoice }),
      jets: createJets(ac, worldD.in, pool),
    };
  }
  function pickCue() {
    const m = combat.mission;
    if (m?.music && CUE_IDS.includes(m.music)) return m.music;
    const tod = m?.start?.tod ?? ctx.time?.timeOfDay;
    if (tod != null && (tod < 6.5 || tod > 19)) return 'nightfall';
    if (m?.id) return CUE_IDS[hash(m.id) % CUE_IDS.length];
    return 'sweep';
  }
  function camWorld() {
    const r = ctx.cameraRig;
    if (r?.worldPosition && Number.isFinite(r.worldPosition.x)) return r.worldPosition;
    if (!ctx.camera || !ctx.world?.toWorld) return camW.set(0, 0, 0);
    tmpC.copy(ctx.camera.position); return ctx.world.toWorld(tmpC, camW);
  }
  const camVel = () => (ctx.cameraRig?.velocity && Number.isFinite(ctx.cameraRig.velocity.x) ? ctx.cameraRig.velocity : zero);
  const camQuat = () => ctx.camera?.quaternion || tmpQ;
  /** pan (-1..1) of a world position in the camera frame */
  function panOf(p) {
    tmpV.copy(p).sub(camWorld()); const d = tmpV.length(); if (d < 1) return 0;
    tmpV.multiplyScalar(1 / d).applyQuaternion(tmpQ.copy(camQuat()).invert());
    return Math.max(-1, Math.min(1, tmpV.x)) * 0.85;
  }
  /** a one-shot at world position p: distance gain, pan, delay at the speed of sound; returns [dest, t, d, cutoff] */
  function spot(p, law = 400, gain = 1, life = 6) {
    const ac = A.ac, d = p ? p.distanceTo(camWorld()) : 0;
    const gn = G(ac, gain / (1 + d / law)), pn = ac.createStereoPanner(); pn.pan.value = p ? panOf(p) : 0;
    gn.connect(pn); pn.connect(A.worldD.in);
    const delay = Math.min(MAX_DELAY, d / C);
    setTimeout(() => { try { gn.disconnect(); pn.disconnect(); } catch {} }, (delay + life + 1) * 1000);
    return { dest: gn, t: ac.currentTime + 0.01 + delay, d, cutoff: distCutoff(d) };
  }
  const isP = (e) => !!e && (e.isPlayer || e === combat.world?.player);
  const now = () => A.ac.currentTime;
  const gunOf = (e) => {
    const g = e?.loadout?.gun || {}, type = g.type || '', rof = g.spec?.rof ?? g.rof ?? combat.weapons?.specs?.gun?.rof ?? 100;
    return { rof, heavy: type === 'gau8' || e?.def?.id === 'a10', medium: type === 'gau22' };
  };

  // ---- events --------------------------------------------------------------------------------------------------
  const on = (name, fn) => ev.on(name, (p) => { if (!ensure()) return; try { fn(p || {}); } catch (e) { warn(e); } });
  on('gun:start', ({ shooter }) => {
    if (!shooter) return; st.lastWeapon = st.clock;
    guns.get(shooter)?.stop(now());
    const G0 = gunOf(shooter);
    if (isP(shooter)) {
      const v = gunVoice(A.ac, A.pool, A.cockpitD.in, now() + 0.005, { rof: G0.rof, heavy: G0.heavy, level: G0.heavy ? 0.9 : G0.medium ? 1.05 : 1, spin0: 0.4, spinTc: (shooter.loadout?.gun?.spec?.spinUp ?? 0.35) / 3 });
      if (v) guns.set(shooter, v);
    } else {
      let far = 0; for (const v of guns.keys()) if (!isP(v)) far++;
      const d = shooter.state.position.distanceTo(camWorld()); if (d > 3000 || far >= 3) return;
      const s = spot(shooter.state.position, 180, 1.4, 30);
      const v = gunVoice(A.ac, A.pool, s.dest, s.t, { rof: G0.rof, heavy: G0.heavy, far: true, cutoff: s.cutoff, level: 0.9 });
      if (v) { v.delay = s.t - now(); guns.set(shooter, v); }
    }
  });
  on('gun:stop', ({ shooter }) => {
    const v = guns.get(shooter); if (!v) return; guns.delete(shooter);
    const t = now() + (v.delay || 0);
    v.stop(t);
    if (isP(shooter)) gunTail(A.ac, A.pool, A.cockpitD.in, t + 0.02, 1, gunOf(shooter).heavy);
  });
  on('missile:launch', ({ shooter }) => {
    st.lastWeapon = st.clock;
    if (isP(shooter)) { missileLaunch(A.ac, A.pool, A.cockpitD.in, now() + 0.01, { level: 1 }); return; }
    if (!shooter?.state) return;
    const s = spot(shooter.state.position, 300, 1.2, 6); if (s.d > 8000) return;
    missileLaunch(A.ac, A.pool, s.dest, s.t, { near: false, cutoff: s.cutoff, level: 1 });
  });
  on('flare', ({ entity }) => {
    if (isP(entity)) { const t = now(); if (t - st.lastFlare < 0.06) return; st.lastFlare = t; flare(A.ac, A.pool, A.cockpitD.in, t + 0.01, 1); return; }
    if (!entity?.state) return;
    const s = spot(entity.state.position, 120, 0.8, 3); if (s.d < 1500) flare(A.ac, A.pool, s.dest, s.t, 0.8);
  });
  on('damage', ({ target, amount = 5, weapon }) => {
    if (!isP(target)) return;
    const t = now(); if (t - st.lastImpact < 0.055) return; st.lastImpact = t;
    airframeHit(A.ac, A.pool, A.cockpitD.in, t + 0.005, weapon === 'missile' ? 1.5 : Math.max(0.35, Math.min(1.4, amount / 8)));
  });
  on('bullet:hit', ({ shooter }) => {
    if (!isP(shooter)) return;
    const t = now(); if (t - st.lastHit < 0.045) return; st.lastHit = t;
    hitTick(A.ac, A.pool, A.cockpitD.in, t + 0.005, 1);
  });
  on('bullet:near', ({ target, distance }) => {
    if (!isP(target)) return;
    const t = now(); if (t - st.lastNear < 0.05) return; st.lastNear = t;
    nearMiss(A.ac, A.pool, A.cockpitD.in, t + 0.005, Math.max(0.4, Math.min(1.2, 12 / ((distance ?? 10) + 2))));
  });
  on('missile:hit', ({ target, position }) => {
    st.missileHit = target; st.missileHitT = st.clock;
    const p = position || target?.state?.position; if (!p) return;
    const s = spot(p, 400, 1, 8); explosion(A.ac, A.pool, s.dest, s.t, { size: 1.3, cutoff: s.cutoff });
  });
  on('missile:miss', ({ position, detonated }) => {
    if (!detonated || !position) return;
    const s = spot(position, 400, 0.8, 6); if (s.d < 9000) explosion(A.ac, A.pool, s.dest, s.t, { size: 0.7, cutoff: s.cutoff });
  });
  on('kill', ({ victim, killer, weapon }) => {
    if (killer && isP(killer)) st.lastKill = st.clock;
    if (!victim || isP(victim) || victim.kind !== 'aircraft' || !victim.state) return;   // the player's death is the simulator's crash audio
    const missile = weapon === 'missile', recent = st.missileHit === victim && st.clock - st.missileHitT < 0.3;
    const s = spot(victim.state.position, 450, 1, 9);
    // a missile kill already has its warhead blast: add the airframe breaking up a beat later
    explosion(A.ac, A.pool, s.dest, s.t + (recent ? 0.22 : 0), { size: missile ? (recent ? 1.2 : 1.7) : 1.1, cutoff: s.cutoff });
  });
  on('wreck:impact', ({ position, entity }) => {
    const p = position || entity?.state?.position; if (!p) return;
    const s = spot(p, 500, 1.1, 8); if (s.d < 15000) explosion(A.ac, A.pool, s.dest, s.t, { size: 1.3, ground: true, cutoff: s.cutoff });
  });
  on('collision', ({ position, a, b }) => {
    if (isP(a) || isP(b) || !position) return;
    const s = spot(position, 450, 1, 8); explosion(A.ac, A.pool, s.dest, s.t, { size: 1.2, cutoff: s.cutoff });
  });
  on('rwr:lock', ({ target }) => { if (isP(target)) st.rwrUntil = st.clock + 2.5; });
  on('rwr:launch', ({ target }) => { if (isP(target)) { st.launchUntil = st.clock + 3; st.lastWeapon = st.clock; } });
  on('missile:active', ({ target }) => { if (isP(target)) st.urgentUntil = st.clock + 6; });
  on('weapon:nolock', ({ entity }) => { if (isP(entity)) A.warnings.noLock(now()); });
  on('target:change', ({ entity }) => { if (isP(entity)) { const t = now(); if (t - st.lastTick > 0.06) { st.lastTick = t; A.warnings.targetTick(t); } } });
  on('weapon:select', ({ entity }) => { if (isP(entity)) A.warnings.targetTick(now()); });
  on('fire:start', ({ target }) => { if (isP(target)) A.warnings.caution(now()); });
  on('engine:out', ({ target }) => { if (isP(target)) A.warnings.caution(now()); });
  on('radio', (r) => { if (r.text) A.radio.say({ text: r.text, from: r.from, priority: r.priority, role: roleOf(r, combat.world?.player?.callsign || '') }, now()); });
  on('mission:start', () => {
    A.music.stop(0.2); A.music.setCue(pickCue()); mood.reset();
    st.lowAmmo = st.winchester = st.hpCaution = false; st.lastKill = st.lastWeapon = -1e9; st.rwrUntil = st.launchUntil = st.urgentUntil = 0;
  });
  on('mission:abort', () => stopAll(0.4));
  on('player:down', () => { stopGuns(); A.warnings.stopAll(now()); });
  // radio lines and the like may arrive before the AudioContext runs; mission:abort must still reset state
  ev.on('mission:abort', () => { mood.reset(); });

  function stopGuns() { const t = A ? now() : 0; for (const v of guns.values()) { try { v.stop(t); } catch {} } guns.clear(); }
  function stopAll(fade) {
    if (!A) return;
    const t = now();
    stopGuns(); A.warnings.stopAll(t); A.radio.stop(t); A.jets.silence(t); A.music.stop(fade);
  }

  // ---- per frame ----------------------------------------------------------------------------------------------
  function update(dt) {
    if (!ensure()) return;
    const ac = A.ac, t = ac.currentTime, rdt = Math.min(0.1, Math.max(0.001, ctx.time?.realDt || dt || 1 / 60));
    st.clock += dt > 0 ? dt : 0;
    const paused = !!ctx.time?.paused, menu = !!ctx.menu?.isOpen, hold = paused || menu;
    const world = combat.world, p = world?.player, active = !!combat.active && !!p;
    const alive = !!p && p.alive !== false;
    // interior / exterior
    const mix = Math.max(0, Math.min(1, ctx.audio?.interiorMix ?? 0)), eS = Math.cos(mix * Math.PI / 2), iS = Math.sin(mix * Math.PI / 2);
    A.cockpitD.setExt(eS, 15000); A.cockpitD.setInt(iS * MIX.cockpitInt, 2600);
    A.worldD.setExt(eS, 14000); A.worldD.setInt(iS * 0.55, 800);
    A.warnBus.gain.setTargetAtTime(MIX.warnings * (MIX.warnExterior + (1 - MIX.warnExterior) * mix), t, 0.1);
    // ---- player systems ----
    let nMis = 0, urgent = false, lockOn = false;
    if (active && alive) {
      if (combat.weapons?.threatsTo) combat.weapons.threatsTo(p, threats);
      else { threats.length = 0; for (const m of combat.weapons?.missiles || []) if (m.target === p) threats.push({ type: 'missile', missile: m, range: m.state.position.distanceTo(p.state.position) }); }
      for (let i = 0; i < threats.length; i++) {
        const th = threats[i]; if (!th) continue;
        if (th.type === 'missile') { nMis++; if (th.missile?.active || (th.range ?? 1e9) < 3000) urgent = true; } else if (th.type === 'lock') lockOn = true;
      }
      if (!combat.weapons?.threatsTo) { if (st.clock < st.launchUntil) nMis = Math.max(nMis, 1); if (st.clock < st.rwrUntil) lockOn = true; }
      const L = p.lock, seeker = L?.seeker === 'radar' ? 'rdr' : 'ir';
      A.warnings.setSeeker(hold || !L || L.state === 'none' || !L.target ? 'none' : SEEK[seeker][L.state === 'locked' ? 1 : 0], t);
      flags.rwrLock = !hold && (lockOn || st.clock < st.rwrUntil); flags.launch = !hold && nMis > 0; flags.urgent = urgent || st.clock < st.urgentUntil; flags.fire = !hold && (p.damage?.fire || 0) > 0;
      A.warnings.update(t, flags);
      const g = p.loadout?.gun;
      if (g && !hold) {
        const frac = g.max ? g.rounds / g.max : 1;
        if (frac < 0.2 && g.rounds > 0 && !st.lowAmmo) { st.lowAmmo = true; A.warnings.lowAmmo(t); }
        if (g.rounds <= 0 && !st.winchester) { st.winchester = true; A.warnings.winchester(t); }
        if (g.rounds <= 0 && (combat.input?.trigger || p.trigger) && t - st.lastDry > 0.28) { st.lastDry = t; A.warnings.dryClick(t); }
        guns.get(p)?.setSpin?.(g.spin ?? 1, t);
      }
      const hp = p.maxHp ? p.hp / p.maxHp : 1;
      if (hp < 0.35 && !st.hpCaution) { st.hpCaution = true; A.warnings.caution(t); }
    } else { A.warnings.setSeeker('none', t); flags.rwrLock = flags.launch = flags.urgent = flags.fire = false; A.warnings.update(t, flags); }
    // ---- other jets ----
    A.jets.update(t, camWorld(), camVel(), camQuat(), world?.aircraft || [], combat.weapons?.missiles, active && !hold);
    // ---- radio ----
    A.radio.update(t, hold);
    // ---- music ----
    let ed = Infinity, ec = 0, fc = 0;
    if (active) for (const e of world.aircraft) {
      if (e === p || !e.alive) continue;
      if (e.team === p.team) fc++; else if (e.team !== 'neutral') { ec++; const d = e.state.position.distanceTo(p.state.position); if (d < ed) ed = d; }
    }
    moodIn.dt = dt > 0 ? dt : (hold ? 0 : rdt); moodIn.active = active; moodIn.alive = alive; moodIn.result = combat.result?.outcome || null;
    moodIn.enemyDist = ed; moodIn.enemyCount = ec; moodIn.friendCount = fc; moodIn.weaponsAgo = st.clock - st.lastWeapon;
    moodIn.lockAny = active && alive && ((p.lock?.state === 'locked') || lockOn); moodIn.threat = nMis > 0;
    moodIn.hp = p?.maxHp ? p.hp / p.maxHp : 1; moodIn.killAgo = st.clock - st.lastKill;
    const m = mood.update(moodIn);
    A.musicBus.gain.setTargetAtTime(paused ? MIX.musicPaused : menu ? MIX.musicMenu : 1, t, 0.25);
    A.music.setDuck(A.radio.speaking ? MIX.duckRadio : A.warnings.launchOn ? MIX.duckWarn : 1);
    try { A.music.update(t, set.musicOn ? m : 'off'); } catch (e) { warn(e); failed = true; A.music.dispose(); A.music.update = () => {}; }
  }

  const api = {
    update,
    get mood() { return mood.mood; },
    /** diagnostics: { cue, section, bar, mood, playing, voices } */
    get info() { return A ? { ...A.music.info, voices: A.pool.live, refused: A.pool.refused, radio: A.radio.current?.text || null, seeker: A.warnings.seeker } : null; },
    get musicVolume() { return set.musicVolume; },
    /** music level 0..1 (default 0.8) */
    setMusicVolume(v) { set.musicVolume = Math.max(0, Math.min(1, +v || 0)); A?.music.setVolume(set.musicVolume * MIX.music); },
    get musicEnabled() { return set.musicOn; },
    set musicEnabled(on) { api.setMusicEnabled(on); },
    setMusicEnabled(on) { set.musicOn = !!on; A?.music.setEnabled(set.musicOn); },
    get radioVoice() { return set.radioVoice; },
    /** speak radio lines with speech synthesis (true) or use the procedural radio murmur only (false) */
    setRadioVoice(on) { set.radioVoice = !!on; A?.radio.setVoice(set.radioVoice); },
    get radioVolume() { return set.radioVolume; },
    setRadioVolume(v) { set.radioVolume = Math.max(0, Math.min(1, +v || 0)); A?.radio.setVolume(set.radioVolume); },
    get sfxVolume() { return set.sfxVolume; },
    setSfxVolume(v) { set.sfxVolume = Math.max(0, Math.min(1, +v || 0)); if (A) A.sfxBus.gain.setTargetAtTime(MIX.sfx * set.sfxVolume, A.ac.currentTime, 0.05); },
  };
  return api;
}
