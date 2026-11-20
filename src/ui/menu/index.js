// Skyward menus / shell UI (DOM). API: createMenu(ctx) -> { isOpen, open(view?), close(), update(dt) }
// Views: 'main' (hangar: aircraft + flight setup over the live, orbiting aircraft), 'settings', 'controls', 'pause'.
// Also owns: the in-flight corner buttons (controls help, fullscreen, menu), the post-crash dialog, and the runtime side
// of the glass material (glass.js: scene tint, sun-lit rims, low-cost fallback).
// Emits 'menu:open' / 'menu:close'; listens to 'cmd' (menu, hudToggle), 'crash', 'session:start', 'time:change',
// 'weather:change', 'quality:change'. The corner help button emits 'cmd' { name: 'help' } (the HUD shows its controls card).
// Debug: URL param menu=main|pause|settings|controls|crash opens that screen at boot (works with autostart).
import { AIRCRAFT } from '../../aircraft/registry.js';
import { AIRPORTS, runwayEnd } from '../../data/airports.js';
import { WEATHER_PRESETS } from '../../core/weather.js';
import { QUALITY_LEVELS } from '../../core/quality.js';
import { CSS } from './style.js';
import { createGlass } from './glass.js';
import { planGlyph, ICON } from './icons.js';
import {
  DEFAULT_BINDINGS, BINDING_GROUPS, bindingSegments, TOD_PRESETS, START_MODES, QUALITY_NOTES,
  CATEGORY_CODE, isCommercial, specRows, engineLine, metar, clearanceLine, fmtClock, group3, toFt, toKt, phaseOf, AC_FILTERS,
} from './data.js';
import { TOUCH_HELP, defaultQualityFor } from './data.js';

const STORE_KEY = 'skyward.menu.v1';
const WX_CODE = { clear: 'SKC', fair: 'FEW', scattered: 'SCT', broken: 'BKN', overcast: 'OVC -RA', storm: 'TSRA CB' };
const SPAWN_DEBOUNCE = 0.35;   // s (real time) before an aircraft/airport change re-spawns the hangar aircraft
const CRASH_DELAY = 2;         // s (real time) before the crash dialog appears
const KEY_SPECS = 4;           // spec rows always visible on the spec card

// ---- tiny DOM helper ----------------------------------------------------------------------
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
/** Scroll `el` into view inside its own scroll container only (never scrolls the page or other ancestors). */
function reveal(el) {
  const box = el?.closest?.('.menu-scroll, .menu-sheet'); if (!box || !el.offsetParent) return;
  const b = box.getBoundingClientRect(), r = el.getBoundingClientRect();
  if (box.scrollWidth > box.clientWidth + 2 && (r.left < b.left || r.right > b.right)) {
    // horizontal carousel: centre the item
    box.scrollLeft += (r.left + r.width / 2) - (b.left + b.width / 2);
  }
  if (box.scrollHeight > box.clientHeight + 2) {
    // 24px clear of the edge: the list fades out over its last 18px
    if (r.top < b.top + 8) box.scrollTop -= b.top - r.top + 8;
    else if (r.bottom > b.bottom - 24) box.scrollTop += r.bottom - b.bottom + 24;
  }
}
/** Morphing selection highlight: moves `ind` (absolutely positioned in `group`) onto the selected item. */
function placeInd(group, ind, snap) {
  const it = group.querySelector('[aria-selected="true"]:not([hidden]), [aria-checked="true"]:not([hidden]), [aria-current="page"]:not([hidden])');
  if (!it || !it.offsetParent || it.offsetWidth === 0) { ind.classList.remove('on'); return; }
  if (snap || !ind.classList.contains('on')) { ind.classList.add('snap'); void ind.offsetWidth; }
  ind.style.transform = `translate(${it.offsetLeft}px, ${it.offsetTop}px)`;
  ind.style.width = it.offsetWidth + 'px'; ind.style.height = it.offsetHeight + 'px';
  ind.classList.add('on');
  if (ind.classList.contains('snap')) requestAnimationFrame(() => ind.classList.remove('snap'));
}

export async function createMenu(ctx) {
  const ev = ctx.events, params = ctx.params || {}, raw = params.raw || {};
  const persist = !params.test;

  // ---- selection state --------------------------------------------------------------------
  let saved = {};
  if (persist) { try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch { saved = {}; } }
  const acIds = AIRCRAFT.map(a => a.id), aptIds = AIRPORTS.map(a => a.id);
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  const sel = {
    aircraft: pick(params.aircraft, acIds, pick(saved.aircraft, acIds, acIds[0])),
    airport: pick(params.airport, aptIds, pick(saved.airport, aptIds, aptIds[0])),
    runway: 0, end: 0,
    liveries: (saved.liveries && typeof saved.liveries === 'object') ? { ...saved.liveries } : {},   // aircraft id → chosen livery
    start: pick(params.autostart ? params.start : (saved.start || params.start), ['runway', 'air', 'approach'], 'runway'),
    tod: ctx.time.timeOfDay,
    weather: ctx.weather.preset,
    volume: clamp(Number.isFinite(saved.volume) ? saved.volume : (ctx.audio?.masterVolume ?? 0.8), 0, 1),
    filter: 'all',
    specsOpen: !!saved.specsOpen,
    glassReduced: !!saved.glassReduced,
  };
  if (saved.airport === sel.airport) { sel.runway = saved.runway | 0; sel.end = saved.end ? 1 : 0; }
  if (!params.quality && saved.quality && QUALITY_LEVELS[saved.quality] && saved.quality !== ctx.quality.level) ctx.quality.set(saved.quality);
  else if (!params.quality && !saved.quality) {
    // first run on a phone / tablet: start at a tier its GPU can hold (the pilot can raise it in Settings)
    const q = defaultQualityFor(ctx.input?.touchEnabled, window.screen?.width, window.screen?.height, ctx.quality.level);
    if (q !== ctx.quality.level && QUALITY_LEVELS[q]) ctx.quality.set(q);
  }
  if (Number.isFinite(saved.volume)) ctx.audio?.setMasterVolume?.(sel.volume);
  let hudOn = params.hud !== false;

  const glass = createGlass(ctx);
  glass.setReduced(sel.glassReduced);

  const def = () => AIRCRAFT.find(a => a.id === sel.aircraft) || AIRCRAFT[0];
  const apt = () => AIRPORTS.find(a => a.id === sel.airport) || AIRPORTS[0];
  const rwyEnd = () => { const a = apt(); const r = a.runways[sel.runway] || a.runways[0]; return runwayEnd(r, sel.end); };
  const save = () => {
    if (!persist) return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ aircraft: sel.aircraft, airport: sel.airport, runway: sel.runway, end: sel.end, start: sel.start, liveries: sel.liveries, quality: ctx.quality.level, volume: sel.volume, specsOpen: sel.specsOpen, glassReduced: sel.glassReduced })); } catch {}
  };

  // ---- runtime state ------------------------------------------------------------------------
  let view = 'main';          // current view
  let returnTo = 'main';      // where Back from settings/controls goes
  let inHangar = false;       // the parked showcase aircraft is up (no flight in progress)
  let spawnTimer = -1;        // >0: counting down to a hangar re-spawn
  let crashTimer = -1, crashInfo = null;
  let clockTimer = 0, cornerT = 0;
  let lastEscAt = -1e9, lastCmdAt = -1e9;
  const inFlight = () => !!(ctx.session?.active && !inHangar);

  // ---- style + roots -----------------------------------------------------------------------
  const style = h('style', { id: 'menu-style' }); style.textContent = CSS;
  document.head.appendChild(style);
  const root = h('div', { class: 'menu-root', id: 'menu-root', role: 'dialog', 'aria-modal': 'false', 'aria-label': 'Skyward menu' });
  root.hidden = true;
  root.style.pointerEvents = 'none';

  // ---- shared widgets -----------------------------------------------------------------------
  const indicators = [];   // [group, ind]
  /** Roving-tabindex group. role 'listbox' (options) or 'radiogroup' (radios). Arrow keys move + select. */
  function navGroup(el, role, withInd) {
    el.setAttribute('role', role);
    el.dataset.nav = '1';
    if (withInd) { const ind = h('span', { class: 'menu-ind', 'aria-hidden': 'true' }); el.prepend(ind); indicators.push([el, ind]); }
    return el;
  }
  function item(el, role, checked) {
    el.setAttribute('role', role);
    el.dataset.item = '1';
    el.setAttribute(role === 'option' ? 'aria-selected' : 'aria-checked', checked ? 'true' : 'false');
    el.tabIndex = checked ? 0 : -1;
    return el;
  }
  function setChecked(group, pred) {
    let any = false;
    for (const it of group.querySelectorAll('[data-item]')) {
      const on = !!pred(it);
      it.setAttribute(it.getAttribute('role') === 'option' ? 'aria-selected' : 'aria-checked', on ? 'true' : 'false');
      it.tabIndex = on && !it.hidden ? 0 : -1; any ||= on && !it.hidden;
    }
    if (!any) { const f = [...group.querySelectorAll('[data-item]')].find(x => !x.hidden); if (f) f.tabIndex = 0; }
  }
  function placeAll(snap) { for (const [g, ind] of indicators) placeInd(g, ind, snap); }
  function sec(title, aside, ...kids) {
    return h('div', { class: 'menu-sec' },
      h('div', { class: 'menu-h' }, h('span', { text: title }), aside ? (aside.nodeType ? aside : h('span', { class: 'menu-h-aside', text: aside })) : null),
      ...kids);
  }

  // ---- top bar: brand · tabs · status --------------------------------------------------------------
  const tabs = {};
  const mkTab = (id, label) => (tabs[id] = h('button', { class: 'menu-tab', id: 'menu-tab-' + id, type: 'button', onclick: () => go(id === 'hangar' ? 'main' : id) },
    h('span', { html: ICON[id], style: 'display:contents' }), label));
  const tabBar = h('nav', { class: 'menu-tabs menu-cap glass-clear glass-lens', 'aria-label': 'Menu sections' }, mkTab('hangar', 'Hangar'), mkTab('settings', 'Settings'), mkTab('controls', 'Controls'));
  const tabInd = h('span', { class: 'menu-ind', 'aria-hidden': 'true' }); tabBar.prepend(tabInd); indicators.push([tabBar, tabInd]);
  const stLcl = h('span', { class: 'menu-status-v', id: 'menu-status-lcl' });
  const stApt = h('span', { class: 'menu-status-v', id: 'menu-status-apt' });
  const canFs = !!(document.fullscreenEnabled && document.documentElement.requestFullscreen);
  const top = h('header', { class: 'menu-top' },
    h('div', { class: 'menu-brand menu-cap glass-clear' }, h('span', { class: 'menu-brand-mark', html: ICON.brand }), h('span', { class: 'menu-brand-name', text: 'Skyward' })),
    tabBar,
    h('div', { class: 'menu-status menu-cap glass-clear' },
      h('div', { class: 'menu-status-item' }, h('span', { class: 'menu-status-k', text: 'Field' }), stApt),
      h('div', { class: 'menu-status-item' }, h('span', { class: 'menu-status-k', text: 'Local' }), stLcl),
      canFs ? h('button', { class: 'menu-iconbtn menu-fsbtn', id: 'menu-fullscreen', type: 'button', 'aria-label': 'Toggle fullscreen', title: 'Fullscreen', 'aria-pressed': 'false', onclick: toggleFullscreen, html: ICON.fullscreen }) : null));

  // ---- MAIN: aircraft panel -------------------------------------------------------------------
  const military = AIRCRAFT.filter(a => !isCommercial(a)), commercial = AIRCRAFT.filter(isCommercial);
  const filterSeg = navGroup(h('div', { class: 'menu-seg menu-filter', 'aria-label': 'Show aircraft' }), 'radiogroup', true);
  const counts = { all: AIRCRAFT.length, military: military.length, commercial: commercial.length };
  for (const f of AC_FILTERS) {
    if (f.id !== 'all' && !counts[f.id]) continue;
    filterSeg.append(item(h('button', { class: 'menu-segbtn', type: 'button', id: 'menu-filter-' + f.id, 'data-id': f.id, onclick: () => setFilter(f.id) }, f.label, h('small', { text: String(counts[f.id]) })), 'radio', f.id === sel.filter));
  }
  const acList = navGroup(h('div', { class: 'menu-list', 'aria-label': 'Aircraft' }), 'listbox', true);
  const groupLabels = [];
  for (const [label, list, gid] of [['Military', military, 'military'], ['Commercial', commercial, 'commercial']]) {
    if (!list.length) continue;
    const gl = h('div', { class: 'menu-grouplabel', role: 'presentation', 'data-group': gid }, label, h('span', { class: 'menu-count', text: String(list.length) }));
    groupLabels.push(gl); acList.append(gl);
    for (const a of list) {
      acList.append(item(h('button', { class: 'menu-row', type: 'button', id: 'menu-ac-' + a.id, 'data-id': a.id, 'data-group': gid, title: a.name, onclick: () => selectAircraft(a.id) },
        h('span', { class: 'menu-glyph', html: planGlyph(a.category) }),
        h('span', { class: 'menu-row-main' }, h('span', { class: 'menu-row-name', text: a.name }), h('span', { class: 'menu-row-sub', text: a.role || a.manufacturer || '' })),
        h('span', { class: 'menu-row-tag', text: CATEGORY_CODE[a.category] || (a.category || '').slice(0, 3).toUpperCase() })), 'option', a.id === sel.aircraft));
    }
  }
  const livGroup = navGroup(h('div', { class: 'menu-chips menu-liveries', 'aria-label': 'Livery' }), 'radiogroup');
  const livSec = h('div', { class: 'menu-livsec', hidden: true }, h('div', { class: 'menu-h' }, h('span', { text: 'Livery' })), livGroup);
  const acScroll = h('div', { class: 'menu-scroll menu-aclist' }, acList);
  const panelAc = h('section', { class: 'menu-panel menu-panel-ac glass', 'aria-label': 'Aircraft selection' },
    h('div', { class: 'menu-phead' }, h('span', { class: 'menu-ptitle', text: 'Aircraft' }), h('span', { class: 'menu-count', text: String(AIRCRAFT.length), title: AIRCRAFT.length + ' aircraft' })),
    filterSeg, acScroll, livSec);

  // ---- MAIN: hero + spec card -------------------------------------------------------------------
  const heroKicker = h('div', { class: 'menu-hero-kicker' });
  const heroName = h('h1', { class: 'menu-hero-name', id: 'menu-acname' });
  const heroTag = h('p', { class: 'menu-hero-tag' });
  const specKey = h('div', { class: 'menu-spec-key' });
  const specGrid = h('div', { class: 'menu-spec-grid' });
  const acMeta = h('div', { class: 'menu-acmeta' });
  const acLore = h('p', { class: 'menu-lore' });
  const moreBtn = h('button', { class: 'menu-more', id: 'menu-specs-more', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'menu-spec-more', 'aria-label': 'Show full specifications', onclick: () => { sel.specsOpen = !sel.specsOpen; save(); syncSpecs(); } }, h('i'));
  const specCard = h('div', { class: 'menu-spec glass', role: 'group', 'aria-label': 'Specifications' },
    h('div', { class: 'menu-spec-top' }, specKey, moreBtn),
    h('div', { class: 'menu-spec-more', id: 'menu-spec-more' }, h('div', null, specGrid, h('div', { class: 'menu-spec-detail' }, acMeta, acLore))));
  const hero = h('div', { class: 'menu-hero' }, heroKicker, heroName, heroTag, specCard);

  // ---- MAIN: flight setup panel ----------------------------------------------------------------
  const aptList = navGroup(h('div', { class: 'menu-list', 'aria-label': 'Departure airport' }), 'listbox', true);
  for (const a of AIRPORTS) {
    aptList.append(item(h('button', { class: 'menu-row', type: 'button', id: 'menu-apt-' + a.id, 'data-id': a.id, onclick: (e) => { selectAirport(a.id); if (e.detail > 0) setAptOpen(false, true); } },
      h('span', { class: 'menu-row-code', text: a.id }),
      h('span', { class: 'menu-row-main' }, h('span', { class: 'menu-row-name', text: a.name }), h('span', { class: 'menu-row-sub', text: a.kind ? a.kind[0].toUpperCase() + a.kind.slice(1) : '' })),
      h('span', { class: 'menu-row-tag' }, group3(toFt(a.elevation)) + ' ft', h('br'), a.runways.length + (a.runways.length > 1 ? ' rwys' : ' rwy'))), 'option', a.id === sel.airport));
  }
  const pkCode = h('span', { class: 'menu-picker-code' }), pkName = h('span', { class: 'menu-row-name' }), pkSub = h('span', { class: 'menu-row-sub' }), pkTag = h('span', { class: 'menu-row-tag' });
  const aptPicker = h('button', { class: 'menu-picker', id: 'menu-apt-picker', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'menu-aptwrap', 'aria-label': 'Departure airport', onclick: () => setAptOpen(aptPicker.getAttribute('aria-expanded') !== 'true') },
    pkCode, h('span', { class: 'menu-row-main' }, pkName, pkSub), pkTag, h('span', { class: 'menu-picker-chev', 'aria-hidden': 'true' }));
  const aptWrap = h('div', { class: 'menu-aptwrap', id: 'menu-aptwrap' }, h('div', null, aptList));
  aptWrap.inert = true;
  const aptDesc = h('p', { class: 'menu-aptdesc' });
  const rwyGroup = navGroup(h('div', { class: 'menu-rwys', 'aria-label': 'Runway' }), 'radiogroup');
  const rwyInfo = h('div', { class: 'menu-rwyinfo' });
  const startGroup = navGroup(h('div', { class: 'menu-seg', 'aria-label': 'Start position' }), 'radiogroup', true);
  for (const m of START_MODES) startGroup.append(item(h('button', { class: 'menu-segbtn', type: 'button', id: 'menu-start-' + m.id, 'data-id': m.id, title: m.label, onclick: () => { sel.start = m.id; save(); sync(); } }, m.short), 'radio', m.id === sel.start));
  const startNote = h('p', { class: 'menu-note' });

  function conditions(prefix) {
    const read = h('div', { class: 'menu-tod-read' });
    const phase = h('div', { class: 'menu-tod-phase' });
    const range = h('input', { class: 'menu-range', type: 'range', id: prefix + 'tod', min: '0', max: '24', step: '0.25', 'aria-label': 'Time of day (local hours)' });
    range.addEventListener('input', () => setTod(+range.value % 24));
    const chips = navGroup(h('div', { class: 'menu-todchips', 'aria-label': 'Time of day presets' }), 'radiogroup');
    for (const p of TOD_PRESETS) chips.append(item(h('button', { class: 'menu-chip', type: 'button', id: prefix + 'tod-' + p.id, 'data-h': p.h, onclick: () => setTod(p.h) }, p.label), 'radio', false));
    const wx = navGroup(h('div', { class: 'menu-wx', 'aria-label': 'Weather' }), 'radiogroup');
    for (const [k, p] of Object.entries(WEATHER_PRESETS)) {
      wx.append(item(h('button', { class: 'menu-chip', type: 'button', id: prefix + 'wx-' + k, 'data-id': k, onclick: () => setWeather(k) },
        h('span', { class: 'menu-wx-code', text: WX_CODE[k] || k.toUpperCase().slice(0, 3) }), h('span', { class: 'menu-wx-label', text: p.label || k })), 'radio', k === sel.weather));
    }
    const met = h('div', { class: 'menu-metar' });
    const el = [
      sec('Time of day', null,
        h('div', { class: 'menu-tod-head' }, read, phase),
        h('div', { class: 'menu-slider' }, range),
        h('div', { class: 'menu-scale', 'aria-hidden': 'true' }, ...['00', '06', '12', '18', '24'].map(t => h('span', { text: t }))),
        chips),
      sec('Weather', null, wx, met),
    ];
    return { el, read, phase, range, chips, wx, met };
  }
  const condMain = conditions('menu-');
  const planScroll = h('div', { class: 'menu-scroll' },
    sec('Departure', null, aptPicker, aptWrap, aptDesc),
    sec('Runway', null, rwyGroup, rwyInfo),
    sec('Start', null, startGroup, startNote),
    ...condMain.el);
  const panelPlan = h('section', { class: 'menu-panel menu-panel-plan glass', 'aria-label': 'Flight setup' }, planScroll);

  const clearLine = h('b', { id: 'menu-clearance' });
  const flyBtn = h('button', { class: 'menu-fly glass-tint', id: 'menu-fly', type: 'button', onclick: () => fly() }, 'Fly', h('span', { class: 'menu-fly-arrow', 'aria-hidden': 'true' }), h('span', { class: 'menu-fly-key', 'aria-hidden': 'true', text: '↵' }));
  const flybar = h('div', { class: 'menu-flybar glass' }, h('div', { class: 'menu-clear' }, h('span', { text: 'CLR' }), clearLine), flyBtn);

  const vMain = h('section', { class: 'menu-view menu-main', 'data-view': 'main' },
    h('div', { class: 'menu-sheet glass' }, h('div', { class: 'menu-grab', 'aria-hidden': 'true' }), panelAc, hero, panelPlan, flybar));

  // ---- SETTINGS ----------------------------------------------------------------------------------
  const qGroup = navGroup(h('div', { class: 'menu-opts', 'aria-label': 'Graphics quality' }), 'radiogroup');
  for (const [k, q] of Object.entries(QUALITY_LEVELS)) {
    qGroup.append(item(h('button', { class: 'menu-opt', type: 'button', id: 'menu-q-' + k, 'data-id': k, onclick: () => { ctx.quality.set(k); save(); sync(); } },
      h('span', { class: 'menu-opt-t' }, k, h('small', { text: `${Math.round(q.renderScale * 100)}%` })),
      h('span', { class: 'menu-opt-d', text: QUALITY_NOTES[k] || '' })), 'radio', k === ctx.quality.level));
  }
  const volRange = h('input', { class: 'menu-range menu-range-plain', type: 'range', id: 'menu-volume', min: '0', max: '100', step: '1', 'aria-label': 'Master volume' });
  const volRead = h('span', { class: 'menu-vol-read' });
  volRange.addEventListener('input', () => { sel.volume = +volRange.value / 100; ctx.audio?.setMasterVolume?.(sel.volume); volRead.textContent = volRange.value + '%'; volRange.style.setProperty('--v', volRange.value + '%'); });
  volRange.addEventListener('change', save);
  const sw = (id, label, onclick) => h('button', { class: 'menu-switch', id, type: 'button', role: 'switch', 'aria-label': label, onclick });
  const hudBtn = sw('menu-hud', 'Head-up display', () => ev.emit('cmd', { name: 'hudToggle' }));
  const fsRowBtn = sw('menu-fs-setting', 'Fullscreen', toggleFullscreen);
  const glassBtn = sw('menu-glass', 'Glass effects', () => { sel.glassReduced = !sel.glassReduced; glass.setReduced(sel.glassReduced); save(); sync(); });
  const field = (t, d, ctl) => h('div', { class: 'menu-field' }, h('div', { class: 'menu-field-l' }, h('span', { class: 'menu-field-t', text: t }), d ? h('span', { class: 'menu-field-d', text: d }) : null), ctl);
  const settingsBack = h('button', { class: 'menu-back', id: 'menu-settings-back', type: 'button', 'aria-label': 'Back', onclick: () => back() });
  const vSettings = h('section', { class: 'menu-view menu-dock menu-dock-r', 'data-view': 'settings', style: '--origin: top center' },
    h('div', { class: 'menu-panel glass', role: 'region', 'aria-label': 'Settings' },
      h('div', { class: 'menu-subhead' }, settingsBack, h('span', { class: 'menu-subtitle', text: 'Settings' })),
      h('div', { class: 'menu-scroll' },
        sec('Graphics quality', null, qGroup, h('p', { class: 'menu-note', text: 'Applies immediately. Resolution also scales down on its own to hold the frame rate.' })),
        sec('Sound', null, h('div', { class: 'menu-group' }, h('div', { class: 'menu-field-l', style: 'padding-top:10px' }, h('span', { class: 'menu-field-t', text: 'Master volume' })), h('div', { class: 'menu-vol' }, volRange, volRead))),
        sec('Display', null, h('div', { class: 'menu-group' },
          field('Head-up display', 'Flight symbology and instruments · U', hudBtn),
          canFs ? field('Fullscreen', 'Hide the browser around the sim', fsRowBtn) : null,
          field('Glass effects', 'Blur and light the panels. Off is faster on older GPUs', glassBtn))),
        sec('Units', null, h('div', { class: 'menu-fine', text: 'Airspeed kt · Mach  /  Altitude ft  /  Vertical speed ft/min  /  Heading ° true  /  Load factor G  /  Pressure hPa' })))));

  // ---- CONTROLS ---------------------------------------------------------------------------------
  const keysWrap = h('div', { class: 'menu-keys' });
  function renderKeys() {
    keysWrap.textContent = '';
    let src = Array.isArray(ctx.input?.bindings) && ctx.input.bindings.length ? ctx.input.bindings : DEFAULT_BINDINGS;
    // F1 (the in-flight controls card) is handled here and in the HUD, not by input
    if (!src.some(b => /controls card/i.test(b.action || ''))) src = [...src, { group: 'Sim', action: 'Controls card show / hide', keys: ['F1'] }];
    const groupNames = [...BINDING_GROUPS, ...new Set(src.map(b => b.group).filter(g => g && !BINDING_GROUPS.includes(g)))];
    // touch screens: the on-screen controls come first; the keyboard table stays below for a paired keyboard
    if (ctx.input?.touchEnabled) {
      keysWrap.append(h('div', { class: 'menu-keygroup menu-keygroup-touch' },
        h('div', { class: 'menu-h' }, h('span', { text: 'Touch' })),
        h('div', { class: 'menu-group' }, TOUCH_HELP.map(([a, k]) => h('div', { class: 'menu-keyrow' }, h('span', { class: 'menu-keyrow-a', text: a }), h('span', { class: 'menu-keyrow-k menu-keytext', text: k }))))));
    }
    for (const g of groupNames) {
      const rows = src.filter(b => (b.group || 'Sim') === g);
      if (!rows.length) continue;
      keysWrap.append(h('div', { class: 'menu-keygroup' },
        h('div', { class: 'menu-h' }, h('span', { text: g })),
        h('div', { class: 'menu-group' }, rows.map(b => {
          const segs = bindingSegments(b);
          const k = segs ? h('span', { class: 'menu-keyrow-k' }, segs.map((alts, i) => [
            i ? h('span', { class: 'menu-kslash', text: '/' }) : null,
            alts.map((key, j) => [j ? h('span', { class: 'menu-kor', text: 'or' }) : null, h('kbd', { class: 'menu-kbd', text: key })]),
          ])) : h('span', { class: 'menu-keyrow-k menu-keytext', text: String(b.keys) });
          return h('div', { class: 'menu-keyrow' }, h('span', { class: 'menu-keyrow-a', text: b.action }), k);
        }))));
    }
  }
  const controlsBack = h('button', { class: 'menu-back', id: 'menu-controls-back', type: 'button', 'aria-label': 'Back', onclick: () => back() });
  const vControls = h('section', { class: 'menu-view menu-dock menu-dock-c menu-dock-wide', 'data-view': 'controls', style: '--origin: top center' },
    h('div', { class: 'menu-panel glass', role: 'region', 'aria-label': 'Controls reference' },
      h('div', { class: 'menu-subhead' }, controlsBack, h('span', { class: 'menu-subtitle', text: 'Controls' })),
      h('div', { class: 'menu-scroll' }, keysWrap,
        h('div', { class: 'menu-devices' },
          h('div', { class: 'menu-device' }, h('b', { text: 'Mouse' }), 'M turns the mouse into a yoke. Right-drag looks around, wheel zooms.'),
          h('div', { class: 'menu-device' }, h('b', { text: 'Gamepad' }), 'Standard controllers connect automatically. Left stick flies, right stick looks.'),
          h('div', { class: 'menu-device' }, h('b', { text: 'Touch' }), 'Right thumb flies (drag anywhere on the right), left thumb sets the throttle. Menu, top right, pauses and opens this screen.')))));

  // ---- PAUSE ----------------------------------------------------------------------------------------
  const pauseSub = h('div', { class: 'menu-pause-sub' });
  const condPause = conditions('menu-p-');
  const kbd = (t) => h('kbd', { class: 'menu-kbd', text: t });
  const resumeBtn = h('button', { class: 'menu-act menu-act-primary glass-tint', id: 'menu-resume', type: 'button', onclick: () => close() }, 'Resume', kbd('Esc'));
  const vPause = h('section', { class: 'menu-view menu-dock menu-dock-l', 'data-view': 'pause', style: '--origin: top left' },
    h('div', { class: 'menu-panel glass', role: 'region', 'aria-label': 'Paused' },
      h('div', { class: 'menu-pause-head' }, h('div', { class: 'menu-pause-title', text: 'Paused' }), pauseSub),
      h('div', { class: 'menu-scroll' },
        h('div', { class: 'menu-actions' },
          resumeBtn,
          h('button', { class: 'menu-act', id: 'menu-restart', type: 'button', onclick: () => restart() }, 'Restart flight', kbd('Backspace')),
          h('button', { class: 'menu-act', id: 'menu-pause-settings', type: 'button', onclick: () => go('settings') }, 'Settings', h('span', { class: 'menu-act-chev' })),
          h('button', { class: 'menu-act', id: 'menu-pause-controls', type: 'button', onclick: () => go('controls') }, 'Controls', h('span', { class: 'menu-act-chev' })),
          h('button', { class: 'menu-act menu-act-dim', id: 'menu-hangar', type: 'button', onclick: () => toHangar() }, 'Back to hangar', h('span', { class: 'menu-act-chev' }))),
        ...condPause.el)));

  const views = { main: vMain, settings: vSettings, controls: vControls, pause: vPause };
  const body = h('div', { class: 'menu-body' }, vMain, vSettings, vControls, vPause);
  root.append(top, body);
  for (const v of Object.values(views)) v.hidden = true;

  // ---- in-flight corner buttons + crash dialog --------------------------------------------------
  const corner = h('div', { class: 'menu-corner' },
    h('button', { class: 'menu-cbtn menu-cbtn-icon glass-clear glass-lens', id: 'menu-help', type: 'button', 'aria-label': 'Show controls', title: 'Controls (F1)', onclick: () => ev.emit('cmd', { name: 'help' }), html: ICON.help }),
    canFs ? h('button', { class: 'menu-cbtn menu-cbtn-icon menu-fsbtn glass-clear glass-lens', id: 'menu-fullscreen-fly', type: 'button', 'aria-label': 'Toggle fullscreen', title: 'Fullscreen', 'aria-pressed': 'false', onclick: toggleFullscreen, html: ICON.fullscreen }) : null,
    h('button', { class: 'menu-cbtn glass-clear glass-lens', id: 'menu-fab', type: 'button', 'aria-label': 'Open menu', onclick: () => open() }, h('span', { html: ICON.menu, style: 'display:contents' }), 'Menu'));
  corner.hidden = true;
  // Corner buttons must not keep focus during flight, or Space (wheel brakes) / Enter would re-trigger them.
  corner.addEventListener('click', (e) => { const b = e.target.closest?.('button'); if (b) setTimeout(() => b.blur(), 0); });
  corner.addEventListener('pointerenter', () => { cornerT = 0; corner.classList.remove('dim'); });
  const crashReason = h('div', { class: 'menu-crash-r' });
  const crash = h('div', { class: 'menu-crash glass', role: 'alertdialog', 'aria-label': 'Flight ended', 'aria-modal': 'false' },
    h('div', { class: 'menu-crash-t', text: 'Flight ended' }), crashReason,
    h('div', { class: 'menu-crash-b' },
      h('button', { class: 'menu-btn glass-tint', id: 'menu-crash-restart', type: 'button', onclick: () => { hideCrash(); ctx.session?.restart?.(); } }, 'Restart flight'),
      h('button', { class: 'menu-btn', id: 'menu-crash-hangar', type: 'button', onclick: () => { hideCrash(); open('main'); } }, 'Back to hangar')));
  crash.hidden = true;
  ctx.uiRoot.append(root, corner, crash);
  renderKeys();

  // ---- sync DOM from state ---------------------------------------------------------------------
  function syncConditions(c) {
    const t = sel.tod;
    if (document.activeElement !== c.range) c.range.value = String(Math.round(t * 4) / 4);
    c.read.textContent = ''; c.read.append(fmtClock(t), h('small', { text: 'LCL' }));
    c.phase.textContent = phaseOf(t);
    setChecked(c.chips, it => Math.abs(+it.dataset.h - t) < 0.13);
    setChecked(c.wx, it => it.dataset.id === sel.weather);
    const m = metar(apt(), WEATHER_PRESETS[sel.weather], t);
    c.met.textContent = ''; c.met.append(h('b', { text: 'METAR ' }), m);
    return m;
  }
  function syncClock() {
    syncConditions(condMain); syncConditions(condPause);
    stLcl.textContent = fmtClock(sel.tod);
  }
  function kv(r) { return h('div', { class: 'menu-kv' }, h('div', { class: 'menu-kv-k', text: r.k }), h('div', { class: 'menu-kv-v' }, r.v, r.u ? h('span', { class: 'menu-kv-u', text: r.u }) : null)); }
  function syncSpecs() {
    specCard.classList.toggle('open', sel.specsOpen);
    moreBtn.setAttribute('aria-expanded', String(sel.specsOpen));
    moreBtn.setAttribute('aria-label', sel.specsOpen ? 'Hide full specifications' : 'Show full specifications');
    const inner = specCard.querySelector('.menu-spec-more > div'); if (inner) inner.inert = !sel.specsOpen;
  }
  function syncFilter() {
    setChecked(filterSeg, it => it.dataset.id === sel.filter);
    for (const el of acList.children) {
      if (!el.dataset.group) continue;
      el.hidden = sel.filter !== 'all' && el.dataset.group !== sel.filter;
    }
    for (const gl of groupLabels) gl.hidden = sel.filter !== 'all';
  }
  function sync() {
    const d = def(), a = apt();
    syncFilter();
    setChecked(acList, it => it.dataset.id === sel.aircraft);
    setChecked(aptList, it => it.dataset.id === sel.airport);
    // aircraft details
    heroKicker.textContent = [d.manufacturer, d.firstFlight ? 'First flight ' + d.firstFlight : null].filter(Boolean).join('  ·  ');
    heroName.textContent = d.name;
    heroName.classList.toggle('long', d.name.length > 18);
    heroTag.textContent = d.lore?.tagline || d.role || '';
    heroTag.hidden = !heroTag.textContent;
    const rows = specRows(d);
    specKey.textContent = ''; specGrid.textContent = '';
    rows.slice(0, KEY_SPECS).forEach(r => specKey.append(kv(r)));
    rows.slice(KEY_SPECS).forEach(r => specGrid.append(kv(r)));
    acMeta.textContent = '';
    acMeta.append(h('b', { text: d.manufacturer || '' }), d.manufacturer ? ' · ' : '',
      [d.role, d.service].filter(Boolean).join(' · '),
      ...(engineLine(d) ? [h('br'), engineLine(d)] : []));
    acLore.textContent = '';
    if (d.lore?.tagline && d.lore?.description) acLore.append(d.lore.description);
    else if (d.lore?.description) acLore.append(d.lore.description);
    acLore.hidden = !d.lore?.description;
    syncSpecs();
    // airport + runways
    pkCode.textContent = a.id; pkName.textContent = a.name;
    pkSub.textContent = a.kind ? a.kind[0].toUpperCase() + a.kind.slice(1) : '';
    pkTag.textContent = ''; pkTag.append(group3(toFt(a.elevation)) + ' ft', h('br'), a.runways.length + (a.runways.length > 1 ? ' rwys' : ' rwy'));
    aptDesc.textContent = a.description || '';
    if (rwyGroup.dataset.apt !== a.id) {
      rwyGroup.dataset.apt = a.id; rwyGroup.textContent = '';
      a.runways.forEach((r, i) => [0, 1].forEach(e => {
        const re = runwayEnd(r, e);
        rwyGroup.append(item(h('button', { class: 'menu-rwy', type: 'button', id: `menu-rwy-${i}-${e}`, 'data-r': i, 'data-e': e, 'aria-label': 'Runway ' + re.name, onclick: () => selectRunway(i, e) }, re.name), 'radio', false));
      }));
    }
    setChecked(rwyGroup, it => +it.dataset.r === sel.runway && +it.dataset.e === sel.end);
    const re = rwyEnd(), rw = a.runways[sel.runway] || a.runways[0];
    rwyInfo.textContent = `HDG ${String(Math.round(re.heading)).padStart(3, '0')}°  ·  ${group3(toFt(re.length))} × ${Math.round(toFt(re.width))} ft  ·  ${(rw.surface || '').toUpperCase()}`;
    stApt.textContent = `${a.id} ${re.name}`;
    // start
    setChecked(startGroup, it => it.dataset.id === sel.start);
    startNote.textContent = (START_MODES.find(m => m.id === sel.start) || START_MODES[0]).note;
    clearLine.textContent = clearanceLine(a, re.name, sel.start, d);
    // settings
    setChecked(qGroup, it => it.dataset.id === ctx.quality.level);
    if (document.activeElement !== volRange) volRange.value = String(Math.round(sel.volume * 100));
    volRange.style.setProperty('--v', Math.round(sel.volume * 100) + '%');
    volRead.textContent = Math.round(sel.volume * 100) + '%';
    hudBtn.setAttribute('aria-pressed', String(hudOn)); hudBtn.setAttribute('aria-checked', String(hudOn));
    glassBtn.setAttribute('aria-pressed', String(!sel.glassReduced)); glassBtn.setAttribute('aria-checked', String(!sel.glassReduced));
    const fs = !!document.fullscreenElement;
    fsRowBtn.setAttribute('aria-pressed', String(fs)); fsRowBtn.setAttribute('aria-checked', String(fs));
    for (const b of document.querySelectorAll('.menu-fsbtn')) b.setAttribute('aria-pressed', String(fs));
    // pause
    syncPause();
    syncClock();
    if (menu.isOpen) placeAll(false);
  }
  function syncPause() {
    const p = ctx.player; pauseSub.textContent = '';
    if (!p) return;
    const s = p.state || {};
    pauseSub.append(h('b', { text: p.def?.name || '' }), h('br'),
      `${p.airport?.id || ''} RWY ${p.runway?.name || ''}`, h('br'),
      `ALT ${group3(toFt(s.altitude || 0))} ft  ·  IAS ${Math.round(toKt(s.ias || 0))} kt  ·  HDG ${String(Math.round(((s.heading || 0) * 180 / Math.PI + 360) % 360)).padStart(3, '0')}°`);
  }

  // ---- actions ----------------------------------------------------------------------------------
  function selectAircraft(id) { if (sel.aircraft === id) return; sel.aircraft = id; save(); sync(); scheduleSpawn(); }
  function setFilter(f) {
    if (sel.filter === f) return;
    sel.filter = f;
    // keep a visible selection: jump to the first aircraft of the group if the current one is filtered out
    const cur = AIRCRAFT.find(a => a.id === sel.aircraft);
    const g = cur && (isCommercial(cur) ? 'commercial' : 'military');
    if (f !== 'all' && g !== f) { const first = (f === 'military' ? military : commercial)[0]; if (first) { sel.aircraft = first.id; save(); scheduleSpawn(); } }
    sync(); placeAll(true);
    acScroll.scrollTop = 0; reveal(acList.querySelector('[aria-selected="true"]'));
  }
  const LIVERY_LABEL = { lowvis: 'Low vis', usaf: 'USAF', raaf: 'RAAF', cag: 'CAG', house: 'House colours' };
  const liveryLabel = id => LIVERY_LABEL[id] || id.charAt(0).toUpperCase() + id.slice(1);
  /** Rebuild the livery chips from the aircraft that is actually on the ramp (its visual lists what it can paint). */
  function syncLiveries() {
    const p = ctx.player;
    if (p && p.id !== sel.aircraft) return;      // a re-spawn is pending: keep the row until the new aircraft arrives
    const list = p?.visual?.liveries || [];
    livSec.hidden = list.length < 2;
    const key = sel.aircraft + ':' + list.join(',');
    if (livGroup.dataset.key !== key) {
      livGroup.dataset.key = key; livGroup.textContent = '';
      for (const id of list) livGroup.append(item(h('button', { class: 'menu-chip', type: 'button', id: 'menu-livery-' + id, 'data-id': id, onclick: () => selectLivery(id) }, liveryLabel(id)), 'radio', false));
    }
    const cur = p?.visual?.livery;
    setChecked(livGroup, it => it.dataset.id === cur);
  }
  function selectLivery(id) { if (sel.liveries[sel.aircraft] === id && ctx.player?.visual?.livery === id) return; sel.liveries[sel.aircraft] = id; save(); scheduleSpawn(); setChecked(livGroup, it => it.dataset.id === id); }
  function selectAirport(id) { if (sel.airport === id) return; sel.airport = id; sel.runway = 0; sel.end = 0; save(); sync(); scheduleSpawn(); }
  function setAptOpen(open, focusPicker) {
    aptPicker.setAttribute('aria-expanded', String(open));
    aptWrap.classList.toggle('open', open); aptWrap.inert = !open;
    if (open) {
      requestAnimationFrame(() => { placeAll(true); const s = aptList.querySelector('[aria-selected="true"]'); try { s?.focus({ preventScroll: true }); } catch {} });
      setTimeout(() => reveal(aptWrap), 360);
    } else if (focusPicker) { try { aptPicker.focus({ preventScroll: true }); } catch {} }
  }
  function selectRunway(i, e) { if (sel.runway === i && sel.end === e) return; sel.runway = i; sel.end = e; save(); sync(); scheduleSpawn(); }
  function setTod(hr) { sel.tod = hr; ctx.time.setTimeOfDay(hr); syncClock(); }
  function setWeather(k) { sel.weather = k; ctx.weather.setPreset(k, true); syncClock(); }
  function scheduleSpawn() { if (inHangar) spawnTimer = SPAWN_DEBOUNCE; }
  function opts(start) { return { aircraft: sel.aircraft, airport: sel.airport, runway: sel.runway, end: sel.end, start, livery: sel.liveries[sel.aircraft] }; }
  function setPaused(p) { if (!!ctx.time.paused !== p) { ctx.time.paused = p; ev.emit('pause', p); } }
  function spawnHangar() {
    spawnTimer = -1;
    try { ctx.session?.start?.(opts('runway')); } catch (e) { console.warn('[menu] hangar spawn failed', e); }
    ctx.cameraRig?.setMode?.('showcase');
  }
  function holdParked() { const c = ctx.controls; if (c) { c.throttle = 0; c.brakes = 1; } }
  function enterHangar() { inHangar = true; hideCrash(); setPaused(false); holdParked(); spawnHangar(); }

  function fly() {
    inHangar = false; spawnTimer = -1; hideCrash();
    if (ctx.controls) { ctx.controls.brakes = 0; }
    ctx.session?.start?.(opts(sel.start));
    ctx.cameraRig?.setMode?.('chase');
    try { ctx.audio?.resume?.(); } catch {}
    close();
  }
  function restart() { hideCrash(); ctx.session?.restart?.(); close(); }
  function toHangar() { go('main'); }

  function show(v) {
    const prev = view;
    view = v;
    for (const [k, el] of Object.entries(views)) el.hidden = k !== v;
    const flight = inFlight();
    tabBar.hidden = flight;
    for (const [k, t] of Object.entries(tabs)) { if ((k === 'hangar' ? 'main' : k) === v) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); }
    if (v === 'pause') syncPause();
    if (v !== 'main') setAptOpen(false);
    // panels grow out of the control that opened them: tabs (top centre) or the corner Menu button (top right)
    if (v === 'pause') views[v].style.setProperty('--origin', 'top right');
    if (prev !== v || !root.classList.contains('menu-anim')) { root.classList.remove('menu-anim'); void root.offsetWidth; root.classList.add('menu-anim'); }
    requestAnimationFrame(() => placeAll(prev !== v));
  }
  // Audio may only start after a user gesture: the first interaction with the menu wakes it (hangar idle sound).
  root.addEventListener('pointerdown', () => { try { ctx.audio?.resume?.(); } catch {} }, { once: true });
  function focusView() {
    let el;
    if (view === 'main') el = acList.querySelector('[tabindex="0"]');
    else if (view === 'pause') el = resumeBtn;
    else if (view === 'settings') el = qGroup.querySelector('[tabindex="0"]');
    else el = controlsBack;
    try { el?.focus({ preventScroll: true }); } catch {}
  }
  /** Navigate between views while open. */
  function go(v) {
    if (v === 'main') { if (!inHangar) enterHangar(); returnTo = 'main'; }
    else if (v === 'settings' || v === 'controls') returnTo = inFlight() ? 'pause' : 'main';
    if (!menu.isOpen) { open(v); return; }
    show(v); sync(); focusView();
  }
  function back() {
    if (view === 'main' && aptPicker.getAttribute('aria-expanded') === 'true') { setAptOpen(false, true); return; }
    if (view === 'settings' || view === 'controls') { show(returnTo === 'pause' && inFlight() ? 'pause' : 'main'); sync(); focusView(); }
    else if (view === 'pause') close();
    // main: nothing to go back to (Esc is a no-op in the hangar)
  }

  function open(v, noFocus) {
    if (!v) v = inFlight() ? 'pause' : 'main';
    if (v === 'main') { if (!inHangar || !ctx.session?.active) enterHangar(); returnTo = 'main'; }
    else if (v === 'settings' || v === 'controls') returnTo = inFlight() ? 'pause' : 'main';
    if (v === 'pause' && !inFlight()) v = 'main';
    if (inFlight()) setPaused(true);
    hideCrash();
    const was = menu.isOpen;
    menu.isOpen = true; root.hidden = false; corner.hidden = true;
    root.classList.remove('menu-anim');
    show(v); sync(); if (!noFocus) focusView();
    if (v === 'main') requestAnimationFrame(() => { reveal(acList.querySelector('[aria-selected="true"]')); });
    if (!was) ev.emit('menu:open');
  }
  function close() {
    if (!menu.isOpen) return;
    if (inHangar) { inHangar = false; spawnTimer = -1; ctx.cameraRig?.setMode?.('chase'); if (ctx.controls) ctx.controls.brakes = 0; }
    setPaused(false);
    menu.isOpen = false; root.hidden = true;
    try { if (root.contains(document.activeElement)) document.activeElement.blur(); } catch {}
    updateCorner();
    ev.emit('menu:close');
  }
  function updateCorner() { const was = corner.hidden; corner.hidden = menu.isOpen || !ctx.session?.active; if (was && !corner.hidden) { cornerT = 0; corner.classList.remove('dim'); } }
  function showCrash() {
    if (menu.isOpen || inHangar) return;
    const r = crashInfo?.reason || ctx.player?.state?.crashReason || '';
    crashReason.textContent = r ? String(r) : 'The aircraft was destroyed.';
    crash.hidden = false;
  }
  function hideCrash() { crash.hidden = true; crashTimer = -1; }

  function toggleFullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen?.()?.catch?.(() => {});
      else document.documentElement.requestFullscreen?.()?.catch?.(() => {});
    } catch {}
  }
  document.addEventListener('fullscreenchange', () => sync());
  window.addEventListener('resize', () => { if (menu.isOpen) requestAnimationFrame(() => placeAll(true)); });
  try { document.fonts?.addEventListener?.('loadingdone', () => { if (menu.isOpen) placeAll(true); }); } catch {}

  // ---- keyboard --------------------------------------------------------------------------------
  function handleMenuKey() {
    if (menu.isOpen) back();
    else if (ctx.session?.active) open();
  }
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const now = performance.now();
    if (e.key === 'Escape' || e.code === 'Escape') {
      if (now - lastCmdAt < 300) return;   // input already turned this Esc into a 'menu' cmd
      lastEscAt = now; e.preventDefault(); handleMenuKey(); return;
    }
    if (e.code === 'F1' && !menu.isOpen) { e.preventDefault(); if (!e.repeat) ev.emit('cmd', { name: 'help' }); return; }
    if (!menu.isOpen) return;
    const t = e.target instanceof Element ? e.target : null;
    // arrow-key navigation inside list / radio groups
    const grp = t?.closest?.('[data-nav]');
    if (grp && root.contains(grp) && /^(Arrow(Up|Down|Left|Right)|Home|End)$/.test(e.key) && t.matches('[data-item]')) {
      const items = [...grp.querySelectorAll('[data-item]')].filter(x => !x.hidden);
      let i = items.indexOf(t);
      if (e.key === 'Home') i = 0; else if (e.key === 'End') i = items.length - 1;
      else i = clamp(i + (/Down|Right/.test(e.key) ? 1 : -1), 0, items.length - 1);
      const n = items[i];
      if (n && n !== t) { n.click(); try { n.focus({ preventScroll: true }); reveal(n); } catch {} }
      e.preventDefault(); return;
    }
    if (e.key === 'Enter' && view === 'main' && !e.repeat) {
      if (t && aptList.contains(t)) { e.preventDefault(); setAptOpen(false, true); return; }
      const plainButton = t && t.tagName === 'BUTTON' && !t.matches('[data-item]');
      if (!plainButton) { e.preventDefault(); fly(); }
    }
  });
  // stop page scroll from focus-into-view on the clipped root
  root.addEventListener('scroll', () => { root.scrollTop = 0; root.scrollLeft = 0; });

  // ---- events -------------------------------------------------------------------------------------
  ev.on('cmd', ({ name } = {}) => {
    if (name === 'menu') {
      if (performance.now() - lastEscAt < 300) return;   // already handled from our own Esc listener
      lastCmdAt = performance.now(); handleMenuKey();
    } else if (name === 'hudToggle') { hudOn = !hudOn; sync(); }
  });
  ev.on('crash', (p) => { if (inHangar || crashTimer > 0 || !crash.hidden) return; crashInfo = p || null; crashTimer = CRASH_DELAY; });
  ev.on('session:start', () => { hideCrash(); updateCorner(); syncLiveries(); if (menu.isOpen) requestAnimationFrame(() => placeAll(false)); });
  ev.on('session:end', () => { updateCorner(); });
  ev.on('time:change', (hr) => { if (Number.isFinite(hr)) { sel.tod = hr; if (menu.isOpen) syncClock(); } });
  ev.on('weather:change', ({ preset } = {}) => { if (preset && preset !== sel.weather) { sel.weather = preset; if (menu.isOpen) syncClock(); } });
  ev.on('quality:change', () => { if (menu.isOpen) sync(); });
  ev.on('ready', () => {
    const dbg = raw.menu;
    if (dbg === 'crash') { crashInfo = { reason: 'Debug: impact with terrain at 212 kt' }; showCrash(); return; }
    // at boot nothing has been interacted with yet: do not move focus (it would draw a focus ring on the first row)
    if (dbg && views[dbg]) { open(dbg, true); return; }
    if (!params.autostart) open('main', true);
    else updateCorner();
  });

  // ---- gamepad: D-pad / left stick move focus, A activates, B goes back, LB / RB switch sections ----------------
  // (input ignores these buttons while the menu is open; Start still toggles the menu through input)
  const pad = { prev: [], rep: 0, repT: 0 };
  const tabbable = () => [...root.querySelectorAll('button, input, [tabindex="0"]')].filter(el => !el.disabled && el.tabIndex >= 0 && el.offsetParent && !el.closest('[inert]') && !el.closest('[hidden]'));
  function moveFocus(dir) {
    const t = document.activeElement;
    const inRoot = t && root.contains(t);
    if (inRoot && (dir === 'left' || dir === 'right') && t.closest('[data-nav]') && t.matches('[data-item]')) {
      t.dispatchEvent(new KeyboardEvent('keydown', { key: dir === 'left' ? 'ArrowLeft' : 'ArrowRight', bubbles: true })); return;
    }
    if (inRoot && t.type === 'range' && (dir === 'left' || dir === 'right')) {
      t.value = String(+t.value + (dir === 'left' ? -1 : 1) * (+t.step || 1) * (t.id.endsWith('tod') ? 2 : 5)); t.dispatchEvent(new Event('input', { bubbles: true })); t.dispatchEvent(new Event('change', { bubbles: true })); return;
    }
    if (inRoot && (dir === 'up' || dir === 'down') && t.closest('[data-nav]') && t.matches('[data-item]') && t.closest('[role="listbox"]')) {
      // inside a list: up/down walk the list until its ends, then leave it
      const items = [...t.closest('[data-nav]').querySelectorAll('[data-item]')].filter(x => !x.hidden);
      const i = items.indexOf(t), n = items[i + (dir === 'down' ? 1 : -1)];
      if (n) { t.dispatchEvent(new KeyboardEvent('keydown', { key: dir === 'down' ? 'ArrowDown' : 'ArrowUp', bubbles: true })); return; }
    }
    const list = tabbable(); if (!list.length) return;
    let i = inRoot ? list.indexOf(t) : -1;
    // skip the other members of a roving group (only its tabindex=0 member is in the list anyway)
    i = clamp(i + (dir === 'down' || dir === 'right' ? 1 : -1), 0, list.length - 1);
    const n = list[i];
    try { n.focus({ preventScroll: true }); reveal(n); } catch {}
  }
  function pollPad(rdt) {
    let gp = null;
    try { for (const g of navigator.getGamepads?.() || []) if (g && g.connected && g.mapping === 'standard') { gp = g; break; } } catch {}
    if (!gp) return;
    const b = gp.buttons, ax = gp.axes;
    const down = (i) => !!b[i]?.pressed;
    const edge = (i) => { const d = down(i), w = !!pad.prev[i]; pad.prev[i] = d; return d && !w; };
    const dir = down(12) || ax[1] < -0.6 ? 'up' : down(13) || ax[1] > 0.6 ? 'down' : down(14) || ax[0] < -0.6 ? 'left' : down(15) || ax[0] > 0.6 ? 'right' : null;
    if (dir) {
      if (pad.rep !== dir) { pad.rep = dir; pad.repT = 0.38; moveFocus(dir); }
      else { pad.repT -= rdt; if (pad.repT <= 0) { pad.repT = 0.11; moveFocus(dir); } }
    } else pad.rep = 0;
    if (edge(0)) { const t = document.activeElement; if (t && root.contains(t) && t.tagName === 'BUTTON') t.click(); else if (view === 'main') fly(); }
    if (edge(1)) back();
    const order = inFlight() ? null : ['main', 'settings', 'controls'];
    if (edge(4) && order) go(order[(order.indexOf(view) + 2) % 3]);
    if (edge(5) && order) go(order[(order.indexOf(view) + 1) % 3]);
  }

  // ---- per-frame ---------------------------------------------------------------------------------
  const menu = {
    isOpen: false,
    open, close,
    get view() { return view; },
    get selection() { return { ...sel }; },
    get glass() { return glass; },
    update() {
      const rdt = ctx.time.realDt || 0;
      glass.update(rdt, menu.isOpen);
      if (spawnTimer > 0) { spawnTimer -= rdt; if (spawnTimer <= 0 && inHangar) spawnHangar(); }
      if (crashTimer > 0) { crashTimer -= rdt; if (crashTimer <= 0) showCrash(); }
      if (inHangar) holdParked();
      if (menu.isOpen) pollPad(rdt);
      else pad.prev.length = 0;
      if (!corner.hidden) corner.classList.toggle('touch', !!ctx.input?.touchEnabled);
      if (!corner.hidden && !corner.classList.contains('dim')) { cornerT += rdt; if (cornerT > 6 && !corner.matches(':hover, :focus-within')) corner.classList.add('dim'); }
      if (menu.isOpen) {
        clockTimer -= rdt;
        if (clockTimer <= 0) {
          clockTimer = 0.5;
          if (Math.abs(ctx.time.timeOfDay - sel.tod) > 1 / 120) { sel.tod = ctx.time.timeOfDay; syncClock(); }
        }
      }
    },
  };
  sync();
  return menu;
}
