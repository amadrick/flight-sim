// Skyward menus / shell UI (DOM). API: createMenu(ctx) -> { isOpen, open(view?), close(), update(dt) }
// Views: 'main' (hangar: aircraft + flight setup over the live, orbiting aircraft), 'settings', 'controls', 'pause'.
// Also owns: the in-flight corner MENU / fullscreen buttons and the post-crash dialog.
// Emits 'menu:open' / 'menu:close'; listens to 'cmd' (menu, hudToggle), 'crash', 'session:start', 'time:change',
// 'weather:change', 'quality:change'.
// Debug: URL param menu=main|pause|settings|controls|crash opens that screen at boot (works with autostart).
import { AIRCRAFT } from '../../aircraft/registry.js';
import { AIRPORTS, runwayEnd } from '../../data/airports.js';
import { WEATHER_PRESETS } from '../../core/weather.js';
import { QUALITY_LEVELS } from '../../core/quality.js';
import { CSS } from './style.js';
import {
  DEFAULT_BINDINGS, BINDING_GROUPS, parseKeys, bindingSegments, TOD_PRESETS, START_MODES, QUALITY_NOTES,
  CATEGORY_CODE, isCommercial, specRows, engineLine, metar, clearanceLine, fmtClock, group3, toFt, toKt,
} from './data.js';

const STORE_KEY = 'skyward.menu.v1';
const WX_CODE = { clear: 'SKC', fair: 'FEW', scattered: 'SCT', broken: 'BKN', overcast: 'OVC -RA', storm: 'TSRA CB' };
const SPAWN_DEBOUNCE = 0.35;   // s (real time) before an aircraft/airport change re-spawns the hangar aircraft
const CRASH_DELAY = 2;         // s (real time) before the crash dialog appears

// ---- tiny DOM helper ----------------------------------------------------------------------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
/** Scroll `el` into view inside its own scroll container only (never scrolls the page or other ancestors). */
function reveal(el) {
  const box = el?.closest?.('.menu-scroll'); if (!box) return;
  const b = box.getBoundingClientRect(), r = el.getBoundingClientRect();
  if (r.top < b.top) box.scrollTop -= b.top - r.top + 4;
  else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 4;
}

function phaseOf(hr) {
  if (hr < 4.6 || hr >= 20.2) return 'Night';
  if (hr < 5.6) return 'Dawn';
  if (hr < 10) return 'Morning';
  if (hr < 15) return 'Midday';
  if (hr < 17.8) return 'Afternoon';
  if (hr < 19.0) return 'Golden hour';
  return 'Dusk';
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
  };
  if (saved.airport === sel.airport) { sel.runway = saved.runway | 0; sel.end = saved.end ? 1 : 0; }
  if (!params.quality && saved.quality && QUALITY_LEVELS[saved.quality] && saved.quality !== ctx.quality.level) ctx.quality.set(saved.quality);
  if (Number.isFinite(saved.volume)) ctx.audio?.setMasterVolume?.(sel.volume);
  let hudOn = params.hud !== false;

  const def = () => AIRCRAFT.find(a => a.id === sel.aircraft) || AIRCRAFT[0];
  const apt = () => AIRPORTS.find(a => a.id === sel.airport) || AIRPORTS[0];
  const rwyEnd = () => { const a = apt(); const r = a.runways[sel.runway] || a.runways[0]; return runwayEnd(r, sel.end); };
  const save = () => {
    if (!persist) return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ aircraft: sel.aircraft, airport: sel.airport, runway: sel.runway, end: sel.end, start: sel.start, liveries: sel.liveries, quality: ctx.quality.level, volume: sel.volume })); } catch {}
  };

  // ---- runtime state ------------------------------------------------------------------------
  let view = 'main';          // current view
  let returnTo = 'main';      // where Back from settings/controls goes
  let inHangar = false;       // the parked showcase aircraft is up (no flight in progress)
  let spawnTimer = -1;        // >0: counting down to a hangar re-spawn
  let crashTimer = -1, crashInfo = null;
  let clockTimer = 0;
  let lastEscAt = -1e9, lastCmdAt = -1e9;
  const inFlight = () => !!(ctx.session?.active && !inHangar);

  // ---- style + roots -----------------------------------------------------------------------
  const style = h('style', { id: 'menu-style' }); style.textContent = CSS;
  document.head.appendChild(style);
  const root = h('div', { class: 'menu-root', id: 'menu-root', role: 'dialog', 'aria-modal': 'false', 'aria-label': 'Skyward menu' });
  root.hidden = true;
  root.style.pointerEvents = 'none';

  // ---- shared widgets -----------------------------------------------------------------------
  /** Roving-tabindex group. role 'listbox' (options) or 'radiogroup' (radios). Arrow keys move + select. */
  function navGroup(el, role) {
    el.setAttribute('role', role);
    el.dataset.nav = '1';
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
      it.tabIndex = on ? 0 : -1; any ||= on;
    }
    if (!any) { const f = group.querySelector('[data-item]'); if (f) f.tabIndex = 0; }
  }
  function sec(n, title, aside, ...kids) {
    return h('div', { class: 'menu-sec' },
      h('div', { class: 'menu-h' }, n ? h('span', { class: 'menu-h-n', text: n }) : null, h('span', { text: title }), aside ? h('span', { class: 'menu-h-aside', text: aside }) : null),
      ...kids);
  }

  // ---- top bar ----------------------------------------------------------------------------------
  const tabs = {};
  const mkTab = (id, n, label) => (tabs[id] = h('button', { class: 'menu-tab', id: 'menu-tab-' + id, type: 'button', onclick: () => go(id === 'hangar' ? 'main' : id) },
    h('span', { class: 'menu-tab-n', text: n }), label));
  const tabBar = h('nav', { class: 'menu-tabs', 'aria-label': 'Menu sections' }, mkTab('hangar', '01', 'Hangar'), mkTab('settings', '02', 'Settings'), mkTab('controls', '03', 'Controls'));
  const stLcl = h('span', { class: 'menu-status-v', id: 'menu-status-lcl' });
  const stApt = h('span', { class: 'menu-status-v', id: 'menu-status-apt' });
  const canFs = !!(document.fullscreenEnabled && document.documentElement.requestFullscreen);
  const fsBtn = (id) => h('button', { class: 'menu-iconbtn menu-fsbtn', id, type: 'button', 'aria-label': 'Toggle fullscreen', title: 'Fullscreen', 'aria-pressed': 'false', onclick: toggleFullscreen, hidden: !canFs },
    h('span', { class: 'menu-ico-fs' }, h('i')));
  const top = h('header', { class: 'menu-top' },
    h('div', { class: 'menu-brand' }, h('span', { class: 'menu-brand-mark', 'aria-hidden': 'true' }), h('span', { class: 'menu-brand-name', text: 'Skyward' }),
      h('span', { class: 'menu-brand-sub', text: 'Flight' }, h('br'), 'Simulator')),
    tabBar,
    h('div', { class: 'menu-status' },
      h('div', { class: 'menu-status-item menu-status-keep' }, h('span', { class: 'menu-status-k', text: 'Field' }), stApt),
      h('div', { class: 'menu-status-item menu-status-keep' }, h('span', { class: 'menu-status-k', text: 'Local' }), stLcl),
      fsBtn('menu-fullscreen')));

  // ---- MAIN: aircraft panel -------------------------------------------------------------------
  const acList = navGroup(h('div', { class: 'menu-list', 'aria-label': 'Aircraft' }), 'listbox');
  const groups = [['Military', AIRCRAFT.filter(a => !isCommercial(a))], ['Commercial', AIRCRAFT.filter(isCommercial)]];
  for (const [label, list] of groups) {
    if (!list.length) continue;
    acList.append(h('div', { class: 'menu-grouplabel', role: 'presentation' }, label, h('span', { text: String(list.length).padStart(2, '0') })));
    for (const a of list) {
      acList.append(item(h('button', { class: 'menu-row', type: 'button', id: 'menu-ac-' + a.id, 'data-id': a.id, onclick: () => selectAircraft(a.id) },
        h('span', { class: 'menu-row-code', text: a.id.toUpperCase() }),
        h('span', { class: 'menu-row-main' }, h('span', { class: 'menu-row-name', text: a.name }), h('span', { class: 'menu-row-sub', text: a.role || a.manufacturer || '' })),
        h('span', { class: 'menu-row-tag', text: CATEGORY_CODE[a.category] || (a.category || '').slice(0, 3).toUpperCase() })), 'option', a.id === sel.aircraft));
    }
  }
  const acName = h('h2', { class: 'menu-acname', id: 'menu-acname' });
  const acMeta = h('div', { class: 'menu-acmeta' });
  const acLore = h('p', { class: 'menu-lore' });
  const acSpecs = h('div', { class: 'menu-specs' });
  const livGroup = navGroup(h('div', { class: 'menu-rwys menu-liveries', 'aria-label': 'Livery' }), 'radiogroup');
  const livSec = h('div', { class: 'menu-livsec', hidden: true }, h('div', { class: 'menu-h' }, h('span', { text: 'Livery' })), livGroup);
  const panelAc = h('section', { class: 'menu-panel menu-panel-ac', 'aria-label': 'Aircraft selection' },
    h('div', { class: 'menu-sec', style: 'padding-bottom:10px;flex:none' }, h('div', { class: 'menu-h', style: 'margin:0' }, h('span', { class: 'menu-h-n', text: 'A' }), h('span', { text: 'Aircraft' }), h('span', { class: 'menu-h-aside', text: String(AIRCRAFT.length).padStart(2, '0') + ' types' }))),
    h('div', { class: 'menu-scroll menu-aclist', style: 'padding:0 16px' }, acList),
    h('div', { class: 'menu-scroll menu-acinfo' }, h('div', { class: 'menu-sec' }, livSec, h('div', { class: 'menu-h' }, h('span', { text: 'Type data' })), acName, acMeta, acLore, acSpecs)));

  // ---- MAIN: flight plan panel ----------------------------------------------------------------
  const aptList = navGroup(h('div', { class: 'menu-list', 'aria-label': 'Departure airport' }), 'listbox');
  for (const a of AIRPORTS) {
    aptList.append(item(h('button', { class: 'menu-row', type: 'button', id: 'menu-apt-' + a.id, 'data-id': a.id, onclick: () => selectAirport(a.id) },
      h('span', { class: 'menu-row-code', text: a.id }),
      h('span', { class: 'menu-row-main' }, h('span', { class: 'menu-row-name', text: a.name }), h('span', { class: 'menu-row-sub', text: a.kind ? a.kind[0].toUpperCase() + a.kind.slice(1) : '' })),
      h('span', { class: 'menu-row-tag' }, group3(toFt(a.elevation)) + ' ft', h('br'), a.runways.length + (a.runways.length > 1 ? ' rwys' : ' rwy'))), 'option', a.id === sel.airport));
  }
  const aptDesc = h('p', { class: 'menu-aptdesc' });
  const rwyGroup = navGroup(h('div', { class: 'menu-rwys', 'aria-label': 'Runway' }), 'radiogroup');
  const rwyInfo = h('div', { class: 'menu-rwyinfo' });
  const startGroup = navGroup(h('div', { class: 'menu-seg', 'aria-label': 'Start position' }), 'radiogroup');
  for (const m of START_MODES) startGroup.append(item(h('button', { class: 'menu-chip', type: 'button', id: 'menu-start-' + m.id, 'data-id': m.id, title: m.label, onclick: () => { sel.start = m.id; save(); sync(); } }, m.short), 'radio', m.id === sel.start));
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
      sec(prefix ? '' : '04', 'Time of day', null,
        h('div', { class: 'menu-tod-head' }, read, phase),
        h('div', { class: 'menu-slider' }, range),
        h('div', { class: 'menu-scale', 'aria-hidden': 'true' }, ...['00', '06', '12', '18', '24'].map(t => h('span', { text: t }))),
        chips),
      sec(prefix ? '' : '05', 'Weather', null, wx, met),
    ];
    return { el, read, phase, range, chips, wx, met };
  }
  const condMain = conditions('menu-');
  const panelPlan = h('section', { class: 'menu-panel menu-panel-plan', 'aria-label': 'Flight setup' },
    h('div', { class: 'menu-scroll' },
      sec('01', 'Departure', null, aptList, aptDesc),
      sec('02', 'Runway', null, rwyGroup, rwyInfo),
      sec('03', 'Start', null, startGroup, startNote),
      ...condMain.el));

  const clearLine = h('b', { id: 'menu-clearance' });
  const flyBtn = h('button', { class: 'menu-fly', id: 'menu-fly', type: 'button', onclick: () => fly() }, 'Fly', h('span', { class: 'menu-fly-arrow', 'aria-hidden': 'true' }), h('span', { class: 'menu-fly-key', 'aria-hidden': 'true', text: '↵' }));
  const flybar = h('div', { class: 'menu-panel menu-flybar' }, h('div', { class: 'menu-clear' }, h('span', { text: 'CLR' }), clearLine), flyBtn);

  const heroKicker = h('div', { class: 'menu-hero-kicker' });
  const heroName = h('div', { class: 'menu-hero-name' });
  const heroTag = h('p', { class: 'menu-hero-tag' });
  const heroMetar = h('span');
  const hero = h('div', { class: 'menu-hero', 'aria-hidden': 'true' }, heroKicker, heroName, heroTag, h('div', { class: 'menu-hero-metar' }, h('span', { text: 'METAR' }), heroMetar));

  const vMain = h('section', { class: 'menu-view menu-main', 'data-view': 'main' },
    h('div', { class: 'menu-sheet' }, h('div', { class: 'menu-grab', 'aria-hidden': 'true' }), panelAc, hero, panelPlan, flybar));

  // ---- SETTINGS ----------------------------------------------------------------------------------
  const qGroup = navGroup(h('div', { class: 'menu-opts', 'aria-label': 'Graphics quality' }), 'radiogroup');
  for (const [k, q] of Object.entries(QUALITY_LEVELS)) {
    qGroup.append(item(h('button', { class: 'menu-opt', type: 'button', id: 'menu-q-' + k, 'data-id': k, onclick: () => { ctx.quality.set(k); save(); sync(); } },
      h('span', { class: 'menu-radio', 'aria-hidden': 'true' }),
      h('span', null, h('span', { class: 'menu-opt-t' }, k, h('small', { text: `${Math.round(q.renderScale * 100)}% · ${q.shadows ? 'shadows ' + q.shadowMapSize : 'no shadows'}` })),
        h('span', { class: 'menu-opt-d', text: QUALITY_NOTES[k] || '' }))), 'radio', k === ctx.quality.level));
  }
  const volRange = h('input', { class: 'menu-range menu-range-plain', type: 'range', id: 'menu-volume', min: '0', max: '100', step: '1', 'aria-label': 'Master volume' });
  const volRead = h('span', { class: 'menu-vol-read' });
  volRange.addEventListener('input', () => { sel.volume = +volRange.value / 100; ctx.audio?.setMasterVolume?.(sel.volume); volRead.textContent = volRange.value + '%'; });
  volRange.addEventListener('change', save);
  const hudBtn = h('button', { class: 'menu-annun', id: 'menu-hud', type: 'button', 'aria-label': 'HUD', onclick: () => ev.emit('cmd', { name: 'hudToggle' }) });
  const fsRowBtn = h('button', { class: 'menu-annun', id: 'menu-fs-setting', type: 'button', 'aria-label': 'Fullscreen', onclick: toggleFullscreen });
  const settingsBack = h('button', { class: 'menu-back', id: 'menu-settings-back', type: 'button', onclick: () => back() }, 'Back');
  const vSettings = h('section', { class: 'menu-view menu-dock menu-dock-r', 'data-view': 'settings' },
    h('div', { class: 'menu-panel', role: 'region', 'aria-label': 'Settings' },
      h('div', { class: 'menu-subhead' }, settingsBack, h('span', { class: 'menu-subtitle', text: 'Settings' })),
      h('div', { class: 'menu-scroll' },
        sec('01', 'Graphics quality', null, qGroup, h('p', { class: 'menu-note', text: 'Applies immediately. Resolution also scales down automatically to hold frame rate.' })),
        sec('02', 'Audio', null, h('div', { class: 'menu-field-l', style: 'margin-bottom:4px' }, h('span', { class: 'menu-field-t', text: 'Master volume' })), h('div', { class: 'menu-vol' }, volRange, volRead)),
        sec('03', 'Display', null,
          h('div', { class: 'menu-field' }, h('div', { class: 'menu-field-l' }, h('span', { class: 'menu-field-t', text: 'Head-up display' }), h('span', { class: 'menu-field-d', text: 'Flight symbology and instruments. Key: U' })), hudBtn),
          canFs ? h('div', { class: 'menu-field' }, h('div', { class: 'menu-field-l' }, h('span', { class: 'menu-field-t', text: 'Fullscreen' }), h('span', { class: 'menu-field-d', text: 'Hide the browser around the sim.' })), fsRowBtn) : null),
        sec('04', 'Units', null, h('div', { class: 'menu-fine', text: 'Airspeed kt · Mach  /  Altitude ft  /  Vertical speed ft/min  /  Heading ° true  /  Load factor G  /  Pressure hPa' })))));

  // ---- CONTROLS ---------------------------------------------------------------------------------
  const keysWrap = h('div', { class: 'menu-keys' });
  function renderKeys() {
    keysWrap.textContent = '';
    const src = Array.isArray(ctx.input?.bindings) && ctx.input.bindings.length ? ctx.input.bindings : DEFAULT_BINDINGS;
    const groupNames = [...BINDING_GROUPS, ...new Set(src.map(b => b.group).filter(g => g && !BINDING_GROUPS.includes(g)))];
    for (const g of groupNames) {
      const rows = src.filter(b => (b.group || 'Sim') === g);
      if (!rows.length) continue;
      keysWrap.append(h('div', { class: 'menu-keygroup' },
        h('div', { class: 'menu-h' }, h('span', { text: g })),
        rows.map(b => {
          const segs = bindingSegments(b);
          const k = segs ? h('span', { class: 'menu-keyrow-k' }, segs.map((alts, i) => [
            i ? h('span', { class: 'menu-kslash', text: '/' }) : null,
            alts.map((key, j) => [j ? h('span', { class: 'menu-kor', text: 'or' }) : null, h('kbd', { class: 'menu-kbd', text: key })]),
          ])) : h('span', { class: 'menu-keyrow-k menu-keytext', text: String(b.keys) });
          return h('div', { class: 'menu-keyrow' }, h('span', { class: 'menu-keyrow-a', text: b.action }), k);
        })));
    }
  }
  const controlsBack = h('button', { class: 'menu-back', id: 'menu-controls-back', type: 'button', onclick: () => back() }, 'Back');
  const vControls = h('section', { class: 'menu-view menu-dock menu-dock-r menu-dock-wide', 'data-view': 'controls' },
    h('div', { class: 'menu-panel', role: 'region', 'aria-label': 'Controls reference' },
      h('div', { class: 'menu-subhead' }, controlsBack, h('span', { class: 'menu-subtitle', text: 'Controls' })),
      h('div', { class: 'menu-scroll' }, keysWrap,
        h('div', { class: 'menu-devices' },
          h('div', { class: 'menu-device' }, h('b', { text: 'Mouse' }), 'M turns the mouse into a yoke. Right-drag looks around, wheel zooms.'),
          h('div', { class: 'menu-device' }, h('b', { text: 'Gamepad' }), 'Standard controllers connect automatically. Left stick flies, right stick looks.'),
          h('div', { class: 'menu-device' }, h('b', { text: 'Touch' }), 'On-screen stick and throttle appear on touch screens. MENU, top right, opens this menu.')))));

  // ---- PAUSE ----------------------------------------------------------------------------------------
  const pauseSub = h('div', { class: 'menu-pause-sub' });
  const condPause = conditions('menu-p-');
  const kbd = (t) => h('kbd', { class: 'menu-kbd', text: t });
  const resumeBtn = h('button', { class: 'menu-act menu-act-primary', id: 'menu-resume', type: 'button', onclick: () => close() }, 'Resume', kbd('Esc'));
  const vPause = h('section', { class: 'menu-view menu-dock menu-dock-l', 'data-view': 'pause' },
    h('div', { class: 'menu-panel', role: 'region', 'aria-label': 'Paused' },
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
    fsBtn('menu-fullscreen-fly'),
    h('button', { class: 'menu-iconbtn menu-fab', id: 'menu-fab', type: 'button', 'aria-label': 'Open menu', onclick: () => open() }, h('span', { class: 'menu-ico-menu', 'aria-hidden': 'true' }), 'Menu'));
  corner.hidden = true;
  // Corner buttons must not keep focus during flight, or Space (wheel brakes) / Enter would re-trigger them.
  corner.addEventListener('click', (e) => { const b = e.target.closest?.('button'); if (b) setTimeout(() => b.blur(), 0); });
  const crashReason = h('div', { class: 'menu-crash-r' });
  const crash = h('div', { class: 'menu-crash', role: 'alertdialog', 'aria-label': 'Flight ended', 'aria-modal': 'false' },
    h('div', { class: 'menu-crash-t', text: 'Flight ended' }), crashReason,
    h('div', { class: 'menu-crash-b' },
      h('button', { class: 'menu-btn menu-btn-primary', id: 'menu-crash-restart', type: 'button', onclick: () => { hideCrash(); ctx.session?.restart?.(); } }, 'Restart flight'),
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
    const m = syncConditions(condMain); syncConditions(condPause);
    stLcl.textContent = fmtClock(sel.tod);
    heroMetar.textContent = m;
  }
  function sync() {
    const d = def(), a = apt();
    setChecked(acList, it => it.dataset.id === sel.aircraft);
    setChecked(aptList, it => it.dataset.id === sel.airport);
    // aircraft details
    acName.textContent = d.name;
    acMeta.textContent = '';
    acMeta.append(h('b', { text: d.manufacturer || '' }), h('br'),
      [d.role, d.firstFlight ? 'First flight ' + d.firstFlight : null, d.service].filter(Boolean).join(' · '),
      ...(engineLine(d) ? [h('br'), engineLine(d)] : []));
    acLore.textContent = '';
    if (d.lore?.tagline) acLore.append(h('span', { class: 'menu-lore-tag', text: d.lore.tagline }), d.lore?.description ? ' ' : '');
    if (d.lore?.description) acLore.append(d.lore.description);
    acLore.hidden = !d.lore?.tagline && !d.lore?.description;
    acSpecs.textContent = '';
    for (const r of specRows(d)) acSpecs.append(h('div', { class: 'menu-spec' }, h('div', { class: 'menu-spec-k', text: r.k }), h('div', { class: 'menu-spec-v' }, r.v, r.u ? h('span', { class: 'menu-spec-u', text: r.u }) : null)));
    heroKicker.textContent = [d.manufacturer, d.firstFlight ? 'First flight ' + d.firstFlight : null].filter(Boolean).join('  ·  ');
    heroName.textContent = d.name;
    heroTag.textContent = d.lore?.tagline || d.role || '';
    heroTag.hidden = !heroTag.textContent;
    // airport + runways
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
    volRead.textContent = Math.round(sel.volume * 100) + '%';
    hudBtn.setAttribute('aria-pressed', String(hudOn)); hudBtn.textContent = hudOn ? 'ON' : 'OFF';
    const fs = !!document.fullscreenElement;
    fsRowBtn.setAttribute('aria-pressed', String(fs)); fsRowBtn.textContent = fs ? 'ON' : 'OFF';
    for (const b of document.querySelectorAll('.menu-fsbtn')) b.setAttribute('aria-pressed', String(fs));
    // pause
    syncPause();
    syncClock();
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
    view = v;
    for (const [k, el] of Object.entries(views)) el.hidden = k !== v;
    const flight = inFlight();
    tabBar.hidden = flight;
    for (const [k, t] of Object.entries(tabs)) { if ((k === 'hangar' ? 'main' : k) === v) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); }
    if (v === 'pause') syncPause();
    root.classList.remove('menu-anim'); void root.offsetWidth; root.classList.add('menu-anim');
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
    if (view === 'settings' || view === 'controls') { show(returnTo === 'pause' && inFlight() ? 'pause' : 'main'); sync(); focusView(); }
    else if (view === 'pause') close();
    // main: nothing to go back to (Esc is a no-op in the hangar)
  }

  function open(v) {
    if (!v) v = inFlight() ? 'pause' : 'main';
    if (v === 'main') { if (!inHangar || !ctx.session?.active) enterHangar(); returnTo = 'main'; }
    else if (v === 'settings' || v === 'controls') returnTo = inFlight() ? 'pause' : 'main';
    if (v === 'pause' && !inFlight()) v = 'main';
    if (inFlight()) setPaused(true);
    hideCrash();
    const was = menu.isOpen;
    menu.isOpen = true; root.hidden = false; corner.hidden = true;
    show(v); sync(); focusView();
    if (v === 'main') { reveal(acList.querySelector('[aria-selected="true"]')); reveal(aptList.querySelector('[aria-selected="true"]')); }
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
  function updateCorner() { corner.hidden = menu.isOpen || !ctx.session?.active; }
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
  ev.on('session:start', () => { hideCrash(); updateCorner(); syncLiveries(); });
  ev.on('session:end', () => { updateCorner(); });
  ev.on('time:change', (hr) => { if (Number.isFinite(hr)) { sel.tod = hr; if (menu.isOpen) syncClock(); } });
  ev.on('weather:change', ({ preset } = {}) => { if (preset && preset !== sel.weather) { sel.weather = preset; if (menu.isOpen) syncClock(); } });
  ev.on('quality:change', () => { if (menu.isOpen) sync(); });
  ev.on('ready', () => {
    const dbg = raw.menu;
    if (dbg === 'crash') { crashInfo = { reason: 'Debug: impact with terrain at 212 kt' }; showCrash(); return; }
    if (dbg && views[dbg]) { open(dbg); return; }
    if (!params.autostart) open('main');
    else updateCorner();
  });

  // ---- per-frame ---------------------------------------------------------------------------------
  const menu = {
    isOpen: false,
    open, close,
    get view() { return view; },
    get selection() { return { ...sel }; },
    update() {
      const rdt = ctx.time.realDt || 0;
      if (spawnTimer > 0) { spawnTimer -= rdt; if (spawnTimer <= 0 && inHangar) spawnHangar(); }
      if (crashTimer > 0) { crashTimer -= rdt; if (crashTimer <= 0) showCrash(); }
      if (inHangar) holdParked();
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
