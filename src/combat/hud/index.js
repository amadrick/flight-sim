// COMBAT HUD — everything the player reads in a fight. API (COMBAT.md §9): createCombatHud(combat) -> { update(dt) } plus
// additive extras documented in README.md (setVisible, visible, radar, subtitles).
//   overlay canvas (world-registered line work): markers, target designator, off-screen cues, gun funnel + pipper,
//                  seeker / lock / launch-zone scale, threat warnings, hit markers, splash stamps, damage arcs + vignette
//   DOM (glass):   objectives + timer + score (top left), radar / RWR scope + stores panel + kill feed (top right),
//                  radio subtitles (bottom centre, above the flight-data strip), score pops, end banner, key hints
// Nothing here touches the DOM at module top level (node tools import the combat tree).
import * as THREE from 'three';
import { readTokens } from '../../ui/hud/common.js';
import { geometry, toBody, angleOff } from '../util.js';
import { createProjector, stripTop, clamp } from './math.js';
import { CSS } from './style.js';
import { createPanels } from './panels.js';
import { createRadar } from './radar.js';
import { createStatus } from './status.js';
import { createOverlay } from './overlay.js';
import { SEATS, seatMode, isCompact, applySeats } from './seats.js';

const HIST = 64, HIST_DT = 0.04;           // gun-line history: 64 samples at 25 Hz ≈ 2.5 s

export async function createCombatHud(combat) {
  const ctx = combat.ctx, doc = document;
  const tok = readTokens();
  const style = doc.createElement('style'); style.textContent = CSS; doc.head.appendChild(style);
  const stage = ctx.hudCanvas?.parentNode || ctx.uiRoot || doc.body;

  const cv = doc.createElement('canvas'); cv.className = 'cbt-hud-cv'; cv.setAttribute('aria-hidden', 'true');
  stage.appendChild(cv);
  const g = cv.getContext('2d');
  const root = doc.createElement('div'); root.className = 'cbt-hud-root'; root.hidden = true;
  stage.appendChild(root);

  let reducedMotion = false;
  try {
    const mq = matchMedia('(prefers-reduced-motion: reduce)'); reducedMotion = mq.matches;
    mq.addEventListener?.('change', (e) => { reducedMotion = e.matches; H.reduced = reducedMotion; });
  } catch {}
  let coarse = false; try { coarse = matchMedia('(pointer: coarse)').matches; } catch {}

  const panels = createPanels(root, { reduced: () => reducedMotion });
  const radar = createRadar(panels.radarCv, tok);
  const status = createStatus(panels.statCv, tok, combat.weapons?.specs);
  let radarMini = false;
  panels.radarBox.addEventListener('click', (e) => {
    e.stopPropagation();
    if (radarMini) { radarMini = false; panels.radarBox.classList.remove('cbt-hud-mini'); return; }
    const r = radar.cycle();
    if (r === 'auto') { radarMini = true; panels.radarBox.classList.add('cbt-hud-mini'); }
  });

  // ---- shared frame state (read by overlay.js) ----------------------------------------------------------
  const C = { hud: tok.hud, red: tok.warn, redHi: '#ff9a8a', blue: '#5ec8ff', amber: tok.accent, mag: '#ff6cf4', fg: tok.fg, dim: 'rgba(222,232,242,0.72)' };
  const mkHist = () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), t: 0 });
  const histBuf = Array.from({ length: HIST }, mkHist);
  const gunHist = { n: 0, head: 0, last: -1, at(i) { return histBuf[(this.head - 1 - i + HIST * 2) % HIST]; } };
  const threatPool = Array.from({ length: 16 }, () => ({ type: '', seeker: '', source: null, missile: null, range: 0 }));
  const H = {
    ctx, combat, tok, C, P: createProjector(), W: 2, H: 2, dpr: 1, t: 0, time: 0, reduced: reducedMotion, interior: false, compact: false,
    player: null, ax: 100, ay: 100, lzOff: 200, lzH: 120, warnY: 200, cueOff: 100, warnW: 200,
    fs: 13, fsWarn: 28, cw: 8, cwXS: 7, cwB: 8, fontXS: '', fontS: '', fontB: '', fontWarn: '', fontWarnS: '',
    geometry, gunHist, trajFn: null, trajHasVel: false,
    threats: [], lockers: [], six: null,
    hit: { t: 0, tt: 0, count: 0, target: null, last: -9, part: '' },
    near: { t: 0 }, msg: { t: 0, text: '', col: tok.fg },
    dmg: Array.from({ length: 4 }, () => ({ a: 0, t: 0, life: 0.9 })), dmgI: 0, vig: 0,
    splash: Array.from({ length: 4 }, () => ({ entity: null, t: 0, life: 1.8, x: NaN, y: NaN })), splashI: 0,
    camMode: null, cine: false, touch: false, camLabelY: 0, tgtOn: false, seat: 'wide', seatCompact: false,
    lockSnap: 0, cue: '', cueCol: tok.hud, cueGun: false, boreX: NaN, boreY: NaN, tgtX: 0, tgtY: 0, tgtS: 0, alwaysCross: true,
    missileSide(p, pos) { return toBody(p.state, pos, _v).x >= 0 ? 1 : -1; },
  };
  const _v = new THREE.Vector3();
  const overlay = createOverlay(H);
  if (combat.weapons?.gunTrajectory) H.trajFn = (p, t, out) => combat.weapons.gunTrajectory(p, t, out) || out;

  // ---- visibility (mirrors the simulator HUD's toggle) ---------------------------------------------------
  let userVisible = ctx.params?.hud !== false;
  ctx.events.on('cmd', (c) => { if (c?.name === 'hudToggle') userVisible = !userVisible; });

  // ---- layout ---------------------------------------------------------------------------------------------
  let lastStat = -1;
  let layoutKey = '', vignette = null, radarW = 212, statW = 212, seat = '', seatCompact = false, subsLeft = false, touch = false;
  function layout(W, Hh, dpr) {
    const k = W + 'x' + Hh + '@' + dpr + (touch ? 't' : '');
    if (k === layoutKey) return;
    layoutKey = k;
    H.compact = W < 640 || Hh < 520;
    const mode = seatMode(W, Hh, touch), cmp = isCompact(W, Hh);
    if (mode !== seat || cmp !== seatCompact) { seat = mode; seatCompact = cmp; subsLeft = applySeats(panels, root, mode, cmp).subsLeft; lastStat = -1; }
    H.seat = mode; H.seatCompact = cmp;
    const m = Math.min(W, Hh);
    H.fs = Math.round(clamp(m * 0.016, 11, 15));
    H.fsWarn = Math.round(clamp(m * 0.042, 20, 40));
    const mono = tok.mono, disp = tok.display;
    H.fontXS = `600 ${H.fs - 1}px ${mono}`; H.fontS = `600 ${H.fs}px ${mono}`; H.fontB = `700 ${H.fs + 1}px ${mono}`;
    H.fontWarn = `700 ${H.fsWarn}px ${disp}`; H.fontWarnS = `700 ${Math.round(H.fsWarn * 0.72)}px ${disp}`;
    H.cw = H.fs * 0.6; H.cwXS = (H.fs - 1) * 0.6; H.cwB = (H.fs + 1) * 0.6;
    H.warnW = H.fsWarn * 5.4;
    const margin = H.compact ? 40 : 56;
    H.ax = W / 2 - margin; H.ay = Math.min(Hh / 2 - margin, H.ax * 1.15);
    H.lzOff = Math.min(W * 0.2, 250); H.lzH = clamp(Hh * 0.2, 90, 170);
    H.warnY = Math.round(Hh * (H.compact ? 0.33 : 0.26));
    H.cueOff = Math.round(clamp(Hh * 0.17, 64, 140));
    // damage vignette, built once per size
    const vc = vignette || doc.createElement('canvas');
    const vw = 256, vh = Math.max(64, Math.round(256 * Hh / W));
    vc.width = vw; vc.height = vh;
    const vg = vc.getContext('2d');
    const grad = vg.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.32, vw / 2, vh / 2, Math.hypot(vw, vh) * 0.55);
    grad.addColorStop(0, 'rgba(160,0,0,0)'); grad.addColorStop(0.6, 'rgba(170,10,0,0.35)'); grad.addColorStop(1, 'rgba(120,0,0,0.85)');
    vg.fillStyle = grad; vg.fillRect(0, 0, vw, vh);
    vignette = vc;
    radarW = panels.radarBox.clientWidth || (H.compact ? 132 : 212);
    statW = panels.statBox.clientWidth || radarW;
    cv.classList.toggle('cbt-hud-shadow', ctx.quality?.level !== 'low');
  }
  ctx.events.on('quality:change', () => { layoutKey = ''; });

  // ---- events ---------------------------------------------------------------------------------------------
  const ev = combat.events;
  const isMe = (e) => e && e === combat.world?.player;
  function msg(text, col = tok.fg, t = 1.3) { H.msg.text = text; H.msg.col = col; H.msg.t = t; }
  function resetState() {
    H.hit.t = H.hit.tt = 0; H.hit.count = 0; H.hit.target = null; H.near.t = 0; H.msg.t = 0; H.vig = 0; H.lockSnap = 0;
    for (const d of H.dmg) d.t = 0;
    for (const s of H.splash) { s.t = 0; s.entity = null; }
    gunHist.n = 0; gunHist.head = 0; gunHist.last = -1;
    rwrLocks.length = 0; status.reset();
  }
  const rwrLocks = [];   // { source, t }
  ev.on('mission:start', () => {
    resetState(); panels.reset();
    panels.renderObjectives(combat.director?.objectives);
    panels.startHints(ctx.params?.raw?.hint !== '0');
    if (combat.weapons?.gunTrajectory) H.trajFn = (p, t, out) => combat.weapons.gunTrajectory(p, t, out) || out;
  });
  ev.on('mission:abort', () => { resetState(); panels.reset(); });
  ev.on('mission:end', (res) => panels.showBanner(res, combat.director?.stats));
  ev.on('objective:update', (e) => panels.renderObjectives(e?.objectives || combat.director?.objectives));
  ev.on('radio', (r) => panels.subQ.push(r));
  ev.on('score', (s) => { if (s?.points) panels.addPop(s.points, s.reason); if (s?.total != null) panels.setScore(s.total); });
  ev.on('kill', ({ victim, killer, weapon } = {}) => {
    if (!victim || victim.kind !== 'aircraft') return;
    const p = combat.world?.player;
    const name = (e) => `<b class="${e.team === (p?.team || 'blue') ? 'cbt-hud-b' : 'cbt-hud-r'}">${esc(e.callsign || e.name || 'Unknown')}</b>`;
    const w = weapon === 'gun' ? 'guns' : weapon === 'missile' ? 'missile' : weapon === 'terrain' ? 'crashed' : esc(weapon || '');
    panels.addKill(killer ? `${name(killer)} ▸ ${name(victim)} <i>· ${w}</i>` : `${name(victim)} <i>· ${w || 'destroyed'}</i>`, isMe(killer));
    if (isMe(killer)) {
      const s = H.splash[H.splashI++ % H.splash.length];
      s.entity = victim; s.t = s.life; s.x = NaN; s.y = NaN;
    }
  });
  ev.on('bullet:hit', ({ shooter, target, part } = {}) => {
    if (!isMe(shooter)) return;
    const now = H.t;
    H.hit.count = H.hit.target === target && now - H.hit.last < 1.5 ? H.hit.count + 1 : 1;
    H.hit.target = target; H.hit.last = now; H.hit.t = 0.22; H.hit.tt = 1.6; H.hit.part = typeof part === 'string' ? part : '';
  });
  ev.on('bullet:near', ({ target } = {}) => { if (isMe(target)) H.near.t = 1.1; });
  ev.on('damage', ({ target, amount, source, position } = {}) => {
    if (!isMe(target)) return;
    const pos = source?.state?.position || position;
    let a = Math.PI / 2;
    if (pos && H.P.w > 2) { H.P.point(pos.x - ctx.world.origin.x, pos.y - ctx.world.origin.y, pos.z - ctx.world.origin.z); a = Math.atan2(H.P.dy, H.P.dx); }
    const d = H.dmg[H.dmgI++ % H.dmg.length]; d.a = a; d.t = d.life;
    H.vig = Math.min(1, H.vig + clamp((amount || 10) / 45, 0.2, 0.8));
    if (source && source.kind === 'aircraft') H.near.t = Math.max(H.near.t, 0.6);
  });
  ev.on('lock:locked', ({ shooter } = {}) => { if (isMe(shooter)) H.lockSnap = 1; });
  ev.on('weapon:nolock', ({ entity } = {}) => { if (isMe(entity)) msg('NO LOCK', tok.accent); });
  ev.on('weapon:select', ({ entity, selected } = {}) => { if (isMe(entity)) msg((combat.weapons?.specs?.missiles?.[selected]?.short || String(selected || '').toUpperCase()) + ' SELECTED', tok.hud, 1.1); });
  const MISS = { timeout: 'MISSILE TIMED OUT', ground: 'MISSILE INTO GROUND', decoyed: 'MISSILE DECOYED', energy: 'MISSILE OUT OF ENERGY', lost: 'MISSILE LOST LOCK' };
  ev.on('missile:miss', ({ missile, reason } = {}) => {
    if (isMe(missile?.owner)) msg(MISS[reason] || 'MISSILE MISSED', tok.accent, 1.8);
    else if (isMe(missile?.target) || isMe(missile?.origTarget)) msg('MISSILE DEFEATED', tok.hud, 1.6);
  });
  ev.on('missile:active', ({ missile } = {}) => { if (isMe(missile?.owner)) msg('PITBULL', tok.hud, 1.4); });
  ev.on('fire:start', ({ target } = {}) => { if (isMe(target)) msg('ENGINE FIRE', tok.warn, 2.5); });
  ev.on('engine:out', ({ target } = {}) => { if (isMe(target)) msg('ENGINE OUT', tok.warn, 2.5); });
  ev.on('missile:decoyed', ({ missile, target } = {}) => { if (isMe(missile?.owner)) msg('DECOYED', tok.accent, 1.6); else if (isMe(target) || isMe(missile?.origTarget)) msg('FLARES WORKED', tok.hud, 1.6); });
  ev.on('rwr:lock', ({ source, target } = {}) => {
    if (!isMe(target) || !source) return;
    for (const r of rwrLocks) if (r.source === source) { r.t = 3; return; }
    rwrLocks.push({ source, t: 3 });
  });
  ev.on('cmd', ({ name } = {}) => { if (name) panels.usedHint(name === 'targetPrev' ? 'targetNext' : name); });
  ev.on('gun:start', ({ shooter } = {}) => { if (isMe(shooter)) panels.usedHint('gun'); });

  // ---- per-frame helpers ------------------------------------------------------------------------------------
  const tmpList = [];
  function gatherThreats(p) {
    const W = combat.weapons, out = H.threats;
    out.length = 0;
    let n = 0;
    if (typeof W.threatsTo === 'function') {
      tmpList.length = 0;
      const r = W.threatsTo(p, tmpList) || tmpList;
      for (let i = 0; i < r.length && n < threatPool.length; i++) {
        const s = r[i], th = threatPool[n++];
        th.type = s.type; th.seeker = s.seeker || ''; th.source = s.source || null; th.missile = s.missile || null; th.range = s.range || 0;
        out.push(th);
      }
    } else {
      for (const m of W.missiles) {
        if (n >= threatPool.length) break;
        if (m.alive && m.target === p) {
          const th = threatPool[n++];
          th.type = 'missile'; th.seeker = m.spec?.seeker || m.type || ''; th.source = m.owner || null; th.missile = m; th.range = m.state.position.distanceTo(p.state.position);
          out.push(th);
        }
      }
      for (const e of combat.world.aircraft) {
        if (n >= threatPool.length) break;
        if (e !== p && e.team !== p.team && e.lock?.state === 'locked' && e.lock.target === p) {
          const th = threatPool[n++];
          th.type = 'lock'; th.seeker = e.lock.seeker || ''; th.source = e; th.missile = null; th.range = e.state.position.distanceTo(p.state.position);
          out.push(th);
        }
      }
    }
    // lockers: lock threats + recent rwr:lock events, unique, nearest first
    H.lockers.length = 0;
    for (const th of out) if (th.type === 'lock' && th.source && H.lockers.indexOf(th.source) < 0) H.lockers.push(th.source);
    for (const r of rwrLocks) if (r.source.alive && H.lockers.indexOf(r.source) < 0) H.lockers.push(r.source);
    // bandit on the six: hostile within 1.8 km, in our rear 50° cone, nose on us
    H.six = null;
    let best = 1800 * 1800;
    for (const e of combat.world.aircraft) {
      if (e === p || e.team === p.team || e.team === 'neutral') continue;
      const d2 = e.state.position.distanceToSquared(p.state.position);
      if (d2 > best) continue;
      toBody(p.state, e.state.position, _v);
      const offTail = Math.atan2(Math.hypot(_v.x, _v.y), _v.z);
      if (offTail < 50 * Math.PI / 180 && angleOff(e.state, p.state.position) < 35 * Math.PI / 180) { best = d2; H.six = e; }
    }
  }
  function recordGun(p) {
    const now = combat.clock;
    if (gunHist.last >= 0 && now - gunHist.last < HIST_DT && now >= gunHist.last) return;
    if (now < gunHist.last) { gunHist.n = 0; }
    gunHist.last = now;
    const h = histBuf[gunHist.head];
    h.p.copy(p.state.position); h.v.copy(p.state.velocity); h.q.copy(p.state.quaternion); h.t = now;
    gunHist.head = (gunHist.head + 1) % HIST; gunHist.n = Math.min(HIST, gunHist.n + 1);
  }
  // the sim's own controls card (top left) — objectives step below it while it is up
  let simHint = null, hintShift = -1;
  function syncHintShift() {
    if (!simHint) simHint = doc.querySelector('.hud-hint');
    const up = !!simHint && !simHint.hidden && !simHint.classList.contains('off');
    const want = up ? simHint.offsetHeight + 10 : 0;
    if (want !== hintShift) { hintShift = want; panels.left.style.transform = want ? `translateY(${want}px)` : ''; panels.setHintsBlocked(up); }
  }

  let shown = false, frame = 0;
  function hide() {
    if (!shown) return;
    shown = false; root.hidden = true;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
  }

  return {
    /** additive: force the combat overlay on/off (the 'hudToggle' command flips the same switch) */
    setVisible(v) { userVisible = !!v; },
    get visible() { return shown; },
    radar, subtitles: panels.subQ,
    update(dt) {
      const rdt = ctx.time?.realDt ?? 1 / 60;
      H.t += rdt; H.time = combat.clock;
      const p = combat.world?.player;
      const mode = ctx.cameraRig?.mode || 'chase';
      const show = combat.active && !!p && userVisible && ctx.params?.hud !== false && !ctx.menu?.isOpen && !combat.ui?.isOpen && mode !== 'showcase';
      if (!show) { hide(); return; }
      if (!shown) { shown = true; root.hidden = false; }
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = Math.max(2, cv.clientWidth || window.innerWidth), Hh = Math.max(2, cv.clientHeight || window.innerHeight);
      const pw = Math.round(W * dpr), ph = Math.round(Hh * dpr);
      if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
      H.W = W; H.H = Hh; H.dpr = dpr; H.player = p; H.reduced = reducedMotion;
      touch = coarse || !!ctx.input?.touchEnabled;
      layout(W, Hh, dpr);
      H.camMode = combat.camera?.mode || null; H.touch = touch;
      H.camLabelY = H.seatCompact ? 30 : Math.min(Hh / 2 + H.cueOff + (H.camMode === 'padlock' ? H.fsWarn * 1.25 : 0), stripTop(W, Hh) - H.fs * 1.4);
      H.interior = ctx.cameraRig?.isInterior ?? mode === 'cockpit';
      const live = !ctx.time?.paused;

      // timers (real time)
      H.hit.t -= rdt; H.hit.tt -= rdt; H.near.t -= rdt; H.msg.t -= rdt; H.lockSnap = Math.max(0, H.lockSnap - rdt / 0.28);
      for (const d of H.dmg) d.t -= rdt;
      for (const s of H.splash) s.t -= rdt;
      for (let i = rwrLocks.length - 1; i >= 0; i--) if ((rwrLocks[i].t -= dt) <= 0) rwrLocks.splice(i, 1);
      const hpF = p.maxHp ? clamp((p.hp ?? p.maxHp) / p.maxHp, 0, 1) : 1;
      H.vig = Math.max(p.alive && hpF < 0.3 ? 0.3 * (1 - hpF / 0.3) + 0.12 : 0, H.vig - rdt * 0.9);

      // ---- overlay canvas ----
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, Hh);
      ctx.camera.updateMatrixWorld?.();
      H.P.set(ctx.camera, W, Hh);
      if (H.vig > 0.01) { g.globalAlpha = H.vig; g.drawImage(vignette, 0, 0, W, Hh); g.globalAlpha = 1; }
      g.lineCap = 'butt'; g.lineJoin = 'miter';
      if (p.alive) {
        if (dt > 0) recordGun(p);
        gatherThreats(p);
        overlay.draw(g, p);
      } else {
        H.threats.length = 0; H.lockers.length = 0; H.six = null;
        overlay.drawDead(g);
      }

      // ---- radar (every frame on desktop, every other frame on small screens) ----
      frame++;
      if (!radarMini && (!H.compact || (frame & 1) === 0)) {
        const D = radarData;
        D.player = p.alive ? p : null; D.aircraft = combat.world.aircraft; D.missiles = combat.weapons.missiles; D.target = p.target;
        D.waypoint = combat.director?.waypoint?.position || null;
        D.home = combat.director?.home?.position || ctx.player?.airport?.position || null;
        D.threats = H.threats; D.t = H.t; D.reduced = reducedMotion;
        radar.draw(D, radarW, dpr);
      }
      // ---- stores panel ----
      if (p.loadout) {
        const sh = status.draw(p, statW, dpr, seatCompact || seat === 'touch');
        if (sh !== lastStat) { lastStat = sh; panels.statBox.style.height = sh + 'px'; }
      }
      // ---- DOM panels ----
      panels.setTimer(combat.director?.timer);
      if (combat.director?.stats?.score != null) panels.setScore(combat.director.stats.score);
      if (!subsLeft) panels.setSubsBottom(H.interior ? Math.max(Hh * 0.05, 16) : Hh - stripTop(W, Hh) + SEATS.subsStripGap);
      panels.tick(rdt, live);
      syncHintShift();
    },
  };
}

const radarData = { player: null, aircraft: [], missiles: [], target: null, waypoint: null, home: null, threats: [], t: 0, reduced: false };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
