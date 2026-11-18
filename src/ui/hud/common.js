// Shared HUD helpers: units, colours, fonts, string caches (no per-frame string churn) and small path helpers.
export const KT = 0.514444;         // m/s per knot
export const FT = 0.3048;           // m per foot
export const NM = 1852;             // m per nautical mile
export const FPM = 0.00508;         // m/s per foot/minute
export const LB = 0.45359237;       // kg per lb
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const wrap360 = (d) => { d %= 360; return d < 0 ? d + 360 : d; };
export const wrap180 = (d) => { d = wrap360(d); return d > 180 ? d - 360 : d; };
export const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);

/** Design tokens from index.template.html (with fallbacks if the page lacks them, e.g. in a harness). */
export function readTokens() {
  const t = { hud: '#5dff9b', fg: '#e6edf3', fgDim: '#8fa1b3', accent: '#ffb000', warn: '#ff5a3c', ok: '#4cc9f0',
    bg: '#05080c', panel: '#0c1218', panel2: '#131c25', line: '#24323f',
    mono: "'B612 Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
    display: "'Saira Condensed', 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif",
    body: "'Saira', 'Segoe UI', system-ui, -apple-system, Arial, sans-serif" };
  try {
    const cs = getComputedStyle(document.documentElement);
    const g = (k) => cs.getPropertyValue(k).trim();
    t.hud = g('--hud') || t.hud; t.fg = g('--fg') || t.fg; t.fgDim = g('--fg-dim') || t.fgDim; t.accent = g('--accent') || t.accent;
    t.warn = g('--warn') || t.warn; t.ok = g('--ok') || t.ok; t.bg = g('--bg') || t.bg; t.panel = g('--panel') || t.panel;
    t.panel2 = g('--panel-2') || t.panel2; t.line = g('--line') || t.line;
    t.mono = g('--font-mono') || t.mono; t.display = g('--font-display') || t.display; t.body = g('--font-body') || t.body;
  } catch {}
  return t;
}

/** Memoised integer → string formatter: fmt(k) returns the same string object for the same integer key. */
export function strCache(fn, max = 4096) {
  const m = new Map();
  return (k) => {
    k = Math.round(k);
    let s = m.get(k);
    if (s === undefined) { if (m.size > max) m.clear(); s = fn(k); m.set(k, s); }
    return s;
  };
}

const pad = (n, w) => { let s = String(Math.abs(n)); while (s.length < w) s = '0' + s; return s; };
const commas = (n) => { const s = String(Math.abs(n)); return s.replace(/\B(?=(\d{3})+(?!\d))/g, ','); };

/** Shared, commonly needed formatters (all keyed by integers). */
export const F = {
  int: strCache((k) => String(k)),
  comma: strCache((k) => (k < 0 ? '-' : '') + commas(k), 8192),
  pad3: strCache((k) => pad(k, 3)),
  pad2: strCache((k) => pad(k, 2)),
  signed: strCache((k) => (k > 0 ? '+' : k < 0 ? '−' : '') + commas(k)),
  tenth: strCache((k) => (k < 0 ? '-' : '') + (Math.floor(Math.abs(k) / 10)) + '.' + (Math.abs(k) % 10)),          // k = value×10
  hundredth: strCache((k) => (k < 0 ? '-' : '') + Math.floor(Math.abs(k) / 100) + '.' + pad(Math.abs(k) % 100, 2)), // k = value×100
  mach: strCache((k) => (k >= 100 ? Math.floor(k / 100) : '') + '.' + pad(k % 100, 2)),                             // k = M×100, ".85" / "1.20"
  mmss: strCache((k) => { const m = Math.floor(k / 60), s = k % 60; return (m >= 60 ? Math.floor(m / 60) + ':' + pad(m % 60, 2) : m) + ':' + pad(s, 2); }),
  hdg: strCache((k) => { const v = ((k % 360) + 360) % 360; return pad(v === 0 ? 360 : v, 3) + '°'; }),
  deg3: strCache((k) => pad(((k % 360) + 360) % 360 === 0 ? 360 : ((k % 360) + 360) % 360, 3)),                     // 001..360
};

/** Rounded-rectangle path (manual, works where ctx.roundRect is missing). */
export function rrect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r);
  g.lineTo(x + w, y + h - r); g.arcTo(x + w, y + h, x + w - r, y + h, r);
  g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r);
  g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r); g.closePath();
}

/** Offscreen canvas factory (OffscreenCanvas where available). */
export function makeLayer(w, h) {
  w = Math.max(1, Math.ceil(w)); h = Math.max(1, Math.ceil(h));
  let c;
  if (typeof document !== 'undefined') { c = document.createElement('canvas'); c.width = w; c.height = h; }
  else c = new OffscreenCanvas(w, h);
  return c;
}

/** Flash phase helper: true during the "on" half of a period (real time). */
export const flash = (t, period = 0.8) => (t % period) < period * 0.62;
