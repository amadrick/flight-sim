// COMBAT SCREENS — mission select + briefing, combat settings, debrief. DOM, built inside createCombatUi only.
// API (COMBAT.md §12): createCombatUi(combat) -> { update(dt), openMissions(), isOpen }
//   additive (README.md): openMissions(missionId?), debrief(), close(), view (getter), progress (store), settings
// Look: the menu's own design system (root also carries .menu-root; panels, rows, chips, segments, switches and buttons
// are the menu's classes on the shared glass material); layout and combat-only pieces in style.js (.cbt-ui-*).
// While a screen is up: isOpen = true, the simulator is paused (ctx.time.paused + 'pause' event, as the menu does),
// the camera shows the aircraft in 'showcase' (which also hides the simulator HUD and the touch controls), and every key
// is captured at window level so neither the simulator's input nor the menu sees it. Leaving always unpauses or hands
// the pause to the menu. The debrief opens over the frozen world a few seconds after 'mission:end'.
import { AIRCRAFT, getAircraft } from '../../aircraft/registry.js';
import { AIRPORTS } from '../../data/airports.js';
import { WEATHER_PRESETS } from '../../core/weather.js';
import { ICON } from '../../ui/menu/icons.js';
import { CSS } from './style.js';
import { drawMap } from './map.js';
import { createProgressStore } from './progress.js';
import {
  DIFFICULTY, groupMissions, nextMission, conditionsLine, outcomeCopy, debriefDelay, statRows, breakdownRows,
  group3, fmtTime, CUSTOM_DEFAULT, ADVANTAGES, RANGE_STEPS, ALT_STEPS, cleanCustom, nearestStep, fmtFt, fmtNm, isNum,
} from './logic.js';

const DIFF_IDS = DIFFICULTY.map(d => d.id);
const WX_LABEL = Object.fromEntries(Object.entries(WEATHER_PRESETS).map(([k, p]) => [k, p.label || k]));
const svg = (inner, fill) => `<svg viewBox="0 0 24 24" aria-hidden="true" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'}>${inner}</svg>`;
const IC = {
  check: svg('<path d="M5 12.5l4.2 4.2L19 7"/>'),
  medal: svg('<path d="M12 3.2l2.5 5.3 5.8.7-4.3 4 1.1 5.7L12 16.1 6.9 18.9 8 13.2 3.7 9.2l5.8-.7z"/>', true),
  sound: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11"/>'),
};

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function reveal(el) {
  const box = el?.closest?.('.menu-scroll'); if (!box || !el.offsetParent) return;
  const b = box.getBoundingClientRect(), r = el.getBoundingClientRect();
  if (r.top < b.top + 8) box.scrollTop -= b.top - r.top + 8;
  else if (r.bottom > b.bottom - 24) box.scrollTop += r.bottom - b.bottom + 24;
}
const focus = (el) => { try { el?.focus({ preventScroll: true }); reveal(el); } catch {} };
const acName = (id) => { const d = getAircraft(id); return d && d.id === id ? d.name : String(id || '').toUpperCase(); };
const acShort = (id) => { const n = acName(id); return n.split(' ')[0]; };

export async function createCombatUi(combat) {
  const ctx = combat.ctx, ev = ctx.events, raw = ctx.params?.raw || {};
  const store = createProgressStore();

  // ---- settings (remembered) --------------------------------------------------------------------------
  if (!DIFF_IDS.includes(raw.difficulty)) { const d = store.getSetting('difficulty'); if (DIFF_IDS.includes(d)) combat.difficulty = d; }
  const settings = {
    musicOn: store.getSetting('musicOn', true) !== false,
    musicVolume: clamp(Number(store.getSetting('musicVolume', 0.7)) || 0, 0, 1),
    radioVoice: store.getSetting('radioVoice', true) !== false,
  };
  function applyAudio() {
    const a = combat.audio; if (!a) return;
    try {
      if ('musicEnabled' in a || typeof a.setMusicEnabled !== 'function') a.musicEnabled = settings.musicOn;
      a.setMusicEnabled?.(settings.musicOn);
      a.setMusicVolume?.(settings.musicOn ? settings.musicVolume : 0);
      a.setRadioVoice?.(settings.radioVoice);
    } catch (e) { console.warn('[combat ui] audio settings', e); }
  }
  applyAudio();
  let custom = cleanCustom({ ...CUSTOM_DEFAULT, ...(store.getSetting('custom') || {}) });
  const acChoice = { ...(store.getSetting('aircraft') || {}) };

  // ---- state --------------------------------------------------------------------------------------------
  let view = null;              // 'missions' | 'settings' | 'debrief'
  let settingsFrom = 'missions';
  let detail = false;           // narrow layouts: briefing shown instead of the list
  let origin = 'main';          // where Back from the mission list goes: 'main' | 'pause' | 'flight' | 'debrief'
  let selId = null;
  let flightCam = 'chase';
  let pending = null, pendingT = 0;
  let last = null;              // { id, options, result, record } of the last decided mission
  let score = null;             // count-up { el, to, t, dur }
  let groups = [];
  const downOpen = new Set();

  const ui = {
    isOpen: false,
    update, openMissions, debrief: () => showDebrief(), close: () => { if (ui.isOpen) leaveTo(view === 'debrief' ? 'flight' : origin); },
    get view() { return ui.isOpen ? view : null; },
    get progress() { return store; },
    settings,
  };

  // ---- DOM ------------------------------------------------------------------------------------------------
  const style = h('style', { id: 'cbt-ui-style' }); style.textContent = CSS + EXTRA_CSS;
  document.head.appendChild(style);
  const root = h('div', { class: 'menu-root cbt-ui-root', id: 'cbt-ui-root', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Combat missions' });
  root.hidden = true;

  const backBtn = h('button', { class: 'menu-back', id: 'cbt-ui-back', type: 'button', 'aria-label': 'Back', onclick: () => back() });
  const capTitle = h('span', { class: 'cbt-ui-captitle', text: 'Missions' });
  const capSub = h('span', { class: 'cbt-ui-capsub' });
  const setBtn = h('button', { class: 'cbt-ui-iconcap glass-clear glass-lens', id: 'cbt-ui-settings-btn', type: 'button', 'aria-label': 'Combat sound settings', 'aria-pressed': 'false', onclick: () => toggleSettings() },
    h('span', { html: IC.sound, style: 'display:contents' }), h('span', { text: 'Sound' }));
  const top = h('header', { class: 'cbt-ui-top' }, h('div', { class: 'cbt-ui-cap glass-clear' }, backBtn, capTitle, capSub), setBtn);

  // mission list
  const listEl = h('div', { class: 'menu-list', role: 'listbox', 'aria-label': 'Missions', 'data-nav': 'v' });
  const listPanel = h('section', { class: 'menu-panel glass cbt-ui-list', 'aria-label': 'Mission list' }, h('div', { class: 'menu-scroll' }, listEl));
  // briefing
  const briefBody = h('div', { class: 'cbt-ui-bbody' });
  const briefScroll = h('div', { class: 'menu-scroll' }, briefBody);
  const flyLine = h('b');
  const flyBtn = h('button', { class: 'menu-fly glass-tint', id: 'cbt-ui-fly', type: 'button', onclick: () => fly() }, 'Fly mission', h('span', { class: 'menu-fly-arrow', 'aria-hidden': 'true' }));
  const briefFoot = h('div', { class: 'cbt-ui-bfoot' }, h('div', { class: 'cbt-ui-flyline' }, h('span', { text: 'Sortie' }), flyLine), flyBtn);
  const briefPanel = h('section', { class: 'menu-panel glass cbt-ui-brief', 'aria-label': 'Briefing' }, briefScroll, briefFoot);
  const vMissions = h('section', { class: 'cbt-ui-view cbt-ui-missions' }, listPanel, briefPanel);
  // settings
  const sw = (id, label, on, fn) => h('button', { class: 'menu-switch', id, type: 'button', role: 'switch', 'aria-label': label, 'aria-pressed': String(on), 'aria-checked': String(on), onclick: fn });
  const field = (t, d, ctl) => h('div', { class: 'menu-field' }, h('div', { class: 'menu-field-l' }, h('span', { class: 'menu-field-t', text: t }), d ? h('span', { class: 'menu-field-d', text: d }) : null), ctl);
  const musicSw = sw('cbt-ui-music', 'Music', settings.musicOn, () => { settings.musicOn = !settings.musicOn; store.setSetting('musicOn', settings.musicOn); applyAudio(); syncSettings(); });
  const radioSw = sw('cbt-ui-radio', 'Radio voice', settings.radioVoice, () => { settings.radioVoice = !settings.radioVoice; store.setSetting('radioVoice', settings.radioVoice); applyAudio(); syncSettings(); });
  const volRange = h('input', { class: 'menu-range menu-range-plain', type: 'range', id: 'cbt-ui-musicvol', min: '0', max: '100', step: '1', 'aria-label': 'Music volume' });
  const volRead = h('span', { class: 'menu-vol-read' });
  volRange.addEventListener('input', () => { settings.musicVolume = +volRange.value / 100; applyAudio(); syncSettings(); });
  volRange.addEventListener('change', () => store.setSetting('musicVolume', settings.musicVolume));
  const setPanel = h('div', { class: 'menu-panel glass', role: 'region', 'aria-label': 'Combat sound' },
    h('div', { class: 'menu-subhead' }, h('span', { class: 'menu-subtitle', text: 'Combat sound' })),
    h('div', { class: 'menu-scroll' },
      h('div', { class: 'menu-sec' }, h('div', { class: 'menu-h' }, h('span', { text: 'Music' })),
        h('div', { class: 'menu-group' }, field('Music', 'Score under the fight, louder when it heats up', musicSw),
          h('div', { class: 'menu-field cbt-ui-volfield' }, h('div', { class: 'menu-vol', style: 'flex:1' }, volRange, volRead)))),
      h('div', { class: 'menu-sec' }, h('div', { class: 'menu-h' }, h('span', { text: 'Radio' })),
        h('div', { class: 'menu-group' }, field('Radio voice', 'Spoken calls from flight, controller and bandits. Subtitles always show.', radioSw))),
      h('p', { class: 'menu-note', style: 'margin:0 12px 10px', text: 'Master volume is in the main Settings.' })));
  const vSettings = h('section', { class: 'cbt-ui-view cbt-ui-dock' }, setPanel);
  // debrief
  const debPanel = h('section', { class: 'menu-panel glass cbt-ui-debp', role: 'region', 'aria-label': 'Debrief' });
  const vDebrief = h('section', { class: 'cbt-ui-view cbt-ui-deb' }, debPanel);

  const views = { missions: vMissions, settings: vSettings, debrief: vDebrief };
  root.append(top, h('div', { class: 'cbt-ui-body' }, vMissions, vSettings, vDebrief));
  for (const v of Object.values(views)) v.hidden = true;
  ctx.uiRoot.appendChild(root);
  root.addEventListener('scroll', () => { root.scrollTop = 0; root.scrollLeft = 0; });
  root.addEventListener('pointerdown', () => { try { ctx.audio?.resume?.(); } catch {} });

  // ---- mission list ----------------------------------------------------------------------------------------
  const allMissions = () => groups.flatMap(g => g.missions);
  const selected = () => allMissions().find(m => m.id === selId) || null;
  function buildList() {
    groups = groupMissions(combat.director?.missions);
    listEl.textContent = '';
    if (!groups.length) {
      listEl.removeAttribute('role');
      listEl.append(h('div', { class: 'cbt-ui-empty' }, h('b', { text: 'No missions available' }), 'This build has no combat missions. Free flight is still in the hangar.'));
      return;
    }
    listEl.setAttribute('role', 'listbox');
    for (const g of groups) {
      listEl.append(h('div', { class: 'menu-grouplabel', role: 'presentation' }, g.label, h('span', { class: 'menu-count', text: String(g.missions.length) })));
      g.missions.forEach((m, i) => {
        const best = store.best(m.id), done = store.completed(m.id);
        const tag = h('span', { class: 'cbt-ui-mtag' });
        if (best?.rating) tag.append(h('span', { class: 'cbt-ui-rate', 'data-r': best.rating, title: `Best rating ${best.rating}`, text: best.rating }));
        if (m.threat) tag.append(pips(m.threat));
        const row = h('button', {
          class: 'menu-row cbt-ui-mrow' + (done ? ' done' : ''), type: 'button', role: 'option', id: 'cbt-ui-m-' + m.id, 'data-item': '1', 'data-mission': m.id,
          'aria-selected': 'false', tabindex: '-1', onclick: (e) => selectMission(m.id, e.detail === 0 ? 'key' : 'pointer'),
        },
        h('span', { class: 'cbt-ui-mno', 'aria-label': done ? 'Completed' : null, html: done ? IC.check : String(i + 1).padStart(2, '0') }),
        h('span', { class: 'menu-row-main' }, h('span', { class: 'menu-row-name', text: m.title }), h('span', { class: 'menu-row-sub', text: m.tagline || '' })),
        tag);
        listEl.append(row);
      });
    }
  }
  function pips(n) {
    const el = h('span', { class: 'cbt-ui-pips', role: 'img', 'aria-label': `Threat ${n} of 5`, title: `Threat ${n} / 5` });
    for (let i = 1; i <= 5; i++) el.append(h('i', { class: i <= n ? 'on' : null }));
    return el;
  }
  function syncList() {
    for (const r of listEl.querySelectorAll('[data-mission]')) {
      const on = r.dataset.mission === selId;
      r.setAttribute('aria-selected', String(on)); r.tabIndex = on ? 0 : -1;
    }
    const ids = allMissions().map(m => m.id), c = store.counts(ids);
    capSub.textContent = ids.length ? `${c.done} / ${c.total} complete` : '';
  }
  function selectMission(id, how) {
    selId = id;
    syncList(); renderBrief();
    if (narrow() && how) { detail = true; syncDetail(); briefScroll.scrollTop = 0; requestAnimationFrame(() => focus(flyBtn)); redrawMap(); }
    else if (how === 'key') focus(flyBtn);
    store.setSetting('lastMission', id);
  }
  const narrow = () => window.innerWidth <= 720;
  function syncDetail() { root.classList.toggle('cbt-ui-detail', detail); }

  // ---- briefing ------------------------------------------------------------------------------------------------
  let mapCanvas = null;
  function sec(title, ...kids) { return h('div', { class: 'menu-sec' }, h('div', { class: 'menu-h' }, h('span', { text: title })), ...kids); }
  function radios(label, items, cur, onPick, cls = 'cbt-ui-chips') {
    const g = h('div', { class: cls, role: 'radiogroup', 'aria-label': label, 'data-nav': 'h' });
    for (const it of items) {
      const on = it.id === cur;
      g.append(h('button', { class: cls === 'menu-seg' ? 'menu-segbtn' : 'menu-chip', type: 'button', role: 'radio', 'data-item': '1', 'data-id': it.id, 'aria-checked': String(on), tabindex: on ? '0' : '-1', title: it.title || null, onclick: () => onPick(it.id) },
        it.label, it.small ? h('small', { text: it.small }) : null));
    }
    if (!items.some(i => i.id === cur) && g.firstChild) g.firstChild.tabIndex = 0;
    return g;
  }
  function setRadio(g, id) {
    for (const b of g.querySelectorAll('[data-item]')) { const on = b.dataset.id === id; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; }
  }
  function aircraftFor(m) { const a = acChoice[m.id]; return m.aircraftChoices.includes(a) ? a : (m.aircraft || m.aircraftChoices[0] || null); }
  function stepper(label, value, fmt, onStep, canDown, canUp) {
    const out = h('output', { text: fmt(value), 'aria-live': 'polite' });
    const dn = h('button', { type: 'button', 'aria-label': `Fewer: ${label}`, text: '−', disabled: !canDown, onclick: () => onStep(-1) });
    const up = h('button', { type: 'button', 'aria-label': `More: ${label}`, text: '+', disabled: !canUp, onclick: () => onStep(1) });
    return h('div', { class: 'cbt-ui-step', role: 'group', 'aria-label': label }, dn, out, up);
  }
  function customForm() {
    const wrap = h('div', { class: 'cbt-ui-form' });
    const rebuild = (focusSel) => {
      const keep = focusSel || (document.activeElement && wrap.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : null);
      store.setSetting('custom', custom);
      wrap.replaceWith(customForm());
      syncFlyLine();
      if (keep) { const n = briefBody.querySelector(`.cbt-ui-form [aria-label="${CSS_ESC(keep)}"]`); if (n && !n.disabled) focus(n); }
    };
    const c = custom;
    const fighters = AIRCRAFT.filter(a => a.category === 'fighter' || a.category === 'attack');
    const ri = nearestStep(RANGE_STEPS, c.startRange), ai = nearestStep(ALT_STEPS, c.altitude);
    wrap.append(h('div', { class: 'menu-group' },
      field('Bandits', null, stepper('Bandits', c.enemies, String, (d) => { c.enemies = clamp(c.enemies + d, 1, 8); rebuild(); }, c.enemies > 1, c.enemies < 8)),
      field('Wingmen', null, stepper('Wingmen', c.wingmen, String, (d) => { c.wingmen = clamp(c.wingmen + d, 0, 3); rebuild(); }, c.wingmen > 0, c.wingmen < 3)),
      field('Start range', null, stepper('Start range', RANGE_STEPS[ri], fmtNm, (d) => { c.startRange = RANGE_STEPS[clamp(ri + d, 0, RANGE_STEPS.length - 1)]; rebuild(); }, ri > 0, ri < RANGE_STEPS.length - 1)),
      field('Altitude', null, stepper('Altitude', ALT_STEPS[ai], fmtFt, (d) => { c.altitude = ALT_STEPS[clamp(ai + d, 0, ALT_STEPS.length - 1)]; rebuild(); }, ai > 0, ai < ALT_STEPS.length - 1)),
      field('Guns only', 'No missiles on either side', h('button', { class: 'menu-switch', type: 'button', role: 'switch', 'aria-label': 'Guns only', 'aria-pressed': String(c.gunsOnly), 'aria-checked': String(c.gunsOnly), onclick: () => { c.gunsOnly = !c.gunsOnly; rebuild('Guns only'); } }))));
    const adv = ADVANTAGES.find(a => a.id === c.advantage) || ADVANTAGES[0];
    const advNote = h('p', { class: 'menu-note', text: adv.note });
    wrap.append(h('div', { class: 'menu-h', style: 'margin-top:14px' }, h('span', { text: 'Start position' })),
      radios('Start position', ADVANTAGES, c.advantage, (id) => { c.advantage = id; rebuild(); }, 'menu-seg'), advNote,
      h('div', { class: 'menu-h', style: 'margin-top:12px' }, h('span', { text: 'Bandit type' })),
      radios('Bandit type', [{ id: 'mixed', label: 'Mixed' }, ...fighters.map(a => ({ id: a.id, label: acShort(a.id), title: a.name }))], c.enemyType, (id) => { c.enemyType = id; rebuild(); }));
    return wrap;
  }
  function renderBrief() {
    briefBody.textContent = ''; mapCanvas = null;
    const m = selected();
    flyBtn.disabled = !m; briefFoot.hidden = !m;
    if (!m) {
      briefBody.append(h('div', { class: 'cbt-ui-empty' }, h('b', { text: groups.length ? 'Choose a mission' : 'Nothing to brief' }), groups.length ? 'Pick a sortie from the list to read its briefing.' : 'Missions appear here when the build includes them.'));
      return;
    }
    const g = groups.find(x => x.id === m.category);
    const no = g ? g.missions.indexOf(m) + 1 : 0;
    const best = store.best(m.id), done = store.completed(m.id);
    const kicker = h('div', { class: 'cbt-ui-kicker' }, h('span', { text: g?.label || m.category }), no ? h('span', { text: `· ${String(no).padStart(2, '0')}` }) : null,
      done ? h('span', { class: 'cbt-ui-done', text: '· Completed' }) : null);
    const facts = h('div', { class: 'cbt-ui-facts' },
      m.threat ? h('div', { class: 'cbt-ui-fact' }, h('div', { class: 'cbt-ui-fact-k', text: 'Threat' }), h('div', { class: 'cbt-ui-fact-v' }, pips(m.threat))) : null,
      m.minutes ? h('div', { class: 'cbt-ui-fact' }, h('div', { class: 'cbt-ui-fact-k', text: 'Length' }), h('div', { class: 'cbt-ui-fact-v' }, `≈ ${Math.round(m.minutes)}`, h('small', { text: 'min' }))) : null,
      h('div', { class: 'cbt-ui-fact' }, h('div', { class: 'cbt-ui-fact-k', text: 'Best' }), h('div', { class: 'cbt-ui-fact-v' },
        best?.rating ? h('span', { class: 'cbt-ui-rate', 'data-r': best.rating, text: best.rating }) : null,
        best ? group3(best.score || 0) : '–')));
    facts.style.gridTemplateColumns = `repeat(${facts.childElementCount}, minmax(92px, 150px))`;
    const cond = conditionsLine(m, AIRPORTS, WX_LABEL);
    mapCanvas = h('canvas', { class: 'cbt-ui-map', role: 'img', 'aria-label': 'Tactical map of the mission area' });
    briefBody.append(
      h('div', { class: 'cbt-ui-bhead' }, kicker, h('h2', { class: 'cbt-ui-btitle', id: 'cbt-ui-btitle', text: m.title }), m.tagline ? h('p', { class: 'cbt-ui-tagline', text: m.tagline }) : null,
        facts, cond ? h('div', { class: 'cbt-ui-cond', text: cond }) : null, mapCanvas));
    if (m.brief.length) briefBody.append(sec('Brief', ...m.brief.map(p => h('p', { class: 'cbt-ui-p', text: p }))));
    if (m.objectives.length) briefBody.append(sec('Objectives', h('ul', { class: 'cbt-ui-obj' }, m.objectives.map(o => h('li', { text: o })))));
    if (m.custom) briefBody.append(sec('Setup', customForm()));
    // aircraft
    const ac = aircraftFor(m);
    if (m.aircraftChoices.length > 1) {
      const grp = radios('Aircraft', m.aircraftChoices.map(id => ({ id, label: acName(id) })), ac, (id) => {
        acChoice[m.id] = id; store.setSetting('aircraft', acChoice); setRadio(grp, id); syncFlyLine();
      });
      briefBody.append(sec('Aircraft', grp));
    } else if (ac) briefBody.append(sec('Aircraft', h('div', { class: 'cbt-ui-fixed' }, acName(ac), h('small', { text: 'assigned' }))));
    // difficulty
    const dNote = h('p', { class: 'menu-note' });
    const dGrp = radios('Difficulty', DIFFICULTY, combat.difficulty, (id) => {
      combat.difficulty = id; store.setSetting('difficulty', id); setRadio(dGrp, id); dNote.textContent = DIFFICULTY.find(d => d.id === id)?.note || ''; syncFlyLine();
    }, 'menu-seg');
    dNote.textContent = DIFFICULTY.find(d => d.id === combat.difficulty)?.note || '';
    briefBody.append(sec('Difficulty', dGrp, dNote));
    syncFlyLine();
    redrawMap();
  }
  function syncFlyLine() {
    const m = selected(); if (!m) { flyLine.textContent = ''; return; }
    const parts = [];
    const ac = aircraftFor(m); if (ac) parts.push(acShort(ac));
    parts.push(DIFFICULTY.find(d => d.id === combat.difficulty)?.label || combat.difficulty);
    if (m.custom) parts.push(`${custom.enemies} v ${custom.wingmen + 1}`);
    flyLine.textContent = parts.join('  ·  ');
  }
  function redrawMap() {
    const m = selected();
    if (!mapCanvas || !m) return;
    try { drawMap(mapCanvas, m.def, ctx, m.id); } catch (e) { mapCanvas.hidden = true; console.warn('[combat ui] map', e); }
  }

  // ---- settings view -------------------------------------------------------------------------------------------
  function syncSettings() {
    for (const [b, on] of [[musicSw, settings.musicOn], [radioSw, settings.radioVoice]]) { b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-checked', String(on)); }
    const v = Math.round(settings.musicVolume * 100);
    if (document.activeElement !== volRange) volRange.value = String(v);
    volRange.style.setProperty('--v', v + '%'); volRead.textContent = v + '%';
    volRange.disabled = !settings.musicOn;
    volRange.closest('.menu-field').style.opacity = settings.musicOn ? '' : '0.45';
  }
  function toggleSettings() {
    if (view === 'settings') { show(settingsFrom); focusView(); return; }
    settingsFrom = view === 'debrief' ? 'debrief' : 'missions';
    show('settings'); syncSettings(); focus(musicSw);
  }

  // ---- debrief -------------------------------------------------------------------------------------------------
  function showDebrief() {
    const r = pending || last?.result || combat.result;
    pending = null;
    if (!r) return false;
    renderDebrief(r);
    if (!ui.isOpen) origin = 'flight';
    enter('debrief');
    return true;
  }
  function renderDebrief(r) {
    debPanel.textContent = '';
    const oc = outcomeCopy(r), s = r.stats || {};
    const mid = last?.id || combat.mission?.id;
    const mdef = allMissions().find(m => m.id === mid) || (groups.length ? null : null);
    const title = mdef?.title || combat.director?.getMission?.(mid)?.title || '';
    debPanel.classList.toggle('fail', !oc.ok);
    const rating = typeof s.rating === 'string' ? s.rating : null;
    const head = h('div', { class: 'cbt-ui-dhead' },
      h('div', null, title ? h('div', { class: 'cbt-ui-dmission', text: title }) : null,
        h('div', { class: 'cbt-ui-outcome', id: 'cbt-ui-outcome', text: oc.title }), h('div', { class: 'cbt-ui-reason', text: oc.reason })),
      rating ? h('div', { class: 'cbt-ui-badge', 'data-r': rating, role: 'img', 'aria-label': `Rating ${rating}` }, h('small', { text: 'RATING' }), rating) : null);
    const scoreV = h('span', { class: 'cbt-ui-score-v', text: '0' });
    const scoreRow = isNum(s.score) ? h('div', { class: 'cbt-ui-score' }, h('span', { class: 'cbt-ui-score-k', text: 'Score' }), scoreV,
      last?.record?.newBest && oc.ok ? h('span', { class: 'cbt-ui-new', text: 'New best' }) : null,
      DIFFICULTY.find(d => d.id === (last?.options?.difficulty || combat.difficulty)) ? h('span', { class: 'menu-h-aside', style: 'margin-left:auto', text: DIFFICULTY.find(d => d.id === (last?.options?.difficulty || combat.difficulty)).label }) : null) : null;
    const brk = breakdownRows(s);
    const brkEl = brk.length ? h('div', { class: 'menu-sec' }, h('div', { class: 'menu-h' }, h('span', { text: 'Score breakdown' })),
      h('div', { class: 'menu-group cbt-ui-brk' }, brk.map(b => h('div', { class: 'cbt-ui-brk-row' }, h('span', { text: b.label }), h('b', { class: b.points < 0 ? 'neg' : null, text: (b.points > 0 ? '+' : '') + group3(b.points) }))),
        isNum(s.score) ? h('div', { class: 'cbt-ui-brk-row total' }, h('span', { text: 'Total' }), h('b', { text: group3(s.score) })) : null)) : null;
    const rows = statRows(s, r.time);
    const statsEl = rows.length ? h('div', { class: 'menu-sec' }, h('div', { class: 'menu-h' }, h('span', { text: 'Flight' })),
      h('div', { class: 'cbt-ui-stats' }, rows.map(x => h('div', { class: 'cbt-ui-stat' }, h('div', { class: 'cbt-ui-stat-k', text: x.k }), h('div', { class: 'cbt-ui-stat-v' }, x.v, x.u ? h('small', { text: x.u }) : null))))) : null;
    const medals = Array.isArray(s.medals) ? s.medals.filter(Boolean) : [];
    const medalsEl = medals.length ? h('div', { class: 'menu-sec' }, h('div', { class: 'menu-h' }, h('span', { text: 'Awards' })),
      h('div', { class: 'cbt-ui-medals' }, medals.map(md => h('div', { class: 'cbt-ui-medal' }, h('i', { html: IC.medal }), h('div', null, h('b', { text: md.title || md.id || 'Award' }), md.text ? h('span', { text: md.text }) : null))))) : null;
    const scroll = h('div', { class: 'menu-scroll' }, scoreRow,
      brkEl && statsEl ? h('div', { class: 'cbt-ui-dgrid' }, brkEl, statsEl) : (brkEl || statsEl), medalsEl);
    // actions
    const nxt = oc.ok && mid ? nextMission(combat.director?.missions, mid) : null;
    const acts = [];
    const btn = (id, label, sub, fn, primary) => h('button', { class: 'menu-btn' + (primary ? ' glass-tint' : ''), id, type: 'button', onclick: fn }, label, sub ? h('small', { text: sub }) : null);
    if (nxt) acts.push(btn('cbt-ui-next', 'Next mission', nxt.title, () => openMissions(nxt.id), true));
    acts.push(btn('cbt-ui-retry', 'Retry', oc.ok ? 'Fly it again' : 'Same setup', () => retry(), !nxt));
    acts.push(btn('cbt-ui-select', 'Mission select', null, () => openMissions(mid)));
    acts.push(btn('cbt-ui-hangar', 'Hangar', null, () => leaveTo('main')));
    const actsEl = h('div', { class: 'cbt-ui-dacts' }, acts);
    if (acts.length === 3) actsEl.style.gridTemplateColumns = '1.4fr 1fr 1fr';
    debPanel.append(head, scroll, actsEl);
    score = isNum(s.score) ? { el: scoreV, to: s.score, t: 0, dur: reducedMotion() ? 0 : 1.1 } : null;
    if (score && score.dur === 0) { scoreV.textContent = group3(score.to); score = null; }
  }
  const reducedMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

  // ---- actions ------------------------------------------------------------------------------------------------
  function setPaused(p) { if (!!ctx.time.paused !== p) { ctx.time.paused = p; ev.emit('pause', p); } }
  function restoreCam() { ctx.cameraRig?.setMode?.(flightCam && flightCam !== 'showcase' && flightCam !== 'orbit' ? flightCam : 'chase'); }
  function enter(v) {
    if (!ui.isOpen) {
      const cm = ctx.cameraRig?.mode;
      if (cm && cm !== 'showcase' && cm !== 'orbit') flightCam = cm;
      combat.input?.release?.();
    }
    ui.isOpen = true; root.hidden = false;
    document.documentElement.classList.add('cbt-ui-open');
    if (ctx.menu?.isOpen) ctx.menu.close();
    setPaused(true);
    if (ctx.cameraRig && ctx.cameraRig.mode !== 'showcase') ctx.cameraRig.setMode?.('showcase');
    show(v);
    focusView();
  }
  function show(v) {
    const prev = view; view = v;
    for (const [k, el] of Object.entries(views)) el.hidden = k !== v;
    root.classList.toggle('cbt-ui-nohead', v === 'debrief');
    setBtn.setAttribute('aria-pressed', String(v === 'settings'));
    capTitle.textContent = v === 'settings' ? 'Combat' : 'Missions';
    if (prev !== v) { root.classList.remove('cbt-ui-anim'); void root.offsetWidth; root.classList.add('cbt-ui-anim'); }
    if (v === 'missions') { syncDetail(); redrawMap(); }
  }
  function focusView() {
    let el = null;
    if (view === 'missions') el = (narrow() && detail) ? flyBtn : listEl.querySelector('[tabindex="0"]') || flyBtn;
    else if (view === 'settings') el = musicSw;
    else if (view === 'debrief') el = debPanel.querySelector('.cbt-ui-dacts .glass-tint') || debPanel.querySelector('.cbt-ui-dacts button');
    if (el && !el.disabled) focus(el);
  }
  function hide() {
    ui.isOpen = false; root.hidden = true; view = null;
    document.documentElement.classList.remove('cbt-ui-open');
    try { if (root.contains(document.activeElement)) document.activeElement.blur(); } catch {}
    downOpen.clear();
  }
  /** Leave the screens: 'flight' resumes, 'main' / 'pause' hand over to the menu, 'debrief' goes back to the result. */
  function leaveTo(dest) {
    if (dest === 'debrief' && (last?.result || combat.result)) { renderDebrief(last?.result || combat.result); show('debrief'); focusView(); return; }
    hide();
    if ((dest === 'main' || dest === 'pause') && ctx.menu?.open) { ctx.menu.open(dest); return; }
    setPaused(false); restoreCam();
  }
  function back() {
    if (view === 'settings') { show(settingsFrom); focusView(); return; }
    if (view === 'missions') {
      if (narrow() && detail) { detail = false; syncDetail(); focus(listEl.querySelector('[tabindex="0"]')); return; }
      leaveTo(origin); return;
    }
    // debrief: Esc does nothing (choose an action)
  }
  function openMissions(id) {
    let o;
    if (ui.isOpen) o = view === 'debrief' ? 'debrief' : origin;
    else if (ctx.menu?.isOpen) o = ctx.menu.view === 'pause' ? 'pause' : 'main';
    else o = ctx.session?.active && !combat.result ? 'flight' : (combat.result ? 'flight' : 'main');
    origin = o;
    buildList();
    const ids = allMissions().map(m => m.id);
    const want = typeof id === 'string' && ids.includes(id) ? id : null;
    const lastId = store.getSetting('lastMission');
    selId = want || (ids.includes(selId) ? selId : null) || (ids.includes(lastId) ? lastId : null) || ids.find(x => !store.completed(x)) || ids[0] || null;
    detail = !!want;
    syncList(); renderBrief();
    enter('missions');
    if (want) { const row = listEl.querySelector(`[data-mission="${CSS_ESC(want)}"]`); reveal(row); if (!narrow()) focus(row); }
    else reveal(listEl.querySelector('[aria-selected="true"]'));
    return true;
  }
  function launch(id, options) {
    hide();
    setPaused(false);
    pending = null;
    let ok = false;
    try { ok = combat.start(id, options); } catch (e) { console.error('[combat ui] start failed', e); }
    if (!ok) { openMissions(id); return false; }
    restoreCam();
    try { ctx.audio?.resume?.(); } catch {}
    applyAudio();
    return true;
  }
  function fly() {
    const m = selected(); if (!m) return;
    const options = { aircraft: aircraftFor(m) || undefined, difficulty: combat.difficulty };
    if (m.custom) options.custom = cleanCustom(custom);
    store.setSetting('lastMission', m.id);
    launch(m.id, options);
  }
  function retry() {
    const id = last?.id || combat.mission?.id; if (!id) { openMissions(); return; }
    const o = { ...(last?.options || combat.options || {}) }; delete o.mission;
    launch(id, o);
  }

  // ---- keyboard: every key goes to the screens while they are up -----------------------------------------------
  window.addEventListener('keydown', (e) => {
    if (!ui.isOpen) return;
    e.stopPropagation(); downOpen.add(e.code);
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target instanceof Element ? e.target : null;
    if (e.key === 'Escape') { e.preventDefault(); if (!e.repeat) back(); return; }
    if (t && t.tagName === 'INPUT') return;                         // range: default arrow behaviour
    const grp = t?.closest?.('[data-nav]');
    if (grp && root.contains(grp) && t.matches('[data-item]') && /^(Arrow(Up|Down|Left|Right)|Home|End)$/.test(e.key)) {
      const vert = grp.dataset.nav === 'v';
      if (vert && /Left|Right/.test(e.key)) return;
      const items = [...grp.querySelectorAll('[data-item]')].filter(x => !x.hidden && !x.disabled);
      let i = items.indexOf(t);
      if (e.key === 'Home') i = 0; else if (e.key === 'End') i = items.length - 1;
      else i = clamp(i + (/Down|Right/.test(e.key) ? 1 : -1), 0, items.length - 1);
      const n = items[i];
      e.preventDefault();
      if (n && n !== t) {
        if (vert) { selId = n.dataset.mission; syncList(); renderBrief(); }
        else n.click();
        const label = grp.getAttribute('aria-label');
        focus(grp.isConnected ? n : briefBody.querySelector(`[aria-label="${CSS_ESC(label)}"] [data-id="${CSS_ESC(n.dataset.id)}"]`));
      }
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && !t?.closest?.('button, input, a')) {
      // nothing focused: Enter flies the selected mission / takes the debrief's primary action
      if (e.key === 'Enter' && !e.repeat) { e.preventDefault(); if (view === 'missions' && !flyBtn.disabled) fly(); else if (view === 'debrief') debPanel.querySelector('.cbt-ui-dacts .glass-tint')?.click(); }
    }
  }, true);
  window.addEventListener('keyup', (e) => { if (ui.isOpen || downOpen.has(e.code)) { if (downOpen.delete(e.code) || ui.isOpen) e.stopPropagation(); } }, true);
  window.addEventListener('resize', () => { if (ui.isOpen && view === 'missions') { if (!narrow()) detail = false; syncDetail(); redrawMap(); } });

  // ---- gamepad navigation while a screen is up (src/input stands down: combat.input.padOwns) ------------------------
  const pad = { prev: [], rep: null, repT: 0 };
  const tabbable = () => [...root.querySelectorAll('button, input, [tabindex="0"]')].filter(el => !el.disabled && el.tabIndex >= 0 && el.offsetParent && !el.closest('[hidden]'));
  function moveFocus(dir) {
    const t = document.activeElement, inRoot = t && root.contains(t);
    if (inRoot && t.matches('[data-item]') && t.closest('[data-nav]')) {
      const vert = t.closest('[data-nav]').dataset.nav === 'v';
      const along = vert ? (dir === 'up' || dir === 'down') : (dir === 'left' || dir === 'right');
      if (along) {
        const items = [...t.closest('[data-nav]').querySelectorAll('[data-item]')].filter(x => !x.hidden);
        const i = items.indexOf(t), n = items[i + (dir === 'down' || dir === 'right' ? 1 : -1)];
        if (n || !vert) { t.dispatchEvent(new KeyboardEvent('keydown', { key: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }[dir], bubbles: true })); return; }
      }
      if (vert && (dir === 'right')) { focus(flyBtn); return; }
    }
    if (inRoot && t.type === 'range' && (dir === 'left' || dir === 'right')) {
      t.value = String(+t.value + (dir === 'left' ? -5 : 5)); t.dispatchEvent(new Event('input', { bubbles: true })); t.dispatchEvent(new Event('change', { bubbles: true })); return;
    }
    const list = tabbable(); if (!list.length) return;
    let i = inRoot ? list.indexOf(t) : -1;
    i = clamp(i + (dir === 'down' || dir === 'right' ? 1 : -1), 0, list.length - 1);
    focus(list[i]);
  }
  function pollPad(rdt) {
    let gp = null;
    try { for (const g of navigator.getGamepads?.() || []) if (g && g.connected && g.mapping === 'standard') { gp = g; break; } } catch {}
    if (!gp) { pad.prev.length = 0; return; }
    const b = gp.buttons, ax = gp.axes;
    const down = (i) => !!b[i]?.pressed;
    const edge = (i) => { const d = down(i), w = !!pad.prev[i]; pad.prev[i] = d; return d && !w; };
    const dir = down(12) || ax[1] < -0.6 ? 'up' : down(13) || ax[1] > 0.6 ? 'down' : down(14) || ax[0] < -0.6 ? 'left' : down(15) || ax[0] > 0.6 ? 'right' : null;
    if (dir) {
      if (pad.rep !== dir) { pad.rep = dir; pad.repT = 0.38; moveFocus(dir); }
      else { pad.repT -= rdt; if (pad.repT <= 0) { pad.repT = 0.11; moveFocus(dir); } }
    } else pad.rep = null;
    if (edge(0)) { const t = document.activeElement; if (t && root.contains(t) && t.tagName === 'BUTTON') t.click(); else if (view === 'missions') fly(); }
    if (edge(1) || edge(9)) back();
  }

  // ---- events ---------------------------------------------------------------------------------------------------
  combat.events.on('mission:end', (r) => {
    const id = combat.mission?.id;
    const rec = id ? store.record(id, combat.options?.difficulty || combat.difficulty, r) : null;
    last = { id, options: { ...(combat.options || {}) }, result: r, record: rec };
    pending = r; pendingT = debriefDelay(r);
  });
  combat.events.on('mission:abort', () => { pending = null; });
  combat.events.on('mission:start', () => applyAudio());
  // the menu took over (gamepad Start, a 'menu' command from elsewhere): step aside, the menu owns pause now
  ev.on('menu:open', () => { if (ui.isOpen) hide(); });

  // ---- per frame (combat.late; runs with or without a mission) ---------------------------------------------------------
  function update() {
    const rdt = ctx.time?.realDt || 0;
    if (pending && !ui.isOpen && !ctx.menu?.isOpen && !ctx.time?.paused) { pendingT -= rdt; if (pendingT <= 0) showDebrief(); }
    if (!ui.isOpen) { pad.prev.length = 0; return; }
    pollPad(rdt);
    if (score) {
      score.t += rdt;
      const k = Math.min(1, score.t / score.dur), e = 1 - Math.pow(1 - k, 3);
      score.el.textContent = group3(score.to * e);
      if (k >= 1) score = null;
    }
  }

  // debug: ?cbtui=missions|settings opens a screen at boot
  ev.on('ready', () => { if (raw.cbtui === 'missions') openMissions(raw.cbtmission); else if (raw.cbtui === 'settings') { openMissions(); toggleSettings(); } });
  return ui;
}

const CSS_ESC = (s) => String(s).replace(/["\\]/g, '\\$&');
const EXTRA_CSS = `
.cbt-ui-open .menu-corner, .cbt-ui-open .menu-crash, .cbt-ui-open .inp-yoke, .cbt-ui-open .inp-touch, .cbt-ui-open .cbt-inp-touch { display: none !important; }
.cbt-ui-root .cbt-ui-mrow[aria-selected="true"] { background: var(--sel); box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.14), inset 0 1px 0 rgb(255 255 255 / 0.18); }
.cbt-ui-root .cbt-ui-mrow[aria-selected="true"] .menu-row-tag { color: var(--amber-soft); }
.cbt-ui-root .menu-seg > .menu-segbtn[aria-checked="true"] { background: var(--sel); box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.14), inset 0 1px 0 rgb(255 255 255 / 0.18); }
.cbt-ui-root .cbt-ui-volfield { min-height: 46px; }
.cbt-ui-root .menu-fly:disabled { opacity: 0.4; cursor: default; filter: grayscale(0.6); }
`;
