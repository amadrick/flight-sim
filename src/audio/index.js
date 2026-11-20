// Skyward audio: fully procedural Web Audio sound (no samples). API: createAudio(ctx) -> { update(dt), resume(), setMasterVolume(v), masterVolume }
// The AudioContext is created lazily on the first user gesture (or resume()); until then everything is a silent no-op.
import * as THREE from 'three';
import { gain, set, clamp, sat } from './dsp.js';
import { createMaster } from './master.js';
import { createRig } from './rig.js';
import { createWeatherLayer } from './aero.js';
import { Dual, listenerGeometry, isInterior, distGain, distCutoff } from './perspective.js';
import * as sfx from './sfx.js';

const CLICK_CMDS = new Set(['gearToggle', 'flapsDown', 'flapsUp', 'speedbrakeToggle', 'parkingBrakeToggle', 'hookToggle', 'engineToggle', 'apToggle',
  'apAltHold', 'apHdgHold', 'apSpdHold', 'lightsToggle', 'canopyToggle', 'wingSweepToggle', 'trimUp', 'trimDown', 'trimReset']);
const GROUND_ROUGH = { runway: 0.2, taxiway: 0.3, apron: 0.3, deck: 0.25, terrain: 1.0, water: 0.5 };

export async function createAudio(ctx) {
  let ac = null, M = null, rig = null, wx = null, rainD = null, ambD = null, worldD = null, boomD = null;
  let volume = 0.8, mixS = 0, dopS = 1, prevDucked = false, camPrev = null, speaking = false;
  const tmpC = new THREE.Vector3(), camVel = new THREE.Vector3(), camW = new THREE.Vector3(), tmpG = {}, geo = { dist: 0, front: 0, pan: 0, dop: 1 };
  const ev = [];                       // event unsubscribers
  const warn = (e) => { try { console.warn('[audio]', e); } catch {} };

  function speak(text) {
    try {
      const ss = typeof window !== 'undefined' && window.speechSynthesis;
      if (!ss || typeof SpeechSynthesisUtterance === 'undefined' || !ss.getVoices || ss.getVoices().length === 0) return false;
      if (ctx.time?.paused || ctx.menu?.isOpen || mixS < 0.5) return true;       // silenced, but do not fall back to tones
      const u = new SpeechSynthesisUtterance(text); u.volume = clamp(volume, 0, 1) * 0.9; u.rate = 1.05; u.pitch = 0.8;
      ss.speak(u); speaking = true; return true;
    } catch { return false; }
  }

  function buildRig(player) {
    if (!ac || !M) return;
    if (rig) { rig.dispose(); rig = null; }
    try { rig = createRig(ac, M.flightIn, player.def, { speak }); } catch (e) { warn(e); rig = null; }
  }

  function ensure() {
    if (ac) return ac;
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext); if (!AC) return null;
    try { ac = new AC({ latencyHint: 'interactive' }); } catch (e) { warn(e); ac = null; return null; }
    try {
      M = createMaster(ac, ac.destination, Math.pow(volume, 1.5));
    } catch (e) { warn(e); }
    try {
      rainD = new Dual(ac, M.flightIn, { intLP: 9000 }); ambD = new Dual(ac, M.ambIn, { intLP: 600 });
      worldD = new Dual(ac, M.flightIn, { intLP: 700 }); boomD = new Dual(ac, M.flightIn, { intLP: 400 });
      wx = createWeatherLayer(ac, rainD.in, ambD.in);
      if (ctx.player) buildRig(ctx.player);
    } catch (e) { warn(e); }
    return ac;
  }
  function resume() {
    const a = ensure(); if (!a) return;
    try { if (a.state !== 'running') a.resume()?.catch?.(() => {}); } catch {}
  }
  // first user gesture
  const gestureEvents = ['pointerdown', 'keydown', 'touchstart', 'mousedown'];
  const onGesture = () => {
    resume();
    if (ac && ac.state === 'running') for (const n of gestureEvents) window.removeEventListener(n, onGesture, true);
  };
  if (typeof window !== 'undefined') for (const n of gestureEvents) window.addEventListener(n, onGesture, true);

  // pause the audio thread entirely while the tab is hidden (rAF stops, so voices would otherwise hold their last state)
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
    if (!ac) return;
    try { if (document.hidden) ac.suspend(); else ac.resume(); } catch {}
  });

  // ---- events --------------------------------------------------------------------------------------------
  const on = (name, fn) => ev.push(ctx.events.on(name, (p) => { if (!ac || !M || ac.state !== 'running') return; try { fn(p); } catch (e) { warn(e); } }));
  function worldShot(build, pos, { boom = false, delayDist } = {}) {
    // pos: world position of the source (or null = at the aircraft)
    const p = pos || ctx.player?.state?.position; const cam = camWorld();
    const d = p && cam ? p.distanceTo(cam) : 100;
    const g = gain(ac, 1), lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = distCutoff(d); lp.Q.value = 0.5;
    g.connect(lp); lp.connect(boom ? boomD.in : worldD.in);
    const delay = Math.min((delayDist ?? d) / 340, 30);
    const dur = build(g, ac.currentTime + 0.01 + delay, d) || 5;
    setTimeout(() => { try { g.disconnect(); lp.disconnect(); } catch {} }, (dur + delay + 1) * 1000);
    return g;
  }
  on('session:start', (pl) => buildRig(pl));
  on('session:end', () => { if (rig) { rig.dispose(); rig = null; } });
  on('touchdown', (e) => rig?.touchdown(e, ac.currentTime));
  on('gear:moved', () => rig?.gearMoved());
  on('flaps:moved', () => rig?.flapsMoved());
  on('stallWarning', () => rig?.stallWarning());
  on('overspeed', () => rig?.overspeed());
  on('cmd', (c) => { if (c && CLICK_CMDS.has(c.name)) rig?.click(1); });
  on('sonicBoom', () => worldShot((g, t, d) => { g.gain.value = 1.8 / (1 + d / 400); return sfx.sonicBoom(ac, g, t, 1); }, null, { boom: true }));
  // crash: the effects module classifies the impact and emits 'crash:fx' (boom scaled by the outcome, delayed by the
  // distance at the speed of sound, then a crackling fire); with ?crash=classic the old fixed explosion plays
  const crashClassic = ctx.params?.raw?.crash === 'classic';
  if (crashClassic) on('crash', () => worldShot((g, t, d) => { g.gain.value = 2.2 / (1 + d / 500); return sfx.explosion(ac, g, t, 1); }));
  let fireSrc = null, fireUntil = 0;
  on('crash:fx', (e) => {
    const p = e?.worldPos ? new THREE.Vector3(e.worldPos.x, e.worldPos.y, e.worldPos.z) : null;
    const k = e?.kind || 'impact';
    const s = { impact: 1.25, airburst: 1.1, breakup: 0.8, secondary: 0.6, waterImpact: 0.7, gearCollapse: 0.3, belly: 0.22, ditch: 0.3 }[k] ?? 1;
    worldShot((g, t, d) => {
      g.gain.value = 2.2 * s / (1 + d / 500);
      if (k === 'belly' || k === 'gearCollapse' || k === 'ditch') {   // crunch + grinding scrape, no blast
        sfx.thunk(ac, g, t, 1.2, 60); sfx.burst(ac, g, t, { kind: 'brown', filters: [['lowpass', 900, 0.7]], peak: 1.5, atk: 0.01, dec: 1.2 });
        sfx.burst(ac, g, t + 0.05, { kind: k === 'ditch' ? 'pink' : 'white', filters: [['bandpass', k === 'ditch' ? 900 : 2600, 0.8]], peak: 0.6, atk: 0.05, dec: 3.5 });
        return 5;
      }
      return sfx.explosion(ac, g, t, Math.min(1.3, s));
    }, p, { boom: k === 'impact' || k === 'airburst' });
    if (e?.fire && p) { fireSrc = p; fireUntil = ac.currentTime + 120; }
  });
  on('session:start', () => { fireSrc = null; });
  // crackling fire: sparse filtered-noise pops + a low roar, at the fire's distance (scheduled from update)
  function fireCrackle(rdt) {
    if (!fireSrc || ac.currentTime > fireUntil) return;
    const cam = camWorld(); if (!cam) return;
    const d = fireSrc.distanceTo(cam), life = clamp((fireUntil - ac.currentTime) / 60, 0, 1);
    const gl = 1.3 * life / (1 + d / 120);
    if (gl < 0.01) return;
    const n = Math.random() < rdt * 22 ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const t = ac.currentTime + 0.02 + Math.random() * 0.04 + d / 340;
      const g = gain(ac, gl * (0.25 + 0.75 * Math.random())); g.connect(worldD.in);
      sfx.burst(ac, g, t, { kind: 'white', filters: [['bandpass', 600 + Math.random() * 3200, 1.5 + Math.random() * 3]], peak: 0.5, atk: 0.001, dec: 0.015 + Math.random() * 0.05 });
      setTimeout(() => { try { g.disconnect(); } catch {} }, 1500 + d / 0.34);
    }
    if (Math.random() < rdt * 1.5) {
      const t = ac.currentTime + 0.05 + d / 340, g = gain(ac, gl * 0.6); g.connect(worldD.in);
      sfx.burst(ac, g, t, { kind: 'brown', filters: [['lowpass', 260, 0.7]], peak: 0.5, atk: 0.4, dec: 1.4 });
      setTimeout(() => { try { g.disconnect(); } catch {} }, 3000 + d / 0.34);
    }
  }
  on('lightning', (e) => {
    const p = e?.worldPos ? new THREE.Vector3(e.worldPos.x, e.worldPos.y, e.worldPos.z) : null;
    worldShot((g, t, d) => { g.gain.value = 3.0 / (1 + d / 3000); return sfx.thunder(ac, g, t, d, clamp(e?.intensity ?? 1, 0.2, 1.5)); }, p);
  });

  function camWorld() {
    const rigC = ctx.cameraRig;
    if (rigC?.worldPosition && isFinite(rigC.worldPosition.x)) return rigC.worldPosition;
    tmpC.copy(ctx.camera.position); return ctx.world.toWorld(tmpC, camW);
  }

  const api = {
    get masterVolume() { return volume; },
    set masterVolume(v) { api.setMasterVolume(v); },
    setMasterVolume(v) { volume = clamp(+v || 0, 0, 1); if (M) set(M.master.gain, Math.pow(volume, 1.5), 0.05); },
    resume,
    /** the live AudioContext (null until a user gesture / resume()) — for diagnostics */
    get audioContext() { return ac; },
    update(dt) {
      if (!ac || !M || ac.state !== 'running') return;
      const rdt = clamp(ctx.time?.realDt || dt || 1 / 60, 1e-3, 0.1), now = ac.currentTime;
      if (!ctx.time?.paused) fireCrackle(rdt);
      const paused = !!ctx.time?.paused, menuOpen = !!ctx.menu?.isOpen;
      const ducked = paused || menuOpen;
      set(M.flightIn.gain, paused ? 0 : menuOpen ? 0.12 : 1, paused ? 0.05 : 0.18);
      if (ducked && speaking) { try { window.speechSynthesis.cancel(); } catch {} speaking = false; }
      prevDucked = ducked;
      const player = ctx.player, st = player?.state;
      // interior mix (cockpit camera), relaxed when the canopy is open
      const target = isInterior(ctx) ? 1 - 0.65 * sat(st?.surfaces?.canopy ?? 0) : 0;
      mixS += (target - mixS) * (1 - Math.exp(-rdt / 0.22));
      const eS = Math.cos(mixS * Math.PI / 2), iS = Math.sin(mixS * Math.PI / 2);
      // weather / ambience (always alive, also under menus)
      const w = ctx.weather || {};
      wx?.update({ precip: w.precipitation || 0, wind: w.windSpeed || 0, speed: st?.ias || 0 });
      rainD?.setExt(eS * 0.55, 9000); rainD?.setInt(iS * (rig?.airliner ? 0.45 : 0.9));
      let ambK = 1;
      if (player && st) {
        const agl = st.agl ?? 0, p = rig?.enginePower ?? 0;
        ambK = sat(1 - agl / 250) * (1 - 0.85 * sat(p * 1.3));
      }
      ambD?.setExt(eS * ambK, 12000); ambD?.setInt(iS * 0.1 * ambK + (st?.surfaces?.canopy > 0.1 ? 0.5 * iS * ambK : 0), 500);
      set(M.ambIn.gain, paused ? 0.1 : menuOpen ? 0.55 : 1, 0.2);
      worldD?.setExt(eS, 14000); worldD?.setInt(iS * 0.55);
      boomD?.setExt(eS, 14000); boomD?.setInt(iS * 0.12);
      if (!rig || !player || !st) return;
      // ---- geometry ----
      const rc = ctx.cameraRig; const cp = camWorld();
      if (rc?.velocity && isFinite(rc.velocity.x)) camVel.copy(rc.velocity);
      else {
        if (camPrev && dt > 0) camVel.copy(cp).sub(camPrev).multiplyScalar(1 / dt); else camVel.set(0, 0, 0);
        if (camVel.lengthSq() > 1e6) camVel.set(0, 0, 0);
        camPrev = (camPrev || new THREE.Vector3()).copy(cp);
      }
      listenerGeometry(st.position, st.velocity, st.quaternion, cp, camVel, ctx.camera.quaternion, geo);
      if (mixS > 0.9) { geo.dop = 1; }
      dopS += (geo.dop - dopS) * (1 - Math.exp(-rdt / 0.06)); geo.dop = dopS;
      let rough = 0.3;
      try { const g = ctx.world.groundAt(st.position.x, st.position.z, tmpG); rough = GROUND_ROUGH[g.type] ?? 0.6; } catch {}
      rig.update({ dt, st, mix: mixS, L: geo, now, rough, turbulence: w.turbulence || 0, muted: ducked });
    },
  };
  return api;
}
