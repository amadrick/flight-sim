// External-view overlay: a compact typographic flight-data strip docked at the bottom, with a small attitude ball and compass.
// Static parts (panel, labels, dividers) are cached in an offscreen layer; per frame only values are drawn.
import { KT, FT, FPM, RAD, DEG, clamp, num, F, strCache, rrect, makeLayer, wrap180, flash } from './common.js';
import { apLabel } from './fighter.js';

const C = { fg: '#e9eef3', dim: 'rgba(196,208,220,0.62)', faint: 'rgba(196,208,220,0.18)', green: '#6dfc9f', amber: '#ffb000', red: '#ff5a3c', cyan: '#4cc9f0',
  sky: '#2f78c4', ground: '#7a5530' };

export function createExternalOverlay(tok) {
  let layer = null, key = -1, L = null;
  const mono = tok.mono, disp = tok.display;
  C.amber = tok.accent; C.red = tok.warn; C.cyan = tok.ok;

  function layout(W, H, airliner) {
    const fsV = Math.round(clamp(Math.min(W * 0.022, H * 0.034), 15, 30));
    const fsL = Math.round(fsV * 0.5), fsS = Math.round(fsV * 0.56);
    const rowH = Math.round(fsV * 2.75);
    const cw = fsV * 0.6;
    const cells = [
      { id: 'att', w: rowH * 0.9 },
      { id: 'spd', label: 'IAS', unit: 'KT', w: cw * 3 + fsS * 1.6 + fsV * 0.6 },
      { id: 'alt', label: 'ALT', unit: 'FT', w: cw * 6 + fsS * 1.6 + fsV * 0.6 },
      { id: 'hdg', label: 'HDG', unit: '', w: cw * 4 + fsV * 0.8 },
      { id: 'vs', label: 'V/S', unit: 'FPM', w: cw * 6 + fsS * 2.2 + fsV * 0.4 },
      { id: 'thr', label: airliner ? 'N1' : 'THR', unit: airliner ? '%' : '%', w: (airliner ? cw * 4 : cw * 3) + fsS * 1.4 + fsV * 0.6 },
      { id: 'g', label: 'G', unit: '', w: cw * 3 + fsV * 0.5 },
      { id: 'cfg', label: 'CONFIG', unit: '', w: fsS * 0.6 * 17 },
      { id: 'cmp', w: rowH * 0.9 },
    ];
    const pad = Math.round(fsV * 0.55), gap = Math.round(fsV * 0.7);
    const maxW = W - 32;
    // greedy rows (phones get two or three rows)
    const rows = [[]]; let rw = pad * 2;
    for (const c of cells) {
      const need = c.w + (rows[rows.length - 1].length ? gap : 0);
      if (rw + need > maxW && rows[rows.length - 1].length) { rows.push([]); rw = pad * 2; }
      rows[rows.length - 1].push(c); rw += c.w + (rows[rows.length - 1].length > 1 ? gap : 0);
    }
    // stretch rows to equal width, centre the panel
    const rowWidths = rows.map(r => r.reduce((a, c) => a + c.w, 0) + gap * (r.length - 1) + pad * 2);
    const pw = Math.min(maxW, Math.max(...rowWidths));
    const ph = rows.length * rowH + (rows.length - 1) * Math.round(fsV * 0.25) + pad * 0.5;
    const px = Math.round((W - pw) / 2), py = Math.round(H - 16 - Math.max(8, H * 0.012) - ph);
    rows.forEach((r, ri) => {
      const used = r.reduce((a, c) => a + c.w, 0);
      const extra = (pw - pad * 2 - used - gap * (r.length - 1)) / Math.max(1, r.length);
      let x = px + pad;
      for (const c of r) { c.x = Math.round(x); c.y = Math.round(py + pad * 0.25 + ri * (rowH + fsV * 0.25)); c.w2 = c.w + extra; c.h = rowH; x += c.w + extra + gap; }
    });
    return { fsV, fsL, fsS, rowH, cells, px, py, pw, ph, cw, gap,
      fontV: `500 ${fsV}px ${mono}`, fontS: `500 ${fsS}px ${mono}`, fontL: `600 ${fsL}px ${disp}`, fontXS: `500 ${Math.round(fsS * 0.92)}px ${mono}`,
      byId: Object.fromEntries(cells.map(c => [c.id, c])) };
  }

  function buildLayer(W, H, dpr) {
    layer = layer || makeLayer(1, 1);
    const lw = Math.ceil((L.pw + 2) * dpr), lh = Math.ceil((L.ph + 2) * dpr);
    layer.width = lw; layer.height = lh;
    const g = layer.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, (-L.px + 1) * dpr, (-L.py + 1) * dpr);
    // panel: dark translucent glass, hairline border
    g.beginPath(); rrect(g, L.px, L.py, L.pw, L.ph, Math.round(L.fsV * 0.35));
    g.fillStyle = 'rgba(6,10,15,0.58)'; g.fill();
    g.strokeStyle = 'rgba(200,215,230,0.16)'; g.lineWidth = 1; g.stroke();
    g.textBaseline = 'alphabetic';
    for (const c of L.cells) {
      if (c.label) {
        g.font = L.fontL; g.fillStyle = C.dim; g.textAlign = 'left';
        try { g.letterSpacing = '0.14em'; } catch {}
        g.fillText(c.label, c.x, c.y + L.fsL * 1.25);
        try { g.letterSpacing = '0px'; } catch {}
      }
    }
    // hairline dividers between cells in a row
    g.strokeStyle = C.faint; g.beginPath();
    for (let i = 1; i < L.cells.length; i++) {
      const a = L.cells[i - 1], b = L.cells[i];
      if (a.y !== b.y) continue;
      const x = Math.round(b.x - L.gap / 2) + 0.5;
      g.moveTo(x, a.y + L.rowH * 0.18); g.lineTo(x, a.y + L.rowH * 0.86);
    }
    g.stroke();
    return layer;
  }

  function draw(g, E) {
    const { s, def, W, H, dpr, nav, t } = E;
    const airliner = def.hudType === 'airliner';
    const k = ((W * 8192 + H) * 8 + Math.round(dpr * 2)) * 2 + (airliner ? 1 : 0);
    if (k !== key || !layer) { key = k; L = layout(W, H, airliner); buildLayer(W, H, dpr); }
    g.drawImage(layer, L.px - 1, L.py - 1, layer.width / dpr, layer.height / dpr);
    const by = L.byId;
    const vY = (c) => c.y + L.fsL * 1.25 + L.fsV * 1.08;
    const subY = (c) => vY(c) + L.fsS * 1.35;
    g.textBaseline = 'alphabetic';
    // value + unit
    const val = (c, text, color = C.fg, unit = c.unit) => {
      g.font = L.fontV; g.fillStyle = color; g.textAlign = 'left'; g.fillText(text, c.x, vY(c));
      if (unit) { const w = text.length * L.cw; g.font = L.fontS; g.fillStyle = C.dim; g.fillText(unit, c.x + w + L.fsS * 0.35, vY(c)); }
    };
    const sub = (c, text, color = C.dim, dx = 0) => { g.font = L.fontXS; g.fillStyle = color; g.textAlign = 'left'; g.fillText(text, c.x + dx, subY(c)); };

    const kias = Math.max(0, num(s.ias) / KT);
    val(by.spd, F.int(kias), s.overspeed ? C.red : (s.stallWarning ? C.amber : C.fg));
    if (num(s.mach) >= 0.3) { sub(by.spd, 'M'); sub(by.spd, F.mach(Math.round(s.mach * 100)), C.fg, L.fsS * 1.0); }
    else { sub(by.spd, 'GS'); sub(by.spd, F.int(num(s.groundSpeed) / KT), C.fg, L.fsS * 1.6); }

    const altFt = num(s.altitude) / FT, aglFt = num(s.agl, 1e9) / FT;
    val(by.alt, F.comma(Math.round(altFt / 10) * 10));
    if (aglFt < 2500) { sub(by.alt, 'AGL'); sub(by.alt, F.comma(Math.max(0, Math.round(aglFt))), C.fg, L.fsS * 2.2); }

    const hdg = num(s.heading) * RAD;
    val(by.hdg, F.hdg(Math.round(hdg)), C.fg, '');
    if (nav.dest) { sub(by.hdg, nav.dest.id); sub(by.hdg, nav.distNM < 100 ? F.tenth(Math.round(nav.distNM * 10)) : F.int(nav.distNM), C.fg, L.fsS * 0.6 * 5); }

    const vs = num(s.verticalSpeed) / FPM;
    val(by.vs, F.signed(Math.round(vs / 10) * 10), Math.abs(vs) < 50 ? C.fg : C.fg);
    // vertical speed bar
    {
      const c = by.vs, x = c.x, y = subY(c) - L.fsS * 0.35, w = c.w2 * 0.85;
      g.fillStyle = C.faint; g.fillRect(x, Math.round(y), w, 2);
      const f = clamp(vs / 4000, -1, 1) * w / 2;
      g.fillStyle = vs < -2000 && aglFt < 2500 ? C.amber : C.fg;
      g.fillRect(Math.round(x + w / 2 + Math.min(0, f)), Math.round(y) - 1, Math.max(1, Math.round(Math.abs(f))), 4);
      g.fillRect(Math.round(x + w / 2), Math.round(y) - 3, 1, 8);
    }

    const en = s.engines || [];
    if (airliner) {
      const n1 = en.length ? en.reduce((a, e) => a + num(e.n1), 0) / en.length : 0;
      val(by.thr, F.tenth(Math.round(n1 * 1000)));
    } else {
      const ab = num(en[0]?.afterburner, 0), thr = num(s.throttle, 0);
      if (ab > 0.02 || thr > 0.905) val(by.thr, 'AB', C.amber, F.int(clamp(Math.ceil(ab * 5), 1, 5)));
      else val(by.thr, F.int(Math.round(clamp(thr / 0.9, 0, 1) * 100)));
    }
    {
      const c = by.thr, x = c.x, y = Math.round(subY(c) - L.fsS * 0.35), w = Math.round(c.w2 * 0.85);
      const thr = clamp(num(s.throttle, 0), 0, 1);
      g.fillStyle = C.faint; g.fillRect(x, y, w, 2);
      const mil = def.specs?.thrustMax > def.specs?.thrustDry * 1.05 ? 0.9 : 1;
      g.fillStyle = C.fg; g.fillRect(x, y - 1, Math.round(w * Math.min(thr, mil)), 4);
      if (thr > mil) { g.fillStyle = C.amber; g.fillRect(x + Math.round(w * mil), y - 1, Math.round(w * (thr - mil)), 4); }
      if (mil < 1) { g.fillStyle = C.dim; g.fillRect(x + Math.round(w * mil), y - 3, 1, 8); }
    }

    const gl = num(s.gLoad, 1);
    val(by.g, F.tenth(Math.round(gl * 10)), s.overG || gl > num(def.specs?.maxG, 9) ? C.red : C.fg);

    // configuration flags
    {
      const c = by.cfg; let x = c.x; const cw = L.fsS * 0.6;
      const y1 = vY(c) - L.fsV * 0.38, y2 = subY(c);
      g.font = L.fontS; g.textAlign = 'left';
      const flag = (txt, color, y) => { g.fillStyle = color; g.fillText(txt, x, y); x += (txt.length + 1.3) * cw; };
      const gear = num(s.surfaces?.gear, 1);
      flag(gear > 0.98 ? 'GEAR DN' : gear < 0.02 ? 'GEAR UP' : 'GEAR', gear > 0.98 ? C.green : gear < 0.02 ? C.dim : (flash(t, 0.6) ? C.amber : C.dim), y1);
      const fl = num(s.surfaces?.flaps, 0);
      flag(fl > 0.02 ? (airliner ? FLAPS_DET(+flapDetent(fl)) : FLAPS_PCT(Math.round(fl * 100))) : 'FLAPS UP', fl > 0.02 ? C.fg : C.dim, y1);
      x = c.x;
      let any = false;
      if (num(s.surfaces?.speedbrake, 0) > 0.05) { flag('SPD BRK', C.amber, y2); any = true; }
      if (s.parkingBrake) { flag('PARK', C.amber, y2); any = true; }
      else if (num(s.brakes, 0) > 0.1) { flag('BRK', C.amber, y2); any = true; }
      if (s.ap?.engaged) { flag(AP_STR(apLabel(s.ap)), C.cyan, y2); any = true; }
      else if (s.ap?.autothrottle) { flag('A/T', C.cyan, y2); any = true; }
      if (!any && s.onGround) flag('ON GROUND', C.dim, y2);
    }

    // attitude ball
    drawBall(g, by.att, s);
    drawCompass(g, by.cmp, hdg, nav, num(s.track) * RAD, num(s.groundSpeed) > 15);

    // warning chip above the panel
    let warn = '', wc = C.red;
    if (nav.gcas.pullUp) warn = 'PULL UP';
    else if (s.stalled || s.stallWarning) warn = 'STALL';
    else if (s.overspeed) warn = 'OVERSPEED';
    else if (s.overG) warn = 'OVER G';
    else if (nav.gcas.sinkRate) { warn = 'SINK RATE'; wc = C.amber; }
    else if (num(s.surfaces?.gear, 1) < 0.1 && !s.onGround && aglFt < 1000 && kias < 200 && num(s.verticalSpeed) < 0) { warn = 'GEAR'; wc = C.amber; }
    else if (s.fuelCapacity > 0 && s.fuel < s.fuelCapacity * 0.08) { warn = 'LOW FUEL'; wc = C.amber; }
    if (warn && flash(t, 0.7)) {
      g.font = L.fontV; g.textAlign = 'center'; g.textBaseline = 'middle';
      const w = warn.length * L.cw + L.fsV * 1.6, h = L.fsV * 1.7, x = Math.round(W / 2 - w / 2), y = Math.round(L.py - h - L.fsV * 0.5);
      g.fillStyle = 'rgba(8,10,14,0.72)'; g.beginPath(); rrect(g, x, y, w, h, 3); g.fill();
      g.strokeStyle = wc; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = wc; g.fillText(warn, W / 2, y + h / 2 + 1);
    }
  }

  function drawBall(g, c, s) {
    const r = Math.round(Math.min(c.w2, c.h) * 0.42), x = Math.round(c.x + c.w2 / 2), y = Math.round(c.y + c.h / 2);
    g.save();
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.clip();
    g.translate(x, y); g.rotate(-num(s.roll));
    const off = clamp(num(s.pitch) * RAD, -60, 60) * (r / 30);
    g.fillStyle = C.sky; g.fillRect(-r * 2, -r * 2, r * 4, r * 2 + off);
    g.fillStyle = C.ground; g.fillRect(-r * 2, off, r * 4, r * 2);
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(-r * 2, off); g.lineTo(r * 2, off);
    for (const p of [-20, -10, 10, 20]) { const yy = off - p * (r / 30), w = r * (Math.abs(p) === 10 ? 0.28 : 0.42); g.moveTo(-w, yy); g.lineTo(w, yy); }
    g.stroke();
    g.restore();
    g.strokeStyle = 'rgba(200,215,230,0.35)'; g.lineWidth = 1; g.beginPath(); g.arc(x, y, r + 0.5, 0, Math.PI * 2); g.stroke();
    // fixed aircraft symbol
    g.strokeStyle = C.amber; g.lineWidth = 2; g.beginPath();
    g.moveTo(x - r * 0.62, y); g.lineTo(x - r * 0.22, y); g.lineTo(x - r * 0.1, y + r * 0.12);
    g.moveTo(x + r * 0.62, y); g.lineTo(x + r * 0.22, y); g.lineTo(x + r * 0.1, y + r * 0.12);
    g.stroke(); g.fillStyle = C.amber; g.fillRect(x - 1, y - 1, 2, 2);
  }

  function drawCompass(g, c, hdg, nav, trk, showTrk) {
    const r = Math.round(Math.min(c.w2, c.h) * 0.4), x = Math.round(c.x + c.w2 / 2), y = Math.round(c.y + c.h / 2);
    g.strokeStyle = 'rgba(200,215,230,0.35)'; g.lineWidth = 1; g.beginPath(); g.arc(x, y, r + 0.5, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = C.dim; g.beginPath();
    for (let d = 0; d < 360; d += 30) {
      const a = (d - hdg) * DEG, l = d % 90 === 0 ? r * 0.28 : r * 0.14;
      g.moveTo(x + Math.sin(a) * r, y - Math.cos(a) * r); g.lineTo(x + Math.sin(a) * (r - l), y - Math.cos(a) * (r - l));
    }
    g.stroke();
    // N marker
    const an = -hdg * DEG;
    g.font = `700 ${Math.max(9, Math.round(r * 0.42))}px ${mono}`; g.fillStyle = C.fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('N', x + Math.sin(an) * r * 0.55, y - Math.cos(an) * r * 0.55);
    // destination bearing (magenta-ish cyan diamond on ring)
    if (nav.dest) {
      const a = (nav.bearing - hdg) * DEG, bx = x + Math.sin(a) * r, by = y - Math.cos(a) * r, k = Math.max(3, r * 0.16);
      g.fillStyle = '#ff6cf4'; g.beginPath(); g.moveTo(bx, by - k); g.lineTo(bx + k, by); g.lineTo(bx, by + k); g.lineTo(bx - k, by); g.closePath(); g.fill();
    }
    if (showTrk) {
      const a = wrap180(trk - hdg) * DEG;
      g.strokeStyle = C.green; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.sin(a) * r * 0.8, y - Math.cos(a) * r * 0.8); g.stroke();
    }
    // lubber line
    g.fillStyle = C.amber; g.beginPath(); g.moveTo(x, y - r + r * 0.32); g.lineTo(x - r * 0.12, y - r - 1); g.lineTo(x + r * 0.12, y - r - 1); g.closePath(); g.fill();
    g.textBaseline = 'alphabetic';
  }

  return { draw, invalidate() { key = -1; } };
}

const DET = [0, 1, 2, 5, 10, 15, 25, 30, 40];
const FLAPS_DET = strCache((k) => 'FLAPS ' + k), FLAPS_PCT = strCache((k) => 'FLAPS ' + k + '%');
const _ap = new Map();
const AP_STR = (l) => { let v = _ap.get(l); if (!v) { v = 'AP ' + l; _ap.set(l, v); } return v; };
export function flapDetent(v) { let b = 0; for (const d of DET) if (Math.abs(d / 40 - v) < Math.abs(b / 40 - v)) b = d; return F.int(b); }
