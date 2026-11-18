// Static menu data + pure formatting helpers (no DOM). Unit-tested in data.test.js.
import { KTS, FT, LBF, LB, NM } from '../../core/constants.js';

/** ARCHITECTURE §10 default controls, grouped. `keys`: segments separated by '/', alternatives by '|'.
 *  `text: true` → render the keys string as prose (mouse gestures), not key-caps. */
export const DEFAULT_BINDINGS = [
  { group: 'Flight', action: 'Pitch (nose up / down)', keys: 'S|↓ / W|↑' },
  { group: 'Flight', action: 'Roll left / right', keys: 'A|← / D|→' },
  { group: 'Flight', action: 'Rudder left / right', keys: 'Q / E' },
  { group: 'Flight', action: 'Pitch trim nose down / up', keys: ', / .' },
  { group: 'Flight', action: 'Mouse yoke on/off', keys: 'M' },
  { group: 'Engine', action: 'Throttle up / down', keys: 'R|=|PageUp / F|-|PageDown' },
  { group: 'Engine', action: 'Throttle idle / MIL / max', keys: '1 / 9 / 0' },
  { group: 'Engine', action: 'Engines start / stop', keys: 'I' },
  { group: 'Systems', action: 'Landing gear', keys: 'G' },
  { group: 'Systems', action: 'Flaps retract / extend one notch', keys: '[ / ]' },
  { group: 'Systems', action: 'Speedbrake / spoilers', keys: 'B' },
  { group: 'Systems', action: 'Wheel brakes (hold)', keys: 'Space' },
  { group: 'Systems', action: 'Parking brake', keys: 'K' },
  { group: 'Systems', action: 'Autopilot (hold altitude + heading)', keys: 'T' },
  { group: 'Systems', action: 'Arrestor hook', keys: 'H' },
  { group: 'Systems', action: 'Lights (landing)', keys: 'L' },
  { group: 'Camera', action: 'Camera next / previous', keys: 'C / Shift+C' },
  { group: 'Camera', action: 'Camera look', keys: 'right-drag or gamepad right stick; wheel = zoom', text: true },
  { group: 'Sim', action: 'HUD on/off', keys: 'U' },
  { group: 'Sim', action: 'Pause', keys: 'P' },
  { group: 'Sim', action: 'Menu', keys: 'Esc' },
  { group: 'Sim', action: 'Restart flight', keys: 'Backspace' },
];
export const BINDING_GROUPS = ['Flight', 'Engine', 'Systems', 'Camera', 'Sim'];

/** Parse a DEFAULT_BINDINGS keys string into [[alt, alt], [alt]] (segments of alternatives).
 *  A lone '/' key cannot occur in the table, so ' / ' is the segment separator. */
export function parseKeys(s) {
  return s.split(' / ').map(seg => seg.split('|'));
}

/** Normalise a binding from ctx.input.bindings ({ keys:[…], action, group }) into segments. */
export function bindingSegments(b) {
  if (typeof b.keys === 'string') return b.text ? null : parseKeys(b.keys);
  if (Array.isArray(b.keys)) return [b.keys.map(k => prettyKey(String(k)))];
  return [];
}

const KEY_NAMES = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', ' ': 'Space', Space: 'Space',
  BracketLeft: '[', BracketRight: ']', Comma: ',', Period: '.', Equal: '=', Minus: '-', Backspace: 'Backspace',
  PageUp: 'PageUp', PageDown: 'PageDown', ShiftLeft: 'Shift', ShiftRight: 'Shift',
};
/** 'KeyG' → 'G', 'Digit1' → '1', 'ArrowUp' → '↑'; anything else passes through. */
export function prettyKey(k) {
  if (KEY_NAMES[k]) return KEY_NAMES[k];
  let m = /^Key([A-Z])$/.exec(k); if (m) return m[1];
  m = /^Digit(\d)$/.exec(k); if (m) return m[1];
  return k;
}

export const TOD_PRESETS = [
  { id: 'dawn', label: 'Dawn', h: 5.1 },
  { id: 'morning', label: 'Morning', h: 8.5 },
  { id: 'noon', label: 'Noon', h: 12.5 },
  { id: 'golden', label: 'Golden hour', h: 18.3 },
  { id: 'dusk', label: 'Dusk', h: 19.4 },
  { id: 'night', label: 'Night', h: 23 },
];

export const START_MODES = [
  { id: 'runway', label: 'On the runway', short: 'Runway', note: 'Lined up, engines running, brakes set.' },
  { id: 'air', label: 'In flight', short: 'In flight', note: '1,500 m above the field, cruise power.' },
  { id: 'approach', label: 'On final approach', short: 'Final', note: '4.9 NM out on a 3° glide path, gear down.' },
];

export const QUALITY_NOTES = {
  low: 'Integrated graphics. 60% resolution, no shadows or bloom, light clouds.',
  medium: 'Laptops and older GPUs. 80% resolution, shadows, bloom and TAA.',
  high: 'Recommended. Full resolution, 2K shadows, full terrain and ocean detail.',
  ultra: 'High-end GPUs. 4K shadows, densest clouds and terrain.',
};

export const CATEGORY_CODE = { fighter: 'FTR', attack: 'ATK', bomber: 'BMR', recon: 'RCN', transport: 'TPT', airliner: 'PAX' };
export const isCommercial = (def) => def.category === 'airliner';

// ---- number formatting ------------------------------------------------------------------
export const group3 = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
export const toKt = (ms) => ms / KTS;
export const toFt = (m) => m / FT;
export const toLbf = (n) => n / LBF;
export const toLb = (kg) => kg / LB;
export const roundTo = (v, step) => Math.round(v / step) * step;

/** "05:30" from hours. */
export function fmtClock(h) {
  h = ((h % 24) + 24) % 24;
  let hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  if (mm === 60) { mm = 0; hh = (hh + 1) % 24; }
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

/** Spec sheet rows in pilot units: [{ k, v, u? }]. Missing specs are skipped. */
export function specRows(def) {
  const s = def.specs || {}, g = def.geometry || {}, rows = [];
  const n = s.engineCount || 1;
  if (s.maxMach) rows.push({ k: 'Max speed', v: 'M ' + s.maxMach.toFixed(2), u: s.maxSpeedSeaLevel ? group3(roundTo(toKt(s.maxSpeedSeaLevel), 5)) + ' kt SL' : '' });
  if (s.cruiseSpeed) rows.push({ k: 'Cruise', v: group3(roundTo(toKt(s.cruiseSpeed), 5)), u: 'kt' });
  if (s.serviceCeiling) rows.push({ k: 'Ceiling', v: group3(roundTo(toFt(s.serviceCeiling), 100)), u: 'ft' });
  if (s.climbRate) rows.push({ k: 'Climb', v: group3(roundTo(toFt(s.climbRate) * 60, 100)), u: 'ft/min' });
  if (s.thrustMax) {
    const wet = s.thrustDry && s.thrustMax > s.thrustDry * 1.05;
    rows.push({ k: wet ? 'Thrust A/B' : 'Thrust', v: (n > 1 ? n + '×' : '') + group3(roundTo(toLbf(s.thrustMax), 10)), u: 'lbf' });
    if (wet) rows.push({ k: 'Thrust MIL', v: (n > 1 ? n + '×' : '') + group3(roundTo(toLbf(s.thrustDry), 10)), u: 'lbf' });
  }
  if (s.maxTakeoffMass) rows.push({ k: 'MTOW', v: group3(roundTo(toLb(s.maxTakeoffMass), 100)), u: 'lb' });
  if (s.stallSpeed) rows.push({ k: 'Stall', v: group3(toKt(s.stallSpeed)), u: 'kt' });
  if (s.approachSpeed) rows.push({ k: 'Approach', v: group3(toKt(s.approachSpeed)), u: 'kt' });
  if (s.maxG) rows.push({ k: 'G limits', v: '+' + s.maxG + ' / ' + (s.minG ?? 0), u: 'G' });
  if (g.span && g.length) rows.push({ k: 'Span × length', v: toFt(g.span).toFixed(0) + ' × ' + toFt(g.length).toFixed(0), u: 'ft' });
  return rows;
}

/** One-line power plant description: "1 × GE F110-GE-129". */
export function engineLine(def) {
  const s = def.specs || {};
  if (!s.engineName) return '';
  return (s.engineCount || 1) + ' × ' + s.engineName;
}

/** Plausible METAR for the chosen conditions (fictional station data; deterministic). */
export function metar(airport, preset, tod) {
  const p = preset || {};
  const day = 21;
  const hhmm = fmtClock(tod).replace(':', '');
  const dir = String(roundTo(p.windFrom ?? 0, 10) % 360 || 360).padStart(3, '0');
  const spd = Math.round(toKt(p.windSpeed ?? 0));
  const wind = spd < 1 ? '00000KT' : dir + String(spd).padStart(2, '0') + (p.turbulence > 0.5 ? 'G' + String(Math.round(spd * 1.6)).padStart(2, '0') : '') + 'KT';
  const vis = (p.visibility ?? 10000) >= 10000 ? '9999' : String(roundTo(p.visibility, 100)).padStart(4, '0');
  const wx = p.lightning ? ' +TSRA' : p.precipitation > 0.6 ? ' RA' : p.precipitation > 0.05 ? ' -RA' : '';
  const cov = p.cloudCoverage ?? 0;
  const base = String(Math.max(1, Math.round(toFt(p.cloudBase ?? 1500) / 100))).padStart(3, '0');
  let clouds;
  if (cov < 0.05) clouds = (p.cirrus > 0.1 ? 'FEW' + '250' : 'SKC');
  else clouds = (cov < 0.3 ? 'FEW' : cov < 0.55 ? 'SCT' : cov < 0.85 ? 'BKN' : 'OVC') + base + (p.lightning ? 'CB' : '');
  if (vis === '9999' && cov < 0.05 && !p.cirrus) clouds = 'CAVOK';
  const elevFt = toFt(airport?.elevation ?? 0);
  const diurnal = Math.cos(((tod - 15) / 24) * Math.PI * 2);   // warmest mid-afternoon
  const t = Math.round(22 - elevFt * 0.002 + diurnal * 6 - cov * 3 - (p.precipitation || 0) * 4);
  const dp = Math.round(t - (p.precipitation > 0.05 ? 1 : 6 + (1 - cov) * 4));
  const tt = (v) => (v < 0 ? 'M' : '') + String(Math.abs(v)).padStart(2, '0');
  const q = Math.round(1015 - (p.precipitation || 0) * 9 - (p.lightning ? 4 : 0));
  return `${airport?.id ?? 'ZZZZ'} ${day}${hhmm}Z ${wind} ${vis}${wx} ${clouds} ${tt(t)}/${tt(dp)} Q${q}`;
}

/** ATC-flavoured summary of the departure for the FLY block. */
export function clearanceLine(airport, rwyName, start, def) {
  if (start === 'air') return `${airport.id} · Airborne ${group3(roundTo(toFt(airport.elevation + 1500), 100))} ft · Hdg runway ${rwyName}`;
  if (start === 'approach') return `${airport.id} · Final RWY ${rwyName} · ${(9000 / NM).toFixed(1)} NM · ${Math.round(toKt((def?.specs?.approachSpeed ?? 70) * 1.08))} kt`;
  return `${airport.id} · RWY ${rwyName} · Line up and wait`;
}
