// Combat HUD — own-ship stores and damage panel (canvas inside a glass panel). Redrawn only when a shown value changes.
//   GUN   rounds bar + count           HEAT ◆◆◆◇   RDR ◆◇   (selected type bracketed in amber)
//   FLR   count                        HULL bar + %
//   caution chips: ENG FIRE · SMOKE · ENG OUT · BINGO · WINCHESTER · GUN LOW
import { F } from '../../ui/hud/common.js';

const PART_KEYS = ['fuselage', 'cockpit', 'wingL', 'wingR', 'tail'];
const WING_L = [17, 16, 2, 26, 2, 29, 17, 26], WING_R = [23, 16, 38, 26, 38, 29, 23, 26], TAIL = [17, 31, 10, 36, 10, 38, 30, 38, 30, 36, 23, 31];

export function createStatus(cv, tok, specs, assistInfo) {
  const g = cv.getContext('2d');
  let W = 1, Hh = 1, dpr = 1, sizeKey = false, last = '';
  const max = { gun: 0, flares: 0, m: Object.create(null) };
  const C = { hud: tok.hud, fg: tok.fg, dim: 'rgba(214,226,238,0.6)', faint: 'rgba(214,226,238,0.16)', amber: tok.accent, red: tok.warn };
  const chips = [];

  function reset() { max.gun = 0; max.flares = 0; for (const k in max.m) delete max.m[k]; last = ''; }

  /** Height the panel needs for width w (CSS px). */
  function heightFor(w, nChips, diag) {
    const fs = w < 170 ? 10 : 12, row = Math.round(fs * 1.75);
    const extra = diag ? Math.max(Math.round(row * 2.1), nChips ? row * Math.ceil(nChips / (w < 170 ? 1 : 2)) : 0) : nChips ? row : 0;
    return Math.round(row * 3 + 12 + extra);
  }
  /** worst part damage (0..1) and a quantised key of all parts */
  function partsInfo(P) {
    let worst = 0, key = 0;
    if (!P) return 0;
    for (const k of PART_KEYS) { const v = P[k] || 0; if (v > worst) worst = v; key = key * 5 + Math.min(4, Math.floor(v * 4.99)); }
    const E = P.engines; if (E) for (let i = 0; i < E.length; i++) { const v = E[i] || 0; if (v > worst) worst = v; key = key * 5 + Math.min(4, Math.floor(v * 4.99)); }
    partsInfo.key = key;
    return worst;
  }
  const partCol = (v) => (v < 0.05 ? null : v < 0.4 ? C.amber : v < 0.8 ? '#ff7a3c' : C.red);
  function drawDiagram(P, x, y, sz) {
    const u = sz / 40;
    const shape = (col, fill, path) => {
      g.beginPath(); path();
      if (col) { g.globalAlpha = 0.85; g.fillStyle = col; g.fill(); g.globalAlpha = 1; }
      g.strokeStyle = col || C.dim; g.lineWidth = 1; g.stroke();
    };
    const R = (x0, y0, x1, y1) => () => g.rect(x + x0 * u, y + y0 * u, (x1 - x0) * u, (y1 - y0) * u);
    const Poly = (pts) => () => { g.moveTo(x + pts[0] * u, y + pts[1] * u); for (let i = 2; i < pts.length; i += 2) g.lineTo(x + pts[i] * u, y + pts[i + 1] * u); g.closePath(); };
    shape(partCol(P.wingL || 0), true, Poly(WING_L));
    shape(partCol(P.wingR || 0), true, Poly(WING_R));
    shape(partCol(P.tail || 0), true, Poly(TAIL));
    shape(partCol(P.fuselage || 0), true, R(17, 3, 23, 34));
    shape(partCol(P.cockpit || 0), true, R(18, 7, 22, 14));
    const E = P.engines || [];
    if (E.length >= 2) { shape(partCol(E[0] || 0), true, R(14, 30, 18, 39)); shape(partCol(E[1] || 0), true, R(22, 30, 26, 39)); }
    else shape(partCol(E[0] || 0), true, R(18, 33, 22, 39));
  }

  function collectChips(p, out) {
    out.length = 0;
    const d = p.damage || {}, lo = p.loadout, s = p.state;
    const ai = assistInfo?.();
    if (ai?.active && ai.autoThrottle) out.push('A/THR', tok.ok);
    if (d.fire > 0.05) out.push('FIRE', C.red);
    if (d.leak > 0.05) out.push('FUEL LEAK', C.amber);
    if (Array.isArray(d.engineOut) ? d.engineOut.some(Boolean) : d.engineOut) out.push('ENG OUT', C.red);
    else if (d.smoke > 0.05) out.push('SMOKE', C.amber);
    if (s && s.fuelCapacity > 0 && s.fuel < s.fuelCapacity * 0.18) out.push(s.fuel < s.fuelCapacity * 0.08 ? 'FUEL LOW' : 'BINGO', C.amber);
    if (lo) {
      let mis = 0; for (const k in lo.missiles) mis += lo.missiles[k] || 0;
      const rounds = lo.gun?.rounds ?? 0;
      if (mis === 0 && rounds === 0) out.push('WINCHESTER', C.red);
      else if (mis === 0) out.push('NO MSL', C.amber);
      else if (rounds > 0 && max.gun > 0 && rounds < max.gun * 0.15) out.push('GUN LOW', C.amber);
      else if (rounds === 0) out.push('GUN EMPTY', C.amber);
    }
    return out;
  }

  /** the dock shows the counts on its buttons: keep only the warnings it cannot show (empty gun / no missiles stay) */
  function dropStoresChips(c) {
    for (let i = c.length - 2; i >= 0; i -= 2) if (c[i] === 'GUN LOW') c.splice(i, 2);
  }
  /** Returns the panel height wanted (CSS px) so the caller can size the glass box. */
  function draw(p, w, d, compact) {
    const lo = p?.loadout; if (!lo) return 0;
    const gun = lo.gun || {}, rounds = gun.rounds ?? 0;
    max.gun = Math.max(max.gun, gun.max || 0, rounds);
    max.flares = Math.max(max.flares, lo.flaresMax || 0, lo.flares || 0);
    for (const k in lo.missiles) max.m[k] = Math.max(max.m[k] || 0, lo.missilesMax?.[k] || 0, lo.missiles[k] || 0);
    collectChips(p, chips);
    const worst = partsInfo(p.damage?.parts), diag = worst >= 0.05;
    const hp = Math.max(0, Math.round(100 * (p.hp ?? 0) / (p.maxHp || 100)));
    // change key (strings built only when something changed would still allocate; numbers combined into one key)
    let k = rounds * 1e6 + (lo.flares || 0) * 1e3 + hp;
    let mk = 0; for (const t in lo.missiles) mk = mk * 13 + (lo.missiles[t] || 0);
    const key2 = (diag ? partsInfo.key * 1e4 : 0) + mk * 97 + (lo.selected === 'radar' ? 1 : lo.selected === 'ir' ? 2 : 3) + chips.length * 7919 + (gun.firing ? 0.5 : 0) + (compact ? 0.25 * compact : 0);
    if (compact && worst >= 0.4) chips.push('DAMAGE', C.red);
    if (compact === 2) dropStoresChips(chips);
    const crow = 22;
    const h = compact === 2 ? hullHeight(w, crow) : compact ? crow + 6 + (chips.length ? crow - 2 : 0) : heightFor(w, chips.length / 2, diag);
    const same = w === W && h === Hh && d === dpr && sizeKey;
    if (k === draw.k && key2 === draw.k2 && same && chipKey() === last) return h;
    draw.k = k; draw.k2 = key2; last = chipKey();
    if (!same) { sizeKey = true; W = w; Hh = h; dpr = d; cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, Hh);
    if (compact === 2) { drawHull(hp, crow); return h; }
    if (compact) { drawCompact(lo, rounds, hp, crow); return h; }
    const fs = w < 170 ? 10 : 12, row = Math.round(fs * 1.75), padX = w < 170 ? 10 : 13;
    const fL = `600 ${fs}px ${tok.display}`, fV = `600 ${fs + 1}px ${tok.mono}`;
    g.textBaseline = 'middle';
    let y = 6 + row / 2;
    const label = (txt, x, col = C.dim) => { g.font = fL; g.fillStyle = col; g.textAlign = 'left'; g.fillText(txt, x, y + 0.5); };
    const bar = (x, bw, f, col) => {
      g.fillStyle = C.faint; g.fillRect(x, Math.round(y - 2), bw, 4);
      g.fillStyle = col; g.fillRect(x, Math.round(y - 2), Math.round(bw * Math.max(0, Math.min(1, f))), 4);
    };
    // GUN
    label('GUN', padX);
    const valX = W - padX, barX = padX + fs * 2.7, barW = Math.max(20, valX - barX - fs * 2.9);
    const gf = max.gun ? rounds / max.gun : 0;
    bar(barX, barW, gf, rounds === 0 ? C.red : gf < 0.15 ? C.amber : gun.firing ? C.fg : C.hud);
    g.font = fV; g.textAlign = 'right'; g.fillStyle = rounds === 0 ? C.red : C.fg; g.fillText(F.int(rounds), valX, y + 0.5);
    // missiles
    y += row;
    let x = padX;
    for (const t in lo.missiles) {
      const n = lo.missiles[t] || 0, m = max.m[t] || n, sel = lo.selected === t;
      const short = specs?.missiles?.[t]?.short || t.toUpperCase();
      g.font = fL; const lw = short.length * fs * 0.6;
      if (sel) { g.strokeStyle = C.amber; g.lineWidth = 1.2; g.strokeRect(Math.round(x - 4) + 0.5, Math.round(y - row * 0.42) + 0.5, Math.round(lw + 8 + m * fs * 0.78), Math.round(row * 0.84)); }
      label(short, x, sel ? C.amber : C.dim);
      x += lw + 8;
      const r = fs * 0.3;
      for (let i = 0; i < m; i++) {
        const cx = x + r + i * fs * 0.78;
        g.beginPath(); g.moveTo(cx, y - r * 1.3); g.lineTo(cx + r, y); g.lineTo(cx, y + r * 1.3); g.lineTo(cx - r, y); g.closePath();
        if (i < n) { g.fillStyle = sel ? C.fg : C.dim; g.fill(); } else { g.strokeStyle = C.faint; g.lineWidth = 1; g.stroke(); }
      }
      x += m * fs * 0.78 + fs * 1.1;
    }
    // flares + hull
    y += row;
    label('FLR', padX);
    const fl = lo.flares || 0;
    g.font = fV; g.textAlign = 'left'; g.fillStyle = fl === 0 ? C.red : fl < 6 ? C.amber : C.fg; g.fillText(F.int(fl), padX + fs * 2.4, y + 0.5);
    const hx = padX + fs * 5.4;
    label('HULL', hx);
    const hbX = hx + fs * 3.0, hbW = valX - hbX - fs * 2.6;
    if (hbW >= 16) bar(hbX, hbW, hp / 100, hp < 30 ? C.red : hp < 60 ? C.amber : C.hud);
    g.font = fV; g.textAlign = 'right'; g.fillStyle = hp < 30 ? C.red : C.fg; g.fillText(F.int(hp), valX, y + 0.5);
    // damage diagram + chips
    if (diag) {
      const sz = Math.round(row * 2);
      drawDiagram(p.damage.parts, padX, y + row * 0.55, sz);
    }
    if (chips.length) {
      y += row; x = diag ? padX + Math.round(row * 2) + 8 : padX;
      const x0 = x;
      g.font = `700 ${fs - 1}px ${tok.display}`;
      for (let i = 0; i < chips.length; i += 2) {
        const txt = chips[i], col = chips[i + 1], cw = txt.length * (fs - 1) * 0.56 + 10;
        if (x + cw > W - padX + 2) { if (diag && x > x0) { x = x0; y += row; } else break; }
        g.strokeStyle = col; g.lineWidth = 1.2; g.strokeRect(Math.round(x) + 0.5, Math.round(y - row * 0.38) + 0.5, Math.round(cw), Math.round(row * 0.76));
        g.fillStyle = col; g.textAlign = 'center'; g.fillText(txt, x + cw / 2, y + 0.5);
        x += cw + 6;
      }
    }
    return h;
  }
  /** one line: GUN n · SRM n · MRM n · FLR n · HULL n%, warning chips on a second line */
  function drawCompact(lo, rounds, hp, row) {
    const fs = 11, fL = `600 ${fs}px ${tok.display}`, fV = `700 ${fs + 1}px ${tok.mono}`;
    let x = 10, y = 3 + row / 2;
    g.textBaseline = 'middle'; g.textAlign = 'left';
    const item = (lab, val, colL, colV) => {
      g.font = fL; g.fillStyle = colL; g.fillText(lab, x, y + 0.5); x += lab.length * fs * 0.58 + 4;
      g.font = fV; g.fillStyle = colV; g.fillText(val, x, y + 0.5); x += val.length * (fs + 1) * 0.62 + 11;
    };
    item('GUN', F.int(rounds), C.dim, rounds === 0 ? C.red : max.gun && rounds < max.gun * 0.15 ? C.amber : C.fg);
    for (const t in lo.missiles) {
      const sel = lo.selected === t, n = lo.missiles[t] || 0;
      item(specs?.missiles?.[t]?.short || t.toUpperCase(), F.int(n), sel ? C.amber : C.dim, n ? (sel ? C.fg : C.dim) : C.red);
    }
    const fl = lo.flares || 0;
    item('FLR', F.int(fl), C.dim, fl === 0 ? C.red : fl < 6 ? C.amber : C.fg);
    if (x + 60 < W) item('HULL', F.int(hp), C.dim, hp < 30 ? C.red : hp < 60 ? C.amber : C.hud);
    if (chips.length) {
      y += row - 2; x = 10;
      g.font = `700 ${fs - 1}px ${tok.display}`;
      for (let i = 0; i < chips.length; i += 2) {
        const txt = chips[i], col = chips[i + 1], cw = txt.length * (fs - 1) * 0.56 + 10;
        if (x + cw > W - 8) break;
        g.strokeStyle = col; g.lineWidth = 1.2; g.strokeRect(Math.round(x) + 0.5, Math.round(y - 8) + 0.5, Math.round(cw), 16);
        g.fillStyle = col; g.textAlign = 'center'; g.fillText(txt, x + cw / 2, y + 0.5); g.textAlign = 'left';
        x += cw + 6;
      }
    }
  }
  // touch layout: the dock's buttons carry rounds / missiles / flares, so only HULL and the warning chips remain
  const HF = 11, HULL_W = 10 + HF * 0.58 * 4 + 6 + 40 + 6 + HF * 0.62 * 3 + 12;
  const chipW = (txt) => txt.length * (HF - 1) * 0.56 + 10;
  function hullHeight(w, row) {
    let x = HULL_W, lines = 1;
    for (let i = 0; i < chips.length; i += 2) {
      const cw = chipW(chips[i]);
      if (x + cw > w - 8) { if (lines === 2) break; lines = 2; x = 10; }
      x += cw + 6;
    }
    return lines === 1 ? row + 4 : row * 2 + 2;
  }
  function drawHull(hp, row) {
    const fL = `600 ${HF}px ${tok.display}`, fV = `700 ${HF + 1}px ${tok.mono}`;
    let x = 10, y = 2 + row / 2;
    const col = hp < 30 ? C.red : hp < 60 ? C.amber : C.hud;
    g.textBaseline = 'middle'; g.textAlign = 'left';
    g.font = fL; g.fillStyle = C.dim; g.fillText('HULL', x, y + 0.5); x += HF * 0.58 * 4 + 6;
    g.fillStyle = C.faint; g.fillRect(x, Math.round(y - 2), 40, 4);
    g.fillStyle = col; g.fillRect(x, Math.round(y - 2), Math.round(40 * Math.max(0, Math.min(1, hp / 100))), 4);
    x += 46;
    g.font = fV; g.fillStyle = hp < 30 ? C.red : C.fg; g.fillText(F.int(hp), x, y + 0.5);
    x = HULL_W;
    g.font = `700 ${HF - 1}px ${tok.display}`;
    let lines = 1;
    for (let i = 0; i < chips.length; i += 2) {
      const txt = chips[i], c = chips[i + 1], cw = chipW(txt);
      if (x + cw > W - 8) { if (lines === 2) break; lines = 2; x = 10; y += row - 2; }
      g.strokeStyle = c; g.lineWidth = 1.2; g.strokeRect(Math.round(x) + 0.5, Math.round(y - 8) + 0.5, Math.round(cw), 16);
      g.fillStyle = c; g.textAlign = 'center'; g.fillText(txt, x + cw / 2, y + 0.5); g.textAlign = 'left';
      x += cw + 6;
    }
  }
  function chipKey() { let s = 0; for (let i = 0; i < chips.length; i += 2) s = s * 31 + chips[i].length + chips[i].charCodeAt(0); return s; }

  return { draw, reset, heightFor };
}
