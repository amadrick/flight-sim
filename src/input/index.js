// INPUT — keyboard, mouse, gamepad, touch. API: createInput(ctx) -> { update(dt), bindings, mode, setMouseYoke(on), ... }
// Writes ctx.controls every frame; emits discrete commands as ctx.events.emit('cmd', { name }).
// Pure shaping logic lives in logic.js, the key map in bindings.js (both unit-tested, DOM-free).
import { clamp, approach, shapeAxis, shapeStick, stepKeyAxis, stepThrottle, snapDetent, milLever, AB_DETENT } from './logic.js';
import { KEY_TABLE, CODE_MAP, BINDINGS, GAMEPAD_BINDINGS } from './bindings.js';

const CSS = `
.inp-yoke{position:absolute;left:50%;top:50%;width:0;height:0;pointer-events:none!important;z-index:5}
.inp-yoke[hidden]{display:none}
.inp-yoke-ring{position:absolute;border:1.5px solid rgba(93,255,155,.55);border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 0 0 1px rgba(0,0,0,.35)}
.inp-yoke-dead{position:absolute;width:14px;height:14px;border:1px solid rgba(93,255,155,.45);border-radius:50%;transform:translate(-50%,-50%)}
.inp-yoke-dot{position:absolute;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:var(--hud,#5dff9b);box-shadow:0 0 6px rgba(93,255,155,.8),0 0 0 1px rgba(0,0,0,.5)}
.inp-yoke-tag{position:absolute;transform:translate(-50%,0);font:600 11px/1 var(--font-mono,monospace);letter-spacing:.14em;text-transform:uppercase;color:var(--hud,#5dff9b);opacity:.8;white-space:nowrap;text-shadow:0 1px 2px #000}
.inp-touch{position:absolute;inset:0;pointer-events:none!important;touch-action:none;z-index:6;font-family:var(--font-display,'Arial Narrow',Arial,sans-serif)}
.inp-touch[hidden]{display:none}
.inp-touch>*{pointer-events:auto;touch-action:none;-webkit-tap-highlight-color:transparent}
.inp-zone{position:absolute;left:0;top:26%;bottom:0;width:60%;pointer-events:auto}
.inp-base,.inp-knob{position:absolute;border-radius:50%;pointer-events:none!important;transform:translate(-50%,-50%);display:none}
.inp-base{width:120px;height:120px;border:2px solid rgba(230,237,243,.38);background:rgba(12,18,24,.28)}
.inp-base::after{content:"";position:absolute;inset:34px;border:1px dashed rgba(230,237,243,.22);border-radius:50%}
.inp-knob{width:58px;height:58px;background:rgba(255,176,0,.55);border:2px solid rgba(255,214,128,.85)}
.inp-hint{position:absolute;left:max(16px,env(safe-area-inset-left,0px));bottom:max(16px,env(safe-area-inset-bottom,0px));width:120px;height:120px;margin-left:0;border:2px dashed rgba(230,237,243,.22);border-radius:50%;pointer-events:none!important;display:grid;place-items:center;color:rgba(230,237,243,.4);font-size:12px;letter-spacing:.16em}
.inp-pnl{position:absolute;background:rgba(12,18,24,.5);border:1px solid rgba(143,161,179,.4);border-radius:12px;color:var(--fg,#e6edf3)}
.inp-thr{right:max(16px,env(safe-area-inset-right,0px));bottom:max(16px,env(safe-area-inset-bottom,0px));width:56px;height:clamp(150px,44vh,300px)}
.inp-thr-fill{position:absolute;left:4px;right:4px;bottom:4px;border-radius:8px;background:linear-gradient(0deg,rgba(255,176,0,.25),rgba(255,176,0,.6));pointer-events:none;height:0}
.inp-thr-knob{position:absolute;left:2px;right:2px;height:8px;margin-bottom:-4px;border-radius:4px;background:var(--accent,#ffb000);box-shadow:0 0 6px rgba(255,176,0,.8);pointer-events:none}
.inp-thr-mil{position:absolute;left:-4px;right:-4px;border-top:2px dashed var(--ok,#4cc9f0);pointer-events:none}
.inp-thr-mil::after{content:"MIL";position:absolute;right:8px;top:-13px;font:600 10px/1 var(--font-mono,monospace);letter-spacing:.1em;color:var(--ok,#4cc9f0)}
.inp-lbl{position:absolute;left:0;right:0;top:-18px;text-align:center;font-size:12px;letter-spacing:.18em;color:var(--fg-dim,#8fa1b3);pointer-events:none;text-transform:uppercase}
.inp-thr-pct{position:absolute;left:0;right:0;top:6px;text-align:center;font:600 12px/1 var(--font-mono,monospace);color:var(--fg,#e6edf3);pointer-events:none}
.inp-rud{left:50%;transform:translateX(-50%);bottom:max(16px,env(safe-area-inset-bottom,0px));width:clamp(140px,30vw,240px);height:46px}
.inp-rud::before{content:"";position:absolute;left:50%;top:8px;bottom:8px;border-left:1px solid rgba(143,161,179,.6)}
.inp-rud-knob{position:absolute;top:5px;bottom:5px;width:34px;margin-left:-17px;left:50%;border-radius:10px;background:rgba(255,176,0,.55);border:2px solid rgba(255,214,128,.85);pointer-events:none}
.inp-rud-lbl{position:absolute;top:-16px;left:0;right:0;text-align:center;font-size:11px;letter-spacing:.18em;color:var(--fg-dim,#8fa1b3);pointer-events:none}
.inp-btns{position:absolute;right:calc(max(16px,env(safe-area-inset-right,0px)) + 68px);bottom:calc(max(16px,env(safe-area-inset-bottom,0px)) + 62px);display:grid;grid-template-columns:repeat(2,48px);gap:8px}
.inp-btn{height:48px;min-width:48px;display:grid;place-items:center;border-radius:12px;background:rgba(12,18,24,.5);border:1px solid rgba(143,161,179,.45);color:var(--fg,#e6edf3);font-size:13px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;user-select:none;-webkit-user-select:none}
.inp-btn.on,.inp-btn.down{background:rgba(255,176,0,.5);border-color:var(--accent,#ffb000);color:#fff}
.inp-top{position:absolute;top:max(10px,env(safe-area-inset-top,0px));right:max(16px,env(safe-area-inset-right,0px));display:flex;gap:8px}
.inp-top .inp-btn{width:58px}
@media (prefers-reduced-motion:reduce){.inp-touch *{transition:none!important}}
`;

const MODES = new Set(['keyboard', 'mouse', 'gamepad', 'touch']);
const AXIS_IDS = ['pitchUp', 'pitchDown', 'rollLeft', 'rollRight', 'yawLeft', 'yawRight'];

export async function createInput(ctx) {
  const c = ctx.controls;
  const raw = (ctx.params && ctx.params.raw) || {};
  const canvas = ctx.canvas, uiRoot = ctx.uiRoot;

  const input = {
    mode: 'keyboard',
    bindings: BINDINGS,
    gamepadBindings: GAMEPAD_BINDINGS,
    lookDelta: { x: 0, y: 0 },   // px this frame (right-drag + right stick), for orbit-style cameras
    zoomDelta: 0,                // wheel notches this frame, + = scroll toward you (zoom out)
    mouseYoke: false,
    touchEnabled: false,
    gamepadConnected: false,
    update, setMouseYoke, setTouch,
    dispose,
  };

  // ---- state ----------------------------------------------------------------------------------------------
  const held = new Set();                                   // KeyboardEvent.code currently down
  const axes = { pitch: { v: 0, t: 0, dir: 0 }, roll: { v: 0, t: 0, dir: 0 }, yaw: { v: 0, t: 0, dir: 0 } };
  const thrKey = { t: 0, latched: false, extra: 0, dir: 0 };
  const thrPad = { t: 0, latched: false, extra: 0, dir: 0 };
  const idCodes = {};                                       // axis id -> codes
  for (const r of KEY_TABLE) if (r.kind === 'axis' || r.kind === 'throttle') idCodes[r.id] = r.codes;
  const down = (id) => { const cs = idCodes[id]; for (let i = 0; i < cs.length; i++) if (held.has(cs[i])) return true; return false; };

  const menuOpen = () => !!(ctx.menu && ctx.menu.isOpen);
  const hasAB = () => !!(ctx.player && ctx.player.def && ctx.player.def.sound && ctx.player.def.sound.afterburner);
  const setMode = (m) => { if (MODES.has(m)) input.mode = m; };
  const emit = (name) => ctx.events.emit('cmd', { name });
  const unsubs = [];
  const listeners = [];
  const on = (t, ev, fn, opt) => { t.addEventListener(ev, fn, opt); listeners.push([t, ev, fn, opt]); };

  function toggleSpeedbrake() { c.speedbrake = c.speedbrake > 0.5 ? 0 : 1; emit('speedbrakeToggle'); }
  function command(name) { emit(name); }
  function setThrottle(v) { c.throttle = clamp(v, 0, 1); thrKey.latched = false; thrPad.latched = false; }

  // ---- keyboard -------------------------------------------------------------------------------------------
  function isTyping(t, code) {
    if (!t || !t.tagName) return false;
    const tag = t.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || t.isContentEditable) return true;
    if (tag === 'BUTTON' && menuOpen() && code !== 'Escape') return true;
    return false;
  }

  function onKeyDown(e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const rows = CODE_MAP.get(e.code);
    if (!rows) return;
    if (isTyping(e.target, e.code)) return;
    const open = menuOpen();
    // pick the row (C / Shift+C share a code)
    let row = rows[0];
    if (rows.length > 1) row = rows.find((r) => !!r.shift === !!e.shiftKey) || rows[0];
    if (open && !(row.kind === 'cmd' && row.always)) return;       // menu owns every other key
    e.preventDefault();
    setMode('keyboard');
    if (row.kind === 'axis' || row.kind === 'hold' || row.id === 'throttleUp' || row.id === 'throttleDown') held.add(e.code);
    if (e.repeat) return;
    switch (row.kind) {
      case 'cmd': command(row.name); break;
      case 'local': if (row.id === 'speedbrake') toggleSpeedbrake(); else if (row.id === 'mouseYoke') setMouseYoke(!input.mouseYoke); break;
      case 'throttle':
        if (row.id === 'throttleIdle') setThrottle(0);
        else if (row.id === 'throttleMil') setThrottle(milLever(hasAB()));
        else if (row.id === 'throttleMax') setThrottle(1);
        break;
      default: break;
    }
  }
  function onKeyUp(e) { held.delete(e.code); if (CODE_MAP.has(e.code) && !(e.ctrlKey || e.altKey || e.metaKey) && !isTyping(e.target, e.code) && !menuOpen()) e.preventDefault(); }
  function releaseAll() {
    held.clear(); mouse.drag = false; mouse.dragId = -1; touchReleaseAll();
  }
  on(window, 'keydown', onKeyDown);
  on(window, 'keyup', onKeyUp);
  on(window, 'blur', releaseAll);
  on(document, 'visibilitychange', () => { if (document.hidden) releaseAll(); });

  // ---- mouse ----------------------------------------------------------------------------------------------
  const mouse = { drag: false, dragId: -1, lx: 0, ly: 0, accX: 0, accY: 0, px: 0, py: 0, hasPos: false, lookX: 0, lookY: 0, locked: false, yx: 0, yy: 0, pendX: 0, pendY: 0, zoomPend: 0 };
  canvas.tabIndex = -1; canvas.style.outline = 'none';
  const focusCanvas = () => { try { window.focus(); canvas.focus({ preventScroll: true }); } catch {} };
  function lookRange() { return 0.25 * Math.min(canvas.clientWidth || 800, canvas.clientHeight || 600); }

  on(canvas, 'contextmenu', (e) => e.preventDefault());
  on(canvas, 'pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    focusCanvas(); setMode('mouse');
    if (e.button === 2 || e.button === 1) {
      e.preventDefault();
      mouse.drag = true; mouse.dragId = e.pointerId; mouse.lx = e.clientX; mouse.ly = e.clientY;
      try { canvas.setPointerCapture(e.pointerId); } catch {}
    } else if (e.button === 0 && input.mouseYoke && !mouse.locked) requestLock();
  });
  on(window, 'pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    if (mouse.drag && e.pointerId === mouse.dragId) {
      const dx = mouse.locked ? e.movementX : e.clientX - mouse.lx, dy = mouse.locked ? e.movementY : e.clientY - mouse.ly;
      mouse.lx = e.clientX; mouse.ly = e.clientY;
      mouse.accX += dx; mouse.accY += dy; mouse.pendX += dx; mouse.pendY += dy;
      return;
    }
    mouse.px = e.clientX; mouse.py = e.clientY; mouse.hasPos = true;
    if (input.mouseYoke) {
      setMode('mouse');
      if (mouse.locked) { const R = yokeRadius(); mouse.yx += e.movementX / R; mouse.yy += e.movementY / R; clampYoke(); }
    }
  });
  const endDrag = (e) => { if (mouse.drag && e.pointerId === mouse.dragId) { mouse.drag = false; mouse.dragId = -1; } };
  on(window, 'pointerup', endDrag); on(window, 'pointercancel', endDrag);
  on(canvas, 'wheel', (e) => {
    e.preventDefault(); setMode('mouse');
    const n = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1) / 100;
    mouse.zoomPend += n;
  }, { passive: false });
  on(document, 'pointerlockchange', () => { mouse.locked = document.pointerLockElement === canvas; if (!mouse.locked && !input.mouseYoke) { mouse.yx = mouse.yy = 0; } });
  function requestLock() { try { const p = canvas.requestPointerLock && canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch {} }
  function clampYoke() { const m = Math.hypot(mouse.yx, mouse.yy); if (m > 1) { mouse.yx /= m; mouse.yy /= m; } }
  const yokeRadius = () => 0.38 * Math.min(canvas.clientWidth || 800, canvas.clientHeight || 600);

  // yoke indicator (DOM)
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const yokeEl = document.createElement('div'); yokeEl.className = 'inp-yoke'; yokeEl.hidden = true;
  yokeEl.innerHTML = '<div class="inp-yoke-ring"></div><div class="inp-yoke-dead"></div><div class="inp-yoke-dot"></div><div class="inp-yoke-tag">Mouse yoke &middot; M to release</div>';
  uiRoot.appendChild(yokeEl);
  const yRing = yokeEl.firstChild, yDot = yokeEl.querySelector('.inp-yoke-dot'), yTag = yokeEl.querySelector('.inp-yoke-tag');
  let yokeSize = 0;
  function setMouseYoke(on_) {
    on_ = !!on_;
    if (on_ === input.mouseYoke) return;
    input.mouseYoke = on_;
    mouse.yx = mouse.yy = 0;
    if (!on_ && document.pointerLockElement === canvas) { try { document.exitPointerLock(); } catch {} }
    if (on_) { setMode('mouse'); if (!mouse.hasPos) { mouse.px = (canvas.clientWidth || 800) / 2; mouse.py = (canvas.clientHeight || 600) / 2; } }
    yokeEl.hidden = !on_;
  }

  // ---- gamepad ----------------------------------------------------------------------------------------------
  const pad = { roll: 0, pitch: 0, yaw: 0, lookX: 0, lookY: 0, rate: 0, abs: null, brakes: false, prev: [], rep: 0, repT: 0, lastAbs: null, seen: false };
  const stk = { x: 0, y: 0 };
  function pollPad(dt) {
    pad.roll = pad.pitch = pad.yaw = pad.lookX = pad.lookY = pad.rate = 0; pad.abs = null; pad.brakes = false;
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    let gp = null;
    try { const l = navigator.getGamepads(); for (let i = 0; i < l.length; i++) if (l[i] && l[i].connected) { gp = l[i]; break; } } catch { return; }
    input.gamepadConnected = !!gp;
    if (!gp) { pad.prev.length = 0; return; }
    const ax = gp.axes, bt = gp.buttons;
    const std = gp.mapping === 'standard' || ax.length < 4;
    let activity = false;
    const b = (i) => (bt[i] ? bt[i].value || (bt[i].pressed ? 1 : 0) : 0);
    if (std) {
      shapeStick(ax[0] || 0, ax[1] || 0, stk, 0.1, 0.4); pad.roll = stk.x; pad.pitch = stk.y;
      shapeStick(ax[2] || 0, ax[3] || 0, stk, 0.12, 0.2); pad.lookX = stk.x; pad.lookY = stk.y;
      const rt = b(7), lt = b(6);
      pad.rate = (rt > 0.06 ? rt : 0) - (lt > 0.06 ? lt : 0);
      pad.yaw = b(5) - b(4);
      pad.brakes = !!(bt[10] && bt[10].pressed);
    } else {
      // Best-effort HOTAS / flight-stick layout (Logitech Extreme 3D style): X/Y stick, axis 2 twist = rudder, axis 3 = throttle slider.
      shapeStick(ax[0] || 0, ax[1] || 0, stk, 0.06, 0.25); pad.roll = stk.x; pad.pitch = stk.y;
      pad.yaw = shapeAxis(ax[2] || 0, 0.15, 0.2);
      if (ax.length >= 4) {
        const t = clamp((1 - (ax[3] || 0)) / 2, 0, 1);
        if (pad.lastAbs === null) pad.lastAbs = t;
        if (Math.abs(t - pad.lastAbs) > 0.004) { pad.abs = t; pad.lastAbs = t; }
      }
      pad.brakes = !!(bt[1] && bt[1].pressed);
    }
    if (pad.roll || pad.pitch || pad.yaw || pad.lookX || pad.lookY || pad.rate || pad.brakes) activity = true;
    // edge-triggered buttons
    const prev = pad.prev;
    const press = (i) => { const p = !!(bt[i] && bt[i].pressed); const was = !!prev[i]; prev[i] = p; if (p && !was) activity = true; return p && !was; };
    const open = menuOpen();
    const fire = (name, always) => { if (!open || always) command(name); };
    if (std) {
      if (press(0) && !open) command('gearToggle');
      if (press(1) && !open) toggleSpeedbrake();
      if (press(2)) fire('flapsDown');
      if (press(3)) fire('flapsUp');
      if (press(8)) fire('cameraNext');
      if (press(9)) fire('menu', true);
      if (press(14)) fire('cameraPrev');
      if (press(15)) fire('cameraNext');
      // trim with auto-repeat
      const up = !!(bt[12] && bt[12].pressed), dn = !!(bt[13] && bt[13].pressed);
      const rep = up ? 1 : dn ? -1 : 0;
      if (rep !== 0 && !open) {
        activity = true;
        if (pad.rep !== rep) { pad.rep = rep; pad.repT = 0.35; command(rep > 0 ? 'trimUp' : 'trimDown'); }
        else { pad.repT -= dt; if (pad.repT <= 0) { pad.repT = 0.12; command(rep > 0 ? 'trimUp' : 'trimDown'); } }
      } else pad.rep = 0;
      prev[12] = up; prev[13] = dn;
    } else {
      if (press(2)) fire('gearToggle');
      if (press(3)) if (!open) toggleSpeedbrake();
      if (press(4)) fire('flapsDown');
      if (press(5)) fire('flapsUp');
      if (press(7)) fire('cameraNext');
      if (press(11)) fire('menu', true);
    }
    if (activity) setMode('gamepad');
  }

  // ---- touch -------------------------------------------------------------------------------------------------
  const touch = { stick: { id: -1, ox: 0, oy: 0, x: 0, y: 0 }, thr: { id: -1 }, rud: { id: -1, v: 0 }, roll: 0, pitch: 0, yaw: 0, brake: false, absThr: null, held: new Map() };
  const coarse = (() => { try { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch { return false; } })();
  let touchEl = null, tBase, tKnob, tThrFill, tThrKnob, tThrPct, tRudKnob, tThrMil, tBtnSpd, tHint;
  let touchVisible = false;
  const tRect = { zone: null };

  function buildTouch() {
    touchEl = document.createElement('div'); touchEl.className = 'inp-touch'; touchEl.hidden = true;
    touchEl.innerHTML = `
      <div class="inp-zone"></div>
      <div class="inp-hint">ROLL / PITCH</div>
      <div class="inp-base"></div><div class="inp-knob"></div>
      <div class="inp-pnl inp-thr"><div class="inp-lbl">THR</div><div class="inp-thr-fill"></div><div class="inp-thr-mil" hidden></div><div class="inp-thr-knob"></div><div class="inp-thr-pct">0</div></div>
      <div class="inp-pnl inp-rud"><div class="inp-rud-lbl">RUDDER</div><div class="inp-rud-knob"></div></div>
      <div class="inp-btns"></div>
      <div class="inp-top"></div>`;
    uiRoot.appendChild(touchEl);
    const $ = (s) => touchEl.querySelector(s);
    tBase = $('.inp-base'); tKnob = $('.inp-knob'); tHint = $('.inp-hint');
    tThrFill = $('.inp-thr-fill'); tThrKnob = $('.inp-thr-knob'); tThrPct = $('.inp-thr-pct'); tThrMil = $('.inp-thr-mil');
    tRudKnob = $('.inp-rud-knob');
    const zone = $('.inp-zone'), thr = $('.inp-thr'), rud = $('.inp-rud');

    // floating virtual stick
    const R = () => clamp(0.13 * Math.min(window.innerWidth, window.innerHeight), 44, 64);
    const st = touch.stick;
    zone.addEventListener('pointerdown', (e) => {
      if (st.id !== -1) return;
      e.preventDefault(); setMode('touch'); st.id = e.pointerId; try { zone.setPointerCapture(e.pointerId); } catch {}
      const r = zone.getBoundingClientRect();
      st.ox = clamp(e.clientX - r.left, 62, r.width - 62) + r.left; st.oy = clamp(e.clientY - r.top, 62, r.height - 62) + r.top;
      st.x = e.clientX; st.y = e.clientY;
      tBase.style.display = tKnob.style.display = 'block'; tHint.style.display = 'none';
      moveStick(e.clientX, e.clientY);
    });
    zone.addEventListener('pointermove', (e) => { if (e.pointerId === st.id) { e.preventDefault(); moveStick(e.clientX, e.clientY); } });
    const endStick = (e) => { if (e.pointerId === st.id) stickUp(); };
    zone.addEventListener('pointerup', endStick); zone.addEventListener('pointercancel', endStick); zone.addEventListener('lostpointercapture', endStick);
    function moveStick(px, py) {
      const rad = R();
      let dx = px - st.ox, dy = py - st.oy; const d = Math.hypot(dx, dy);
      if (d > rad) { const k = (d - rad) / d; st.ox += dx * k; st.oy += dy * k; dx = px - st.ox; dy = py - st.oy; }  // origin trails the thumb
      const r = zone.getBoundingClientRect(), pr = touchEl.getBoundingClientRect();
      tBase.style.left = (st.ox - pr.left) + 'px'; tBase.style.top = (st.oy - pr.top) + 'px';
      tKnob.style.left = (px - pr.left - (px - st.ox - dx) + 0) + 'px'; tKnob.style.top = (py - pr.top - (py - st.oy - dy)) + 'px';
      const kx = clamp(dx / rad, -1, 1), ky = clamp(dy / rad, -1, 1);
      shapeStick(kx, ky, stk, 0.07, 0.4); touch.roll = stk.x; touch.pitch = stk.y;
      void r;
    }
    function stickUp() { st.id = -1; touch.roll = touch.pitch = 0; tBase.style.display = tKnob.style.display = 'none'; tHint.style.display = 'grid'; }
    touch.stickUp = stickUp;

    // throttle slider (absolute)
    const tr = touch.thr;
    const thrSet = (e) => {
      const r = thr.getBoundingClientRect();
      const pad_ = 14, h = Math.max(1, r.height - 2 * pad_);
      let v = clamp(1 - (e.clientY - r.top - pad_) / h, 0, 1);
      if (v < 0.03) v = 0; if (v > 0.985) v = 1;
      touch.absThr = snapDetent(v, hasAB(), 0.04);
    };
    thr.addEventListener('pointerdown', (e) => { if (tr.id !== -1) return; e.preventDefault(); setMode('touch'); tr.id = e.pointerId; try { thr.setPointerCapture(e.pointerId); } catch {} thrSet(e); });
    thr.addEventListener('pointermove', (e) => { if (e.pointerId === tr.id) { e.preventDefault(); thrSet(e); } });
    const endThr = (e) => { if (e.pointerId === tr.id) { tr.id = -1; } };
    thr.addEventListener('pointerup', endThr); thr.addEventListener('pointercancel', endThr); thr.addEventListener('lostpointercapture', endThr);

    // rudder twist slider (springs to centre)
    const ru = touch.rud;
    const rudSet = (e) => { const r = rud.getBoundingClientRect(); const v = clamp(((e.clientX - r.left) / r.width - 0.5) * 2 / 0.86, -1, 1); touch.yaw = shapeAxis(v, 0.06, 0.2); ru.v = v; };
    rud.addEventListener('pointerdown', (e) => { if (ru.id !== -1) return; e.preventDefault(); setMode('touch'); ru.id = e.pointerId; try { rud.setPointerCapture(e.pointerId); } catch {} rudSet(e); });
    rud.addEventListener('pointermove', (e) => { if (e.pointerId === ru.id) { e.preventDefault(); rudSet(e); } });
    const endRud = (e) => { if (e.pointerId === ru.id) { ru.id = -1; ru.v = 0; touch.yaw = 0; } };
    rud.addEventListener('pointerup', endRud); rud.addEventListener('pointercancel', endRud); rud.addEventListener('lostpointercapture', endRud);

    // buttons
    const mk = (parent, label, aria, fn, holdKey) => {
      const b = document.createElement('div'); b.className = 'inp-btn'; b.textContent = label; b.setAttribute('role', 'button'); b.setAttribute('aria-label', aria);
      let pid = -1;
      b.addEventListener('pointerdown', (e) => {
        if (pid !== -1) return;
        e.preventDefault(); setMode('touch'); pid = e.pointerId; b.classList.add('down'); try { b.setPointerCapture(e.pointerId); } catch {}
        if (holdKey) touch[holdKey] = true; else fn();
      });
      const up = (e) => { if (e.pointerId !== pid) return; pid = -1; b.classList.remove('down'); if (holdKey) touch[holdKey] = false; };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
      b._release = () => { pid = -1; b.classList.remove('down'); if (holdKey) touch[holdKey] = false; };
      parent.appendChild(b); return b;
    };
    const btns = $('.inp-btns'), top = $('.inp-top');
    mk(btns, 'Gear', 'Landing gear', () => command('gearToggle'));
    mk(btns, 'Flap −', 'Flaps retract', () => command('flapsUp'));
    mk(btns, 'Brake', 'Wheel brakes (hold)', null, 'brake');
    mk(btns, 'Flap +', 'Flaps extend', () => command('flapsDown'));
    tBtnSpd = mk(btns, 'Spd Brk', 'Speedbrake', () => toggleSpeedbrake());
    mk(btns, 'Cam', 'Next camera', () => command('cameraNext'));
    mk(top, 'Pause', 'Pause', () => command('pause'));
    mk(top, 'Menu', 'Menu', () => command('menu'));
    touch.buttons = touchEl.querySelectorAll('.inp-btn');
  }

  function touchReleaseAll() {
    if (!touchEl) return;
    touch.stickUp && touch.stickUp();
    touch.thr.id = -1; touch.rud.id = -1; touch.rud.v = 0; touch.yaw = 0; touch.brake = false; touch.absThr = null;
    touch.buttons.forEach((b) => b._release && b._release());
  }
  function setTouch(on_) {
    on_ = !!on_;
    if (on_ && !touchEl) buildTouch();
    input.touchEnabled = on_;
    if (!on_) { touchReleaseAll(); if (touchEl) touchEl.hidden = true; touchVisible = false; }
  }
  setTouch(raw.touch === '1' || (coarse && raw.touch !== '0'));

  // ---- session -----------------------------------------------------------------------------------------------
  unsubs.push(ctx.events.on('session:start', () => {
    // adopt whatever lever position physics set; just clear transient detent/ramp state
    thrKey.t = thrPad.t = 0; thrKey.latched = thrPad.latched = false; thrKey.dir = thrPad.dir = 0;
    pad.lastAbs = null; touch.absThr = null;
  }));

  // ---- per-frame update -------------------------------------------------------------------------------------
  const ANALOG_EPS = 1e-3;
  function update(dt) {
    dt = clamp(dt || 0, 0, 0.1);
    const open = menuOpen();
    const ab = hasAB();

    // visibility of touch UI
    if (touchEl) {
      const show = input.touchEnabled && !open && !(ctx.cameraRig && ctx.cameraRig.mode === 'showcase');
      if (show !== touchVisible) { touchVisible = show; touchEl.hidden = !show; if (!show) touchReleaseAll(); }
    }
    yokeEl.hidden = !(input.mouseYoke && !open);

    pollPad(dt);

    // keyboard axes (relax to neutral while the menu is open)
    const dir = (neg, pos) => (open ? 0 : (down(pos) ? 1 : 0) - (down(neg) ? 1 : 0));
    const kPitch = stepKeyAxis(axes.pitch, dir('pitchDown', 'pitchUp'), dt);
    const kRoll = stepKeyAxis(axes.roll, dir('rollLeft', 'rollRight'), dt);
    const kYaw = stepKeyAxis(axes.yaw, dir('yawLeft', 'yawRight'), dt);

    // mouse yoke
    let yRoll = 0, yPitch = 0;
    if (input.mouseYoke && !open) {
      if (!mouse.locked) {
        const r = canvas.getBoundingClientRect(), R = yokeRadius();
        mouse.yx = (mouse.px - (r.left + r.width / 2)) / R; mouse.yy = (mouse.py - (r.top + r.height / 2)) / R; clampYoke();
      }
      shapeStick(mouse.yx, mouse.yy, stk, 0.05, 0.3); yRoll = stk.x; yPitch = stk.y;
      const R = yokeRadius(), sz = Math.round(R * 2);
      if (sz !== yokeSize) { yokeSize = sz; yRing.style.width = yRing.style.height = sz + 'px'; yTag.style.top = (R + 10) + 'px'; }
      yDot.style.transform = `translate(${(mouse.yx * R).toFixed(1)}px,${(mouse.yy * R).toFixed(1)}px)`;
    }

    // combine: analog (touch > gamepad > mouse yoke) overrides the keyboard per axis when it is off-centre
    let roll = kRoll, pitch = kPitch, yaw = kYaw;
    if (!open) {
      if (Math.abs(yRoll) > ANALOG_EPS) roll = yRoll;
      if (Math.abs(yPitch) > ANALOG_EPS) pitch = yPitch;
      if (Math.abs(pad.roll) > ANALOG_EPS) roll = pad.roll;
      if (Math.abs(pad.pitch) > ANALOG_EPS) pitch = pad.pitch;
      if (Math.abs(pad.yaw) > ANALOG_EPS) yaw = pad.yaw;
      if (touchVisible) {
        if (Math.abs(touch.roll) > ANALOG_EPS) roll = touch.roll;
        if (Math.abs(touch.pitch) > ANALOG_EPS) pitch = touch.pitch;
        if (Math.abs(touch.yaw) > ANALOG_EPS) yaw = touch.yaw;
      }
    }
    c.roll = clamp(roll, -1, 1); c.pitch = clamp(pitch, -1, 1); c.yaw = clamp(yaw, -1, 1);

    // throttle: the lever is whatever ctx.controls.throttle says (physics may move it)
    if (!open) {
      let lever = c.throttle;
      const kd = (down('throttleUp') ? 1 : 0) - (down('throttleDown') ? 1 : 0);
      lever = stepThrottle(thrKey, lever, kd, dt, ab);
      if (pad.rate !== 0 || thrPad.dir !== 0) lever = stepThrottle(thrPad, lever, pad.rate, dt, ab);
      if (pad.abs !== null) lever = pad.abs;
      if (touchVisible && touch.thr.id !== -1 && touch.absThr !== null) lever = touch.absThr;
      c.throttle = clamp(lever, 0, 1);
    }

    // brakes (held), gently ramped
    const brakeOn = !open && (held.has('Space') || pad.brakes || (touchVisible && touch.brake));
    c.brakes = approach(c.brakes, brakeOn ? 1 : 0, 8 * dt);

    // camera look: mouse drag (springs back) / right stick; deltas for orbit cameras
    const range = lookRange();
    if (!mouse.drag) { const k = Math.exp(-6 * dt); mouse.accX *= k; mouse.accY *= k; if (Math.abs(mouse.accX) < 0.05) mouse.accX = 0; if (Math.abs(mouse.accY) < 0.05) mouse.accY = 0; }
    let lx = clamp(mouse.accX / range, -1, 1), ly = clamp(mouse.accY / range, -1, 1);
    if (Math.abs(pad.lookX) > ANALOG_EPS) lx = pad.lookX;
    if (Math.abs(pad.lookY) > ANALOG_EPS) ly = pad.lookY;
    if (open) { lx = 0; ly = 0; }
    c.lookX = lx; c.lookY = ly;
    input.lookDelta.x = mouse.pendX + pad.lookX * 700 * dt; input.lookDelta.y = mouse.pendY + pad.lookY * 700 * dt;
    mouse.pendX = mouse.pendY = 0;

    // zoom impulses
    input.zoomDelta = open ? 0 : mouse.zoomPend; mouse.zoomPend = 0;
    c.zoom = clamp(approach(c.zoom + input.zoomDelta * 0.25, 0, 3 * dt), -1, 1);

    if (touchVisible) updateTouchUI();
  }

  let lastThr = -1, lastAB = null, lastSb = -1;
  function updateTouchUI() {
    const t = c.throttle;
    if (t !== lastThr) {
      lastThr = t;
      const pct = (t * 100).toFixed(1);
      tThrFill.style.height = `calc((100% - 28px) * ${t.toFixed(3)} + 0px)`; tThrFill.style.bottom = '14px';
      tThrKnob.style.bottom = `calc(14px + (100% - 28px) * ${t.toFixed(3)})`;
      tThrPct.textContent = hasAB() && t > AB_DETENT + 0.005 ? 'AB' : Math.round(t * (hasAB() ? 100 / AB_DETENT : 100)) + '%';
      void pct;
    }
    const ab = hasAB();
    if (ab !== lastAB) { lastAB = ab; tThrMil.hidden = !ab; tThrMil.style.bottom = `calc(14px + (100% - 28px) * ${AB_DETENT})`; }
    tRudKnob.style.transform = `translateX(${(touch.rud.v * 0.43 * tRudKnob.parentNode.clientWidth).toFixed(1)}px)`;
    const sb = c.speedbrake > 0.5 ? 1 : 0;
    if (sb !== lastSb) { lastSb = sb; tBtnSpd.classList.toggle('on', !!sb); }
  }

  function dispose() {
    for (const [t, ev, fn, opt] of listeners) t.removeEventListener(ev, fn, opt);
    for (const u of unsubs) { try { u && u(); } catch {} }
    style.remove(); yokeEl.remove(); if (touchEl) touchEl.remove();
  }

  return input;
}
