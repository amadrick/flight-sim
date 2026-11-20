// Touch flight controls (phones, tablets): floating virtual stick under the right thumb, throttle with detents under the
// left thumb, a systems drawer (gear, AP, flaps, speedbrake, brake) that shows only what the moment needs, optional rudder
// slider (default: auto-coordinated rudder), camera / menu buttons, a LOOK area (drag on empty screen, double tap to
// recentre), the combat fire cluster in missions (GUN / MSL / TGT / FLR beside the stick, VIEW top right) and a rail for
// extra buttons added by other modules. Positions come from the pure layout in layout.js, so every element owns a
// rectangle and nothing overlaps; the HUD reads `layout.hud`, the combat HUD the CSS variables published here.
// Pointer events with pointer capture; every control tracks its own pointerId, so stick + throttle + a button work at once.
import { clamp, shapeAxis, AB_DETENT, touchRaw, touchShape, autoCoordYaw, throttleDetent, TOUCH_STICK } from './logic.js';
import { touchLayout, BUTTON_IDS, FIRE_IDS, MAX_EXTRA } from './layout.js';
import { viewportHinge } from './segments.js';
import { createPrefs } from './prefs.js';

const CSS = `
.inp-touch{position:absolute;inset:0;pointer-events:none!important;touch-action:none;z-index:6;font-family:var(--font-display,'Saira Condensed','Arial Narrow',Arial,sans-serif);color:var(--fg,#f2f6fa);
  -webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
.inp-touch[hidden],.inp-touch [hidden],.inp-look[hidden]{display:none!important}
.inp-touch *{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;box-sizing:border-box}
.inp-look{position:absolute;inset:0;z-index:2;touch-action:none;pointer-events:auto;-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none;user-select:none}
.inp-region{position:absolute;pointer-events:auto;touch-action:none}
.inp-zone{background:none}
.inp-glass{background:rgb(var(--glass-rgb,18 24 33) / var(--glass-a-clear,.4));-webkit-backdrop-filter:blur(12px) saturate(1.6);backdrop-filter:blur(12px) saturate(1.6);
  box-shadow:inset 0 0 0 1px rgb(255 255 255/.22),inset 0 1px 0 rgb(255 255 255/.28),0 6px 18px rgb(0 0 0/.22);border-radius:16px}
:root.ui-lite .inp-glass{-webkit-backdrop-filter:none;backdrop-filter:none;background:rgb(var(--glass-rgb,18 24 33) / .72)}
.inp-lbl{position:absolute;left:0;right:0;top:7px;text-align:center;font-size:11px;font-weight:600;letter-spacing:.16em;color:var(--fg-dim,#a9b8c7);pointer-events:none;text-transform:uppercase;line-height:1}
/* stick */
.inp-ring,.inp-base,.inp-knob{position:absolute;border-radius:50%;pointer-events:none;transform:translate(-50%,-50%)}
.inp-ring{border:1.5px dashed rgb(255 255 255/.34);background:rgb(var(--glass-rgb,18 24 33)/.16);display:grid;place-items:center;text-align:center;
  font-size:11px;font-weight:600;letter-spacing:.14em;line-height:1.35;color:rgb(242 246 250/.62);text-shadow:0 1px 2px rgb(0 0 0/.6)}
.inp-base{border:1.5px solid rgb(255 255 255/.4);background:rgb(var(--glass-rgb,18 24 33)/.3)}
.inp-base::after{content:"";position:absolute;inset:30%;border:1px dashed rgb(255 255 255/.25);border-radius:50%}
.inp-knob{width:56px;height:56px;background:radial-gradient(circle at 50% 35%,#fff,#dfe6ee);box-shadow:0 3px 10px rgb(0 0 0/.35)}
.inp-knob.held{background:radial-gradient(circle at 50% 35%,#ffe7b0,#ffc04a)}
/* throttle */
.inp-track{position:absolute;left:50%;top:26px;bottom:12px;width:8px;margin-left:-4px;border-radius:4px;background:rgb(255 255 255/.14);pointer-events:none}
.inp-fill{position:absolute;left:0;right:0;bottom:0;border-radius:4px;background:linear-gradient(0deg,rgb(255 176 0/.55),rgb(255 196 70/.95));height:0}
.inp-ab{position:absolute;left:5px;right:5px;top:24px;border-radius:8px 8px 3px 3px;background:linear-gradient(0deg,rgb(255 90 60/.10),rgb(255 90 60/.28));pointer-events:none}
.inp-thr-knob{position:absolute;left:50%;width:calc(100% - 14px);max-width:52px;height:18px;margin:0 0 -9px;transform:translateX(-50%);border-radius:9px;background:radial-gradient(circle at 50% 30%,#fff,#dfe6ee);box-shadow:0 2px 8px rgb(0 0 0/.4);pointer-events:none;bottom:0}
.inp-mil{position:absolute;left:6px;right:6px;border-top:2px dashed var(--ok,#4cc9f0);pointer-events:none}
.inp-mil::after{content:"MIL";position:absolute;right:0;top:-13px;font:600 9px/1 var(--font-mono,monospace);letter-spacing:.06em;color:var(--ok,#4cc9f0)}
.inp-pct{position:absolute;left:0;right:0;top:7px;text-align:center;font:600 13px/1 var(--font-mono,'B612 Mono',monospace);color:var(--fg,#f2f6fa);pointer-events:none}
/* rudder */
.inp-rud-c{position:absolute;left:50%;top:18px;bottom:6px;border-left:1px solid rgb(255 255 255/.35);pointer-events:none}
.inp-rud-knob{position:absolute;top:18px;bottom:6px;width:34px;left:50%;margin-left:-17px;border-radius:9px;background:radial-gradient(circle at 50% 35%,#fff,#dfe6ee);box-shadow:0 2px 8px rgb(0 0 0/.35);pointer-events:none}
.inp-rud .inp-lbl{top:5px;font-size:9.5px;display:flex;justify-content:space-between;padding:0 10px;letter-spacing:.14em}
/* buttons */
.inp-btn{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:0 4px;color:var(--fg,#f2f6fa);text-align:center;cursor:pointer}
.inp-btn b{font-size:13px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;line-height:1;white-space:nowrap}
.inp-btn small{font:600 9.5px/1 var(--font-mono,'B612 Mono',monospace);letter-spacing:.04em;color:var(--fg-dim,#a9b8c7);white-space:nowrap}
.inp-btn small:empty{display:none}
.inp-btn svg{width:18px;height:18px;flex:none}
.inp-btn.on{background:rgb(255 176 0/.5);box-shadow:inset 0 0 0 1.5px rgb(255 196 70/.95),0 4px 14px rgb(0 0 0/.25)}
.inp-btn.on small{color:#fff}
.inp-btn.down{transform:scale(.94);background:rgb(255 255 255/.3)}
.inp-btn.on.down{background:rgb(255 176 0/.7)}
.inp-btn.inp-extra{border-radius:50%}
.inp-btn.inp-extra b{font-size:11.5px}
.inp-btn.inp-more b{font-size:12px}
.inp-btn.inp-fire b{font-size:15px;letter-spacing:.14em}
.inp-btn.inp-gun{border-radius:22px;box-shadow:inset 0 0 0 1.5px rgb(255 90 60/.6),0 6px 18px rgb(0 0 0/.25)}
.inp-btn.inp-gun b{font-size:19px;letter-spacing:.3em;color:#ffd9cf;padding-left:.3em}
.inp-btn.inp-gun.down{background:rgb(255 90 60/.7)}
.inp-btn.inp-msl{border-radius:20px}
/* coach card (first flights / help) */
.inp-tip{position:absolute;pointer-events:none;box-sizing:border-box;padding:8px 12px;border-radius:12px;background:rgb(255 176 0/.94);color:var(--accent-ink,#1c1300);display:grid;gap:4px;
  font:600 12px/1.25 var(--font-body,'Saira',system-ui,sans-serif);letter-spacing:.01em;box-shadow:0 4px 14px rgb(0 0 0/.3);opacity:0;transition:opacity .4s}
.inp-touch.coach .inp-tip{opacity:1}
@media (prefers-reduced-motion:reduce){.inp-touch *{transition:none!important}}
`;

// Combat HUD seats while the touch layout runs a mission: until the combat HUD reads the --inp-* variables itself, these
// rules place its panels in the regions the layout reserves (html.inp-mission is set only while the touch UI is up in a
// mission). Fixed positioning: the regions are viewport rectangles and the stack clips (overflow) to its own region.
const COMBAT_SEATS = `
html.inp-mission .cbt-hud-root .cbt-hud-left{position:fixed!important;left:var(--inp-cbt-x)!important;top:var(--inp-cbt-y)!important;width:var(--inp-cbt-w)!important;
  max-height:var(--inp-cbt-h)!important;overflow:hidden!important;transform:none!important}
html.inp-mission.inp-radar .cbt-hud-root .cbt-hud-radar{position:fixed!important;left:var(--inp-radar-x)!important;top:var(--inp-radar-y)!important;width:var(--inp-radar-w)!important;height:var(--inp-radar-h)!important;margin:0!important}
html.inp-mission.inp-subs .cbt-hud-root .cbt-hud-subs{position:fixed!important;left:var(--inp-subs-x)!important;top:var(--inp-subs-y)!important;width:var(--inp-subs-w)!important;height:var(--inp-subs-h)!important;
  bottom:auto!important;transform:none!important;overflow:hidden!important;display:flex!important;flex-direction:column!important;justify-content:flex-end!important;align-items:center!important}
html.inp-mission .cbt-hud-root .cbt-hud-pops{position:fixed!important;left:calc(var(--inp-clear-x) + var(--inp-clear-w) / 2)!important;top:calc(var(--inp-clear-y) + 40px)!important}
html.inp-mission .cbt-hud-root .cbt-hud-banner{position:fixed!important;left:calc(var(--inp-clear-x) + var(--inp-clear-w) / 2)!important;top:calc(var(--inp-clear-y) + var(--inp-clear-h) / 2)!important;width:min(520px,var(--inp-clear-w))!important}
html.inp-mission .cbt-hud-root .cbt-hud-hints{display:none!important}
html.inp-mission .cbt-inp-touch{position:fixed!important;inset:0!important;width:auto!important;height:auto!important;pointer-events:none!important}
html.inp-mission .cbt-inp-touch .cbt-inp-grid{display:contents!important}
html.inp-mission .cbt-inp-touch .cbt-inp-btn{position:fixed!important;pointer-events:auto!important;margin:0!important;min-width:0!important}
html.inp-mission .cbt-inp-btn[data-act="gun"]{left:var(--inp-gun-x)!important;top:var(--inp-gun-y)!important;width:var(--inp-gun-w)!important;height:var(--inp-gun-h)!important}
html.inp-mission .cbt-inp-btn[data-act="missile"]{left:var(--inp-msl-x)!important;top:var(--inp-msl-y)!important;width:var(--inp-msl-w)!important;height:var(--inp-msl-h)!important}
html.inp-mission .cbt-inp-btn[data-act="targetNext"]{left:var(--inp-tgt-x)!important;top:var(--inp-tgt-y)!important;width:var(--inp-tgt-w)!important;height:var(--inp-tgt-h)!important}
html.inp-mission .cbt-inp-btn[data-act="flare"]{left:var(--inp-flr-x)!important;top:var(--inp-flr-y)!important;width:var(--inp-flr-w)!important;height:var(--inp-flr-h)!important}
html.inp-mission .cbt-inp-btn[data-act="padlock"]{left:var(--inp-view-x)!important;top:var(--inp-view-y)!important;width:var(--inp-view-w)!important;height:var(--inp-view-h)!important}
`;

const ICON = {
  cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.4"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="3.6" height="14" rx="1"/><rect x="13.9" y="5" width="3.6" height="14" rx="1"/></svg>',
  view: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.8"/></svg>',
};
// regions published as CSS custom properties on <html>: --inp-<name>-x / -y / -w / -h (px)
const VAR_RECTS = ['hud', 'cbt', 'radar', 'subs', 'clear', 'zone', 'dock', 'view'];

/**
 * @param ctx  the sim context
 * @param h    hooks from input: { setMode(m), command(name), toggleSpeedbrake(), hasAB(), controls, prefs? }
 */
export function createTouchControls(ctx, h) {
  const c = h.controls;
  const prefs = h.prefs || createPrefs();
  let P = prefs.get();
  // st: what input/index.js reads each frame. raw = stick before shaping (unit circle), roll/pitch shaped, yaw = rudder
  // slider or auto-coordination; look = LOOK area offset (−1…1, +x right, +y up) and lookPX/PY = px dragged this frame.
  const st = { roll: 0, pitch: 0, yaw: 0, brake: false, absThr: null, thrActive: false, raw: { x: 0, y: 0 }, stickHeld: false,
    lookX: 0, lookY: 0, lookPX: 0, lookPY: 0, lookActive: false, autoCoord: true };
  const stk = { x: 0, y: 0 };
  const style = document.createElement('style'); style.textContent = CSS + COMBAT_SEATS; document.head.appendChild(style);
  const el = document.createElement('div'); el.className = 'inp-touch'; el.hidden = true;
  el.innerHTML = `
    <div class="inp-region inp-zone" data-r="zone"></div>
    <div class="inp-ring"><span>DRAG<br>TO FLY</span></div><div class="inp-base" hidden></div><div class="inp-knob" hidden></div>
    <div class="inp-region inp-glass inp-thr" data-r="thr" role="slider" aria-label="Throttle" aria-valuemin="0" aria-valuemax="100"><div class="inp-ab" hidden></div><div class="inp-pct">0</div><div class="inp-track"><div class="inp-fill"></div></div><div class="inp-mil" hidden></div><div class="inp-thr-knob"></div></div>
    <div class="inp-region inp-glass inp-rud" data-r="rud" role="slider" aria-label="Rudder"><div class="inp-rud-c"></div><div class="inp-lbl"><span>◀</span><span>Rudder</span><span>▶</span></div><div class="inp-rud-knob"></div></div>
    <div class="inp-tip" aria-hidden="true"><span>◀ Left thumb: slide THR for power</span><span>Right thumb: drag on the right to fly ▶</span><span>Drag empty sky to look · double tap to recentre</span></div>`;
  ctx.uiRoot.appendChild(el);
  const look = document.createElement('div'); look.className = 'inp-look'; look.hidden = true; look.setAttribute('aria-hidden', 'true');
  ctx.uiRoot.appendChild(look);
  const $ = (s) => el.querySelector(s);
  const zone = $('.inp-zone'), ring = $('.inp-ring'), base = $('.inp-base'), knob = $('.inp-knob');
  const thr = $('.inp-thr'), fill = $('.inp-fill'), tKnob = $('.inp-thr-knob'), pct = $('.inp-pct'), mil = $('.inp-mil'), abZone = $('.inp-ab');
  const rud = $('.inp-rud'), rKnob = $('.inp-rud-knob');
  const tip = el.querySelector('.inp-tip');
  const place = (node, q) => {
    if (!q) { node.hidden = true; return; }
    const s = node.style; s.left = q.x + 'px'; s.top = q.y + 'px'; s.width = q.w + 'px'; s.height = q.h + 'px';
  };
  const buzz = (ms) => { if (!P.haptics) return; try { navigator.vibrate && navigator.vibrate(ms); } catch {} };

  // ---- stick (floating: the base appears where the thumb lands; it trails the thumb beyond full throw) ----
  const sk = { id: -1, ox: 0, oy: 0, edge: false };
  let L = null;
  const radius = () => (L ? L.stickR : 50);
  zone.addEventListener('pointerdown', (e) => {
    if (sk.id !== -1) return;
    e.preventDefault(); h.setMode('touch'); sk.id = e.pointerId; try { zone.setPointerCapture(e.pointerId); } catch {}
    sk.ox = e.clientX; sk.oy = e.clientY; sk.edge = false; st.stickHeld = true;
    base.hidden = knob.hidden = false; ring.hidden = true; knob.classList.remove('held');
    const d = radius() * 2 / P.sensitivity; base.style.width = base.style.height = d + 'px';
    moveStick(e.clientX, e.clientY);
    coachDone();
  });
  zone.addEventListener('pointermove', (e) => { if (e.pointerId === sk.id) { e.preventDefault(); moveStick(e.clientX, e.clientY); } });
  const endStick = (e) => { if (e.pointerId === sk.id) stickUp(); };
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) zone.addEventListener(t, endStick);
  function moveStick(px, py) {
    const rad = radius() / P.sensitivity;                                     // throw in px for full deflection
    let dx = px - sk.ox, dy = py - sk.oy; const d = Math.hypot(dx, dy);
    if (d > rad) { const k = (d - rad) / d; sk.ox += dx * k; sk.oy += dy * k; dx = px - sk.ox; dy = py - sk.oy; }
    const pr = el.getBoundingClientRect();
    base.style.left = (sk.ox - pr.left) + 'px'; base.style.top = (sk.oy - pr.top) + 'px';
    knob.style.left = (sk.ox + dx - pr.left) + 'px'; knob.style.top = (sk.oy + dy - pr.top) + 'px';
    touchRaw(dx, dy, rad, 1, st.raw);
    touchShape(st.raw, stk);
    st.roll = stk.x; st.pitch = stk.y;
    const atEdge = Math.hypot(st.raw.x, st.raw.y) > 0.985;
    if (atEdge && !sk.edge) buzz(6);
    sk.edge = atEdge;
  }
  function stickUp() {
    const wasHeld = sk.id !== -1;
    sk.id = -1; st.stickHeld = false;
    if (P.autoCentre || !wasHeld) { st.roll = st.pitch = 0; st.raw.x = st.raw.y = 0; base.hidden = knob.hidden = true; ring.hidden = false; }
    else knob.classList.add('held');                                         // hold the last deflection (auto-centre off)
  }

  // ---- throttle: relative drag (touching never jumps the lever), detents at idle / MIL, afterburner zone above MIL ----
  const tr = { id: -1, y0: 0, v0: 0, last: 0 };
  const thrTravel = () => Math.max(40, thr.clientHeight - 38);
  thr.addEventListener('pointerdown', (e) => {
    if (tr.id !== -1) return;
    e.preventDefault(); h.setMode('touch'); tr.id = e.pointerId; try { thr.setPointerCapture(e.pointerId); } catch {}
    tr.y0 = e.clientY; tr.v0 = c.throttle; tr.last = c.throttle; st.thrActive = true; st.absThr = c.throttle;
    coachDone();
  });
  thr.addEventListener('pointermove', (e) => {
    if (e.pointerId !== tr.id) return;
    e.preventDefault();
    const r = throttleDetent(tr.last, tr.v0 + (tr.y0 - e.clientY) / thrTravel(), h.hasAB());
    if (r.hit) buzz(r.hit === 'ab' ? 18 : 10);
    tr.last = r.v; st.absThr = r.v;
  });
  const endThr = (e) => { if (e.pointerId === tr.id) { tr.id = -1; st.thrActive = false; } };
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) thr.addEventListener(t, endThr);

  // ---- rudder (optional slider): relative to where the thumb lands, springs back to centre ----
  const ru = { id: -1, x0: 0, v: 0 };
  rud.addEventListener('pointerdown', (e) => {
    if (ru.id !== -1) return;
    e.preventDefault(); h.setMode('touch'); ru.id = e.pointerId; ru.x0 = e.clientX; try { rud.setPointerCapture(e.pointerId); } catch {}
  });
  rud.addEventListener('pointermove', (e) => {
    if (e.pointerId !== ru.id) return;
    e.preventDefault();
    ru.v = clamp((e.clientX - ru.x0) / Math.max(30, rud.clientWidth * 0.42), -1, 1);
  });
  // rudder: slider while touched, else auto-coordinated from the stick (unless disabled, e.g. by the combat assist).
  // A getter, so it is never a frame stale whatever order the input and UI updates run in.
  Object.defineProperty(st, 'yaw', { enumerable: true, set() {},
    get: () => (ru.id !== -1 ? shapeAxis(ru.v, 0.06, 0.2) : (st.autoCoord ? autoCoordYaw(st.roll) : 0)) });
  const endRud = (e) => { if (e.pointerId === ru.id) { ru.id = -1; ru.v = 0; } };
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) rud.addEventListener(t, endRud);

  // ---- LOOK: drag on empty screen to look around (the offset stays), double tap to recentre ----
  const lk = { id: -1, lx: 0, ly: 0, tapT: 0, tapX: 0, tapY: 0, moved: 0 };
  const lookRange = () => 0.32 * Math.min(ctx.uiRoot.clientWidth || 800, ctx.uiRoot.clientHeight || 600);
  look.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;          // mouse look stays on the canvas
    if (lk.id !== -1) return;
    e.preventDefault(); h.setMode('touch'); lk.id = e.pointerId; lk.lx = e.clientX; lk.ly = e.clientY; lk.moved = 0;
    try { look.setPointerCapture(e.pointerId); } catch {}
    st.lookActive = true;
  });
  look.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lk.id) return;
    e.preventDefault();
    const dx = e.clientX - lk.lx, dy = e.clientY - lk.ly; lk.lx = e.clientX; lk.ly = e.clientY; lk.moved += Math.abs(dx) + Math.abs(dy);
    const k = P.sensitivity / lookRange();
    st.lookX = clamp(st.lookX + dx * k, -1, 1); st.lookY = clamp(st.lookY - dy * k, -1, 1);
    st.lookPX += dx * P.sensitivity; st.lookPY -= dy * P.sensitivity;
  });
  const endLook = (e) => {
    if (e.pointerId !== lk.id) return;
    lk.id = -1; st.lookActive = false;
    if (lk.moved < 12) {
      const now = performance.now();
      if (now - lk.tapT < 330 && Math.hypot(e.clientX - lk.tapX, e.clientY - lk.tapY) < 40) { recentre(); lk.tapT = 0; }
      else { lk.tapT = now; lk.tapX = e.clientX; lk.tapY = e.clientY; }
    }
  };
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) look.addEventListener(t, endLook);
  function recentre() { st.lookX = st.lookY = 0; buzz(8); }

  // ---- buttons ----
  const buttons = new Map();      // id → { el, spec, release }
  function makeButton(spec, cls) {
    const b = document.createElement('div');
    b.className = 'inp-region inp-glass inp-btn' + (cls ? ' ' + cls : '');
    b.setAttribute('role', 'button'); b.setAttribute('aria-label', spec.aria || spec.label || spec.id);
    b.dataset.id = spec.id;
    b.innerHTML = (spec.icon || '') + '<b></b><small></small>';
    b.querySelector('b').textContent = spec.label || '';
    let pid = -1;
    const release = () => { if (pid === -1) return; pid = -1; b.classList.remove('down'); try { spec.onUp && spec.onUp(); } catch (e) { console.error(e); } };
    b.addEventListener('pointerdown', (e) => {
      if (pid !== -1) return;
      e.preventDefault(); e.stopPropagation(); h.setMode('touch'); pid = e.pointerId; b.classList.add('down');
      try { b.setPointerCapture(e.pointerId); } catch {}
      buzz(spec.buzz || 8);
      try { spec.onDown && spec.onDown(); } catch (err) { console.error(err); }
    });
    const up = (e) => { if (e.pointerId === pid) release(); };
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(t, up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    el.appendChild(b);
    const rec = { el: b, spec, release, sub: b.querySelector('small'), lbl: b.querySelector('b'), on: null, subText: '' };
    buttons.set(spec.id, rec);
    return rec;
  }
  const cmd = (n) => () => h.command(n);
  const sysUse = () => { drawerT = DRAWER_LINGER; };
  makeButton({ id: 'gear', label: 'Gear', aria: 'Landing gear', onDown: () => { sysUse(); h.command('gearToggle'); } });
  makeButton({ id: 'ap', label: 'AP', aria: 'Autopilot', onDown: () => { sysUse(); h.command('apToggle'); } });
  makeButton({ id: 'flapUp', label: 'Flaps −', aria: 'Flaps retract one notch', onDown: () => { sysUse(); h.command('flapsUp'); } });
  makeButton({ id: 'flapDn', label: 'Flaps +', aria: 'Flaps extend one notch', onDown: () => { sysUse(); h.command('flapsDown'); } });
  makeButton({ id: 'sb', label: 'Spd brk', aria: 'Speedbrake', onDown: () => { sysUse(); h.toggleSpeedbrake(); } });
  makeButton({ id: 'brake', label: 'Brake', aria: 'Wheel brakes (hold)', onDown: () => { sysUse(); st.brake = true; }, onUp: () => { st.brake = false; } });
  makeButton({ id: 'more', label: 'Sys', aria: 'Systems: gear, flaps, brakes, autopilot', onDown: () => { drawerOpen = !drawerOpen; drawerT = DRAWER_LINGER; } }, 'inp-more');
  makeButton({ id: 'cam', label: 'Cam', aria: 'Next camera', icon: ICON.cam, onDown: cmd('cameraNext') });
  makeButton({ id: 'menu', label: 'Menu', aria: 'Pause and open the menu', icon: ICON.menu, onDown: cmd('menu') });
  // combat (missions): own buttons when combat exposes input.actions; else the combat grid is adopted (COMBAT_SEATS)
  const combat = () => ctx.combat || null;
  const actions = () => combat()?.input?.actions || null;
  const fireSpecs = {
    gun: { label: 'Gun', aria: 'Fire gun (hold)', buzz: 12, onDown: () => actions()?.gun?.(true), onUp: () => actions()?.gun?.(false) },
    msl: { label: 'MSL', aria: 'Launch missile', buzz: 16, onDown: () => actions()?.missile?.() },
    tgt: { label: 'TGT', aria: 'Next target', onDown: () => actions()?.targetNext?.() },
    flr: { label: 'FLR', aria: 'Flares', onDown: () => actions()?.flares?.() },
  };
  for (const id of FIRE_IDS) { const r = makeButton({ id: 'fire.' + id, ...fireSpecs[id] }, 'inp-fire inp-' + id); r.el.hidden = true; }
  makeButton({ id: 'view', label: 'View', aria: 'Target view (padlock) on / off', icon: ICON.view, onDown: () => toggleView() }).el.hidden = true;
  function toggleView() {
    const cb = combat(); if (!cb) return;
    const a = actions();
    if (a && a.toggleView) a.toggleView();
    else if (cb.camera && cb.camera.toggle) cb.camera.toggle('padlock');
    else cb.events?.emit?.('cmd', { name: 'padlock' });
  }
  const extras = [];              // ids in rail order
  // one docked block of buttons owned by another module (api.addDock): the layout reserves its measured size and places it
  let dock = null;                // { id, el, mo }
  function dockSize() {
    if (!dock || !dock.el.isConnected || dock.el.hidden) return null;
    const w = dock.el.offsetWidth, hh = dock.el.offsetHeight;
    return w > 0 && hh > 0 ? { w, h: hh } : null;
  }

  // ---- systems drawer: context-sensitive (gear / flaps / brake near the ground), or everything when opened ----
  const DRAWER_LINGER = 8;        // s the opened drawer stays without use
  let drawerOpen = false, drawerT = 0;
  function systemsVisible() {
    const s = ctx.player && ctx.player.state;
    const all = P.drawer === 'open' || drawerOpen;
    const out = {};
    for (const id of BUTTON_IDS) out[id] = all;
    if (!all && P.drawer === 'auto' && s) {
      const gear = s.surfaces ? s.surfaces.gear : 1, fl = s.surfaces ? s.surfaces.flaps || 0 : 0;
      const low = s.onGround || (s.agl != null && s.agl < 300) || gear > 0.5 || fl > 0.02;
      if (low) { out.gear = out.flapUp = out.flapDn = true; out.brake = !!s.onGround || gear > 0.5; }
    }
    return out;
  }

  // ---- layout ----
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  document.body.appendChild(probe);
  function insets() {
    try { const s = getComputedStyle(probe); return { t: parseFloat(s.paddingTop) || 0, r: parseFloat(s.paddingRight) || 0, b: parseFloat(s.paddingBottom) || 0, l: parseFloat(s.paddingLeft) || 0 }; }
    catch { return {}; }
  }
  const root = document.documentElement;
  function publish() {
    const on = shown && !!L;
    root.classList.toggle('inp-touch-on', on);
    root.classList.toggle('inp-mission', on && !!L.mission);
    root.classList.toggle('inp-lefty', on && !!L.lefty);
    root.classList.toggle('inp-radar', on && !!L.radar);
    root.classList.toggle('inp-subs', on && !!L.subs);
    if (!on) return;
    const set = (n, q) => { if (!q) return; root.style.setProperty(`--inp-${n}-x`, q.x + 'px'); root.style.setProperty(`--inp-${n}-y`, q.y + 'px'); root.style.setProperty(`--inp-${n}-w`, q.w + 'px'); root.style.setProperty(`--inp-${n}-h`, (q.h ?? 0) + 'px'); };
    for (const n of VAR_RECTS) set(n, L[n]);
    if (L.fire) for (const id of FIRE_IDS) set(id, L.fire[id]);
  }
  let layoutKey = '', mission = false, adopted = null, ownFire = false;
  function relayout(force) {
    const W = ctx.uiRoot.clientWidth || window.innerWidth, H = ctx.uiRoot.clientHeight || window.innerHeight;
    const ins = insets(), hg = viewportHinge(W, H), ds = dockSize();
    const sr = mission && ctx.hud && ctx.hud.stripRect, sH = sr ? Math.round(sr.h) : 0;
    const key = [W, H, ins.t, ins.r, ins.b, ins.l, extras.length, hg ? [hg.x, hg.y, hg.w, hg.h].join(':') : '', ds ? ds.w + 'x' + ds.h : '',
      mission, sH, P.rudder, P.lefty, P.sensitivity].join(',');
    if (!force && key === layoutKey) return;
    layoutKey = key;
    L = touchLayout(W, H, ins, { extra: extras.length, hinge: hg, dock: ds, rudder: P.rudder, drawer: true, mission, stripH: sH, lefty: P.lefty });
    if (dock && L.dock) Object.assign(dock.el.style, { left: L.dock.x + 'px', top: L.dock.y + 'px', right: 'auto', bottom: 'auto' });
    place(zone, L.zone); place(thr, L.thr);
    rud.hidden = !L.rud; if (L.rud) place(rud, L.rud);
    for (const id of BUTTON_IDS) place(buttons.get(id).el, L.btn[id]);
    place(buttons.get('more').el, L.more);
    place(buttons.get('cam').el, L.cam); place(buttons.get('menu').el, L.menu);
    extras.forEach((id, i) => place(buttons.get(id).el, L.extra[i]));
    ownFire = !!(mission && actions());
    for (const id of FIRE_IDS) { const b = buttons.get('fire.' + id).el; if (ownFire && L.fire) { place(b, L.fire[id]); b.hidden = false; } else b.hidden = true; }
    { const v = buttons.get('view').el; if (ownFire && L.view) { place(v, L.view); v.hidden = false; } else v.hidden = true; }
    if (ownFire) { try { combat()?.input?.setTouchButtons?.(false); } catch {} }
    const d = L.stickR * 2 / P.sensitivity;
    ring.style.left = L.home.x + 'px'; ring.style.top = L.home.y + 'px'; ring.style.width = ring.style.height = Math.max(L.stickR * 1.4, Math.min(d, L.zone.w, L.zone.h)) + 'px';
    // one coach card in free space (landscape: top of the stick zone, above where the thumb rests; portrait: bottom of clear)
    const A = L.portrait ? (L.clear.h > 60 ? L.clear : L.zone) : L.zone;
    const cw = Math.min(A.w, 300);
    tip.style.width = cw + 'px';
    tip.style.left = Math.round(A.x + (A.w - cw) / 2) + 'px';
    if (L.portrait && A === L.clear) { tip.style.top = ''; tip.style.bottom = Math.round(L.H - (A.y + A.h)) + 'px'; }
    else { tip.style.bottom = ''; tip.style.top = A.y + 'px'; }
    lastThr = -1; lastVis = '';
    publish();
    ctx.events.emit('touch:layout', L);
  }
  const onResize = () => { if (shown) relayout(); };
  window.addEventListener('resize', onResize);
  try { window.visualViewport?.addEventListener('resize', onResize); } catch {}
  const unResize = ctx.events.on('resize', onResize);
  // spanning / unspanning a dual-screen device can change the segments without a resize
  const segMQ = [];
  try { for (const q of ['(horizontal-viewport-segments: 2)', '(vertical-viewport-segments: 2)']) { const m = matchMedia(q); m.addEventListener?.('change', onResize); segMQ.push(m); } } catch {}
  const unPrefs = prefs.on((p) => {
    const was = P; P = p;
    if (!was.autoCentre && p.autoCentre && sk.id === -1) { st.roll = st.pitch = 0; st.raw.x = st.raw.y = 0; base.hidden = knob.hidden = true; ring.hidden = false; }
    lastVis = '';
    if (shown) relayout(true);
  });

  // ---- page guards while the touch UI is up: no pinch zoom, double-tap zoom, long-press callouts or text selection ----
  const prevent = (e) => { if (shown) e.preventDefault(); };
  document.addEventListener('gesturestart', prevent, { passive: false });     // Safari pinch
  document.addEventListener('dblclick', prevent, { passive: false });
  const onTouchMove = (e) => { if (shown && e.touches && e.touches.length > 1) e.preventDefault(); };
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('selectstart', (e) => e.preventDefault());
  look.addEventListener('contextmenu', (e) => e.preventDefault());
  try {
    // without viewport-fit=cover env(safe-area-inset-*) is always 0; keep the page at 1:1 (no zoom) on phones
    let vp = document.querySelector('meta[name=viewport]');
    if (!vp) { vp = document.createElement('meta'); vp.name = 'viewport'; vp.content = 'width=device-width, initial-scale=1'; document.head.appendChild(vp); }
    const want = { 'maximum-scale': '1', 'user-scalable': 'no', 'viewport-fit': 'cover' };
    const parts = vp.content.split(',').map(s => s.trim()).filter(Boolean);
    for (const k in want) if (!parts.some(p => p.startsWith(k + '='))) parts.push(k + '=' + want[k]);
    vp.content = parts.join(', ');
  } catch {}

  // ---- coach card: first few flights, and on cmd 'help' ----
  let coachT = 0;
  const COACH_KEY = 'skyward.touch.coach';
  function coach(sec) { coachT = sec; el.classList.add('coach'); }
  function coachDone() { if (coachT > 0) { coachT = Math.min(coachT, 1.2); } }

  // ---- portrait: fully usable, but suggest landscape once per flight (never blocks anything) ----
  let rotateSaid = false;
  function rotateHint() {
    if (rotateSaid || !L || !L.portrait || L.W > 700 || ctx.params?.raw?.hint === '0') return;
    rotateSaid = true;
    try { ctx.hud?.toast?.('Turn your phone sideways for a wider view', { tone: 'info', key: 'rotate', duration: 4 }); } catch {}
  }

  // ---- visibility ----
  let shown = false;
  function setShown(on) {
    on = !!on;
    if (on === shown) return;
    shown = on; el.hidden = !on; look.hidden = !on;
    if (on) { relayout(true); rotateHint(); } else { releaseAll(); publish(); }
  }
  function releaseAll() {
    sk.id = -1; st.stickHeld = false; st.roll = st.pitch = 0; st.raw.x = st.raw.y = 0; base.hidden = knob.hidden = true; ring.hidden = false;
    tr.id = -1; st.thrActive = false; st.absThr = null;
    ru.id = -1; ru.v = 0; st.yaw = 0; st.brake = false;
    lk.id = -1; st.lookActive = false;
    for (const b of buttons.values()) b.release();
  }

  // ---- per-frame UI ----
  let lastThr = -1, lastAB = null, tick = 0, lastVis = '';
  function setOn(id, on, sub) {
    const b = buttons.get(id); if (!b) return;
    if (b.on !== on) { b.on = on; b.el.classList.toggle('on', !!on); b.el.setAttribute('aria-pressed', String(!!on)); }
    if (sub !== undefined && sub !== b.subText) { b.subText = sub; b.sub.textContent = sub; }
  }
  function update(dt) {
    if (coachT > 0) { coachT -= dt; if (coachT <= 0) el.classList.remove('coach'); }   // runs while hidden too
    if (!shown) return;
    const m = !!(combat() && combat().active);
    if (m !== mission) { mission = m; relayout(true); }
    if ((++tick % 10) === 0) relayout();     // insets / segments / strip height can change without a resize event
    if (L && L.rud) rKnob.style.transform = `translateX(${(ru.v * 0.42 * rud.clientWidth).toFixed(1)}px)`;
    // drawer
    if (drawerOpen && P.drawer !== 'open') { drawerT -= dt; if (drawerT <= 0) drawerOpen = false; }
    const vis = systemsVisible();
    const vkey = BUTTON_IDS.map(id => (vis[id] ? 1 : 0)).join('') + (drawerOpen ? 'o' : '') + P.drawer;
    if (vkey !== lastVis) {
      lastVis = vkey;
      for (const id of BUTTON_IDS) { const b = buttons.get(id); b.el.hidden = !vis[id]; if (!vis[id]) b.release(); }
      const more = buttons.get('more'); more.el.hidden = P.drawer === 'open' || !L || !L.more;
      more.lbl.textContent = drawerOpen ? 'Hide' : 'Sys'; more.el.classList.toggle('on', drawerOpen);
    }
    const t = c.throttle, ab = h.hasAB();
    if (t !== lastThr || ab !== lastAB) {
      lastThr = t;
      const f = t.toFixed(3);
      fill.style.height = `calc(100% * ${f})`;
      tKnob.style.bottom = `calc(12px + (100% - 38px) * ${f})`;
      const txt = ab && t > AB_DETENT + 0.005 ? 'AB' : Math.round(t * (ab ? 100 / AB_DETENT : 100)) + '%';
      if (pct.textContent !== txt) { pct.textContent = txt; thr.setAttribute('aria-valuenow', String(Math.round(t * 100))); }
      if (ab !== lastAB) {
        lastAB = ab; mil.hidden = !ab; abZone.hidden = !ab;
        mil.style.bottom = `calc(12px + (100% - 38px) * ${AB_DETENT})`;
        abZone.style.bottom = `calc(12px + (100% - 38px) * ${AB_DETENT})`;
      }
    }
    const s = ctx.player && ctx.player.state;
    if (s) {
      const gear = s.surfaces ? s.surfaces.gear : 1;
      setOn('gear', gear > 0.5, gear > 0.98 ? 'DOWN' : gear < 0.02 ? 'UP' : 'MOVING');
      setOn('ap', !!(s.ap && s.ap.engaged), '');
      const fl = s.surfaces ? s.surfaces.flaps || 0 : 0;
      setOn('flapDn', fl > 0.02, fl > 0.02 ? Math.round(fl * 100) + '%' : 'UP');
      setOn('flapUp', false, '');
      setOn('sb', c.speedbrake > 0.5 || (s.surfaces && s.surfaces.speedbrake > 0.5), '');
      setOn('brake', st.brake || !!s.parkingBrake, s.parkingBrake ? 'PARK' : '');
    }
    if (ownFire) {
      const cs = combat()?.input?.state || null;            // optional readable combat state
      if (cs) {
        if (cs.missile != null) setOn('fire.msl', false, String(cs.missileLabel ?? cs.missile));
        if (cs.flares != null) setOn('fire.flr', false, String(cs.flares));
        if (cs.view != null) setOn('view', !!cs.view, '');
      }
    }
  }

  // ---- public API (ctx.input.touch) ----
  const api = {
    get visible() { return shown; },
    /** Current layout (layout.js shape) while the touch UI is shown, else null. `layout.hud` is the HUD's region. */
    get layout() { return shown ? L : null; },
    /** Touch preferences store (prefs.js): get(), set(patch), on(fn). Settings → Touch controls writes it. */
    prefs,
    /** Stick before shaping: { x, y } on the unit circle (+x right, +y down), and whether a thumb is on it. */
    get raw() { return { x: st.raw.x, y: st.raw.y, held: st.stickHeld }; },
    /** Auto-coordinated rudder from the stick while the slider is not in use (default true). The combat assist sets false. */
    get autoCoord() { return st.autoCoord; },
    set autoCoord(v) { st.autoCoord = !!v; },
    /** Recentre the LOOK offset (same as a double tap on empty screen). */
    recentreLook() { recentre(); },
    /**
     * Add an action button to the rail (right edge in landscape, above the action row in portrait). At most 4.
     * spec: { id, label, icon? (inline SVG string), aria?, onDown?(), onUp?() }. onUp also runs when the touch UI hides.
     * Returns a handle { el, setActive(on), setLabel(text), setSub(text), remove() }, or null when the rail is full.
     */
    addButton(spec) {
      if (!spec || !spec.id || buttons.has(spec.id)) return null;
      if (extras.length >= MAX_EXTRA) return null;
      const rec = makeButton(spec, 'inp-extra');
      extras.push(spec.id);
      relayout(true);
      return {
        el: rec.el,
        setActive: (on) => { rec.el.classList.toggle('on', !!on); rec.el.setAttribute('aria-pressed', String(!!on)); },
        setLabel: (text) => { rec.lbl.textContent = String(text); },
        setSub: (text) => { rec.sub.textContent = String(text); },
        remove: () => api.removeButton(spec.id),
      };
    },
    removeButton(id) {
      const i = extras.indexOf(id); if (i < 0) return false;
      const rec = buttons.get(id); rec.release(); rec.el.remove(); buttons.delete(id); extras.splice(i, 1);
      relayout(true);
      return true;
    },
    /** Show the coach card for `sec` seconds. */
    showHints(sec = 6) { coach(sec); },
    /**
     * Dock a whole block of buttons that another module builds and owns. `el` must be absolutely positioned inside
     * ctx.uiRoot; the layout measures it (offsetWidth / offsetHeight, re-measured on every relayout and when its `hidden`
     * attribute, class or style changes), reserves that rectangle (landscape: right edge, bottom-aligned beside the stick
     * zone; portrait: beside the stick zone) and sets its left / top. While `el` is hidden nothing is reserved. One dock at
     * a time. Returns { get rect(), remove() }, or null when another dock is set. (The combat fire grid does NOT use this:
     * it has its own reserved cluster, L.fire.)
     */
    addDock(spec) {
      if (!spec || !spec.el) return null;
      if (dock && dock.el !== spec.el) return null;
      if (!dock) {
        let mo = null;
        try { mo = new MutationObserver(() => { if (shown) relayout(); }); mo.observe(spec.el, { attributes: true, attributeFilter: ['hidden', 'class', 'style'] }); } catch {}
        dock = { id: spec.id || 'dock', el: spec.el, mo };
        relayout(true);
      }
      return { get rect() { return L && L.dock ? { ...L.dock } : null; }, remove: () => api.removeDock(dock && dock.id) };
    },
    removeDock(id) {
      if (!dock || (id && id !== dock.id)) return false;
      try { dock.mo && dock.mo.disconnect(); } catch {}
      dock = null; relayout(true);
      return true;
    },
  };
  // other modules may hand over a block by marking it data-touch-dock
  try {
    const adopt = () => {
      const g = ctx.uiRoot.querySelector(':scope > [data-touch-dock]'); if (g && !dock) api.addDock({ id: g.dataset.touchDock || 'dock', el: g });
      adopted = ctx.uiRoot.querySelector(':scope > .cbt-inp-touch');   // combat fire grid: seated by COMBAT_SEATS
    };
    new MutationObserver(adopt).observe(ctx.uiRoot, { childList: true });
    adopt();
  } catch {}

  ctx.events.on('cmd', (e) => { if (e && e.name === 'help' && shown) coach(8); });
  ctx.events.on('camera:mode', () => { st.lookX = st.lookY = 0; });
  ctx.events.on('session:start', () => {
    rotateSaid = false; st.lookX = st.lookY = 0; drawerOpen = false;
    if (shown) setTimeout(rotateHint, 0);
    if (ctx.params?.raw?.hint === '0') return;
    let n = 0; try { n = parseInt(localStorage.getItem(COACH_KEY) || '0', 10) || 0; } catch {}
    if (n < 3 || ctx.params?.raw?.hint === '1') { coach(7); if (!ctx.params?.test) { try { localStorage.setItem(COACH_KEY, String(n + 1)); } catch {} } }
  });

  return {
    el, st, api, update, setShown, releaseAll,
    get shown() { return shown; },
    get adopted() { return adopted; },
    dispose() {
      window.removeEventListener('resize', onResize);
      for (const m of segMQ) { try { m.removeEventListener?.('change', onResize); } catch {} }
      try { window.visualViewport?.removeEventListener('resize', onResize); } catch {}
      try { unResize && unResize(); } catch {}
      try { unPrefs && unPrefs(); } catch {}
      document.removeEventListener('gesturestart', prevent);
      document.removeEventListener('dblclick', prevent);
      document.removeEventListener('touchmove', onTouchMove);
      style.remove(); el.remove(); look.remove(); probe.remove();
      for (const k of ['inp-touch-on', 'inp-mission', 'inp-lefty', 'inp-radar', 'inp-subs']) root.classList.remove(k);
    },
  };
}
