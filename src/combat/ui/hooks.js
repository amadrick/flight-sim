// Entry points into combat from the simulator's menu, registered at runtime from this module so the menu's source stays
// untouched (it is being reworked in parallel). Each hook looks its anchor up by id and does nothing if it is missing.
//   - Missions tab in the menu's top bar, after Hangar           → ui.openMissions()
//   - Mission select in the pause menu, after Restart             → ui.openMissions()
//   - Restart in the pause menu restarts the MISSION while one runs (a plain session restart would abort it)
//   - Combat rows appended to the Controls reference
//   - html.cbt-active while a mission runs: the menu's crash card stands down (style), the debrief owns that moment
// Everything that depends on the menu's internals is in this one file, so the integrator can swap it for real hooks.
const NS_TAB_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.2"/><path d="M12 1.8v4M12 18.2v4M1.8 12h4M18.2 12h4"/></svg>';

export const HOOK_CSS = `
.cbt-active .menu-crash { display: none !important; }
@media (max-width: 460px) { .menu-tabs .menu-tab { padding: 0 9px; font-size: 13px; } }
`;

export function installMenuHooks(combat, ui) {
  const ctx = combat.ctx;
  const doc = document;
  const mk = (tag, cls, id, text) => { const el = doc.createElement(tag); if (cls) el.className = cls; if (id) el.id = id; if (text) el.textContent = text; return el; };
  const open = () => { try { ui.openMissions(); } catch (e) { console.warn('[combat ui] open missions', e); } };

  // top bar tab
  const hangarTab = doc.getElementById('menu-tab-hangar');
  if (hangarTab && !doc.getElementById('menu-tab-missions')) {
    const t = mk('button', 'menu-tab', 'menu-tab-missions');
    t.type = 'button';
    const ic = mk('span'); ic.style.display = 'contents'; ic.innerHTML = NS_TAB_ICON;
    t.append(ic, 'Missions');
    t.addEventListener('click', open);
    hangarTab.after(t);
  }

  // pause menu: Mission select + mission-aware Restart
  const restart = doc.getElementById('menu-restart');
  let pauseBtn = null;
  if (restart && !doc.getElementById('menu-pause-missions')) {
    pauseBtn = mk('button', 'menu-act', 'menu-pause-missions');
    pauseBtn.type = 'button';
    pauseBtn.append('Mission select', mk('span', 'menu-act-chev'));
    pauseBtn.addEventListener('click', open);
    restart.after(pauseBtn);
    // capture on the target runs before the menu's own listener
    restart.addEventListener('click', (e) => {
      if (!combat.active) return;
      e.stopImmediatePropagation();
      ctx.menu?.close?.();
      combat.restart();
    }, true);
  }
  const labelNode = restart && [...restart.childNodes].find(n => n.nodeType === 3);
  function syncPause() {
    if (labelNode) labelNode.data = combat.active ? 'Restart mission' : 'Restart flight';
  }
  ctx.events.on('menu:open', syncPause);

  // controls reference: one more key group, built with the menu's classes
  const keys = doc.querySelector('#menu-root .menu-keys');
  if (keys && !keys.querySelector('[data-cbt]')) {
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

  // mission running flag on <html>
  let active = null;
  return {
    update() {
      const a = !!combat.active;
      if (a !== active) { active = a; doc.documentElement.classList.toggle('cbt-active', a); }
    },
    syncPause,
  };
}
