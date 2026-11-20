// INPUT — keyboard, mouse, gamepad, touch. API: createInput(ctx) -> { update(dt), bindings, mode, setMouseYoke(on), ... }
// Writes ctx.controls every frame; emits discrete commands as ctx.events.emit('cmd', { name }).
// Pure shaping logic lives in logic.js, the key map in bindings.js (both unit-tested, DOM-free).
import { clamp, approach, shapeAxis, shapeStick, stepKeyAxis, stepThrottle, snapDetent, milLever, AB_DETENT } from './logic.js';
import { KEY_TABLE, CODE_MAP, BINDINGS, GAMEPAD_BINDINGS } from './bindings.js';
import { createTouchControls } from './touch.js';

const CSS = `
.inp-yoke{position:absolute;left:50%;top:50%;width:0;height:0;pointer-events:none!important;z-index:5}
.inp-yoke[hidden]{display:none}
.inp-yoke-ring{position:absolute;border:1.5px solid rgba(93,255,155,.55);border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 0 0 1px rgba(0,0,0,.35)}
.inp-yoke-dead{position:absolute;width:14px;height:14px;border:1px solid rgba(93,255,155,.45);border-radius:50%;transform:translate(-50%,-50%)}
.inp-yoke-dot{position:absolute;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:var(--hud,#5dff9b);box-shadow:0 0 6px rgba(93,255,155,.8),0 0 0 1px rgba(0,0,0,.5)}
.inp-yoke-tag{position:absolute;transform:translate(-50%,0);font:600 11px/1 var(--font-mono,monospace);letter-spacing:.14em;text-transform:uppercase;color:var(--hud,#5dff9b);opacity:.8;white-space:nowrap;text-shadow:0 1px 2px #000}
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
    zoomDelta: 0,                // wheel notches this frame, + = zoom IN (scroll away from you)
    mouseYoke: false,
    touchEnabled: false,
    touch: null,                 // touch UI API, see below (always set)
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

  // ---- touch (touch.js: layout, stick, throttle, rudder, buttons, extra-button slots) ----------------------------
  const coarse = (() => { try { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch { return false; } })();
  let touchUI = null;
  const touch = { roll: 0, pitch: 0, yaw: 0, brake: false, absThr: null, thrActive: false };
  let touchVisible = false;
  // ctx.input.touch exists even before (or without) the touch UI: extra buttons added early are kept and appear when
  // the touch UI is built (touch screens, or setTouch(true)). See INTEGRATION.md "Extra touch buttons".
  const pendingButtons = [];
  input.touch = {
    get visible() { return !!(touchUI && touchUI.api.visible); },
    get layout() { return touchUI ? touchUI.api.layout : null; },
    addButton(spec) {
      if (touchUI) return touchUI.api.addButton(spec);
      if (!spec || !spec.id || pendingButtons.some((p) => p.spec.id === spec.id)) return null;
      // handle that works before and after the UI exists
      const p = { spec, real: null, active: false, label: null, sub: null };
      pendingButtons.push(p);
      return {
        get el() { return p.real ? p.real.el : null; },
        setActive: (on) => { p.active = !!on; p.real && p.real.setActive(on); },
        setLabel: (t) => { p.label = t; p.real && p.real.setLabel(t); },
        setSub: (t) => { p.sub = t; p.real && p.real.setSub(t); },
        remove: () => { const i = pendingButtons.indexOf(p); if (i >= 0) pendingButtons.splice(i, 1); return input.touch.removeButton(spec.id); },
      };
    },
    removeButton(id) { return touchUI ? touchUI.api.removeButton(id) : false; },
    showHints(sec) { if (touchUI) touchUI.api.showHints(sec); },
  };
  function buildTouch() {
    touchUI = createTouchControls(ctx, { setMode, command, toggleSpeedbrake, hasAB, controls: c });
    for (const p of pendingButtons) {
      p.real = touchUI.api.addButton(p.spec);
      if (p.real) { if (p.active) p.real.setActive(true); if (p.label != null) p.real.setLabel(p.label); if (p.sub != null) p.real.setSub(p.sub); }
    }
  }
  function touchReleaseAll() { if (touchUI) touchUI.releaseAll(); }
  function setTouch(on_) {
    on_ = !!on_;
    if (on_ && !touchUI) buildTouch();
    input.touchEnabled = on_;
    if (!on_ && touchUI) { touchUI.setShown(false); touchVisible = false; }
  }
  setTouch(raw.touch === '1' || (coarse && raw.touch !== '0'));

  // ---- session -----------------------------------------------------------------------------------------------
  unsubs.push(ctx.events.on('session:start', () => {
    // adopt whatever lever position physics set; just clear transient detent/ramp state
    thrKey.t = thrPad.t = 0; thrKey.latched = thrPad.latched = false; thrKey.dir = thrPad.dir = 0;
    pad.lastAbs = null;
  }));

  // ---- per-frame update -------------------------------------------------------------------------------------
  const ANALOG_EPS = 1e-3;
  function update(dt) {
    dt = clamp(dt || 0, 0, 0.1);
    const open = menuOpen();
    const ab = hasAB();

    // visibility of touch UI
    if (touchUI) {
      const show = input.touchEnabled && !open && !(ctx.cameraRig && ctx.cameraRig.mode === 'showcase') && !(ctx.player && ctx.player.state && ctx.player.state.crashed);
      if (show !== touchVisible) { touchVisible = show; touchUI.setShown(show); }
    }
    const ts = touchUI ? touchUI.st : touch;
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
        if (Math.abs(ts.roll) > ANALOG_EPS) roll = ts.roll;
        if (Math.abs(ts.pitch) > ANALOG_EPS) pitch = ts.pitch;
        if (Math.abs(ts.yaw) > ANALOG_EPS) yaw = ts.yaw;
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
      if (touchVisible && ts.thrActive && ts.absThr !== null) lever = ts.absThr;
      c.throttle = clamp(lever, 0, 1);
    }

    // brakes (held), gently ramped
    const brakeOn = !open && (held.has('Space') || pad.brakes || (touchVisible && ts.brake));
    c.brakes = approach(c.brakes, brakeOn ? 1 : 0, 8 * dt);

    // camera look: mouse drag (springs back) / right stick; deltas for orbit cameras
    const range = lookRange();
    if (!mouse.drag) { const k = Math.exp(-6 * dt); mouse.accX *= k; mouse.accY *= k; if (Math.abs(mouse.accX) < 0.05) mouse.accX = 0; if (Math.abs(mouse.accY) < 0.05) mouse.accY = 0; }
    let lx = clamp(mouse.accX / range, -1, 1), ly = clamp(mouse.accY / range, -1, 1);
    if (Math.abs(pad.lookX) > ANALOG_EPS) lx = pad.lookX;
    if (Math.abs(pad.lookY) > ANALOG_EPS) ly = pad.lookY;
    if (open) { lx = 0; ly = 0; }
    // Integrator: canonical convention (shared with the camera rig) is lookY/lookDelta.y > 0 = look UP, zoom/zoomDelta > 0 = zoom IN.
    c.lookX = lx; c.lookY = -ly;
    input.lookDelta.x = mouse.pendX + pad.lookX * 700 * dt; input.lookDelta.y = -(mouse.pendY + pad.lookY * 700 * dt);
    mouse.pendX = mouse.pendY = 0;

    // zoom impulses
    input.zoomDelta = open ? 0 : -mouse.zoomPend; mouse.zoomPend = 0;
    c.zoom = clamp(approach(c.zoom + input.zoomDelta * 0.25, 0, 3 * dt), -1, 1);

    if (touchUI) touchUI.update(dt);
  }

  function dispose() {
    for (const [t, ev, fn, opt] of listeners) t.removeEventListener(ev, fn, opt);
    for (const u of unsubs) { try { u && u(); } catch {} }
    style.remove(); yokeEl.remove(); if (touchUI) touchUI.dispose();
  }

  return input;
}
