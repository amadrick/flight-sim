// The per-aircraft sound rig: engines, airframe noise, ground/mechanical layers, cockpit warnings.
// Pure Web Audio: works with a live AudioContext and with an OfflineAudioContext (verification harness).
import { gain, set, clamp, sat, smooth } from './dsp.js';
import { createEngineVoice } from './engines.js';
import { createAeroLayer, createMechLayer, createCabinLayer } from './aero.js';
import { Dual, distGain, distCutoff } from './perspective.js';
import * as sfx from './sfx.js';

const FT = 3.28084, RAD = 180 / Math.PI;
const CALLOUTS = [1000, 500, 100, 50, 40, 30, 20, 10];
const SPEECH = { 1000: 'one thousand', 500: 'five hundred', 100: 'one hundred', 50: 'fifty', 40: 'forty', 30: 'thirty', 20: 'twenty', 10: 'ten' };

function track(mem, key, val, rateKey, gdt) {
  if (mem[key] === null) { mem[key] = val; return; }
  const r = Math.abs(val - mem[key]) / gdt; mem[key] = val;
  mem[rateKey] += (r - mem[rateKey]) * (1 - Math.exp(-gdt / 0.12));
}

export function createRig(ac, dest, def, { speak } = {}) {
  const kind = def?.sound?.engine || 'jet-lowbypass';
  const airliner = kind === 'jet-highbypass' || def?.hudType === 'airliner' || def?.category === 'airliner' || def?.category === 'transport';
  const hasAB = def?.sound?.afterburner ?? kind === 'jet-lowbypass';
  const nEng = clamp(def?.specs?.engineCount || 1, 1, 6);
  const thrustRef = def?.specs?.thrustDry || def?.specs?.thrustMax || 0;
  const gearNames = (def?.geometry?.gear || []).map((g) => String(g.name || ''));
  const rigOut = gain(ac, 1); rigOut.connect(dest);

  // --- perspective stage -------------------------------------------------------------------------------
  const C = airliner
    ? { whine: [0.3, 1700], roar: [0.24, 520], aero: [0.14, 1800], mech: [0.45, 1400], eng: 2.0 }
    : { whine: [0.4, 2800], roar: [0.34, 850], aero: [0.55, 3600], mech: [0.8, 1900], eng: 2.0 };
  const dWhine = new Dual(ac, rigOut, { intLP: C.whine[1] }), dRoar = new Dual(ac, rigOut, { intLP: C.roar[1] }), dRev = new Dual(ac, rigOut, { intLP: C.roar[1] * 1.2 });
  const dAero = new Dual(ac, rigOut, { intLP: C.aero[1] }), dMech = new Dual(ac, rigOut, { intLP: C.mech[1] });
  const cabinOut = gain(ac, 0); cabinOut.connect(rigOut);
  const warnOut = gain(ac, 0); warnOut.connect(rigOut);

  // --- engines & layers --------------------------------------------------------------------------------
  const out = { whine: dWhine.in, roar: dRoar.in, rev: dRev.in };
  const voices = [];
  for (let i = 0; i < nEng; i++) {
    const pan = nEng === 1 ? 0 : (i / (nEng - 1) - 0.5) * (airliner ? 0.5 : 0.3);
    voices.push(createEngineVoice(ac, kind, out, { pan, hasAB, level: 1 }));
  }
  const aero = createAeroLayer(ac, dAero.in), mech = createMechLayer(ac, dMech.in), cabin = createCabinLayer(ac, cabinOut, airliner);

  // --- mutable memory ------------------------------------------------------------------------------------
  const mem = {
    gear: null, flaps: null, sb: null, gearRate: 0, flapRate: 0, sbRate: 0, lastClunk: -9, lastTick: -9, dist: 0,
    gOn: [], lastTD: [], vsPrev: 0, vsHold: 0, ap: null, over: false, running: [], t: 0, callArmed: {}, alarms: {}, engPower: 0, lastClick: -9,
  };
  const alarm = (name, active, now, play, minGap = 0) => {
    const a = mem.alarms[name] || (mem.alarms[name] = { on: false, next: 0 });
    if (!active) { a.on = false; return; }
    if (!a.on) { a.on = true; a.next = now + 0.02; }
    if (now + 0.15 >= a.next) { const d = play(Math.max(a.next, now)) || 0.4; a.next = Math.max(a.next, now) + Math.max(d, minGap); }
  };
  const forced = { stall: 0, over: 0 };

  function update(f) {
    const { dt, st, mix, L, now } = f;       // L: { dist, front, pan, dop }
    mem.t = now;
    const m = clamp(mix, 0, 1), iS = Math.sin(m * Math.PI / 2), eS = Math.cos(m * Math.PI / 2);
    const gdt = dt > 0 ? dt : 1 / 60;
    // ---- engines ----
    let maxPa = 0, anyRun = false, nRun = 0;
    for (let i = 0; i < voices.length; i++) {
      const e = st.engines?.[i]; if (!e) continue;
      const n1 = e.n1 ?? 0, n2 = e.n2 ?? n1;
      const thrFrac = thrustRef ? Math.min(1, Math.abs(e.thrust || 0) / thrustRef) : 0;
      const thr = Math.max(thrFrac, sat((n1 - 0.25) / 0.7) * 0.95);
      const running = e.running !== false;
      if (mem.running[i] === true && !running && !st.onGround) mem.masterCaution = now;
      mem.running[i] = running;
      anyRun = anyRun || running; if (running) nRun++;
      maxPa = Math.max(maxPa, running ? thr : 0);
      voices[i].update({ n1, n2, thr, ab: e.afterburner || 0, rev: e.reverser || 0, running }, L.dop, gdt);
    }
    mem.engPower = maxPa;
    // ---- perspective: engines ----
    const d = L.dist, dg = distGain(d), dc = distCutoff(d);
    const back = 0.5 - 0.5 * L.front, fwd = 0.5 + 0.5 * L.front;
    dWhine.setExt(eS * dg * C.eng * (0.2 + 0.8 * fwd), dc * (0.7 + 0.3 * fwd), L.pan);
    dRoar.setExt(eS * dg * C.eng * (0.3 + 0.7 * back), dc * (0.5 + 0.5 * back), L.pan);
    dRev.setExt(eS * dg * C.eng * (0.35 + 0.65 * fwd), dc, L.pan);
    dWhine.setInt(iS * C.whine[0]); dRoar.setInt(iS * C.roar[0]); dRev.setInt(iS * C.roar[0] * 1.1);
    // ---- aero ----
    const v = st.ias || 0, mach = st.mach || 0;
    const aoaDeg = Math.abs(st.aoa || 0) * RAD;
    const buffet = Math.max(st.stalled ? 1 : 0, st.stallWarning ? 0.4 : 0,
      smooth(airliner ? 9 : 13, airliner ? 16 : 24, aoaDeg) * 0.75, smooth(airliner ? 1.8 : 4.5, airliner ? 2.6 : 9, st.gLoad || 1) * 0.55,
      (f.turbulence || 0) * 0.12 * sat(v / 120));
    const sp = st.surfaces || {};
    const sbOut = Math.max(sp.speedbrake || 0, ((sp.spoilerL || 0) + (sp.spoilerR || 0)) * 0.5);
    aero.update({ v, mach, buffet, gearOut: sp.gear ?? 0, flapsOut: sp.flaps ?? 0, brakeOut: sbOut });
    dAero.setExt(eS * 0.6 * dg * 2, dc * 0.8, L.pan); dAero.setInt(iS * C.aero[0]);
    // ---- ground ----
    const gears = st.gear || [];
    let skid = 0; for (const g of gears) skid = Math.max(skid, g.skid || 0);
    const onGround = !!st.onGround || gears.some((g) => g.onGround);
    const gs = st.groundSpeed ?? 0;
    mech.update({ gs, rough: f.rough ?? 0.3, skid, brake: st.brakes || 0, onGround, gearRate: mem.gearRate, flapRate: mem.flapRate, sbRate: mem.sbRate });
    dMech.setExt(eS * 0.9 * dg * 2, dc, L.pan); dMech.setInt(iS * C.mech[0]);
    // ---- cabin ----
    cabin.update({ power: anyRun ? 1 : 0.15, v });
    set(cabinOut.gain, iS, 0.15);
    set(warnOut.gain, iS, 0.12);

    // ---- surface movement -> motors + clunks ----
    const gearPrevRate = mem.gearRate, flapPrevRate = mem.flapRate;
    track(mem, 'gear', sp.gear ?? 1, 'gearRate', gdt); track(mem, 'flaps', sp.flaps ?? 0, 'flapRate', gdt); track(mem, 'sb', sp.speedbrake ?? 0, 'sbRate', gdt);
    if (dt > 0) {
      const g = sp.gear ?? 1;
      if (gearPrevRate > 0.02 && mem.gearRate <= 0.02) { sfx.thunk(ac, dMech.in, now + 0.01, 1.2, 90); if (g < 0.5) sfx.thunk(ac, dMech.in, now + 0.2, 0.6, 140); }
      if (gearPrevRate <= 0.02 && mem.gearRate > 0.02 && now - mem.lastClunk > 0.6) { mem.lastClunk = now; sfx.thunk(ac, dMech.in, now + 0.01, 0.9, 120); }
      if (flapPrevRate > 0.02 && mem.flapRate <= 0.02) sfx.thunk(ac, dMech.in, now + 0.01, 0.4, 170);
    }

    // ---- touchdown (state-based fallback; physics 'touchdown' events de-duplicate through lastTD) ----
    if (dt > 0) {
      for (let i = 0; i < gears.length; i++) {
        const og = !!gears[i].onGround;
        if (mem.gOn[i] === false && og && now - (mem.lastTD[i] ?? -9) > 0.6) {
          touchdown({ verticalSpeed: Math.min(mem.vsHold, st.verticalSpeed || 0), gear: i }, now);
        }
        mem.gOn[i] = og;
      }
      if (!onGround) { mem.vsHold = st.verticalSpeed || 0; }
    }
    // runway joints
    if (onGround && gs > 3 && dt > 0) {
      mem.dist += gs * dt;
      if (mem.dist > 26) { mem.dist = 0; sfx.tick(ac, dMech.in, now + 0.005, (0.4 + 0.6 * sat(gs / 60)) * (0.5 + (f.rough ?? 0.3))); }
    }

    // ---- warnings (interior only: skipped when inaudible) ----
    if (m > 0.04 && dt > 0 && !f.muted) warnings(f, st, sp, now, airliner);
  }

  function warnings(f, st, sp, now) {
    const dest = warnOut;
    const stall = st.stallWarning || st.stalled || now < forced.stall;
    alarm('stall', stall, now, (t) => (airliner ? sfx.stickShaker(ac, dest, t, 0.5) : sfx.stallFighter(ac, dest, t)), airliner ? 0.5 : 0.7);
    alarm('over', !!st.overspeed || now < forced.over, now, (t) => sfx.clacker(ac, dest, t), 0.5);
    if (st.overG && !mem.over) mem.masterCaution = now;
    alarm('overg', !!st.overG, now, (t) => sfx.overG(ac, dest, t), 1.2);
    mem.over = !!st.overG;
    if (mem.masterCaution && now - mem.masterCaution < 0.2) { mem.masterCaution = 0; sfx.masterCaution(ac, dest, now + 0.05); }
    const agl = st.agl ?? 0, aglFt = agl * FT, air = !st.onGround;
    const gearUp = (sp.gear ?? 1) < 0.05, gearMoving = mem.gearRate > 0.02;
    const thrLever = st.throttle ?? 1;
    const hornCond = air && gearUp && !gearMoving && ((agl < 300 && thrLever < 0.25 && (st.verticalSpeed || 0) < 0.5) || (airliner && (st.flapsIndex || 0) >= 3 && agl < 600));
    alarm('horn', hornCond, now, (t) => sfx.gearHorn(ac, dest, t, airliner), airliner ? 1.2 : 1.5);
    // GPWS
    const vsFpm = -(st.verticalSpeed || 0) * 196.85, k = airliner ? 1 : 1.8;
    const pull = air && ((vsFpm > 2200 * k && aglFt < 1200) || (vsFpm > 1800 * k && aglFt < 450));
    const sink = air && !pull && vsFpm > 1500 * k && aglFt < 1000;
    alarm('pull', pull, now, (t) => { const d = sfx.whoop(ac, dest, t, 2); if (!(speak && speak('Pull up'))) sfx.pullUpTones(ac, dest, t + d); return d + 0.9; }, 2);
    alarm('sink', sink, now, (t) => { const d = sfx.whoop(ac, dest, t, 1); if (!(speak && speak('Sink rate'))) sfx.pullUpTones(ac, dest, t + d); return d + 1.4; }, 2.5);
    // radio-altitude call-outs (airliners)
    if (airliner) {
      const desc = (st.verticalSpeed || 0) < -0.4;
      for (const ft of CALLOUTS) {
        if (aglFt > ft * 1.25 + 8 || st.onGround) mem.callArmed[ft] = true;
        if (mem.callArmed[ft] !== false && aglFt <= ft && air && desc && aglFt > ft * 0.4 - 1) {
          mem.callArmed[ft] = false;
          if (!(speak && speak(SPEECH[ft]))) sfx.calloutTones(ac, dest, now + 0.02, ft);
        }
      }
    }
    // autopilot disconnect
    const apOn = !!st.ap?.engaged;
    if (mem.ap === true && !apOn) sfx.apDisconnect(ac, dest, now + 0.02);
    mem.ap = apOn;
  }

  function touchdown(ev, now = mem.t) {
    const i = ev?.gear ?? 0; mem.lastTD[i] = now;
    const vs = Math.abs(ev?.verticalSpeed ?? 0), s = clamp(0.25 + vs / 3.5, 0.25, 1.5);
    const nose = /nose|front/i.test(gearNames[i] || '') ;
    const t = ac.currentTime + 0.005;
    if (nose) sfx.noseThump(ac, dMech.in, t, clamp(s, 0.4, 1.2));
    else if (now - mem.firstMain > 0.8 || mem.firstMain === undefined) { mem.firstMain = now; sfx.touchdown(ac, dMech.in, t, s); }
    else sfx.noseThump(ac, dMech.in, t, clamp(s * 0.6, 0.25, 0.9));
  }
  mem.firstMain = -9;

  return {
    update, touchdown, voices, aero, mech, cabin, airliner, nEng,
    get enginePower() { return mem.engPower; },
    gearMoved() { mem.lastClunk = ac.currentTime; sfx.thunk(ac, dMech.in, ac.currentTime + 0.02, 1.0, 100); sfx.thunk(ac, dMech.in, ac.currentTime + 0.3, 0.5, 150); },
    flapsMoved() { sfx.thunk(ac, dMech.in, ac.currentTime + 0.02, 0.45, 180); },
    stallWarning() { forced.stall = ac.currentTime + 0.6; },
    overspeed() { forced.over = ac.currentTime + 0.6; },
    click(s = 1) { const n = ac.currentTime; if (n - mem.lastClick < 0.04) return; mem.lastClick = n; sfx.click(ac, warnOut, n + 0.005, s); },
    dispose() {
      set(rigOut.gain, 0, 0.02);
      const stopAll = () => {
        for (const v of voices) v.dispose();
        for (const l of [aero, mech, cabin]) for (const s of l.srcs || []) { try { s.stop(); } catch {} }
        for (const d of [dWhine, dRoar, dRev, dAero, dMech]) d.dispose();
        try { rigOut.disconnect(); cabinOut.disconnect(); warnOut.disconnect(); } catch {}
      };
      if (ac.state === 'running' && typeof setTimeout === 'function') setTimeout(stopAll, 120); else stopAll();
    },
  };
}
