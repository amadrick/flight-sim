// COMBAT INPUT — keyboard, mouse, gamepad and touch fire controls for a running mission.
// API (COMBAT.md §9): createCombatInput(combat) -> { update(dt), trigger, bindings }
//   plus (additive, see src/combat/ui/README.md): padBindings, padOwns(buttonIndex), touchVisible, release().
// Emits combat.events 'cmd' { name }: missile, flare, targetNext, targetPrev, targetNearest, weaponNext.
// `trigger` = gun held. Everything stands down while the menu or a combat screen is open, while paused, while the user
// types in a field, and when no mission is live; the trigger is released on blur, tab switch, pause and menu.
import { keyAction, padAction, PAD_OWNED, TOUCH_BUTTONS, COMBAT_BINDINGS, COMBAT_PAD_BINDINGS } from './map.js';

export { COMBAT_BINDINGS };

const CSS = `
.cbt-inp-touch{position:absolute;z-index:7;display:grid;grid-template-columns:repeat(2,52px);gap:8px;pointer-events:auto;touch-action:none;
  right:calc(max(16px,env(safe-area-inset-right,0px)) + 68px);bottom:calc(max(16px,env(safe-area-inset-bottom,0px)) + 62px + 168px + 14px);
  font-family:var(--font-display,'Arial Narrow',Arial,sans-serif)}
.cbt-inp-touch[hidden]{display:none!important}
.cbt-inp-btn{height:52px;min-width:52px;box-sizing:border-box;display:grid;place-items:center;border-radius:18px;font-size:14px;font-weight:700;letter-spacing:.12em;
  color:var(--fg,#f2f6fa);background:rgba(12,18,24,.5);border:1px solid rgba(143,161,179,.45);user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;touch-action:none;padding-left:.12em}
.cbt-inp-btn.cbt-inp-gun{grid-column:1 / 3;height:60px;font-size:17px;letter-spacing:.3em;padding-left:.3em;color:#ffd9cf;box-shadow:inset 0 0 0 1.5px rgb(255 90 60 / .55),0 6px 18px rgb(0 0 0 / .2)!important}
.cbt-inp-btn.down{background:rgb(255 176 0 / .6)!important;color:var(--accent-ink,#1c1300)!important}
.cbt-inp-btn.cbt-inp-gun.down{background:rgb(255 90 60 / .7)!important;color:#fff!important}
@media (max-height:520px){
  .cbt-inp-touch{grid-template-columns:repeat(2,52px);right:calc(max(16px,env(safe-area-inset-right,0px)) + 68px + 104px + 14px);bottom:calc(max(16px,env(safe-area-inset-bottom,0px)) + 62px)}
}
@media (prefers-reduced-motion:reduce){.cbt-inp-btn{transition:none!important}}
`;

export async function createCombatInput(combat) {
  const ctx = combat.ctx;
  const held = { key: false, mouse: false, mouseId: -1, touch: false, pad: false };
  const pad = { prev: [] };

  const input = {
    trigger: false,
    bindings: COMBAT_BINDINGS,
    padBindings: COMBAT_PAD_BINDINGS,
    touchVisible: false,
    update, padOwns, release,
  };

  const airborne = () => { const s = ctx.player?.state; return !!s && !s.onGround && !s.crashed; };
  const screensOpen = () => !!(ctx.menu?.isOpen || combat.ui?.isOpen);
  const live = () => combat.active && !screensOpen() && !ctx.time?.paused && !!combat.world?.player?.alive;
  const emit = (name) => combat.events.emit('cmd', { name });
  function typing(t) {
    if (!t || !t.tagName) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || !!t.isContentEditable;
  }
  function release() {
    held.key = held.mouse = held.touch = held.pad = false; held.mouseId = -1;
    input.trigger = false;
    if (touchEl) for (const b of touchEl.children) b._release?.();
  }
  function act(name) {
    if (name === 'speedbrake') {
      const c = ctx.controls; if (c) c.speedbrake = c.speedbrake > 0.5 ? 0 : 1;
      ctx.events.emit('cmd', { name: 'speedbrakeToggle' });
    } else emit(name);
  }

  // ---- keyboard --------------------------------------------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    const a = keyAction(e);
    if (!a || !live() || typing(e.target)) return;
    if (a === 'gun') {
      if (!airborne()) return;                       // on the ground Space is the simulator's wheel brake
      held.key = true; return;
    }
    if (e.code === 'Tab' || e.code === 'Enter' || e.code === 'NumpadEnter') e.preventDefault();   // keep focus where it is
    if (!e.repeat) act(a);
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') held.key = false; });

  // ---- mouse: left button on the 3D view (right-drag stays camera look; with the mouse yoke on, left = gun) -------
  const canvas = ctx.canvas;
  canvas?.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0 || !live() || !airborne()) return;
    held.mouse = true; held.mouseId = e.pointerId;
  });
  const mouseUp = (e) => { if (held.mouse && e.pointerId === held.mouseId) { held.mouse = false; held.mouseId = -1; } };
  window.addEventListener('pointerup', mouseUp);
  window.addEventListener('pointercancel', mouseUp);

  window.addEventListener('blur', release);
  document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
  ctx.events.on('pause', (p) => { if (p) release(); });
  ctx.events.on('menu:open', release);
  combat.events.on('mission:abort', () => { release(); setTouchVisible(false); });

  // ---- gamepad -----------------------------------------------------------------------------------------------
  /** True when combat (or a combat screen) owns standard-gamepad button i this frame: src/input skips its own use. */
  function padOwns(i) {
    if (combat.ui?.isOpen) return true;                                  // screens navigate with the pad
    return PAD_OWNED.has(i) && combat.active && !ctx.menu?.isOpen && airborne() && !!combat.world?.player?.alive;
  }
  function pollPad() {
    let gp = null;
    try { const l = navigator.getGamepads?.() || []; for (let i = 0; i < l.length; i++) if (l[i] && l[i].connected) { gp = l[i]; break; } } catch { gp = null; }
    if (!gp || gp.mapping !== 'standard') { held.pad = false; pad.prev.length = 0; return; }
    const bt = gp.buttons;
    const ok = live() && airborne();
    held.pad = ok && !!bt[0]?.pressed;
    for (let i = 1; i < 16; i++) {
      const p = !!bt[i]?.pressed, was = !!pad.prev[i]; pad.prev[i] = p;
      if (!p || was || !ok) continue;
      const a = padAction(i); if (a && a !== 'gun') act(a);
    }
  }

  // ---- touch: GUN (hold), MSL, FLR, TGT above the simulator's button grid ------------------------------------------
  let touchEl = null, styleEl = null;
  function buildTouch() {
    styleEl = document.createElement('style'); styleEl.id = 'cbt-inp-style'; styleEl.textContent = CSS; document.head.appendChild(styleEl);
    touchEl = document.createElement('div'); touchEl.className = 'cbt-inp-touch'; touchEl.hidden = true;
    touchEl.setAttribute('aria-label', 'Weapons');
    for (const t of TOUCH_BUTTONS) {
      const b = document.createElement('div');
      b.className = 'cbt-inp-btn inp-btn' + (t.hold ? ' cbt-inp-gun' : ''); b.textContent = t.label;
      b.setAttribute('role', 'button'); b.setAttribute('aria-label', t.aria); b.dataset.act = t.id;
      let pid = -1;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (pid !== -1) return;
        pid = e.pointerId; b.classList.add('down'); try { b.setPointerCapture(e.pointerId); } catch {}
        if (t.hold) held.touch = true;
        else if (live()) act(t.id);
      });
      const up = (e) => { if (e.pointerId !== pid) return; pid = -1; b.classList.remove('down'); if (t.hold) held.touch = false; };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
      b._release = () => { pid = -1; b.classList.remove('down'); if (t.hold) held.touch = false; };
      touchEl.appendChild(b);
    }
    ctx.uiRoot.appendChild(touchEl);
  }
  function setTouchVisible(v) {
    if (v && !touchEl) buildTouch();
    if (touchEl && touchEl.hidden === v) { touchEl.hidden = !v; if (!v) for (const b of touchEl.children) b._release?.(); }
    input.touchVisible = !!v && !!touchEl;
  }

  // ---- per frame (combat.pre, only while a mission is loaded) ---------------------------------------------------------
  function update() {
    const isLive = live();
    pollPad();
    if (!isLive) { held.key = held.mouse = held.pad = false; }
    const touchOn = !!ctx.input?.touchEnabled && combat.active && !screensOpen() && ctx.cameraRig?.mode !== 'showcase';
    setTouchVisible(touchOn);
    if (!touchOn) held.touch = false;
    input.trigger = isLive && airborne() && (held.key || held.mouse || held.touch || held.pad);
  }
  return input;
}
