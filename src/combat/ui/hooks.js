// Entry points into combat from the simulator's menu, registered at runtime from this module so the menu's source stays
// untouched (it is being reworked in parallel). Every anchor has a fallback, nothing throws when an anchor is missing,
// and a MutationObserver on ctx.uiRoot re-attaches whatever the menu re-renders away.
//   - Missions tab in the top bar (after Hangar), with a "New" badge until the first mission is flown
//   - Pause menu (after Restart): Mission select, Combat settings, Leave mission (only during a mission)
//   - Pause-menu Restart restarts the MISSION while one runs (a plain session restart would abort it)
//   - Combat rows appended to the Controls reference
//   - html.cbt-active while a mission runs: the menu's crash card stands down (style); the debrief owns that moment
// Base-UI selectors depended on are listed in DEPENDS (and in INTEGRATION.md).
export const DEPENDS = {
  tabAnchor: '#menu-tab-hangar',
  tabBar: ['#menu-tab-hangar (parent)', '.menu-tabs', '#menu-root [role="tablist"]', '#menu-root nav'],
  tabClass: '.menu-tab',
  pauseAnchor: '#menu-restart',
  pauseList: ['#menu-restart (parent)', '[data-view="pause"] .menu-actions', '#menu-resume (parent)'],
  pauseClasses: ['.menu-act', '.menu-act-chev'],
  keys: ['#menu-root .menu-keys', '.menu-keys'],
  keyClasses: ['.menu-keygroup', '.menu-h', '.menu-group', '.menu-keyrow', '.menu-keyrow-a', '.menu-keyrow-k', '.menu-kbd', '.menu-kor'],
  crash: '.menu-crash',
  menuApi: ['ctx.menu.isOpen', 'ctx.menu.view', 'ctx.menu.open(view)', 'ctx.menu.close()', "'menu:open' event"],
};

const TAB_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.2"/><path d="M12 1.8v4M12 18.2v4M1.8 12h4M18.2 12h4"/></svg>';

export const HOOK_CSS = `
.cbt-active .menu-crash { display: none !important; }
@media (max-width: 460px) { .menu-tabs .menu-tab { padding: 0 9px; font-size: 13px; } }
#menu-tab-missions { position: relative; }
.cbt-ui-newbadge { position: absolute; top: 1px; right: 2px; padding: 1px 5px 0; border-radius: 999px; font-size: 9.5px; font-weight: 700; letter-spacing: 0.08em;
  line-height: 13px; text-transform: uppercase; color: var(--accent-ink, #1c1300); background: var(--accent, #ffb000); pointer-events: none; }
.cbt-ui-pausebtn[hidden] { display: none !important; }
`;

export function installMenuHooks(combat, ui) {
  const ctx = combat.ctx;
  const doc = document;
  const mk = (tag, cls, id, text) => { const el = doc.createElement(tag); if (cls) el.className = cls; if (id) el.id = id; if (text) el.textContent = text; return el; };
  const q = (sel) => { try { return doc.querySelector(sel); } catch { return null; } };
  const safe = (fn) => () => { try { fn(); } catch (e) { console.warn('[combat ui] menu action', e); } };

  function tabBar() {
    return q(DEPENDS.tabAnchor)?.parentElement || q('.menu-tabs') || q('#menu-root [role="tablist"]') || q('#menu-root nav');
  }
  function pauseList() {
    return q(DEPENDS.pauseAnchor)?.parentElement || q('[data-view="pause"] .menu-actions') || q('#menu-resume')?.parentElement;
  }

  let tab = null, badge = null;
  const pauseBtns = [];
  function attachTab() {
    if (tab && tab.isConnected) return;
    const bar = tabBar(); if (!bar) return;
    tab = doc.getElementById('menu-tab-missions') || mk('button', 'menu-tab', 'menu-tab-missions');
    if (!tab.dataset.cbt) {
      tab.dataset.cbt = '1'; tab.type = 'button';
      const ic = mk('span'); ic.style.display = 'contents'; ic.innerHTML = TAB_ICON;
      badge = mk('span', 'cbt-ui-newbadge', null, 'New'); badge.setAttribute('aria-label', 'new');
      tab.append(ic, 'Missions', badge);
      tab.addEventListener('click', safe(() => ui.openMissions()));
    }
    const hangar = q(DEPENDS.tabAnchor);
    if (hangar && hangar.parentElement === bar) hangar.after(tab); else bar.append(tab);
    syncBadge(true);
  }
  function pauseButton(id, label, fn) {
    const b = mk('button', 'menu-act cbt-ui-pausebtn', id); b.type = 'button';
    b.append(label, mk('span', 'menu-act-chev'));
    b.addEventListener('click', safe(fn));
    return b;
  }
  let restartHooked = null;
  function attachPause() {
    const list = pauseList(); if (!list) return;
    if (!pauseBtns.length) {
      pauseBtns.push(
        pauseButton('menu-pause-missions', 'Mission select', () => ui.openMissions()),
        pauseButton('menu-pause-combat', 'Combat settings', () => ui.openSettings()),
        pauseButton('menu-pause-leave', 'Leave mission', () => { ctx.menu?.close?.(); combat.abort(); syncActive(); }));
      pauseBtns[2].classList.add('menu-act-dim');
    }
    if (pauseBtns.every(b => b.isConnected && b.parentElement === list)) { hookRestart(); return; }
    const restart = q(DEPENDS.pauseAnchor);
    if (restart && restart.parentElement === list) restart.after(...pauseBtns); else list.append(...pauseBtns);
    hookRestart();
    syncPause();
  }
  function hookRestart() {
    const restart = q(DEPENDS.pauseAnchor);
    if (!restart || restart === restartHooked) return;
    restartHooked = restart;
    // capture on the target runs before the menu's own listener
    restart.addEventListener('click', (e) => {
      if (!combat.active) return;
      e.stopImmediatePropagation();
      ctx.menu?.close?.();
      combat.restart();
    }, true);
  }
  function syncPause() {
    const restart = q(DEPENDS.pauseAnchor);
    const label = restart && [...restart.childNodes].find(n => n.nodeType === 3 && n.data.trim());
    if (label) label.data = combat.active ? 'Restart mission' : 'Restart flight';
    if (pauseBtns[2]) pauseBtns[2].hidden = !combat.active;
    if (pauseBtns[1]) pauseBtns[1].hidden = !combat.active;
  }
  function attachKeys() {
    const keys = q('#menu-root .menu-keys') || q('.menu-keys');
    if (!keys || keys.querySelector('[data-cbt]')) return;
    const groups = [['Combat', combat.input?.bindings], ['Combat gamepad', combat.input?.padBindings]];
    for (const [title, rows] of groups) {
      if (!Array.isArray(rows) || !rows.length) continue;
      const g = mk('div', 'menu-keygroup'); g.dataset.cbt = '1';
      const hd = mk('div', 'menu-h'); hd.append(mk('span', null, null, title));
      const box = mk('div', 'menu-group');
      for (const b of rows) {
        const row = mk('div', 'menu-keyrow');
        const k = mk('span', 'menu-keyrow-k');
        (b.keys || []).forEach((key, i) => { if (i) k.append(mk('span', 'menu-kor', null, 'or')); k.append(mk('kbd', 'menu-kbd', null, String(key))); });
        row.append(mk('span', 'menu-keyrow-a', null, b.action), k);
        box.append(row);
      }
      g.append(hd, box);
      keys.append(g);
    }
  }
  function attach() {
    for (const f of [attachTab, attachPause, attachKeys]) { try { f(); } catch (e) { console.warn('[combat ui] menu hook', e); } }
  }

  // first-run badge: until any mission has been attempted
  let badgeOn = null;
  function syncBadge(force) {
    const on = !ui.progress?.anyAttempt?.();
    if (!force && on === badgeOn) return;
    badgeOn = on; if (badge) badge.hidden = !on;
  }
  let active = null;
  function syncActive() {
    const a = !!combat.active;
    if (a !== active) { active = a; doc.documentElement.classList.toggle('cbt-active', a); syncPause(); }
  }

  attach();
  ctx.events.on('menu:open', () => { attach(); syncPause(); syncBadge(); });
  combat.events.on('mission:start', () => { syncActive(); syncBadge(); });
  combat.events.on('mission:abort', syncActive);
  // the menu may re-render (mobile layout pass): re-attach on DOM changes, at most once per task
  let queued = false;
  try {
    const mo = new MutationObserver(() => {
      if (queued) return; queued = true;
      Promise.resolve().then(() => { queued = false; if (!(tab?.isConnected) || !pauseBtns.every(b => b.isConnected) || !q('[data-cbt="1"].menu-keygroup')) attach(); });
    });
    mo.observe(ctx.uiRoot || doc.body, { childList: true, subtree: true });
  } catch {}

  return { update() { syncActive(); }, syncPause, attach, get attached() { return { tab: !!tab?.isConnected, pause: pauseBtns.every(b => b.isConnected), keys: !!q('[data-cbt="1"].menu-keygroup') }; } };
}
