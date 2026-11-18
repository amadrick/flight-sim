// F-16-style conformal head-up display. Everything angular is projected through the real camera (see projection.js),
// so the horizon, pitch ladder, flight-path marker, steerpoint diamond and AoA bracket register with the outside world.
// Fixed symbology (tapes, readouts) lives in the HUD's own frame, which is attached to the aircraft (the combiner).
import { DEG, RAD, KT, FT, FPM, LB, clamp, wrap180, wrap360, num, F, rrect, flash } from './common.js';
import { bodyToWorld, dirFromElAz } from './projection.js';
import { LOC_FULL, GS_FULL } from './nav.js';

const HUD_CENTER_DOWN = 6 * DEG;     // combiner centre below the boresight
const HUD_HALF_W = 14 * DEG, HUD_HALF_H = 12 * DEG;

export function createFighterHud() {
  const D = { x: 0, y: 0, z: 0 }, D2 = { x: 0, y: 0, z: 0 }, V = { x: 0, y: 0, z: 0 };
  // per-frame frame data
  let cx = 0, cy = 0, ca = 1, sa = 0, hw = 150, hh = 130, fs = 12, lw = 1.5, dpr = 1;
  let fontN = '', fontS = '', fontL = '', fontXL = '';
  let lastFs = -1, mono = 'monospace';
  let maxG = 1;
  const L = { x: 0, y: 0 };

  function toLocal(sx, sy) { const dx = sx - cx, dy = sy - cy; L.x = ca * dx + sa * dy; L.y = -sa * dx + ca * dy; return L; }
  function setFonts(m) {
    if (fs === lastFs && m === mono) return; lastFs = fs; mono = m;
    fontS = `500 ${Math.round(fs * 0.82)}px ${mono}`;
    fontN = `500 ${fs}px ${mono}`;
    fontL = `700 ${Math.round(fs * 1.15)}px ${mono}`;
    fontXL = `700 ${Math.round(fs * 1.9)}px ${mono}`;
  }
  // pixel-align a coordinate for crisp horizontal/vertical strokes (local frame is translated to whole device px)
  const al = (v) => (Math.round(v * dpr - 0.5) + 0.5) / dpr;

  function resetSession() { maxG = 1; }

  function draw(g, E) {
    const { s, def, proj, nav, t, W, H } = E;
    dpr = E.dpr;
    const q = s.quaternion;
    // ---- HUD frame (combiner, fixed to the airframe) -------------------------------------------------
    bodyToWorld(q, 0, -Math.sin(HUD_CENTER_DOWN), -Math.cos(HUD_CENTER_DOWN), D);
    if (!proj.dir(D.x, D.y, D.z)) return;                       // looking away from the HUD
    const scx = proj.x, scy = proj.y;
    bodyToWorld(q, 0, -Math.sin(HUD_CENTER_DOWN - 1 * DEG), -Math.cos(HUD_CENTER_DOWN - 1 * DEG), D2);
    proj.dir(D2.x, D2.y, D2.z);
    const roll = Math.atan2(proj.x - scx, -(proj.y - scy));
    cx = Math.round(scx * dpr) / dpr; cy = Math.round(scy * dpr) / dpr; ca = Math.cos(roll); sa = Math.sin(roll);
    const fpx = proj.fy;   // px per unit tangent
    hh = clamp(fpx * Math.tan(HUD_HALF_H), Math.min(H * 0.34, 420), H * 0.47);
    hw = clamp(fpx * Math.tan(HUD_HALF_W), Math.min(hh * 1.12, W * 0.46), W * 0.47);
    fs = Math.round(clamp(Math.min(hw, hh) * 0.072, 11, 22));
    setFonts(E.tok.mono);
    lw = Math.max(1, Math.round(fs / 8 * dpr)) / dpr;
    const col = E.hudColor;

    g.save();
    g.translate(cx, cy); g.rotate(roll);
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = lw; g.lineCap = 'butt'; g.lineJoin = 'miter';
    g.textBaseline = 'middle';

    // boresight (gun cross)
    bodyToWorld(q, 0, 0, -1, D); proj.dir(D.x, D.y, D.z); toLocal(proj.x, proj.y);
    const bx = L.x, by = L.y;

    // flight-path marker: inertial velocity direction
    const vx = s.velocity.x, vy = s.velocity.y, vz = s.velocity.z;
    const vmag = Math.hypot(vx, vy, vz);
    let fx = bx, fy = by, fpmVis = true;
    if (vmag > 12) {
      fpmVis = proj.dir(vx / vmag, vy / vmag, vz / vmag);
      toLocal(proj.x, proj.y); fx = L.x; fy = L.y;
    }
    const lim = { x0: -hw + fs * 1.6, x1: hw - fs * 1.6, y0: -hh + fs * 1.4, y1: hh - fs * 3.8 };
    let fpmLimited = !fpmVis;
    let lfx = fx, lfy = fy;
    if (!fpmVis) { lfx = bx; lfy = lim.y1; }
    if (lfx < lim.x0 || lfx > lim.x1 || lfy < lim.y0 || lfy > lim.y1) { fpmLimited = true; lfx = clamp(lfx, lim.x0, lim.x1); lfy = clamp(lfy, lim.y0, lim.y1); }

    // ---- conformal layer, clipped to the combiner's field of view ------------------------------------
    g.save();
    g.beginPath(); rrect(g, -hw, -hh + fs * 3.9, hw * 2, hh * 2 - fs * 3.9, fs * 2.2); g.clip();
    const gs = Math.hypot(vx, vz);
    const az = gs > 8 ? Math.atan2(vx, -vz) : s.heading;
    drawLadder(g, proj, az, lfx - fx, fpmVis && !fpmLimited ? 0 : 0);
    // steerpoint diamond (conformal position of the destination airport)
    if (nav.dest && E.camPos) {
      const cp = E.camPos;
      const dx = nav.dest.position.x - cp.x, dy = nav.dest.elevation - cp.y, dz = nav.dest.position.z - cp.z;
      const dl = Math.hypot(dx, dy, dz) || 1;
      if (proj.dir(dx / dl, dy / dl, dz / dl)) {
        toLocal(proj.x, proj.y);
        if (Math.abs(L.x) < hw && Math.abs(L.y) < hh) {
          const r = fs * 0.5; g.beginPath();
          g.moveTo(L.x, L.y - r); g.lineTo(L.x + r, L.y); g.lineTo(L.x, L.y + r); g.lineTo(L.x - r, L.y); g.closePath(); g.stroke();
          g.fillRect(L.x - lw, L.y - lw, lw * 2, lw * 2);
        }
      }
    }
    g.restore();

    // ---- fixed symbology -----------------------------------------------------------------------------
    // gun cross
    {
      const a = fs * 0.75, gap = fs * 0.22;
      const x = al(bx), y = al(by);
      g.beginPath();
      g.moveTo(x - a, y); g.lineTo(x - gap, y); g.moveTo(x + gap, y); g.lineTo(x + a, y);
      g.moveTo(x, y - a); g.lineTo(x, y - gap); g.moveTo(x, y + gap); g.lineTo(x, y + a * 0.6);
      g.stroke();
    }
    // AoA bracket / E-bracket (gear down): body-fixed 11°..15° below the boresight, FPM centred at 13°
    const gearDown = num(s.surfaces?.gear, 0) > 0.5;
    if (gearDown && !s.onGround) {
      const aoaRef = num(def.specs?.approachAoA, 13);
      bodyToWorld(q, 0, -Math.sin((aoaRef - 2) * DEG), -Math.cos((aoaRef - 2) * DEG), D); proj.dir(D.x, D.y, D.z); toLocal(proj.x, proj.y);
      const y0 = L.y;
      bodyToWorld(q, 0, -Math.sin((aoaRef + 2) * DEG), -Math.cos((aoaRef + 2) * DEG), D); proj.dir(D.x, D.y, D.z); toLocal(proj.x, proj.y);
      const y1 = L.y;
      if (y0 > -hh && y1 < hh) {
        const x = al(lfx - fs * 1.9), tick = fs * 0.45;
        g.beginPath();
        g.moveTo(x + tick, al(y0)); g.lineTo(x, al(y0)); g.lineTo(x, al(y1)); g.lineTo(x + tick, al(y1));
        g.moveTo(x, al((y0 + y1) / 2)); g.lineTo(x + tick * 0.8, al((y0 + y1) / 2));
        g.stroke();
      }
    }
    // FPM
    drawFpm(g, lfx, lfy, fpmLimited);
    // ILS deviation bars, referenced to the FPM
    if (nav.ils.active && nav.ils.dist < 25 * 1852) {
      const K = hw * 0.32, len = hw * 0.32;
      const lx = lfx - clamp(nav.ils.locDev / LOC_FULL, -1.3, 1.3) * K;
      g.beginPath(); g.moveTo(al(lx), lfy - len); g.lineTo(al(lx), lfy + len); g.stroke();
      if (nav.ils.gsValid) {
        const ly = lfy + clamp(nav.ils.gsDev / GS_FULL, -1.3, 1.3) * K;
        g.beginPath(); g.moveTo(lfx - len, al(ly)); g.lineTo(lfx + len, al(ly)); g.stroke();
      }
    }
    // steering cue (tadpole): circle displaced from the FPM by the bearing error, tail points to the steerpoint
    if (nav.dest && !s.onGround) {
      const err = wrap180(nav.bearing - (gs > 8 ? s.track : s.heading) * RAD);
      const ppd = fpx * DEG;
      const tx = lfx + clamp(err * ppd, -hw * 0.4, hw * 0.4), ty = lfy;
      const r = fs * 0.28, a = err * DEG;
      g.beginPath(); g.arc(tx, ty, r, 0, Math.PI * 2);
      g.moveTo(tx + Math.sin(a) * r, ty - Math.cos(a) * r); g.lineTo(tx + Math.sin(a) * r * 3.2, ty - Math.cos(a) * r * 3.2);
      g.stroke();
    }

    const tb = drawTapes(g, E);
    drawHeading(g, E, s.heading * RAD, nav);
    drawBank(g, s.roll);
    drawBlocks(g, E, tb);
    drawWarnings(g, E, bx, by);
    g.restore();
  }

  function drawFpm(g, x, y, limited) {
    const r = fs * 0.42;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.moveTo(al(x - r), al(y)); g.lineTo(al(x - r * 2.6), al(y));
    g.moveTo(al(x + r), al(y)); g.lineTo(al(x + r * 2.6), al(y));
    g.moveTo(al(x), al(y - r)); g.lineTo(al(x), al(y - r * 2.0));
    if (limited) { const k = r * 1.5; g.moveTo(x - k, y - k); g.lineTo(x + k, y + k); g.moveTo(x + k, y - k); g.lineTo(x - k, y + k); }
    g.stroke();
  }

  // Pitch ladder: rungs every 5° centred on the FPM's azimuth. Solid above, dashed and canted (half the pitch angle) below,
  // tails pointing to the horizon, numbered. Zenith star / nadir circle at ±90°.
  function drawLadder(g, proj, az, shiftX) {
    const gap = hw * 0.11, len = hw * 0.2, tail = fs * 0.5;
    const toLocalVec = (dx, dy, o) => { o.x = ca * dx + sa * dy; o.y = -sa * dx + ca * dy; return o; };
    const T = { x: 0, y: 0 };
    let haveNeg = false;
    // pass 0 = solid (>= 0), pass 1 = dashed (< 0)
    for (let pass = 0; pass < 2; pass++) {
      g.beginPath();
      if (pass === 1) g.setLineDash([fs * 0.5, fs * 0.35]);
      for (let deg = pass === 0 ? 0 : -5; pass === 0 ? deg < 90 : deg > -90; deg += pass === 0 ? 5 : -5) {
        const el = deg * DEG;
        dirFromElAz(el, az, D);
        if (!proj.dir(D.x, D.y, D.z)) continue;
        const sx = proj.x, sy = proj.y;
        dirFromElAz(el, az + 0.01, D2);
        if (!proj.dir(D2.x, D2.y, D2.z)) continue;
        toLocalVec(proj.x - sx, proj.y - sy, T);
        const tl = Math.hypot(T.x, T.y) || 1; const tx = T.x / tl, ty = T.y / tl;
        toLocal(sx, sy); const x = L.x + shiftX * 1, y = L.y;
        if (Math.abs(y) > hh * 1.5 || Math.abs(x) > hw * 1.8) continue;
        const nx = -ty, ny = tx;                     // normal: points toward the horizon for climb rungs
        if (deg === 0) {
          const w = hw * 2.2, hg = gap * 1.1;
          g.moveTo(x - tx * w, y - ty * w); g.lineTo(x - tx * hg, y - ty * hg);
          g.moveTo(x + tx * hg, y + ty * hg); g.lineTo(x + tx * w, y + ty * w);
          continue;
        }
        if (pass === 1) haveNeg = true;
        const sgn = deg > 0 ? 1 : -1;                // toward-horizon normal = n * sgn
        const cant = deg < 0 ? (-deg / 2) * DEG : 0;
        const cc = Math.cos(cant), sc = Math.sin(cant);
        for (let side = -1; side <= 1; side += 2) {
          const ix = x + tx * side * gap, iy = y + ty * side * gap;
          // direction along the rung (outboard), canted toward the horizon for dive rungs
          const ux = tx * side * cc + nx * sgn * sc, uy = ty * side * cc + ny * sgn * sc;
          const ox = ix + ux * len, oy = iy + uy * len;
          g.moveTo(ix, iy); g.lineTo(ox, oy);
          if (pass === 0) { g.lineTo(ox + nx * sgn * tail, oy + ny * sgn * tail); }
          else { g.moveTo(ox, oy); g.lineTo(ox + nx * sgn * tail, oy + ny * sgn * tail); }
        }
      }
      g.stroke();
      if (pass === 1) g.setLineDash([]);
    }
    // numerals (rotate with the ladder)
    g.font = fontS; g.textAlign = 'center';
    for (let deg = -85; deg <= 85; deg += 5) {
      if (deg === 0) continue;
      dirFromElAz(deg * DEG, az, D); if (!proj.dir(D.x, D.y, D.z)) continue;
      const sx = proj.x, sy = proj.y;
      dirFromElAz(deg * DEG, az + 0.01, D2); if (!proj.dir(D2.x, D2.y, D2.z)) continue;
      toLocalVec(proj.x - sx, proj.y - sy, T);
      const tl = Math.hypot(T.x, T.y) || 1; const tx = T.x / tl, ty = T.y / tl;
      toLocal(sx, sy); const x = L.x + shiftX, y = L.y;
      if (Math.abs(y) > hh * 1.1 || Math.abs(x) > hw * 1.4) continue;
      const sgn = deg > 0 ? 1 : -1, nx = -ty, ny = tx;
      const cant = deg < 0 ? (-deg / 2) * DEG : 0;
      const ang = Math.atan2(ty, tx);
      const lab = F.int(Math.abs(deg));
      for (let side = -1; side <= 1; side += 2) {
        const ux = tx * side * Math.cos(cant) + nx * sgn * Math.sin(cant), uy = ty * side * Math.cos(cant) + ny * sgn * Math.sin(cant);
        const ox = x + tx * side * gap + ux * (gap * 0 + hw * 0.2), oy = y + ty * side * gap + uy * hw * 0.2;
        const px = ox + tx * side * fs * 1.15 + nx * sgn * fs * 0.25, py = oy + ty * side * fs * 1.15 + ny * sgn * fs * 0.25;
        g.save(); g.translate(px, py); g.rotate(ang); g.fillText(lab, 0, 0); g.restore();
      }
    }
    // zenith / nadir
    for (const z of [1, -1]) {
      D.x = 0; D.y = z; D.z = 0;
      if (!proj.dir(0, z, 0)) continue;
      toLocal(proj.x, proj.y);
      if (Math.abs(L.x) > hw || Math.abs(L.y) > hh) continue;
      const r = fs * 0.7; g.beginPath();
      if (z > 0) { for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g.moveTo(L.x + Math.cos(a) * r * 0.35, L.y + Math.sin(a) * r * 0.35); g.lineTo(L.x + Math.cos(a) * r, L.y + Math.sin(a) * r); } }
      else { g.arc(L.x, L.y, r, 0, Math.PI * 2); g.moveTo(L.x - r * 0.7, L.y - r * 0.7); g.lineTo(L.x + r * 0.7, L.y + r * 0.7); g.moveTo(L.x + r * 0.7, L.y - r * 0.7); g.lineTo(L.x - r * 0.7, L.y + r * 0.7); }
      g.stroke();
    }
    return haveNeg;
  }

  // Airspeed (left) and altitude (right) scales with boxed digital readouts; VVI scale inboard of the altitude scale.
  function drawTapes(g, E) {
    const s = E.s;
    const tapeH = hh * 0.7, yc = -hh * 0.16, top = yc - tapeH / 2, bot = yc + tapeH / 2;
    const cw = fs * 0.6;   // mono char width
    // ---- airspeed ----
    const kias = Math.max(0, num(s.ias) / KT);
    {
      const x = al(-hw * 0.70);   // scale line (ticks extend left)
      const ppk = tapeH / 100;
      const boxW = cw * 4 + fs * 0.6, boxH = fs * 1.5;
      g.font = fontS; g.textAlign = 'right';
      g.beginPath();
      const k0 = Math.ceil((kias - 50) / 10) * 10;
      for (let k = Math.max(0, k0); k <= kias + 50; k += 10) {
        const y = al(yc + (kias - k) * ppk);
        if (y < top || y > bot) continue;
        const major = k % 50 === 0;
        g.moveTo(x, y); g.lineTo(x - (major ? fs * 0.6 : fs * 0.35), y);
        if (major && Math.abs(y - yc) > boxH * 0.8) g.fillText(F.int(k), x - fs * 0.85, y);
      }
      g.stroke();
      // box with caret pointing at the scale
      const bxr = x - fs * 0.15, bxl = bxr - boxW - fs * 0.5;
      g.beginPath();
      g.moveTo(al(bxl), al(yc - boxH / 2)); g.lineTo(al(bxr - fs * 0.5), al(yc - boxH / 2)); g.lineTo(bxr, yc);
      g.lineTo(al(bxr - fs * 0.5), al(yc + boxH / 2)); g.lineTo(al(bxl), al(yc + boxH / 2)); g.closePath(); g.stroke();
      g.font = fontN; g.textAlign = 'right'; g.fillText(F.int(kias), bxr - fs * 0.65, yc + 0.5);
      // G (top), Mach / AoA / max G (below)
      g.textAlign = 'left';
      const lx = -hw * 0.92;
      const gl = num(s.gLoad, 1); if (!s.onGround) maxG = Math.max(maxG, gl);
      g.font = fontL; g.fillText(F.tenth(gl * 10), lx, top - fs * 1.2);
      g.font = fontS;
      g.fillText('M', lx, bot + fs * 1.0); g.fillText(F.mach(Math.round(num(s.mach) * 100)), lx + cw * 1.6, bot + fs * 1.0);
      g.fillText('α', lx, bot + fs * 2.1); g.fillText(F.tenth(Math.round(num(s.aoa) * RAD * 10)), lx + cw * 1.6, bot + fs * 2.1);
      g.fillText(F.tenth(Math.round(maxG * 10)), lx + cw * 1.6, bot + fs * 3.2);
      g.fillText('G', lx, bot + fs * 3.2);
    }
    // ---- altitude ----
    const altFt = num(s.altitude) / FT;
    {
      const x = al(hw * 0.70);
      const ppf = tapeH / 1000;
      const boxW = cw * 6 + fs * 0.6, boxH = fs * 1.5;
      g.font = fontS; g.textAlign = 'left';
      g.beginPath();
      const f0 = Math.ceil((altFt - 500) / 100) * 100;
      for (let f = f0; f <= altFt + 500; f += 100) {
        const y = al(yc + (altFt - f) * ppf);
        if (y < top || y > bot) continue;
        const major = f % 500 === 0;
        g.moveTo(x, y); g.lineTo(x + (major ? fs * 0.6 : fs * 0.35), y);
        if (major && Math.abs(y - yc) > boxH * 0.8) g.fillText(F.tenth(Math.round(f / 100)), x + fs * 0.85, y);
      }
      g.stroke();
      const bxl = x + fs * 0.15, bxr = bxl + boxW + fs * 0.5;
      g.beginPath();
      g.moveTo(al(bxr), al(yc - boxH / 2)); g.lineTo(al(bxl + fs * 0.5), al(yc - boxH / 2)); g.lineTo(bxl, yc);
      g.lineTo(al(bxl + fs * 0.5), al(yc + boxH / 2)); g.lineTo(al(bxr), al(yc + boxH / 2)); g.closePath(); g.stroke();
      g.font = fontN; g.textAlign = 'right';
      g.fillText(F.comma(Math.round(altFt / 10) * 10), bxr - fs * 0.3, yc + 0.5);
      // radar altitude box below 5,000 ft AGL
      const aglFt = num(s.agl, 1e9) / FT;
      if (aglFt < 5000) {
        const ry = bot + fs * 1.3, rw = cw * 7 + fs * 0.6;
        g.beginPath(); g.rect(al(bxr - rw), al(ry - boxH / 2), Math.round(rw), Math.round(boxH)); g.stroke();
        g.font = fontN; g.textAlign = 'left'; g.fillText('R', bxr - rw + fs * 0.3, ry + 0.5);
        g.textAlign = 'right'; g.fillText(F.comma(Math.max(0, Math.round(aglFt / (aglFt < 1000 ? 5 : 10)) * (aglFt < 1000 ? 5 : 10))), bxr - fs * 0.3, ry + 0.5);
      }
      // vertical velocity: digital above the scale, VVI scale with caret inboard
      const vsFpm = num(s.verticalSpeed) / FPM;
      g.font = fontS; g.textAlign = 'right';
      g.fillText(F.signed(Math.round(vsFpm / 10) * 10), bxr - fs * 0.3, top - fs * 1.2);
      const vx = al(hw * 0.58), vh = tapeH * 0.36, pp = vh / 1000;
      g.beginPath();
      for (let v = -1000; v <= 1000; v += 500) {
        const y = al(yc - v * pp); g.moveTo(vx, y); g.lineTo(vx + (v === 0 ? fs * 0.55 : fs * 0.3), y);
      }
      g.moveTo(vx, al(yc - vh)); g.lineTo(vx, al(yc + vh));
      g.stroke();
      const cy2 = yc - clamp(vsFpm, -1200, 1200) * pp;
      g.beginPath(); g.moveTo(vx - fs * 0.1, cy2); g.lineTo(vx - fs * 0.55, cy2 - fs * 0.3); g.lineTo(vx - fs * 0.55, cy2 + fs * 0.3); g.closePath(); g.stroke();
      TB.right = aglFt < 5000 ? bot + fs * 2.3 : bot + fs * 0.6;
    }
    TB.left = bot + fs * 3.4;
    return TB;
  }
  const TB = { left: 0, right: 0 };

  // Heading tape at the top of the combiner: 5° ticks, labels every 10°, fixed caret + digital heading, steerpoint marker.
  function drawHeading(g, E, hdg, nav) {
    const y = al(-hh + fs * 2.1), half = hw * 0.4, ppd = hw * 0.15 / 10;
    g.font = fontS; g.textAlign = 'center';
    g.beginPath();
    const d0 = Math.ceil((hdg - half / ppd) / 5) * 5;
    for (let d = d0; d <= hdg + half / ppd; d += 5) {
      const x = al((d - hdg) * ppd);
      const major = d % 10 === 0;
      g.moveTo(x, y); g.lineTo(x, y - (major ? fs * 0.55 : fs * 0.3));
      if (major) { const v = wrap360(d) / 10; g.fillText(F.pad2(v === 0 ? 36 : v), x, y - fs * 1.15); }
    }
    g.stroke();
    g.beginPath(); g.moveTo(0, y + fs * 0.15); g.lineTo(-fs * 0.35, y + fs * 0.7); g.moveTo(0, y + fs * 0.15); g.lineTo(fs * 0.35, y + fs * 0.7); g.stroke();
    g.fillText(F.deg3(Math.round(hdg)), 0, y + fs * 1.35);
    if (nav.dest) {
      const e = wrap180(nav.bearing - hdg);
      const x = clamp(e, -half / ppd, half / ppd) * ppd;
      g.beginPath(); g.moveTo(x, y - fs * 0.05); g.lineTo(x - fs * 0.3, y + fs * 0.45); g.lineTo(x + fs * 0.3, y + fs * 0.45); g.closePath();
      if (Math.abs(e) < half / ppd) g.fill(); else g.stroke();
    }
  }

  // Bank scale at the bottom of the combiner: fixed arc of ticks (0, 10, 20, 30, 45°) and a pendulum pointer.
  const BANK_TICKS = [-45, -30, -20, -10, 0, 10, 20, 30, 45];
  function drawBank(g, roll) {
    const R = hh * 0.3, yc = hh - fs * 2.6 - R;
    g.beginPath();
    for (const t of BANK_TICKS) {
      const a = t * DEG, len = t === 0 ? fs * 0.6 : (t % 30 === 0 || Math.abs(t) === 45) ? fs * 0.45 : fs * 0.28;
      const sx = Math.sin(a), cy2 = Math.cos(a);
      g.moveTo(sx * R, yc + cy2 * R); g.lineTo(sx * (R + len), yc + cy2 * (R + len));
    }
    g.stroke();
    const r = clamp(roll, -60 * DEG, 60 * DEG);
    const sx = Math.sin(r), cy2 = Math.cos(r);
    const px = sx * (R - fs * 0.1), py = yc + cy2 * (R - fs * 0.1);
    const nx = sx, ny = cy2, tx = cy2, ty = -sx;
    g.beginPath();
    g.moveTo(px, py); g.lineTo(px - nx * fs * 0.55 + tx * fs * 0.3, py - ny * fs * 0.55 + ty * fs * 0.3);
    g.lineTo(px - nx * fs * 0.55 - tx * fs * 0.3, py - ny * fs * 0.55 - ty * fs * 0.3); g.closePath(); g.stroke();
  }

  function drawBlocks(g, E, tb) {
    const { s, def, nav } = E;
    const cw = fs * 0.6;
    const lx = -hw * 0.92, rx = hw * 0.92;
    let y = tb.left + fs * 1.0;
    g.font = fontS; g.textAlign = 'left';
    // master mode / discretes (lower left)
    g.fillText(nav.ils.active ? 'ILS' : 'NAV', lx, y); y += fs * 1.15;
    const en = s.engines?.[0];
    const ab = num(en?.afterburner, 0), thr = num(s.throttle, 0);
    const rpm = Math.round(num(en?.n2, num(en?.n1, 0)) * 100);
    if (ab > 0.02 || thr > 0.905) { g.fillText('AB', lx, y); g.fillText(F.int(clamp(Math.ceil(ab * 5), 1, 5)), lx + cw * 3, y); }
    else if (thr < 0.03) g.fillText('IDLE', lx, y);
    else { g.fillText(thr > 0.88 ? 'MIL' : 'THR', lx, y); g.fillText(F.int(Math.round(thr / 0.9 * 100)), lx + cw * 4, y); }
    g.fillText('RPM', lx + cw * 8, y); g.fillText(F.int(rpm), lx + cw * 12, y);
    y += fs * 1.15;
    const gear = num(s.surfaces?.gear, 0);
    if (gear > 0.98) g.fillText('GEAR DN', lx, y); else if (gear > 0.02) { if (flash(E.t, 0.6)) g.fillText('GEAR', lx, y); } else y -= fs * 1.15;
    y += fs * 1.15;
    if (num(s.surfaces?.speedbrake, 0) > 0.05) { g.fillText('SPD BRK', lx, y); y += fs * 1.15; }
    if (num(s.surfaces?.flaps, 0) > 0.05) { g.fillText('FLAPS', lx, y); g.fillText(F.int(Math.round(s.surfaces.flaps * 100)), lx + cw * 6, y); y += fs * 1.15; }
    if (s.parkingBrake) { g.fillText('PARK BRK', lx, y); y += fs * 1.15; }
    else if (num(s.brakes, 0) > 0.1 && s.onGround) { g.fillText('BRAKES', lx, y); y += fs * 1.15; }
    if (num(s.surfaces?.hook, 0) > 0.5) { g.fillText('HOOK', lx, y); y += fs * 1.15; }
    if (s.ap?.engaged) { g.fillText('A/P', lx, y); g.fillText(apLabel(s.ap), lx + cw * 4, y); y += fs * 1.15; }
    // fuel (bottom left), lbs
    const fuelLb = num(s.fuel) / LB;
    const low = s.fuelCapacity > 0 && s.fuel < s.fuelCapacity * 0.12;
    if (!low || flash(E.t)) { g.fillText('FUEL', lx, hh - fs * 1.1); g.fillText(F.comma(Math.round(fuelLb / 10) * 10), lx + cw * 5, hh - fs * 1.1); }
    // steerpoint block (lower right): ident, bearing / distance, time to go; ILS data
    g.textAlign = 'right';
    let ry = tb.right + fs * 0.9;
    if (nav.dest) {
      g.fillText(nav.dest.id, rx, ry); ry += fs * 1.15;
      g.fillText(F.deg3(Math.round(nav.bearing)), rx - cw * 6, ry);
      g.fillText('/', rx - cw * 5, ry);
      g.fillText(nav.distNM < 100 ? F.tenth(Math.round(nav.distNM * 10)) : F.int(Math.round(nav.distNM)), rx, ry); ry += fs * 1.15;
      g.fillText(isFinite(nav.ttg) && nav.ttg < 360000 ? F.mmss(Math.round(nav.ttg)) : '--:--', rx, ry); ry += fs * 1.15;
    }
    if (nav.ils.active) {
      g.fillText(nav.ils.ident, rx, ry); ry += fs * 1.15;
      g.fillText('DME', rx - cw * 5, ry); g.fillText(F.tenth(Math.round(nav.ils.dme * 10)), rx, ry);
    }
  }

  function drawWarnings(g, E, bx, by) {
    const { s, nav, t, def } = E;
    const y0 = by + fs * 2.6;
    let line = 0;
    g.textAlign = 'center';
    if (nav.gcas.pullUp) {
      // break-X across the combiner
      if (flash(t, 0.5)) {
        const k = Math.min(hw, hh) * 0.7;
        g.save(); g.lineWidth = lw * 2;
        g.beginPath(); g.moveTo(-k, -k); g.lineTo(k, k); g.moveTo(k, -k); g.lineTo(-k, k); g.stroke();
        g.restore();
        g.font = fontXL; g.fillText('PULL UP', 0, y0 + fs * 0.5);
      }
      line += 2;
    }
    g.font = fontL;
    const say = (txt, blink) => { if (!blink || flash(t)) g.fillText(txt, 0, y0 + fs * (1.4 * line + (line ? 0.6 : 0))); line++; };
    if (s.stalled || s.stallWarning) say('STALL', true);
    const maxGl = num(def.specs?.maxG, 9);
    if (s.overG || num(s.gLoad, 1) > maxGl) say('OVER G', true);
    if (s.overspeed) say('OVERSPEED', true);
    const gearUp = num(s.surfaces?.gear, 1) < 0.1;
    if (gearUp && !s.onGround && num(s.agl, 1e9) < 300 && num(s.ias) < 210 * KT && num(s.verticalSpeed) < 0) say('GEAR', true);
    if (nav.gcas.sinkRate && !nav.gcas.pullUp) say('SINK RATE', false);
    if (s.fuelCapacity > 0 && s.fuel < s.fuelCapacity * 0.06) say('BINGO', true);
  }

  return { draw, resetSession };
}

const _apl = new Map();
export function apLabel(ap) {
  const key = ap.mode || '';
  let v = _apl.get(key);
  if (v === undefined) { v = apLabelRaw(key); if (_apl.size > 64) _apl.clear(); _apl.set(key, v); }
  return v;
}
function apLabelRaw(mode) {
  const m = String(mode || '').toLowerCase();
  if (!m) return 'ALT HDG';
  let out = '';
  if (m.includes('alt')) out += 'ALT ';
  if (m.includes('hdg') || m.includes('head')) out += 'HDG ';
  if (m.includes('vs') || m.includes('v/s')) out += 'V/S ';
  if (m.includes('spd') || m.includes('speed')) out += 'SPD ';
  if (m.includes('att')) out += 'ATT ';
  return (out || m.toUpperCase()).trim();
}
