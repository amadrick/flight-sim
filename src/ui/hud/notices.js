// DOM notices over the flight view: toasts (state changes + public toast()), crash banner, paused tag, first-flight key hint.
// Toasts are driven by events where physics emits them and by state diffs otherwise (so they work with any physics).
import { num, FPM } from './common.js';

const CSS = `
.hud-root{position:absolute;inset:0;pointer-events:none!important;overflow:hidden;font-family:var(--font-body,'Saira','Segoe UI',system-ui,Arial,sans-serif);color:var(--fg,#f2f6fa)}
.hud-root[hidden],.hud-root [hidden]{display:none!important}
.hud-toasts{position:absolute;top:max(14px,env(safe-area-inset-top,0px));left:0;right:0;display:flex;flex-direction:column;align-items:center;gap:8px;padding:0 max(16px,env(safe-area-inset-left,0px))}
.hud-toast{--r:999px;display:flex;align-items:center;gap:10px;max-width:100%;box-sizing:border-box;height:38px;padding:0 18px 0 14px;
  font-size:13.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  opacity:0;transform:translateY(-10px) scale(.94);transition:opacity .22s ease,transform .38s var(--spring,cubic-bezier(.34,1.32,.5,1))}
.hud-toast::marker{content:none}
.hud-toast i{width:8px;height:8px;border-radius:50%;flex:none;background:var(--hud,#5dff9b);box-shadow:0 0 8px currentColor;color:var(--hud,#5dff9b)}
.hud-toast.on{opacity:1;transform:none}
.hud-toast[data-tone=caution]{color:#ffd27a}.hud-toast[data-tone=caution] i{background:var(--accent,#ffb000);color:var(--accent,#ffb000)}
.hud-toast[data-tone=warn]{color:#ffb3a3}.hud-toast[data-tone=warn] i{background:var(--warn,#ff5a3c);color:var(--warn,#ff5a3c)}
.hud-toast[data-tone=info] i{background:var(--ok,#4cc9f0);color:var(--ok,#4cc9f0)}
.hud-root .hud-paused{--r:999px;position:absolute;left:50%;top:30%;transform:translate(-50%,-50%);display:flex;align-items:center;gap:14px;height:52px;padding:0 26px 0 22px;box-sizing:border-box;
  font-family:var(--font-display,'Saira Condensed','Arial Narrow',Arial,sans-serif);font-weight:600;font-size:clamp(20px,2.6vw,28px);letter-spacing:.3em;color:var(--fg,#f2f6fa)}
.hud-paused::after{content:"";order:-1;width:11px;height:20px;border:solid currentColor;border-width:0 4px;box-sizing:border-box;border-radius:1px}
.hud-root .hud-crash{--r:30px;position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);width:min(500px,calc(100% - 32px));box-sizing:border-box;text-align:center;padding:24px 22px 20px}
.hud-crash h2{margin:0 0 6px;font-family:var(--font-display,'Saira Condensed','Arial Narrow',Arial,sans-serif);font-weight:600;font-size:clamp(24px,4vw,34px);letter-spacing:.2em;text-transform:uppercase;color:var(--fg,#f2f6fa)}
.hud-crash h2::before{content:"";display:inline-block;width:12px;height:12px;border-radius:50%;margin:0 14px 4px 0;vertical-align:middle;background:var(--warn,#ff5a3c);box-shadow:0 0 12px var(--warn,#ff5a3c)}
.hud-crash p{margin:0;font-size:14px;letter-spacing:.04em;color:#ffc2b4}
.hud-crash .hud-k{margin-top:14px;color:var(--fg-dim,#a9b8c7);font-size:13px}
.hud-kbd{display:inline-grid;place-items:center;min-width:24px;height:23px;padding:0 7px;margin:0 2px;box-sizing:border-box;border-radius:7px;color:var(--fg,#f2f6fa);
  font-family:var(--font-mono,'B612 Mono',ui-monospace,monospace);font-size:11px;font-weight:700;letter-spacing:0;text-transform:none;
  background:linear-gradient(rgb(255 255 255/.18),rgb(255 255 255/.08));box-shadow:inset 0 0 0 1px rgb(255 255 255/.18),inset 0 -2px 0 rgb(0 0 0/.25)}
.hud-root .hud-hint{--r:24px;position:absolute;left:max(16px,env(safe-area-inset-left,0px));top:max(16px,env(safe-area-inset-top,0px));width:min(300px,calc(100% - 32px));box-sizing:border-box;padding:14px 16px 14px;
  font-size:13px;color:var(--fg-dim,#a9b8c7);transform-origin:top left;transition:opacity .7s ease,transform .5s var(--spring,cubic-bezier(.34,1.32,.5,1))}
.hud-hint.off{opacity:0;transform:scale(.96) translateY(-6px)}
.hud-hint h3{display:flex;align-items:center;justify-content:space-between;margin:0 0 10px;font-size:15px;font-weight:600;letter-spacing:.01em;color:var(--fg,#f2f6fa)}
.hud-hint h3>span{font-size:11.5px;font-weight:500;color:var(--fg-faint,rgba(214,226,238,.56))}
.hud-hint dl{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;margin:0}
.hud-hint dt{text-align:right;white-space:nowrap}.hud-hint dd{margin:0;align-self:center;color:var(--fg,#f2f6fa)}
.hud-plate.hud-plate{position:absolute;left:0;top:0;pointer-events:none!important;transition:opacity .25s}
.hud-plate[hidden]{display:none}
@media (max-width:520px),(pointer:coarse){.hud-toast{font-size:12px;height:34px}.hud-hint{display:none}}
@media (prefers-reduced-motion:reduce){.hud-toast,.hud-hint{transition:none}}
`;

const HINT = [
  [['W', 'S'], 'Pitch down / up'], [['A', 'D'], 'Roll'], [['Q', 'E'], 'Rudder'], [['R', 'F'], 'Throttle up / down'],
  [['G'], 'Landing gear'], [['[', ']'], 'Flaps'], [['B'], 'Speedbrake'], [['T'], 'Autopilot'], [['C'], 'Change camera'],
  [['U'], 'HUD on / off'], [['P'], 'Pause'], [['Esc'], 'Menu'],
];
const HINT_AUTO = 7;        // s of flying the controls card stays up by itself
const HINT_ASKED = 12;      // s when brought back with F1 / the help button
const HINT_FADE = 0.8;
const HINT_AUTO_SESSIONS = 6;   // the card comes up by itself for the first few flights, then only on request

const AIRLINER_FLAPS = [0, 1, 2, 5, 10, 15, 25, 30, 40];

export function createNotices(ctx) {
  const doc = document;
  const style = doc.createElement('style'); style.textContent = CSS; doc.head.appendChild(style);
  const root = doc.createElement('div'); root.className = 'hud-root'; root.setAttribute('aria-live', 'polite');
  const toasts = doc.createElement('div'); toasts.className = 'hud-toasts'; root.appendChild(toasts);
  const paused = doc.createElement('div'); paused.className = 'hud-paused glass'; paused.textContent = 'PAUSED'; paused.hidden = true; root.appendChild(paused);
  const crash = doc.createElement('div'); crash.className = 'hud-crash glass'; crash.hidden = true; crash.setAttribute('role', 'alert');
  crash.innerHTML = '<h2>Flight ended</h2><p class="hud-reason"></p><div class="hud-k">Press <span class="hud-kbd">Backspace</span> to restart</div>';
  root.appendChild(crash);
  const crashReason = crash.querySelector('.hud-reason');
  const hint = doc.createElement('div'); hint.className = 'hud-hint glass'; hint.hidden = true;
  hint.innerHTML = '<h3>Controls <span><span class="hud-kbd">F1</span> show / hide</span></h3><dl>' + HINT.map(([k, d]) => `<dt>${k.map(x => `<span class="hud-kbd">${x}</span>`).join('')}</dt><dd>${d}</dd>`).join('') + '</dl>';
  root.appendChild(hint);
  ctx.uiRoot.appendChild(root);

  // ---- toasts ---------------------------------------------------------------------------------------
  const POOL = 4, pool = [];
  for (let i = 0; i < POOL; i++) { const el = doc.createElement('div'); el.className = 'hud-toast glass-clear'; el.hidden = true;
    el.appendChild(doc.createElement('i')); el.appendChild(doc.createElement('span')); toasts.appendChild(el); pool.push({ el, t: 0, life: 0, key: '' }); }
  const lastByKey = new Map();
  let now = 0;
  function toast(text, opts = {}) {
    const key = opts.key || text;
    const prev = lastByKey.get(key);
    if (prev && prev.text === text && now - prev.t < (opts.dedupe ?? 2.5)) return;
    lastByKey.set(key, { text, t: now });
    // reuse a toast with the same key (replace text) or the oldest
    let slot = pool.find(p => p.key === key && p.life > 0);
    if (!slot) slot = pool.find(p => p.life <= 0 && p.el.hidden) || pool.reduce((a, b) => (a.t <= b.t ? a : b));
    slot.hideAt = 0;
    slot.key = key; slot.t = now; slot.life = opts.duration ?? 2.6;
    slot.el.lastChild.textContent = String(text).toUpperCase();
    slot.el.dataset.tone = opts.tone || '';
    slot.el.hidden = false;
    toasts.appendChild(slot.el);                 // newest at the bottom of the stack
    void slot.el.offsetWidth; slot.el.classList.add('on');
  }

  // ---- state-diff watchers --------------------------------------------------------------------------
  let W = null;                                  // previous snapshot
  let sessionT = 0, hintT = -1, hintLife = HINT_AUTO;
  const settle = { flaps: { v: 0, since: 0, said: 0 }, sb: { v: 0, since: 0, said: 0 } };
  function flapLabel(def, s, v) {
    const det = def.physics?.flapDetents || def.physics?.flaps?.detents || def.flapDetents;
    if (Array.isArray(det) && det.length > 1) {
      const idx = num(s.flapsIndex, -1);
      if (idx > 0 && idx < det.length) return String(det[idx]);
      const max = det[det.length - 1] || 1; let best = det[0];
      for (const d of det) if (Math.abs(d / max - v) < Math.abs(best / max - v)) best = d;
      return String(best);
    }
    if (def.hudType === 'airliner') {
      let best = 0; for (const d of AIRLINER_FLAPS) if (Math.abs(d / 40 - v) < Math.abs(best / 40 - v)) best = d;
      return String(best);
    }
    return v < 0.02 ? 'UP' : Math.round(v * 100) + '%';
  }
  function snapshot(s) {
    return { gear: num(s.surfaces?.gear, 1), gearDir: 0, park: !!s.parkingBrake, ap: !!s.ap?.engaged, at: !!s.ap?.autothrottle,
      land: !!s.lights?.landing, hook: num(s.surfaces?.hook, 0), canopy: num(s.surfaces?.canopy, 0), hookDir: 0, canDir: 0,
      eng: (s.engines || []).some(e => e.running), timeScale: num(ctx.time?.timeScale, 1) };
  }
  function onSession(p) {
    W = p ? snapshot(p.state) : null; sessionT = now;
    settle.flaps.v = settle.flaps.said = num(p?.state.surfaces?.flaps, 0); settle.flaps.since = now;
    settle.sb.v = settle.sb.said = num(p?.state.surfaces?.speedbrake, 0); settle.sb.since = now;
    for (const sl of pool) { sl.life = 0; sl.el.classList.remove('on'); sl.el.hidden = true; }
    lastByKey.clear();
    if (!p) { hideHint(); return; }
    if (ctx.params.raw?.hint === '0') return;
    let n = 0; try { n = parseInt(localStorage.getItem('skyward.hud.hint') || '0', 10) || 0; } catch {}
    if (ctx.params.raw?.hint === '1' || n < HINT_AUTO_SESSIONS) {
      showHint(HINT_AUTO);
      if (!ctx.params.test) { try { localStorage.setItem('skyward.hud.hint', String(n + 1)); } catch {} }
    }
  }
  function showHint(life) { if (ctx.input?.touchEnabled) return; hintT = 0; hintLife = life; hint.hidden = false; hint.classList.remove('off'); }
  function hideHint() { hintT = -1; hint.classList.add('off'); hint.hidden = true; }
  /** F1 / help button: bring the card back, or put it away. */
  function toggleHint() {
    if (hintT >= 0 && hintT < hintLife) { hintT = hintLife; return; }   // fade out now
    showHint(HINT_ASKED);
  }
  ctx.events.on('cmd', (c) => { if (c?.name === 'help') toggleHint(); });
  function dirOf(prev, cur) { return cur > prev + 1e-4 ? 1 : cur < prev - 1e-4 ? -1 : 0; }
  function watch(p) {
    const s = p.state, def = p.def;
    if (!W) { W = snapshot(s); return; }
    // gear: announce at the start of travel
    const gv = num(s.surfaces?.gear, 1), gd = dirOf(W.gear, gv);
    if (gd && gd !== W.gearDir) toast(gd > 0 ? 'Gear down' : 'Gear up', { key: 'gear' });
    if (gd) W.gearDir = gd; else if (gv <= 0 || gv >= 1) W.gearDir = 0;
    W.gear = gv;
    // flaps / speedbrake: announce when the surface settles at a new position
    const fv = num(s.surfaces?.flaps, 0), F = settle.flaps;
    if (Math.abs(fv - F.v) > 1e-4) { F.v = fv; F.since = now; }
    else if (now - F.since > 0.25 && Math.abs(fv - F.said) > 0.01) { F.said = fv; toast('Flaps ' + flapLabel(def, s, fv), { key: 'flaps', dedupe: 0 }); }
    const sv = num(s.surfaces?.speedbrake, 0), SB = settle.sb;
    if (Math.abs(sv - SB.v) > 1e-4) { SB.v = sv; SB.since = now; }
    else if (now - SB.since > 0.15 && Math.abs(sv - SB.said) > 0.2) { SB.said = sv; toast(sv > 0.5 ? (def.hudType === 'airliner' ? 'Speedbrake extended' : 'Speedbrake out') : (def.hudType === 'airliner' ? 'Speedbrake down' : 'Speedbrake in'), { key: 'sb', tone: sv > 0.5 ? 'caution' : '' }); }
    if (!!s.parkingBrake !== W.park) { W.park = !!s.parkingBrake; toast(W.park ? 'Parking brake set' : 'Parking brake released', { key: 'park', tone: W.park ? 'caution' : '' }); }
    if (!!s.ap?.engaged !== W.ap) { W.ap = !!s.ap?.engaged; toast(W.ap ? 'Autopilot on' : 'Autopilot off', { key: 'ap', tone: W.ap ? 'info' : 'caution' }); }
    if (!!s.ap?.autothrottle !== W.at) { W.at = !!s.ap?.autothrottle; toast(W.at ? 'Autothrottle on' : 'Autothrottle off', { key: 'at', tone: W.at ? 'info' : 'caution' }); }
    if (!!s.lights?.landing !== W.land) { W.land = !!s.lights?.landing; toast(W.land ? 'Landing lights on' : 'Landing lights off', { key: 'lights' }); }
    const hv = num(s.surfaces?.hook, 0), hd = dirOf(W.hook, hv);
    if (hd && hd !== W.hookDir) toast(hd > 0 ? 'Hook down' : 'Hook up', { key: 'hook' });
    W.hookDir = hd || (hv <= 0 || hv >= 1 ? 0 : W.hookDir); W.hook = hv;
    const cv = num(s.surfaces?.canopy, 0), cd = dirOf(W.canopy, cv);
    if (cd && cd !== W.canDir) toast(cd > 0 ? 'Canopy open' : 'Canopy closed', { key: 'canopy' });
    W.canDir = cd || (cv <= 0 || cv >= 1 ? 0 : W.canDir); W.canopy = cv;
    const eng = (s.engines || []).some(e => e.running);
    if (eng !== W.eng) { W.eng = eng; toast(eng ? 'Engine start' : 'Engine shutdown', { key: 'eng', tone: eng ? '' : 'caution' }); }
    const ts = num(ctx.time?.timeScale, 1);
    if (Math.abs(ts - W.timeScale) > 1e-6) { W.timeScale = ts; toast('Sim rate ×' + (ts >= 1 ? +ts.toFixed(2) : '1/' + +(1 / ts).toFixed(1)), { key: 'rate', tone: 'info' }); }
  }

  // ---- events ---------------------------------------------------------------------------------------
  ctx.events.on('gear:moved', (e) => { if (ctx.player && e && typeof e.target === 'number') toast(e.target > 0.5 ? 'Gear down' : 'Gear up', { key: 'gear' }); });
  ctx.events.on('touchdown', (e) => {
    if (!ctx.player) return;
    const fpm = Math.abs(num(e?.verticalSpeed, 0)) / FPM;
    toast('Touchdown  ' + Math.round(fpm / 10) * 10 + ' fpm', { key: 'td', tone: fpm > 600 ? 'caution' : 'info', duration: 4, dedupe: 3 });
  });
  ctx.events.on('camera:mode', (m) => {
    if (!ctx.player || now - sessionT < 1.5) return;
    const names = { chase: 'Chase view', cockpit: 'Cockpit view', orbit: 'Orbit view', flyby: 'Fly-by view', tower: 'Tower view', showcase: 'Showcase', free: 'Free camera' };
    toast(names[m] || String(m) + ' view', { key: 'cam', duration: 1.6 });
  });
  ctx.events.on('crash', (e) => { lastCrashReason = e?.reason || ''; });
  let lastCrashReason = '';

  let lastReason = null, toastTop = null;
  return {
    toast,
    /** Touch layout: start the toast stack below the HUD region (px from the top), or null for the default spot. */
    setToastTop(px) {
      px = px == null ? null : Math.round(px);
      if (px === toastTop) return;
      toastTop = px; toasts.style.top = px == null ? '' : px + 'px';
    },
    onSession,
    toggleHint,
    get hintVisible() { return hintT >= 0 && hintT < hintLife; },
    /** realDt: wall-clock seconds; show: overall visibility; p: ctx.player */
    update(realDt, show, p) {
      now += realDt;
      root.hidden = !show;
      if (!show) return;
      for (const sl of pool) {
        if (sl.life > 0) { sl.life -= realDt; if (sl.life <= 0) { sl.el.classList.remove('on'); sl.hideAt = now + 0.3; } }
        else if (!sl.el.hidden && sl.hideAt && now > sl.hideAt) sl.el.hidden = true;
      }
      paused.hidden = !(ctx.time?.paused && p);
      const crashed = !!p?.state.crashed;
      crash.hidden = !crashed || !!ctx.menu?.crashDialogOpen;   // the menu's dialog replaces the card after 2 s
      if (crashed) {
        const reason = p.state.crashReason || lastCrashReason || 'Aircraft destroyed';
        if (reason !== lastReason) { lastReason = reason; crashReason.textContent = reason; }
      } else lastReason = null;
      if (p && !crashed) watch(p);
      if (hintT >= 0) {
        // the card's clock only runs while flying (not paused), so it is still there after a pause at the start
        if (!ctx.time?.paused) hintT += realDt;
        hint.classList.toggle('off', hintT >= hintLife);
        if (hintT >= hintLife + HINT_FADE) { hintT = -1; hint.hidden = true; }
      }
    },
  };
}
