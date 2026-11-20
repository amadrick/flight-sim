// Combat HUD — own-ship stores and damage panel (canvas inside a glass panel). Redrawn only when a shown value changes.
//   GUN   rounds bar + count           HEAT ◆◆◆◇   RDR ◆◇   (selected type bracketed in amber)
//   FLR   count                        HULL bar + %
//   caution chips: ENG FIRE · SMOKE · ENG OUT · BINGO · WINCHESTER · GUN LOW
import { F } from '../../ui/hud/common.js';

export function createStatus(cv, tok, specs) {
  const g = cv.getContext('2d');
  let W = 1, Hh = 1, dpr = 1, sizeKey = '', last = '';
  const max = { gun: 0, flares: 0, m: Object.create(null) };
  const C = { hud: tok.hud, fg: tok.fg, dim: 'rgba(214,226,238,0.6)', faint: 'rgba(214,226,238,0.16)', amber: tok.accent, red: tok.warn };
  const chips = [];

  function reset() { max.gun = 0; max.flares = 0; for (const k in max.m) delete max.m[k]; last = ''; }

  /** Height the panel needs for width w (CSS px). */
  function heightFor(w, nChips) {
    const fs = w < 170 ? 10 : 12, row = Math.round(fs * 1.75);
    return Math.round(row * 3 + 12 + (nChips ? row : 0));
  }

  function collectChips(p, out) {
    out.length = 0;
    const d = p.damage || {}, lo = p.loadout, s = p.state;
    if (d.fire > 0.05) out.push('ENG FIRE', C.red);
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

  /** Returns the panel height wanted (CSS px) so the caller can size the glass box. */
  function draw(p, w, d) {
    const lo = p?.loadout; if (!lo) return 0;
    const gun = lo.gun || {}, rounds = gun.rounds ?? 0;
    max.gun = Math.max(max.gun, gun.max || 0, rounds);
    max.flares = Math.max(max.flares, lo.flares || 0);
    for (const k in lo.missiles) max.m[k] = Math.max(max.m[k] || 0, lo.missiles[k] || 0);
    collectChips(p, chips);
    const hp = Math.max(0, Math.round(100 * (p.hp ?? 0) / (p.maxHp || 100)));
    // change key (strings built only when something changed would still allocate; numbers combined into one key)
    let k = rounds * 1e6 + (lo.flares || 0) * 1e3 + hp;
    let mk = 0; for (const t in lo.missiles) mk = mk * 13 + (lo.missiles[t] || 0);
    const key2 = mk * 97 + (lo.selected === 'radar' ? 1 : lo.selected === 'ir' ? 2 : 3) + chips.length * 7919 + (gun.firing ? 0.5 : 0);
    const h = heightFor(w, chips.length / 2);
    if (k === draw.k && key2 === draw.k2 && sizeKey === w + ':' + h + ':' + d && chipKey() === last) return h;
    draw.k = k; draw.k2 = key2; last = chipKey();
    if (sizeKey !== w + ':' + h + ':' + d) { sizeKey = w + ':' + h + ':' + d; W = w; Hh = h; dpr = d; cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, Hh);
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
      g.font = fL; const lw = short.length * fs * 0.52;
      if (sel) { g.strokeStyle = C.amber; g.lineWidth = 1.2; g.strokeRect(Math.round(x - 4) + 0.5, Math.round(y - row * 0.42) + 0.5, Math.round(lw + 8 + m * fs * 0.78), Math.round(row * 0.84)); }
      label(short, x, sel ? C.amber : C.dim);
      x += lw + 5;
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
    const hbX = hx + fs * 3.0, hbW = Math.max(16, valX - hbX - fs * 2.6);
    bar(hbX, hbW, hp / 100, hp < 30 ? C.red : hp < 60 ? C.amber : C.hud);
    g.font = fV; g.textAlign = 'right'; g.fillStyle = hp < 30 ? C.red : C.fg; g.fillText(F.int(hp), valX, y + 0.5);
    // chips
    if (chips.length) {
      y += row; x = padX;
      g.font = `700 ${fs - 1}px ${tok.display}`;
      for (let i = 0; i < chips.length; i += 2) {
        const txt = chips[i], col = chips[i + 1], cw = txt.length * (fs - 1) * 0.56 + 10;
        if (x + cw > W - padX + 2) break;
        g.strokeStyle = col; g.lineWidth = 1.2; g.strokeRect(Math.round(x) + 0.5, Math.round(y - row * 0.38) + 0.5, Math.round(cw), Math.round(row * 0.76));
        g.fillStyle = col; g.textAlign = 'center'; g.fillText(txt, x + cw / 2, y + 0.5);
        x += cw + 6;
      }
    }
    return h;
  }
  function chipKey() { let s = 0; for (let i = 0; i < chips.length; i += 2) s = s * 31 + chips[i].length + chips[i].charCodeAt(0); return s; }

  return { draw, reset, heightFor };
}
