// HUD + flight instruments. API: createHud(ctx) -> { update(dt), setVisible(v), toast(text, opts?), setDestination(id), destination }
// Draws on ctx.hudCanvas (2D overlay canvas; this module owns its sizing) plus a small DOM layer for notices.
//   cockpit camera + def.hudType 'fighter'  → conformal F-16-style HUD          (fighter.js)
//   cockpit camera + def.hudType 'airliner' → PFD / ND / engine displays          (airliner.js)
//   any exterior camera                     → compact flight-data strip           (external.js)
import { AIRPORTS, getAirport } from '../../data/airports.js';
import { readTokens, num, KT, NM, RAD } from './common.js';
import { createProjector } from './projection.js';
import { createFighterHud } from './fighter.js';
import { createAirlinerDeck } from './airliner.js';
import { createExternalOverlay } from './external.js';
import { createNotices } from './notices.js';
import { bearingTo, nearestAirport, findIls, createIlsResult, createGcas, predictGroundCollision } from './nav.js';

export async function createHud(ctx) {
  const cv = ctx.hudCanvas;
  const g = cv.getContext('2d');
  const tok = readTokens();
  let W = 2, H = 2, dpr = 1;
  function fit() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    W = Math.max(2, cv.clientWidth || window.innerWidth); H = Math.max(2, cv.clientHeight || window.innerHeight);
    const pw = Math.round(W * dpr), ph = Math.round(H * dpr);
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
    dirty = true;
    deck.invalidate(); ext.invalidate();
  }
  let dirty = true;
  const proj = createProjector();
  const fighter = createFighterHud();
  const deck = createAirlinerDeck(tok);
  const ext = createExternalOverlay(tok);
  const notices = createNotices(ctx);

  // Glass plate under the external flight-data strip: it must sit BELOW the HUD canvas (a backdrop-filter above the
  // canvas would blur the numbers), so it is inserted between the 3D view and the HUD canvas.
  let plate = null, plateKey = '';
  try {
    if (cv.parentNode && ctx.params.raw?.glass !== 'off') {
      plate = document.createElement('div'); plate.className = 'hud-plate glass'; plate.hidden = true; plate.setAttribute('aria-hidden', 'true');
      cv.parentNode.insertBefore(plate, cv);
      ext.setGlass(true);
    }
  } catch { plate = null; }
  function syncPlate(on) {
    if (!plate) return;
    if (!on) { if (!plate.hidden) plate.hidden = true; return; }
    const r = ext.rect; if (!r) return;
    const k = r.x + ',' + r.y + ',' + r.w + ',' + r.h;
    if (k !== plateKey) {
      plateKey = k;
      plate.style.transform = `translate(${r.x}px, ${r.y}px)`; plate.style.width = r.w + 'px'; plate.style.height = r.h + 'px';
      plate.style.setProperty('--r', r.r + 'px');
    }
    if (plate.hidden) plate.hidden = false;
  }

  // fonts may arrive late (Google Fonts) → rebuild cached layers
  try { document.fonts?.addEventListener?.('loadingdone', () => { deck.invalidate(); ext.invalidate(); }); } catch {}
  ctx.events.on('resize', fit);
  window.addEventListener('resize', fit);
  fit();

  // ---- visibility -----------------------------------------------------------------------------------
  let userVisible = ctx.params.hud !== false;
  ctx.events.on('cmd', (c) => { if (c?.name === 'hudToggle') userVisible = !userVisible; });

  // ---- navigation state shared by all displays -------------------------------------------------------
  const nav = { dest: null, destOverride: null, bearing: 0, distNM: 0, ttg: Infinity, ils: createIlsResult(), gcas: createGcas() };
  function defaultDestination(p) {
    if (!p) return null;
    if (ctx.session?.options?.start === 'approach' && p.airport) return p.airport;
    const s = p.state;
    return nearestAirport(s.position.x, s.position.z, p.airport?.id) || p.airport || AIRPORTS[0];
  }
  let gcasTick = 0;
  const groundHeight = (x, z) => (ctx.world?.groundHeightAt ? ctx.world.groundHeightAt(x, z) : 0);
  function updateNav(p) {
    const s = p.state;
    if (nav.destOverride) nav.dest = nav.destOverride;
    else if (!nav.dest) nav.dest = defaultDestination(p);
    const d = nav.dest;
    if (d) {
      const dx = d.position.x - s.position.x, dz = d.position.z - s.position.z;
      nav.bearing = bearingTo(s.position.x, s.position.z, d.position.x, d.position.z);
      nav.distNM = Math.hypot(dx, dz) / NM;
      const gs = num(s.groundSpeed);
      nav.ttg = gs > 15 ? (nav.distNM * NM) / gs : Infinity;
    }
    findIls(s.position.x, s.position.y, s.position.z, num(s.heading) * RAD, d?.id, nav.ils);
    if ((gcasTick++ % 3) === 0) predictGroundCollision(s, groundHeight, p.def.hudType === 'fighter' ? 5 : 1.6, nav.gcas);
  }
  ctx.events.on('session:start', (p) => { nav.dest = null; nav.gcas.pullUp = false; fighter.resetSession(); notices.onSession(p); });
  ctx.events.on('session:end', () => { notices.onSession(null); });

  // ---- glow / brightness (CSS filter on the overlay canvas: composited on the GPU, free for the main thread) ----
  let filterKey = '';
  function setFilter(key) {
    if (key === filterKey) return; filterKey = key;
    const low = ctx.quality?.level === 'low';
    let f = 'none';
    if (key === 'day') f = low ? 'drop-shadow(0 0 1px rgba(0,30,10,.9))' : 'drop-shadow(0 0 1px rgba(0,26,8,.85)) drop-shadow(0 0 3px rgba(93,255,155,.35))';
    else if (key === 'dusk') f = low ? 'none' : 'drop-shadow(0 0 2px rgba(93,255,155,.45))';
    else if (key === 'night') f = low ? 'none' : 'drop-shadow(0 0 2.5px rgba(93,255,155,.5))';
    else if (key === 'ext') f = 'drop-shadow(0 1px 2px rgba(0,0,0,.55))';
    cv.style.filter = f;
  }
  ctx.events.on('quality:change', () => { const k = filterKey; filterKey = ''; setFilter(k); });

  const camPos = { x: 0, y: 0, z: 0 };
  const E = { box: null, clear: null, s: null, def: null, p: null, ctx, proj, nav, tok, t: 0, W, H, dpr, camPos: null, hudColor: tok.hud, realDt: 0 };
  let t = 0;
  let hingeTick = 0, hingeCache = null;
  const hingeBox = { x: 0, y: 0, w: 0, h: 0 }, hingeClear = { x: 0, y: 0, w: 0, h: 0 };

  const hud = {
    get destination() { return nav.dest; },
    setDestination(id) {
      const a = id ? AIRPORTS.find(x => x.id === id) : null;
      nav.destOverride = a || null; nav.dest = a || null;
      if (a) notices.toast('Destination ' + a.id, { key: 'dest', tone: 'info' });
    },
    setVisible(v) { userVisible = !!v; },
    toast(text, opts) { notices.toast(text, opts); },
    update(dt) {
      const realDt = num(ctx.time?.realDt, 1 / 60);
      // follow the canvas size every frame too: phones rotate, and the 'resize' event can arrive late (or report the old
      // size on iOS), which would leave the overlay stretched or cleared after it was drawn
      if (cv.clientWidth !== W || cv.clientHeight !== H) { if (cv.clientWidth > 1 && cv.clientHeight > 1) fit(); }
      t += realDt;
      const p = ctx.player;
      const rig = ctx.cameraRig;
      const mode = rig?.mode || 'chase';
      const menuOpen = !!ctx.menu?.isOpen;
      const show = userVisible && ctx.params.hud !== false && !menuOpen && mode !== 'showcase';
      notices.update(realDt, show, p);
      if (dirty) { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); dirty = false; }
      if (!show || !p || !p.state) { syncPlate(false); notices.setToastTop(null); return; }
      const s = p.state;
      updateNav(p);
      const interior = rig?.isInterior ?? (mode === 'cockpit');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      dirty = true;
      E.s = s; E.def = p.def; E.p = p; E.t = t; E.W = W; E.H = H; E.dpr = dpr; E.realDt = realDt;
      const wp = rig?.worldPosition;
      if (wp && isFinite(wp.x)) { camPos.x = wp.x; camPos.y = wp.y; camPos.z = wp.z; } else { camPos.x = s.position.x; camPos.y = s.position.y; camPos.z = s.position.z; }
      E.camPos = camPos;
      // touch screens: draw in the HUD region the touch layout reserves (clear of stick, throttle and buttons)
      const tl = ctx.input?.touch?.layout || null;
      E.box = tl && tl.hud && tl.hud.w > 120 && tl.hud.h > 60 ? tl.hud : null;
      E.clear = tl ? tl.clear : null;
      if (!tl) {
        // keyboard / gamepad on a dual-screen device spanned side by side: keep the strip on the left screen (top) and
        // the conformal HUD off the hinge (it falls back to the strip when centred on it)
        if ((hingeTick++ % 30) === 0) hingeCache = ctx.input?.touch?.hinge || null;
        const hg = hingeCache;
        if (hg && hg.w >= 2 && hg.h > H * 0.5) {
          E.box = hingeBox; hingeBox.x = 16; hingeBox.y = 12; hingeBox.w = hg.x - 32; hingeBox.h = Math.round(Math.min(220, H * 0.4));
          E.clear = hingeClear; hingeClear.x = hg.x + hg.w + 16; hingeClear.y = 12; hingeClear.w = W - hingeClear.x - 16; hingeClear.h = H - 24;
        }
      }
      let below = null;
      if (interior && p.def.hudType !== 'airliner') {
        const night = num(ctx.env?.nightFactor, 0);
        setFilter(night > 0.7 ? 'night' : night > 0.3 ? 'dusk' : 'day');
        E.hudColor = night > 0.7 ? 'rgba(93,255,155,0.82)' : night > 0.3 ? 'rgba(110,255,170,0.92)' : '#7dffb2';
        ctx.camera.updateMatrixWorld?.();
        proj.set(ctx.camera, W, H);
        if (fighter.draw(g, E) === false) {
          setFilter('ext'); ext.draw(g, E); syncPlate(true);
          const r = ext.rect; if (E.box && r) below = r.y + r.h + 40;
        } else syncPlate(false);
      } else if (interior) {
        setFilter('none');
        deck.draw(g, E);
        syncPlate(false);
        if (E.box) below = deck.boxBottom;
      } else {
        setFilter('ext');
        ext.draw(g, E);
        syncPlate(true);
        const r = ext.rect; if (E.box && r) below = r.y + r.h + 40;   // room for the warning chip under the strip
      }
      notices.setToastTop(below, E.box ? E.box.x : null, E.box ? E.box.w : null);
    },
  };
  return hud;
}
