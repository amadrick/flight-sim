// COMBAT INPUT — keyboard, mouse (incl. mouse aim), gamepad, touch fire controls and haptics for a running mission.
// API (COMBAT.md §9): createCombatInput(combat) -> { update(dt), trigger, bindings }
//   plus (additive, see src/combat/ui/README.md): actions, state, setTouchButtons(on), padBindings, padOwns(i),
//   touchVisible, release().
// Emits combat.events 'cmd' { name }: flare (per release of a programme), targetNext, targetPrev, targetNearest,
// targetThreat, weaponNext, padlock, missileCam, boost, and 'missile' after a launch (hint tick; the weapons cooldown makes it
// a no-op). Missiles are fired through combat.weapons.launchMissile(player, type) with the best type for the shot; a held
// shot emits 'weapon:nolock' { entity, reason, text } with a specific reason (map.js missileShot).
// Writes combat.assist.aim { x, y, active } (mouse aim, Assisted mode only, never while the simulator's mouse yoke is on).
// `trigger` = gun held. Everything stands down while the menu or a combat screen is open, while paused, while the user
// types in a field, and when no mission is live; the trigger is released on blur, tab switch, pause and menu.
import {
  keyAction, padStep, PAD_MAP, PAD_FREE, PAD_OWNED, TOUCH_BUTTONS, COMBAT_BINDINGS, COMBAT_PAD_BINDINGS, PAD_FALLBACK_BINDINGS,
  TAB_HOLD, DOUBLE_TAP, PEEK_HOLD, FLARE_PROGRAM, missileShot, NOLOCK_TEXT, nextMissileMode, aimFromPointer, accumulateAim, HAPTICS,
} from './map.js';

export { COMBAT_BINDINGS };
const DEG = Math.PI / 180;
const ICON_BOOST = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 17l6-6 6 6M6 11l6-6 6 6"/></svg>';
const STICK_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);

// Touch fire controls: FALLBACK ONLY. The simulator's touch layer (ctx.input.touch, src/input/touch.js) owns GUN / MSL /
// TGT / FLR / VIEW in its dock and calls combat.input.actions; when ctx.input.touch exists nothing below is created.
// Combat adds BOOST and (two missile types aboard) a missile-type button to its rail via ctx.input.touch.addButton.
// PLACEMENT OF THE FALLBACK IS ONE BLOCK: TOUCH_PLACE (CSS for the container) + mountTouch() (which parent the
// container goes into). Today: own container on the right edge, upper half — thumb reach above any bottom-right
// throttle, clear of a bottom-left stick, the top-right buttons and the centre of the view (camera-safe: nothing over
// the gun sight / the padlock target area). When the base input exposes a touch "slot" for action buttons, change
// mountTouch() to return it (and drop TOUCH_PLACE); createTouchButtons(parent) does not care where it lives.
const TOUCH_PLACE = `
.cbt-inp-touch{position:absolute;z-index:7;pointer-events:auto;touch-action:none;
  right:max(16px,env(safe-area-inset-right,0px));top:clamp(calc(64px + env(safe-area-inset-top,0px)),24vh,260px)}
@media (max-height:520px){.cbt-inp-touch{top:calc(60px + env(safe-area-inset-top,0px))}}
`;
const CSS = TOUCH_PLACE + `
.cbt-inp-touch[hidden]{display:none!important}
.cbt-inp-grid{display:grid;grid-template-columns:repeat(2,54px);grid-template-areas:"view tgt" "flr msl" "gun gun";gap:8px;font-family:var(--font-display,'Arial Narrow',Arial,sans-serif)}
@media (max-height:520px){.cbt-inp-grid{grid-template-columns:repeat(3,52px);grid-template-areas:"view tgt flr" "msl gun gun"}.cbt-inp-grid .cbt-inp-gun{height:52px}}
.cbt-inp-btn{height:52px;min-width:52px;box-sizing:border-box;display:grid;place-items:center;border-radius:18px;font-size:14px;font-weight:700;letter-spacing:.12em;
  color:var(--fg,#f2f6fa);background:rgba(12,18,24,.5);border:1px solid rgba(143,161,179,.45);user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;touch-action:none;padding-left:.12em}
.cbt-inp-btn.cbt-inp-small{font-size:12.5px}
.cbt-inp-btn.cbt-inp-gun{height:72px;font-size:19px;letter-spacing:.3em;padding-left:.3em;color:#ffd9cf;box-shadow:inset 0 0 0 1.5px rgb(255 90 60 / .55),0 6px 18px rgb(0 0 0 / .2)!important}
.cbt-inp-btn.down{background:rgb(255 176 0 / .6)!important;color:var(--accent-ink,#1c1300)!important}
.cbt-inp-btn.on{box-shadow:inset 0 0 0 1.5px rgb(255 176 0 / .8)!important;color:var(--amber-soft,#ffd27a)!important}
.cbt-inp-btn.cbt-inp-gun.down{background:rgb(255 90 60 / .7)!important;color:#fff!important}
@media (prefers-reduced-motion:reduce){.cbt-inp-btn{transition:none!important}}
`;
const AIM_CSS = `
.cbt-inp-aim{position:absolute;left:50%;top:50%;width:0;height:0;pointer-events:none;z-index:6}
.cbt-inp-aim[hidden]{display:none}
.cbt-inp-aim-ring{position:absolute;width:28px;height:28px;margin:-14px 0 0 -14px;border:1.5px solid rgba(93,255,155,.9);border-radius:50%;box-shadow:0 0 0 1px rgba(0,0,0,.4),0 0 8px rgba(93,255,155,.35)}
.cbt-inp-aim-ring::before,.cbt-inp-aim-ring::after{content:"";position:absolute;background:rgba(93,255,155,.9)}
.cbt-inp-aim-ring::before{left:50%;top:-7px;width:1.5px;height:6px;margin-left:-.75px;box-shadow:0 34px 0 rgba(93,255,155,.9)}
.cbt-inp-aim-ring::after{top:50%;left:-7px;height:1.5px;width:6px;margin-top:-.75px;box-shadow:34px 0 0 rgba(93,255,155,.9)}
.cbt-inp-aim-dot{position:absolute;width:4px;height:4px;margin:-2px 0 0 -2px;border-radius:50%;background:rgba(93,255,155,.95)}
.cbt-inp-aim-tag{position:absolute;top:24px;transform:translate(-50%,0);font:600 10.5px/1 var(--font-mono,monospace);letter-spacing:.14em;text-transform:uppercase;color:rgba(93,255,155,.9);white-space:nowrap;text-shadow:0 1px 2px #000;transition:opacity .4s}
.cbt-inp-aim-tag.off{opacity:0}
@media (prefers-reduced-motion:reduce){.cbt-inp-aim-tag{transition:none}}
`;

/**
 * Build the fire buttons (TOUCH_BUTTONS) into `parent` (any element; a future touch-slot container works too).
 * onPress(id) for taps, onHold(on) for the gun. Returns { el, release() }.
 */
export function createTouchButtons(parent, onPress, onHold) {
  const grid = document.createElement('div'); grid.className = 'cbt-inp-grid'; grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', 'Weapons');
  const releases = [];
  for (const t of TOUCH_BUTTONS) {
    const b = document.createElement('div');
    b.className = 'cbt-inp-btn inp-btn' + (t.hold ? ' cbt-inp-gun' : t.label.length > 3 ? ' cbt-inp-small' : ''); b.textContent = t.label;
    if (t.area) b.style.gridArea = t.area;
    b.setAttribute('role', 'button'); b.setAttribute('aria-label', t.aria); b.dataset.act = t.id;
    let pid = -1;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (pid !== -1) return;
      pid = e.pointerId; b.classList.add('down'); try { b.setPointerCapture(e.pointerId); } catch {}
      if (t.hold) onHold(true); else onPress(t.id);
    });
    const rel = () => { if (pid === -1) return; pid = -1; b.classList.remove('down'); if (t.hold) onHold(false); };
    const up = (e) => { if (e.pointerId === pid) rel(); };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
    releases.push(rel);
    grid.appendChild(b);
  }
  parent.appendChild(grid);
  return { el: grid, release() { for (const r of releases) r(); }, button: (id) => grid.querySelector(`[data-act="${id}"]`) };
}

export async function createCombatInput(combat) {
  const ctx = combat.ctx;
  const held = { key: false, mouse: false, mouseId: -1, touch: false, pad: false, api: false, boostKey: false, boostApi: false };
  const pad = { prev: [], gp: null };
  let missileMode = 'auto';            // 'auto' | 'ir' | 'radar' (Z / switchMissile)
  let lastNoLock = '';

  const state = {                      // read-only snapshot, refreshed every frame (for a touch dock / HUD)
    live: false, gun: false, firing: false, boost: false,
    target: null, targetName: '', lock: 'none', lockProgress: 0, lockSeeker: '',
    missileMode: 'auto', missile: '', missiles: { ir: 0, radar: 0 }, rounds: 0, flares: 0, flareProgram: false,
    padlock: false, peek: false, aim: false, aimLocked: false, lastNoLock: '',
  };
  const actions = {
    gun(on) { held.api = !!on; },
    missile() { fireMissile(); },
    flares() { startFlares(); },
    targetNext() { if (live()) emit('targetNext'); },
    targetPrev() { if (live()) emit('targetPrev'); },
    targetNearest() { if (live()) emit('targetNearest'); },
    targetThreat() { if (live()) emit('targetThreat'); },
    /** touch TGT semantics: tap = next, double tap = most dangerous */
    targetTap() { tgtTap(); },
    toggleView() { if (live()) emit('padlock'); },
    /** VIEW with long press: viewDown() on press, viewUp() on release — tap toggles padlock, hold > PEEK_HOLD s peeks while held */
    viewDown() { viewHold.down(); },
    viewUp() { viewHold.up(); },
    peek(on) { setPeek(on); },
    switchMissile() { switchMissile(); },
    boost(on) { held.boostApi = !!on; if (on && live()) emit('boost'); },
  };
  let ownButtons = true;
  const input = {
    trigger: false,
    bindings: COMBAT_BINDINGS,
    get padBindings() { return ctx.input?.combatPadHook ? COMBAT_PAD_BINDINGS : PAD_FALLBACK_BINDINGS; },
    touchVisible: false,
    actions, state,
    /** false hides this module's own touch fire buttons (a touch dock owns them and calls `actions`) */
    setTouchButtons(on) { ownButtons = on !== false; },
    update, padOwns, release,
  };

  const airborne = () => { const s = ctx.player?.state; return !!s && !s.onGround && !s.crashed; };
  const screensOpen = () => !!(ctx.menu?.isOpen || combat.ui?.isOpen);
  const live = () => combat.active && !screensOpen() && !ctx.time?.paused && !!combat.world?.player?.alive;
  const player = () => combat.world?.player || null;
  const emit = (name) => combat.events.emit('cmd', { name });
  const vibrationOn = () => combat.ui?.settings?.vibration !== false;
  function typing(t) {
    if (!t || !t.tagName) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || !!t.isContentEditable;
  }
  function release() {
    held.key = held.mouse = held.touch = held.pad = held.api = held.boostKey = held.boostApi = false; held.mouseId = -1;
    tab.down = false; viewHold.isDown = false; setPeek(false);
    input.trigger = false;
    touchBtns?.release();
    endBoost();
  }
  function act(name) {
    if (name === 'missile') fireMissile();
    else if (name === 'flare') startFlares();
    else if (name === 'weaponNext') switchMissile();
    else if (name === 'speedbrake') {
      const c = ctx.controls; if (c) c.speedbrake = c.speedbrake > 0.5 ? 0 : 1;
      ctx.events.emit('cmd', { name: 'speedbrakeToggle' });
    } else emit(name);
  }

  // ---- missiles: the best one for the shot ------------------------------------------------------------------------
  const _los = { x: 0, y: 0, z: 0 };
  function shotInfo(p) {
    const W = combat.weapons, lo = p.loadout, L = p.lock || {}, t = p.target && p.target.alive ? p.target : null;
    const o = { mode: missileMode, selected: lo.selected, hasTarget: !!t };
    for (const type of ['ir', 'radar']) {
      const S = W?.specs?.missiles?.[type];
      const i = { rounds: lo.missiles?.[type] | 0, locked: !!t && L.state === 'locked' && L.seeker === type && L.target === t, see: false, off: 0,
        fov: ((type === 'ir' ? S?.fov : W?.specs?.radar?.cone) || 30) * DEG, range: 0, rMin: 0, rMax: 0 };
      if (t && S) {
        try {
          i.see = !!W.canLock(p, t, type);
          const z = W.launchZone(p, t, type, {}); i.range = z.range; i.rMin = z.rMin || 0; i.rMax = z.rMax || 0;
          const a = p.state.position, b = t.state.position, f = p.forward;
          _los.x = b.x - a.x; _los.y = b.y - a.y; _los.z = b.z - a.z; const n = Math.hypot(_los.x, _los.y, _los.z) || 1;
          i.off = f ? Math.acos(Math.max(-1, Math.min(1, (_los.x * f.x + _los.y * f.y + _los.z * f.z) / n))) : 0;
        } catch { /* weapons API shape changed: judge on what we have */ }
      }
      o[type] = i;
    }
    return o;
  }
  function fireMissile() {
    const p = player(); if (!live() || !p?.loadout || !combat.weapons) return;
    if (!(p.target && p.target.alive)) emit('targetThreat');          // a press with nothing designated starts the lock attempt
    const r = missileShot(shotInfo(p));
    if (r.type) {
      const m = combat.weapons.launchMissile(p, r.type);
      if (m) { lastNoLock = ''; emit('missile'); return; }              // 'missile' ticks the HUD hint; the launch cooldown makes it a no-op
      return;                                                           // refused by the weapons (cooldown / fairness): silent
    }
    lastNoLock = r.reason;
    combat.events.emit('weapon:nolock', { entity: p, reason: r.reason, text: NOLOCK_TEXT[r.reason] || 'NO LOCK' });
  }
  function switchMissile() {
    const p = player(); if (!live() || !p?.loadout) return;
    const lo = p.loadout;
    missileMode = nextMissileMode(missileMode, lo.missiles);
    if (missileMode === 'auto') combat.events.emit('weapon:select', { entity: p, selected: 'auto', auto: true });
    else if (lo.selected !== missileMode) emit('weaponNext');          // weapons cycles the seeker and announces it
    else combat.events.emit('weapon:select', { entity: p, selected: lo.selected });
  }
  combat.events.on('mission:start', () => { missileMode = 'auto'; lastNoLock = ''; flareQ.left = 0; });

  // ---- flares: one press = a short programme -------------------------------------------------------------------------
  const flareQ = { left: 0, t: 0 };
  function startFlares() {
    if (!live()) return;
    if (flareQ.left > 0) return;                                        // a programme is already running
    emit('flare'); flareQ.left = FLARE_PROGRAM.releases - 1; flareQ.t = FLARE_PROGRAM.interval;
  }
  function stepFlares(dt) {
    if (flareQ.left <= 0) return;
    if (!live()) { flareQ.left = 0; return; }
    if ((flareQ.t -= dt) <= 0) { emit('flare'); flareQ.left--; flareQ.t = FLARE_PROGRAM.interval; }
  }

  // ---- boost (Shift hold): full throttle while held, back to the lever on release ---------------------------------------
  let boostSaved = null;
  function stepBoost() {
    const want = (held.boostKey || held.boostApi) && live();
    const c = ctx.controls; if (!c) return;
    if (want) { if (boostSaved === null) boostSaved = c.throttle ?? 0; c.throttle = 1; }
    else endBoost();
  }
  function endBoost() {
    const c = ctx.controls;
    if (boostSaved !== null && c) { if (c.throttle === 1) c.throttle = boostSaved; }
    boostSaved = null;
  }

  // ---- target view: tap = padlock on / off, hold = peek while held (O key, actions.viewDown / viewUp) ---------------------
  let peeking = false;
  function setPeek(on) {
    on = !!on && live();
    if (on === peeking) return;
    peeking = on;
    const cam = combat.camera;
    if (typeof cam?.peek === 'function') cam.peek(on); else emit(on ? 'peekOn' : 'peekOff');
  }
  const viewHold = {
    isDown: false, t: 0,
    down() { if (!live() || this.isDown) return; this.isDown = true; this.t = 0; },
    up() { if (!this.isDown) return; this.isDown = false; if (peeking) setPeek(false); else if (live()) emit('padlock'); },
    step(rdt) { if (this.isDown && !peeking) { this.t += rdt; if (this.t >= PEEK_HOLD) setPeek(true); } if (!live()) { this.isDown = false; if (peeking) setPeek(false); } },
  };

  // ---- targets: Tab tap = next by nose, hold = most dangerous; touch TGT double tap = most dangerous ---------------------
  const tab = { down: false, t: 0, fired: false };
  let tgtLast = -1;
  function tgtTap() {
    if (!live()) return;
    const now = performance.now() / 1000;
    if (now - tgtLast < DOUBLE_TAP) { emit('targetThreat'); tgtLast = -1; } else { emit('targetNext'); tgtLast = now; }
  }

  // ---- keyboard --------------------------------------------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    if (STICK_KEYS.has(e.code)) aim.suspended = true;                    // the keyboard flies: mouse aim waits for the mouse to move
    const a = keyAction(e);
    if (!a || !live() || typing(e.target)) return;
    if (a === 'gun') {
      if (!airborne()) return;                       // on the ground Space is the simulator's wheel brake
      held.key = true; return;
    }
    if (e.code === 'Tab' || e.code === 'Enter' || e.code === 'NumpadEnter') e.preventDefault();   // keep focus where it is
    if (a === 'boost') { if (!held.boostKey) { held.boostKey = true; emit('boost'); } return; }
    if (a === 'padlock' && e.code === 'KeyO') { if (!e.repeat) viewHold.down(); return; }
    if (a === 'targetNext' && e.code === 'Tab') { if (!e.repeat && !tab.down) { tab.down = true; tab.t = 0; tab.fired = false; } return; }
    if (!e.repeat) act(a);
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') held.key = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') held.boostKey = false;
    if (e.code === 'KeyO') viewHold.up();
    if (e.code === 'Tab' && tab.down) { tab.down = false; if (!tab.fired && live()) emit('targetNext'); }
  });

  // ---- mouse ------------------------------------------------------------------------------------------------------
  // left button on the 3D view = gun (airborne); right click = missile, middle click = target nearest the nose (a drag
  // stays the simulator's camera look); with mouse aim active the wheel steps targets instead of zooming.
  const canvas = ctx.canvas;
  const clickBtn = { 1: null, 2: null };
  canvas?.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    if (e.button === 1 || e.button === 2) { clickBtn[e.button] = { t: performance.now(), x: e.clientX, y: e.clientY, m: 0 }; return; }
    if (e.button !== 0 || !live()) return;
    if (aimAllowed() && !aim.locked && !aim.lockRequested) requestAimLock();
    if (!airborne()) return;
    held.mouse = true; held.mouseId = e.pointerId;
  });
  const mouseUp = (e) => {
    if (held.mouse && e.pointerId === held.mouseId) { held.mouse = false; held.mouseId = -1; }
    const c = clickBtn[e.button]; if (!c) return;
    clickBtn[e.button] = null;
    const moved = aim.locked ? c.m : Math.hypot(e.clientX - c.x, e.clientY - c.y);
    if (performance.now() - c.t > 350 || moved > 6 || !live()) return;
    if (e.button === 2) fireMissile(); else emit('targetNearest');
  };
  window.addEventListener('pointerup', mouseUp);
  window.addEventListener('pointercancel', mouseUp);
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    for (const k of [1, 2]) if (clickBtn[k]) clickBtn[k].m += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
    if (aim.locked) {
      if (!aimAllowed()) return;
      if (e.movementX || e.movementY) { accumulateAim(aim, e.movementX || 0, e.movementY || 0, viewRect()); aim.suspended = false; }
      return;
    }
    const moved = Math.hypot(e.clientX - aim.px, e.clientY - aim.py);
    aim.px = e.clientX; aim.py = e.clientY; aim.has = true;
    if (moved > 3 && e.target === canvas) aim.suspended = false;
  });
  document.addEventListener('mouseleave', () => { aim.has = false; });
  // the wheel: targets while mouse aim is active (capture phase, before the simulator's zoom), else untouched
  let wheelT = 0;
  window.addEventListener('wheel', (e) => {
    if (!aimActive() || (e.target !== canvas && !aim.locked)) return;
    e.preventDefault(); e.stopPropagation();
    const now = performance.now(); if (now - wheelT < 140) return; wheelT = now;
    if (e.deltaY > 0) emit('targetNext'); else if (e.deltaY < 0) emit('targetPrev');
  }, { capture: true, passive: false });

  // ---- mouse aim (Assisted mode): combat.assist.aim from the pointer, or from accumulated motion under pointer lock -----
  const aim = { x: 0, y: 0, px: 0, py: 0, has: false, suspended: true, locked: false, lockRequested: false, tagT: 0 };
  function aimAllowed() {
    return live() && combat.assist?.mode === 'assist' && !ctx.input?.mouseYoke && ctx.input?.mode !== 'touch' && !!canvas;
  }
  const aimActive = () => aimAllowed() && (aim.locked || (aim.has && !aim.suspended));
  function viewRect() { return canvas.getBoundingClientRect(); }
  function requestAimLock() {
    aim.lockRequested = true;
    try { const r = canvas.requestPointerLock?.(); if (r && r.catch) r.catch(() => { aim.lockRequested = false; }); } catch { aim.lockRequested = false; }
  }
  document.addEventListener('pointerlockchange', () => {
    const mine = document.pointerLockElement === canvas && aim.lockRequested;
    if (mine && !aim.locked) { aim.locked = true; aim.tagT = 3; if (!aim.has || aim.suspended) { aim.x = 0; aim.y = 0; } aim.suspended = false; }
    else if (!mine) { aim.locked = false; aim.lockRequested = false; }
  });
  function releaseAimLock() {
    if (aim.locked && document.pointerLockElement === canvas) { try { document.exitPointerLock(); } catch {} }
    aim.locked = false; aim.lockRequested = false;
  }
  let aimEl = null, aimRing = null, aimTag = null, aimShown = false, cursorHidden = false;
  function buildAim() {
    ensureStyle();
    aimEl = document.createElement('div'); aimEl.className = 'cbt-inp-aim'; aimEl.hidden = true; aimEl.setAttribute('aria-hidden', 'true');
    aimEl.innerHTML = '<div class="cbt-inp-aim-ring"></div><div class="cbt-inp-aim-dot"></div><div class="cbt-inp-aim-tag off">Mouse aim · Esc frees the mouse</div>';
    aimRing = aimEl.firstChild; aimTag = aimEl.querySelector('.cbt-inp-aim-tag');
    (ctx.uiRoot || document.body).appendChild(aimEl);
  }
  function stepAim(rdt) {
    const A = combat.assist?.aim;
    const allowed = aimAllowed();
    if (!allowed && aim.locked && (combat.assist?.mode !== 'assist' || !combat.active || ctx.input?.mouseYoke || screensOpen())) releaseAimLock();
    const on = allowed && (aim.locked || (aim.has && !aim.suspended));
    if (on && !aim.locked) aimFromPointer(aim.px, aim.py, viewRect(), aim);
    if (A) { A.x = on ? aim.x : 0; A.y = on ? aim.y : 0; A.active = on; }
    // reticle
    if (on && !aimEl) buildAim();
    if (aimEl) {
      if (on !== aimShown) { aimShown = on; aimEl.hidden = !on; }
      if (on) {
        const r = viewRect(), host = (ctx.uiRoot || document.body).getBoundingClientRect();
        const R = 0.4 * Math.max(1, Math.min(r.width, r.height));
        const cx = r.left + r.width / 2 - host.left + aim.x * R, cy = r.top + r.height / 2 - host.top - aim.y * R;
        aimEl.style.left = cx.toFixed(1) + 'px'; aimEl.style.top = cy.toFixed(1) + 'px';
        if (aim.tagT > 0) { aim.tagT -= rdt; aimTag.classList.toggle('off', aim.tagT <= 0); }
      }
    }
    const hide = on && !aim.locked;
    if (canvas && hide !== cursorHidden) { cursorHidden = hide; canvas.style.cursor = hide ? 'none' : ''; }
  }

  window.addEventListener('blur', release);
  document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
  ctx.events.on('pause', (p) => { if (p) release(); });
  ctx.events.on('menu:open', () => { release(); releaseAimLock(); });
  combat.events.on('mission:abort', () => { release(); setTouchVisible(false); releaseAimLock(); flareQ.left = 0; });
  combat.events.on('mission:end', () => { flareQ.left = 0; });

  // ---- haptics: gun buzz while firing, a thump when hit (respects the Vibration setting) ---------------------------------
  const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  let buzzT = 0;
  const touchUser = () => !!ctx.input?.touchEnabled;
  function vibrate(pat) { if (canVibrate && vibrationOn() && touchUser()) { try { navigator.vibrate(pat); } catch {} } }
  function rumble(fx) {
    const act_ = pad.gp?.vibrationActuator; if (!act_ || !vibrationOn()) return;
    try { const r = act_.playEffect?.('dual-rumble', fx); if (r && r.catch) r.catch(() => {}); } catch {}
  }
  combat.events.on('damage', ({ target, amount } = {}) => {
    if (!target || target !== player() || !live()) return;
    const heavy = (amount || 0) >= 15;
    vibrate(heavy ? HAPTICS.hitHeavy : HAPTICS.hit); rumble(HAPTICS.padHit);
  });
  function stepHaptics(dt) {
    if (!input.trigger) { buzzT = 0; return; }
    if ((buzzT -= dt) > 0) return;
    buzzT = HAPTICS.gunEvery;
    if (held.touch || held.api) vibrate(HAPTICS.gunPulse);
    if (held.pad) rumble(HAPTICS.padGun);
  }

  // ---- gamepad -----------------------------------------------------------------------------------------------
  // Combat reads navigator.getGamepads() itself during a live mission (see map.js for why these buttons):
  // default PAD_FREE (R3 gun hold, Home padlock: buttons the simulator does not map, so nothing double-fires);
  // PAD_MAP (RT gun with dead zone, RB missile, B flares, X / Y targets, LB switch missile, R3 padlock) only when the
  // simulator's input advertises ctx.input.combatPadHook and skips the buttons padOwns() claims.
  const hooked = () => !!ctx.input?.combatPadHook;
  /** True when combat (or a combat screen) owns standard-gamepad button i this frame (src/input should skip it). */
  function padOwns(i) {
    if (combat.ui?.isOpen) return true;                                  // screens navigate with the pad
    return hooked() && PAD_OWNED.has(i) && combat.active && !ctx.menu?.isOpen && airborne() && !!combat.world?.player?.alive;
  }
  function pollPad() {
    let gp = null;
    try { const l = navigator.getGamepads?.() || []; for (let i = 0; i < l.length; i++) if (l[i] && l[i].connected) { gp = l[i]; break; } } catch { gp = null; }
    pad.gp = gp;
    if (!gp || gp.mapping !== 'standard') { held.pad = false; pad.prev.length = 0; return; }
    const r = padStep(gp.buttons, pad.prev, hooked() ? PAD_MAP : PAD_FREE, live() && airborne(), held.pad);
    held.pad = r.gun;
    for (const c of r.cmds) act(c);
  }
  input.padHooked = hooked;

  // ---- touch ---------------------------------------------------------------------------------------------------
  let touchEl = null, touchBtns = null, padOn = false;
  function ensureStyle(id = 'cbt-inp-aim-style', css = AIM_CSS) {
    if (document.getElementById(id)) return;
    const st = document.createElement('style'); st.id = id; st.textContent = css; document.head.appendChild(st);
  }
  function buildTouch() {
    ensureStyle('cbt-inp-style', CSS);
    touchEl = document.createElement('div'); touchEl.className = 'cbt-inp-touch'; touchEl.hidden = true;
    touchBtns = createTouchButtons(touchEl, (id) => { if (!live()) return; if (id === 'targetNext') tgtTap(); else act(id); }, (on) => { held.touch = on; });
    mountTouch().appendChild(touchEl);
  }
  /** The one place that decides where the touch buttons live (swap for the base input's touch slot when it exists). */
  function mountTouch() { return ctx.uiRoot; }
  function setTouchVisible(v) {
    if (v && !touchEl) buildTouch();
    if (touchEl && touchEl.hidden === v) { touchEl.hidden = !v; if (!v) touchBtns?.release(); }
    input.touchVisible = !!v && !!touchEl;
  }

  // ---- extra buttons on the touch layer's rail (ctx.input.touch.addButton): BOOST, missile type -------------------------
  // Added on mission start (once the loadout is known), removed on mission end / abort. BOOST stays with auto-throttle
  // on (combat.assist.info.autoThrottle): it is the override.
  const rail = { want: false, boost: null, type: null, sub: '' };
  const MODE_SUB = { auto: 'Auto', ir: 'IR', radar: 'Radar' };
  function railRemove() {
    for (const k of ['boost', 'type']) { try { rail[k]?.remove(); } catch {} rail[k] = null; }
    rail.sub = ''; held.boostApi = false;
  }
  function stepRail() {
    const T = ctx.input?.touch;
    if (!rail.want || typeof T?.addButton !== 'function') return;
    const p = player(); if (!p?.loadout) return;
    rail.want = false;
    railRemove();
    rail.boost = T.addButton({ id: 'cbt-boost', label: 'Boost', aria: 'Boost: full afterburner while held', icon: ICON_BOOST,
      onDown() { actions.boost(true); rail.boost?.setActive(true); }, onUp() { actions.boost(false); rail.boost?.setActive(false); } });
    const mx = p.loadout.missilesMax || p.loadout.missiles || {};
    if ((mx.ir | 0) > 0 && (mx.radar | 0) > 0) {
      rail.type = T.addButton({ id: 'cbt-msltype', label: 'Missile', aria: 'Missile type: Auto, IR or radar', onDown() { switchMissile(); } });
    }
  }
  function syncRail() {
    if (rail.type) { const sub = MODE_SUB[missileMode] || 'Auto'; if (sub !== rail.sub) { rail.sub = sub; rail.type.setSub(sub); } }
  }
  combat.events.on('mission:start', () => { rail.want = true; });
  combat.events.on('mission:end', () => { rail.want = false; railRemove(); });
  combat.events.on('mission:abort', () => { rail.want = false; railRemove(); });

  // ---- per frame (combat.pre, only while a mission is loaded) ---------------------------------------------------------
  let lastNow = 0;
  function update(dt) {
    const now = performance.now() / 1000, rdt = lastNow ? Math.min(0.1, now - lastNow) : 0; lastNow = now;
    const isLive = live();
    pollPad();
    if (!isLive) { held.key = held.mouse = held.pad = held.api = false; tab.down = false; }
    if (tab.down) { tab.t += rdt; if (!tab.fired && tab.t >= TAB_HOLD) { tab.fired = true; emit('targetThreat'); } }
    const touchOn = ownButtons && !ctx.input?.touch && !!ctx.input?.touchEnabled && combat.active && !screensOpen() && ctx.cameraRig?.mode !== 'showcase';
    setTouchVisible(touchOn);
    if (!touchOn) held.touch = false;
    input.trigger = isLive && airborne() && (held.key || held.mouse || held.touch || held.pad || held.api);
    viewHold.step(rdt);
    stepRail();
    stepFlares(dt || 0);
    stepBoost();
    stepAim(rdt);
    stepHaptics(dt || 0);
    if (touchBtns && input.touchVisible) { const on = combat.camera?.mode === 'padlock'; if (on !== padOn) { padOn = on; touchBtns.button('padlock')?.classList.toggle('on', on); } }
    syncRail();
    syncState(isLive);
  }
  function syncState(isLive) {
    const p = player(), lo = p?.loadout, L = p?.lock, t = p?.target && p.target.alive ? p.target : null;
    state.live = isLive; state.gun = held.key || held.mouse || held.touch || held.pad || held.api; state.firing = input.trigger;
    state.boost = boostSaved !== null;
    state.target = t; state.targetName = t ? (t.callsign || t.def?.name || t.name || '') : '';
    state.lock = L && t ? L.state || 'none' : 'none'; state.lockProgress = L && t ? L.progress || 0 : 0; state.lockSeeker = L?.seeker || '';
    state.missileMode = missileMode; state.missile = lo?.selected || '';
    state.missiles.ir = lo?.missiles?.ir | 0; state.missiles.radar = lo?.missiles?.radar | 0;
    state.rounds = lo?.gun?.rounds | 0; state.flares = lo?.flares | 0; state.flareProgram = flareQ.left > 0;
    state.padlock = combat.camera?.mode === 'padlock'; state.peek = peeking; state.aim = !!combat.assist?.aim?.active; state.aimLocked = aim.locked;
    state.lastNoLock = lastNoLock;
  }
  return input;
}
