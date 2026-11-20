// COMBAT INPUT — keyboard, mouse, gamepad and touch fire controls for a running mission.
// API (COMBAT.md §9): createCombatInput(combat) -> { update(dt), trigger, bindings }
//   plus (additive, see src/combat/ui/README.md): padBindings, padOwns(buttonIndex), touchVisible, release().
// Emits combat.events 'cmd' { name }: missile, flare, targetNext, targetPrev, targetNearest, weaponNext.
// `trigger` = gun held. Everything stands down while the menu or a combat screen is open, while paused, while the user
// types in a field, and when no mission is live; the trigger is released on blur, tab switch, pause and menu.
import { keyAction, padAction, PAD_OWNED, TOUCH_BUTTONS, COMBAT_BINDINGS, COMBAT_PAD_BINDINGS, PAD_FALLBACK_BINDINGS } from './map.js';

export { COMBAT_BINDINGS };

// Touch fire controls: one container, placed by ONE CSS block (.cbt-inp-touch below) on the right edge above mid-height,
// in thumb reach above wherever a bottom-right throttle sits and clear of a bottom-left stick and top-right buttons.
// Buttons are created by createTouchButtons(parent) so they can be re-parented into a future touch "slot" API.
const CSS = `
.cbt-inp-touch{position:absolute;z-index:7;pointer-events:auto;touch-action:none;
  right:max(16px,env(safe-area-inset-right,0px));top:clamp(calc(64px + env(safe-area-inset-top,0px)),28vh,280px)}
@media (max-height:520px){.cbt-inp-touch{top:calc(64px + env(safe-area-inset-top,0px))}}
.cbt-inp-touch[hidden]{display:none!important}
.cbt-inp-grid{display:grid;grid-template-columns:repeat(2,54px);grid-template-areas:"tgt flr" "msl msl" "gun gun";gap:8px;font-family:var(--font-display,'Arial Narrow',Arial,sans-serif)}
@media (max-height:520px){.cbt-inp-grid{grid-template-areas:"tgt flr" "msl gun"}.cbt-inp-grid .cbt-inp-gun{height:54px}}
.cbt-inp-btn{height:52px;min-width:52px;box-sizing:border-box;display:grid;place-items:center;border-radius:18px;font-size:14px;font-weight:700;letter-spacing:.12em;
  color:var(--fg,#f2f6fa);background:rgba(12,18,24,.5);border:1px solid rgba(143,161,179,.45);user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;touch-action:none;padding-left:.12em}
.cbt-inp-btn[data-act="targetNext"]{grid-area:tgt}.cbt-inp-btn[data-act="flare"]{grid-area:flr}.cbt-inp-btn[data-act="missile"]{grid-area:msl}
.cbt-inp-btn.cbt-inp-gun{grid-area:gun;height:68px;font-size:18px;letter-spacing:.3em;padding-left:.3em;color:#ffd9cf;box-shadow:inset 0 0 0 1.5px rgb(255 90 60 / .55),0 6px 18px rgb(0 0 0 / .2)!important}
.cbt-inp-btn.down{background:rgb(255 176 0 / .6)!important;color:var(--accent-ink,#1c1300)!important}
.cbt-inp-btn.cbt-inp-gun.down{background:rgb(255 90 60 / .7)!important;color:#fff!important}
@media (prefers-reduced-motion:reduce){.cbt-inp-btn{transition:none!important}}
`;

/**
 * Build the four fire buttons into `parent` (any element; a future touch-slot container works too).
 * onPress(id) for taps, onHold(on) for the gun. Returns { el, release() }.
 */
export function createTouchButtons(parent, onPress, onHold) {
  const grid = document.createElement('div'); grid.className = 'cbt-inp-grid'; grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', 'Weapons');
  const releases = [];
  for (const t of TOUCH_BUTTONS) {
    const b = document.createElement('div');
    b.className = 'cbt-inp-btn inp-btn' + (t.hold ? ' cbt-inp-gun' : ''); b.textContent = t.label;
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
  return { el: grid, release() { for (const r of releases) r(); } };
}

export async function createCombatInput(combat) {
  const ctx = combat.ctx;
  const held = { key: false, mouse: false, mouseId: -1, touch: false, pad: false };
  const pad = { prev: [] };

  const input = {
    trigger: false,
    bindings: COMBAT_BINDINGS,
    get padBindings() { return ctx.input?.combatPadHook ? COMBAT_PAD_BINDINGS : PAD_FALLBACK_BINDINGS; },
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
    touchBtns?.release();
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
  // Full map (PAD_MAP: A gun, B flares, X missile, Y next target, R3 nearest, D-pad up switch missile, D-pad down
  // speedbrake) only when the simulator's input honours padOwns() — it advertises that with ctx.input.combatPadHook
  // (patch in src/combat/ui/INTEGRATION.md). Without it every face button still does its simulator job, so combat
  // takes only the one free button: right stick click = gun (hold).
  const hooked = () => !!ctx.input?.combatPadHook;
  /** True when combat (or a combat screen) owns standard-gamepad button i this frame (src/input should skip it). */
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
    if (!hooked()) { held.pad = ok && !!bt[11]?.pressed; pad.prev.length = 0; return; }
    held.pad = ok && !!bt[0]?.pressed;
    for (let i = 1; i < 16; i++) {
      const p = !!bt[i]?.pressed, was = !!pad.prev[i]; pad.prev[i] = p;
      if (!p || was || !ok) continue;
      const a = padAction(i); if (a && a !== 'gun') act(a);
    }
  }
  input.padHooked = hooked;

  // ---- touch ---------------------------------------------------------------------------------------------------
  let touchEl = null, touchBtns = null;
  function buildTouch() {
    const st = document.createElement('style'); st.id = 'cbt-inp-style'; st.textContent = CSS; document.head.appendChild(st);
    touchEl = document.createElement('div'); touchEl.className = 'cbt-inp-touch'; touchEl.hidden = true;
    touchBtns = createTouchButtons(touchEl, (id) => { if (live()) act(id); }, (on) => { held.touch = on; });
    ctx.uiRoot.appendChild(touchEl);
  }
  function setTouchVisible(v) {
    if (v && !touchEl) buildTouch();
    if (touchEl && touchEl.hidden === v) { touchEl.hidden = !v; if (!v) touchBtns?.release(); }
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
