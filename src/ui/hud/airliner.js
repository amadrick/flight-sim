// Airliner flight-deck displays (Boeing 737NG style): PFD, ND (track-up MAP) and upper EICAS, docked at the bottom of the
// view like looking over the glareshield. Each display is drawn in its own local frame of 100 × 100 "units" (u = size/100).
import { AIRPORTS } from '../../data/airports.js';
import { KT, FT, FPM, NM, LB, DEG, RAD, clamp, num, wrap180, wrap360, F, strCache, rrect, makeLayer, flash } from './common.js';
import { LOC_FULL, GS_FULL } from './nav.js';
import { flapDetent } from './external.js';

const B = {
  white: '#ffffff', green: '#46f26e', magenta: '#ff63f2', cyan: '#3fdcff', amber: '#ffb000', red: '#ff3b30',
  gray: 'rgba(92,102,114,0.62)', grayLine: '#9aa4ae', sky: '#2a7fd4', ground: '#8a5a2b', black: '#000000', bezel: '#161b21',
};
const FLAP_VFE = [[0, 999], [1, 250], [2, 250], [5, 250], [10, 210], [15, 200], [25, 190], [30, 175], [40, 162]];
const VMO = 340, MMO = 0.82, VLE = 270;
const ND_RANGES = [5, 10, 20, 40, 80, 160, 320];

const fmt = {
  k1: strCache((k) => (k / 10).toFixed(1)),
  alt5: strCache((k) => String(k)),
  mach3: strCache((k) => (k >= 1000 ? Math.floor(k / 1000) : '') + '.' + String(k % 1000).padStart(3, '0')),
  wind: strCache((k) => { const d = Math.floor(k / 1000) % 360; return String(d === 0 ? 360 : d).padStart(3, '0') + '°/' + (k % 1000); }),
  baro: strCache((k) => (k / 100).toFixed(2)),
  hhmm: strCache((k) => { const h = Math.floor(k / 600) % 24, m = (k % 600) / 10; return String(h).padStart(2, '0') + String(Math.floor(m)).padStart(2, '0') + '.' + (Math.floor(m * 10) % 10) + 'z'; }),
};

export function createAirlinerDeck(tok) {
  const mono = tok.mono;
  let key = -1, layer = null, Lyt = null;
  // filtered speed trend
  let lastIas = null, accel = 0;
  // FMA change-highlight timers
  const fma = { at: '', roll: '', pitch: '', tAt: 0, tRoll: 0, tPitch: 0, cmd: false, tCmd: 0 };
  let ndRange = 40;
  let fs = 12, u = 3;
  const font = (w, px) => `${w} ${Math.round(px)}px ${mono}`;
  let fonts = {};

  function layout(W, H) {
    const pad = 16;
    const deckH = H * 0.4;
    const gap = Math.max(8, Math.round(W * 0.008));
    let S = Math.min(deckH - 18, (W - pad * 2 - gap * 2) / 2.85);
    let mode = 'full';
    if (S < 230) {                      // too small for three legible displays: PFD + compact engine strip
      mode = 'compact';
      S = Math.min(W - pad * 2, H * 0.46, 520);
      if (W > H * 1.3) S = Math.min(H * 0.5, (W - pad * 2) * 0.6);
    }
    S = Math.floor(S);
    const eW = Math.floor(S * 0.82);
    const total = mode === 'full' ? S * 2 + eW + gap * 2 : S;
    const x0 = Math.round((W - total) / 2);
    const y0 = Math.round(H - S - Math.max(10, H * 0.015));
    const L = { mode, S, eW, gap, W, H, panelTop: y0 - 12 };
    if (mode === 'full') {
      L.pfd = { x: x0, y: y0, w: S, h: S };
      L.nd = { x: x0 + S + gap, y: y0, w: S, h: S };
      L.eicas = { x: x0 + S * 2 + gap * 2, y: y0, w: eW, h: S };
    } else if (W > H * 1.3) {          // landscape phone: PFD left of centre, compact engines to its right
      const ew = Math.min(Math.floor(S * 0.62), W - pad * 2 - S - gap);
      const x = Math.round((W - S - gap - ew) / 2);
      L.pfd = { x, y: y0, w: S, h: S };
      L.strip = { x: x + S + gap, y: y0, w: ew, h: S, vertical: true };
    } else {                            // portrait phone: PFD with a compact engine strip above it
      const sh = Math.round(S * 0.16);
      L.pfd = { x: Math.round((W - S) / 2), y: y0, w: S, h: S };
      L.strip = { x: Math.round((W - S) / 2), y: y0 - sh - gap * 0.6, w: S, h: sh, vertical: false };
      L.panelTop = L.strip.y - 10;
    }
    return L;
  }

  function buildLayer(W, H, dpr) {
    layer = layer || makeLayer(1, 1);
    const top = Math.max(0, Lyt.panelTop - 30);
    layer.width = Math.ceil(W * dpr); layer.height = Math.ceil((H - top) * dpr);
    Lyt.layerTop = top;
    const g = layer.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, -top * dpr);
    // instrument panel below the glareshield: dark, slightly textured gradient, lip highlight
    const pt = Lyt.panelTop;
    const grd = g.createLinearGradient(0, pt - 30, 0, H);
    grd.addColorStop(0, 'rgba(8,11,14,0)'); grd.addColorStop(0.12, 'rgba(10,13,17,0.92)'); grd.addColorStop(1, 'rgba(14,18,23,0.98)');
    g.fillStyle = grd; g.fillRect(0, pt - 30, W, H - pt + 30);
    g.fillStyle = 'rgba(18,22,27,1)'; g.fillRect(0, pt, W, 3);
    g.fillStyle = 'rgba(120,135,150,0.18)'; g.fillRect(0, pt + 3, W, 1);
    for (const k of ['pfd', 'nd', 'eicas', 'strip']) {
      const d = Lyt[k]; if (!d) continue;
      const b = Math.max(4, Math.round(d.w * 0.025));
      g.fillStyle = B.bezel; g.beginPath(); rrect(g, d.x - b, d.y - b, d.w + b * 2, d.h + b * 2, b * 1.4); g.fill();
      g.strokeStyle = 'rgba(160,175,190,0.12)'; g.lineWidth = 1; g.stroke();
      g.fillStyle = '#030405'; g.beginPath(); rrect(g, d.x, d.y, d.w, d.h, b * 0.6); g.fill();
      // bezel screws
      g.fillStyle = 'rgba(160,175,190,0.22)';
      for (const [sx, sy] of [[d.x - b * 0.5, d.y - b * 0.5], [d.x + d.w + b * 0.5, d.y - b * 0.5], [d.x - b * 0.5, d.y + d.h + b * 0.5], [d.x + d.w + b * 0.5, d.y + d.h + b * 0.5]]) { g.beginPath(); g.arc(sx, sy, Math.max(1, b * 0.22), 0, Math.PI * 2); g.fill(); }
    }
  }

  function draw(g, E) {
    const { W, H, dpr, s } = E;
    const k = (W * 8192 + H) * 8 + Math.round(dpr * 2);
    if (k !== key || !layer) { key = k; Lyt = layout(W, H); buildLayer(W, H, dpr); }
    g.drawImage(layer, 0, Lyt.layerTop, layer.width / dpr, layer.height / dpr);
    // speed trend (filtered dIAS/dt over sim time)
    const dt = num(E.ctx.time?.dt, 0);
    const ias = num(s.ias) / KT;
    if (lastIas === null) lastIas = ias;
    if (dt > 0) { const a = (ias - lastIas) / dt; accel += (clamp(a, -20, 20) - accel) * Math.min(1, dt * 1.5); lastIas = ias; }
    if (s.onGround && ias < 30) accel = 0;
    E.accel = accel;
    E.windshear = !s.onGround && num(s.agl, 1e9) / FT < 1500 && accel < -4 && num(s.throttle) > 0.6;
    pfd(g, Lyt.pfd, E);
    if (Lyt.nd) nd(g, Lyt.nd, E);
    if (Lyt.eicas) eicas(g, Lyt.eicas, E);
    if (Lyt.strip) strip(g, Lyt.strip, E);
  }

  function setScale(d) {
    u = d.w / 100; fs = Math.max(9, u * 4.4);
    fonts.s = font(500, Math.max(8.5, u * 3.4)); fonts.n = font(500, fs); fonts.l = font(700, Math.max(10, u * 5.2)); fonts.xl = font(700, Math.max(11, u * 6.4));
    fonts.xs = font(500, Math.max(8, u * 2.9));
    fonts.fma = font(500, Math.max(9, u * 3.7));
  }

  function text(g, t, x, y, color, f, align = 'left', base = 'middle') { g.fillStyle = color; g.font = f; g.textAlign = align; g.textBaseline = base; g.fillText(t, x, y); }

  // ======================================== PFD ========================================
  function pfd(g, d, E) {
    const { s, def, nav, t } = E;
    setScale(d);
    g.save(); g.translate(d.x, d.y);
    g.beginPath(); g.rect(0, 0, d.w, d.h); g.clip();
    const ax = 50 * u, ay = 45 * u, aw = 22 * u, ah = 25 * u;     // attitude centre and half sizes
    const ppd = ah / 21;                                          // pixels per degree of pitch
    const pitch = num(s.pitch) * RAD, roll = num(s.roll);
    // ---- attitude sphere ----
    g.save();
    g.beginPath(); rrect(g, ax - aw, ay - ah, aw * 2, ah * 2, u * 5); g.clip();
    g.translate(ax, ay); g.rotate(-roll);
    const hy = pitch * ppd;
    g.fillStyle = B.sky; g.fillRect(-aw * 2, -ah * 3, aw * 4, ah * 3 + hy);
    g.fillStyle = B.ground; g.fillRect(-aw * 2, hy, aw * 4, ah * 3);
    g.strokeStyle = B.white; g.lineWidth = Math.max(1, u * 0.35);
    g.beginPath(); g.moveTo(-aw * 2, hy); g.lineTo(aw * 2, hy); g.stroke();
    // pitch scale: 2.5° steps, labelled every 10°, limited to a window around the aircraft symbol
    g.save();
    g.beginPath(); g.rect(-aw * 0.75, -ah * 0.78, aw * 1.5, ah * 1.5); g.clip();
    g.beginPath();
    g.lineWidth = Math.max(1, u * 0.3);
    const p0 = Math.ceil((pitch - 20) / 2.5) * 2.5;
    for (let p = p0; p <= pitch + 20; p += 2.5) {
      if (Math.abs(p) < 0.01) continue;
      const y = hy - p * ppd;
      const w = (Math.abs(p) % 10 === 0) ? 10 * u : (Math.abs(p) % 5 === 0) ? 5 * u : 2.5 * u;
      g.moveTo(-w, y); g.lineTo(w, y);
    }
    g.stroke();
    for (let p = Math.ceil((pitch - 20) / 10) * 10; p <= pitch + 20; p += 10) {
      if (p === 0) continue;
      const y = hy - p * ppd;
      text(g, F.int(Math.abs(p)), -13.5 * u, y, B.white, fonts.s, 'center');
      text(g, F.int(Math.abs(p)), 13.5 * u, y, B.white, fonts.s, 'center');
    }
    g.restore();
    g.restore();
    // ---- bank scale (fixed) + sky pointer and slip indicator (rotate with the horizon) ----
    const R = ah * 0.9;
    g.strokeStyle = B.white; g.lineWidth = Math.max(1, u * 0.35);
    g.beginPath();
    for (const b of [-60, -45, -30, -20, -10, 10, 20, 30, 45, 60]) {
      const a = b * DEG - Math.PI / 2, l = Math.abs(b) === 30 || Math.abs(b) === 60 ? 3.2 * u : 1.8 * u;
      if (Math.abs(b) === 45) { const x = ax + Math.cos(a) * R, y = ay + Math.sin(a) * R; g.moveTo(x, y); g.lineTo(ax + Math.cos(a) * (R + 1.6 * u), ay + Math.sin(a) * (R + 1.6 * u)); continue; }
      g.moveTo(ax + Math.cos(a) * R, ay + Math.sin(a) * R); g.lineTo(ax + Math.cos(a) * (R + l), ay + Math.sin(a) * (R + l));
    }
    g.stroke();
    // zero index (fixed, hollow triangle above the scale)
    g.beginPath(); g.moveTo(ax, ay - R); g.lineTo(ax - 1.6 * u, ay - R - 2.6 * u); g.lineTo(ax + 1.6 * u, ay - R - 2.6 * u); g.closePath(); g.stroke();
    {
      const bankWarn = Math.abs(roll) > 35 * DEG;
      g.save(); g.translate(ax, ay); g.rotate(-roll);
      g.fillStyle = bankWarn ? B.amber : B.white; g.strokeStyle = bankWarn ? B.amber : B.white;
      g.beginPath(); g.moveTo(0, -R); g.lineTo(-1.7 * u, -R + 2.8 * u); g.lineTo(1.7 * u, -R + 2.8 * u); g.closePath();
      if (bankWarn) g.fill(); else g.stroke();
      const slip = clamp(num(s.beta) * RAD * 0.6, -3, 3) * u;
      g.beginPath(); g.moveTo(-2 * u + slip, -R + 3.3 * u); g.lineTo(2 * u + slip, -R + 3.3 * u); g.lineTo(2.4 * u + slip, -R + 4.4 * u); g.lineTo(-2.4 * u + slip, -R + 4.4 * u); g.closePath();
      if (bankWarn) g.fill(); else g.stroke();
      g.restore();
    }
    // ---- aircraft symbol ----
    g.fillStyle = B.black; g.strokeStyle = B.white; g.lineWidth = Math.max(1, u * 0.35);
    for (const sd of [-1, 1]) {
      g.beginPath();
      g.moveTo(ax + sd * 7 * u, ay - 0.9 * u); g.lineTo(ax + sd * 17 * u, ay - 0.9 * u); g.lineTo(ax + sd * 17 * u, ay + 0.9 * u);
      g.lineTo(ax + sd * 9 * u, ay + 0.9 * u); g.lineTo(ax + sd * 9 * u, ay + 4 * u); g.lineTo(ax + sd * 7 * u, ay + 4 * u); g.closePath();
      g.fill(); g.stroke();
    }
    g.beginPath(); g.rect(ax - 1 * u, ay - 1 * u, 2 * u, 2 * u); g.fill(); g.stroke();
    // ---- flight-path vector (green "bird") ----
    {
      const gs = Math.hypot(s.velocity.x, s.velocity.z);
      if (!s.onGround && gs > 20) {
        const fpa = Math.atan2(s.velocity.y, gs) * RAD, drift = wrap180((num(s.track) - num(s.heading)) * RAD);
        const vx = clamp(drift * ppd, -aw * 0.8, aw * 0.8), vy = clamp(-(fpa - pitch) * ppd, -ah * 0.8, ah * 0.8);
        g.save(); g.translate(ax, ay); g.rotate(-roll);
        // rotate the body-frame offset by roll so the bird sits in the right place in the rotated sphere
        g.rotate(roll);
        g.strokeStyle = B.green; g.lineWidth = Math.max(1, u * 0.4);
        const r = 1.4 * u; g.beginPath(); g.arc(vx, vy, r, 0, Math.PI * 2);
        g.moveTo(vx - r, vy); g.lineTo(vx - r * 3, vy); g.moveTo(vx + r, vy); g.lineTo(vx + r * 3, vy); g.moveTo(vx, vy - r); g.lineTo(vx, vy - r * 2.2);
        g.stroke(); g.restore();
      }
    }
    // ---- ILS deviation scales ----
    const ils = nav.ils;
    if (ils.active) {
      const ly = ay + ah - 3.2 * u, gx = ax + aw - 3.2 * u, dot = 4.2 * u;
      g.strokeStyle = B.white; g.lineWidth = Math.max(1, u * 0.3);
      g.beginPath();
      for (const k of [-2, -1, 1, 2]) { g.moveTo(ax + k * dot + 0.8 * u, ly); g.arc(ax + k * dot, ly, 0.8 * u, 0, Math.PI * 2); g.moveTo(gx + 0.8 * u, ay + k * dot); g.arc(gx, ay + k * dot, 0.8 * u, 0, Math.PI * 2); }
      g.moveTo(ax, ly - 1.8 * u); g.lineTo(ax, ly + 1.8 * u); g.moveTo(gx - 1.8 * u, ay); g.lineTo(gx + 1.8 * u, ay);
      g.stroke();
      const lx = ax - clamp(ils.locDev / LOC_FULL * 2, -2.3, 2.3) * dot;
      const full = Math.abs(ils.locDev / LOC_FULL * 2) > 2.3;
      diamond(g, lx, ly, 1.6 * u, 1.0 * u, B.magenta, !full);
      if (ils.gsValid) {
        const gy = ay + clamp(ils.gsDev / GS_FULL * 2, -2.3, 2.3) * dot;
        diamond(g, gx, gy, 1.0 * u, 1.6 * u, B.magenta, Math.abs(ils.gsDev / GS_FULL * 2) <= 2.3);
      }
      text(g, ils.ident, ax - aw - 1 * u, ay - ah - 2.2 * u, B.white, fonts.xs, 'left');
      text(g, 'DME', ax + aw - 7.5 * u, ay - ah - 2.2 * u, B.white, fonts.xs, 'right');
      text(g, F.tenth(Math.round(ils.dme * 10)), ax + aw + 1 * u, ay - ah - 2.2 * u, B.white, fonts.xs, 'right');
    }
    // ---- radio altitude ----
    const raFt = num(s.agl, 1e9) / FT;
    if (raFt < 2500) {
      const v = raFt > 100 ? Math.round(raFt / 10) * 10 : Math.round(Math.max(0, raFt) / 2) * 2;
      text(g, F.int(v), ax, ay + ah * 0.6, raFt < num(E.minimums, 200) && !s.onGround ? B.amber : B.white, fonts.l, 'center');
    }
    // ---- alerts ----
    if (nav.gcas.pullUp) { if (flash(t, 0.6)) alertBox(g, 'PULL UP', ax, ay + ah * 0.35, B.red); }
    else if (E.windshear) alertBox(g, 'WINDSHEAR', ax, ay + ah * 0.35, B.red);
    else if (nav.gcas.sinkRate) alertBox(g, 'SINK RATE', ax, ay + ah * 0.35, B.amber);
    else if (s.stallWarning || s.stalled) { if (flash(t, 0.5)) alertBox(g, 'STALL', ax, ay + ah * 0.35, B.red); }
    else if (num(s.surfaces?.gear, 1) < 0.1 && !s.onGround && raFt < 800 && num(s.verticalSpeed) < 0 && num(s.ias) / KT < 190) alertBox(g, 'TOO LOW GEAR', ax, ay + ah * 0.35, B.amber);
    else if (Math.abs(roll) > 40 * DEG && !s.onGround) alertBox(g, 'BANK ANGLE', ax, ay + ah * 0.35, B.amber);
    // ---- FMA ----
    drawFma(g, s, nav, t);
    // ---- tapes ----
    speedTape(g, s, def, E);
    altTape(g, s, E);
    vsi(g, s);
    headingRose(g, s, nav);
    g.restore();
  }

  function diamond(g, x, y, rx, ry, color, filled) {
    g.beginPath(); g.moveTo(x, y - ry); g.lineTo(x + rx, y); g.lineTo(x, y + ry); g.lineTo(x - rx, y); g.closePath();
    if (filled) { g.fillStyle = color; g.fill(); } else { g.strokeStyle = color; g.lineWidth = Math.max(1, u * 0.3); g.stroke(); }
  }
  function alertBox(g, msg, x, y, color) {
    g.font = fonts.l; const w = msg.length * u * 3.3 + 3 * u, h = 6.5 * u;
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(x - w / 2, y - h / 2, w, h);
    g.strokeStyle = color; g.lineWidth = Math.max(1, u * 0.35); g.strokeRect(x - w / 2, y - h / 2, w, h);
    text(g, msg, x, y + 0.2 * u, color, fonts.l, 'center');
  }

  function drawFma(g, s, nav, t) {
    const ap = s.ap || {};
    const m = String(ap.mode || '').toLowerCase();
    let at = '', roll = '', pitch = '', armedR = '', armedP = '';
    if (ap.autothrottle) at = s.onGround && num(s.throttle) > 0.8 ? 'N1' : 'MCP SPD';
    if (ap.engaged) {
      roll = m.includes('loc') ? 'VOR/LOC' : m.includes('lnav') ? 'LNAV' : 'HDG SEL';
      pitch = m.includes('gs') || m.includes('g/s') ? 'G/S' : m.includes('vs') || m.includes('v/s') ? 'V/S' : m.includes('vnav') ? 'VNAV PTH' : m.includes('lvl') || m.includes('chg') ? 'LVL CHG' : 'ALT HOLD';
      if (nav.ils.active && roll !== 'VOR/LOC') armedR = 'VOR/LOC';
      if (nav.ils.active && pitch !== 'G/S') armedP = 'G/S';
    }
    const now = t;
    if (at !== fma.at) { fma.at = at; fma.tAt = now; }
    if (roll !== fma.roll) { fma.roll = roll; fma.tRoll = now; }
    if (pitch !== fma.pitch) { fma.pitch = pitch; fma.tPitch = now; }
    const y = 3.6 * u, x0 = 17 * u, cw = 22 * u;
    g.strokeStyle = B.grayLine; g.lineWidth = 1;
    g.beginPath(); g.moveTo(Math.round(x0 + cw) + 0.5, 0.8 * u); g.lineTo(Math.round(x0 + cw) + 0.5, 9.5 * u); g.moveTo(Math.round(x0 + cw * 2) + 0.5, 0.8 * u); g.lineTo(Math.round(x0 + cw * 2) + 0.5, 9.5 * u); g.stroke();
    const col = (txt, i, tm) => {
      if (!txt) return;
      const cx = x0 + cw * i + cw / 2;
      text(g, txt, cx, y, B.green, fonts.fma, 'center');
      if (now - tm < 10 && now > 0.5) { g.strokeStyle = B.white; g.lineWidth = Math.max(1, u * 0.25); g.strokeRect(cx - cw * 0.45, y - 2.4 * u, cw * 0.9, 4.8 * u); }
    };
    col(at, 0, fma.tAt); col(roll, 1, fma.tRoll); col(pitch, 2, fma.tPitch);
    if (armedR) text(g, armedR, x0 + cw * 1.5, y + 4.4 * u, B.white, fonts.xs, 'center');
    if (armedP) text(g, armedP, x0 + cw * 2.5, y + 4.4 * u, B.white, fonts.xs, 'center');
    if (ap.engaged !== fma.cmd) { fma.cmd = !!ap.engaged; fma.tCmd = now; }
    if (ap.engaged) {
      text(g, 'CMD', 50 * u, 13.4 * u, B.green, fonts.l, 'center');
      if (now - fma.tCmd < 10 && now > 0.5) { g.strokeStyle = B.white; g.strokeRect(43 * u, 10.6 * u, 14 * u, 5.6 * u); }
    } else if (now - fma.tCmd < 6 && now > 2 && fma.tCmd > 0) {
      if (flash(t, 0.5)) text(g, 'A/P DISENGAGED', 50 * u, 13.4 * u, B.red, fonts.n, 'center');
    }
  }

  // speed tape: knots, trend vector, V-speed bugs, barber poles
  function speedTape(g, s, def, E) {
    const x = 3 * u, w = 13.5 * u, top = 14 * u, bot = 77 * u, cy = 45.5 * u;
    const ias = Math.max(0, num(s.ias) / KT);
    const pp = (bot - top) / 80;        // ±40 kt visible
    const lw = Math.max(1, u * 0.3);
    g.fillStyle = B.gray; g.fillRect(x, top, w, bot - top);
    g.save(); g.beginPath(); g.rect(x, top, w + 9.5 * u, bot - top); g.clip();
    g.strokeStyle = B.white; g.lineWidth = lw; g.beginPath();
    const disp = Math.max(30, ias);
    for (let k = Math.ceil((disp - 44) / 10) * 10; k <= disp + 44; k += 10) {
      if (k < 30) continue;
      const y = Math.round(cy + (disp - k) * pp) + 0.5;
      g.moveTo(x + w - 2 * u, y); g.lineTo(x + w, y);
      if (k % 20 === 0) text(g, F.int(k), x + w - 2.8 * u, y, B.white, fonts.s, 'right');
    }
    g.stroke();
    // stall / min-manoeuvre bands (airborne), overspeed barber pole
    const mass = num(s.mass, def.specs?.typicalMass || 1), mref = def.specs?.typicalMass || mass;
    const flaps = num(s.surfaces?.flaps, 0);
    const vs = num(def.specs?.stallSpeed, 55) / KT * (1 + 0.32 * (1 - flaps)) * Math.sqrt(clamp(mass / mref, 0.6, 1.5));
    const shaker = vs * 1.06, minMan = vs * 1.28;
    const yOf = (v) => cy + (disp - v) * pp;
    const bx = x + w - 1.2 * u, bw = 1.2 * u;
    if (!s.onGround) {
      barber(g, bx, yOf(shaker), bw, bot + 10 * u);
      g.strokeStyle = B.amber; g.lineWidth = Math.max(1, u * 0.45);
      g.beginPath(); g.moveTo(bx + bw * 0.5, yOf(minMan)); g.lineTo(bx + bw * 0.5, yOf(shaker)); g.moveTo(bx - u, yOf(minMan)); g.lineTo(bx + bw, yOf(minMan)); g.stroke();
    }
    let vmax = VMO;
    const mach = num(s.mach);
    if (mach > 0.3 && ias > 50) vmax = Math.min(vmax, ias * MMO / mach);
    if (flaps > 0.01) { const det = +flapDetent(flaps); for (const [f, v] of FLAP_VFE) if (f === det) vmax = Math.min(vmax, v); }
    if (num(s.surfaces?.gear, 0) > 0.02) vmax = Math.min(vmax, VLE);
    barber(g, bx, top - 10 * u, bw, yOf(vmax));
    // bugs: V1 / VR / V2 on the takeoff roll, REF / +20 on approach, selected speed (magenta)
    const sp = def.specs || {};
    const vr = num(sp.rotateSpeed, 75) / KT, vapp = num(sp.approachSpeed, 72) / KT;
    const bugs = [];
    if (s.onGround && ias < vr + 30) { bugs.push(['V1', vr - 6], ['VR', vr], ['V2', vr + 9]); }
    else if (num(s.surfaces?.gear, 0) > 0.5 || flaps > 0.3) { bugs.push(['REF', vapp - 5], ['+20', vapp + 15]); }
    g.lineWidth = lw;
    let off = 0;
    for (const [lab, v] of bugs) {
      const y = yOf(v);
      if (y < top) {   // off-scale above: digital readout at the top of the tape
        const yy = top + 3 * u + off * 4 * u; off++;
        g.fillStyle = B.black; g.fillRect(x, yy - 2 * u, w, 4 * u);
        text(g, lab, x + 0.8 * u, yy, B.green, fonts.xs, 'left');
        text(g, F.int(Math.round(v)), x + w - 0.6 * u, yy, B.green, fonts.xs, 'right');
        continue;
      }
      if (y > bot) continue;
      g.strokeStyle = B.green; g.beginPath(); g.moveTo(x + w, y); g.lineTo(x + w + 1.6 * u, y); g.stroke();
      text(g, lab, x + w + 1.8 * u, y, B.green, fonts.xs, 'left');
    }
    if (s.ap?.autothrottle || s.ap?.engaged) {
      const v = num(s.ap.speed) / KT;
      if (v > 30) {
        const y = clamp(yOf(v), top, bot);
        g.strokeStyle = B.magenta; g.lineWidth = Math.max(1, u * 0.4);
        g.beginPath(); g.moveTo(x + w, y); g.lineTo(x + w + 1.8 * u, y - 1.4 * u); g.lineTo(x + w + 3 * u, y - 1.4 * u); g.lineTo(x + w + 3 * u, y + 1.4 * u); g.lineTo(x + w + 1.8 * u, y + 1.4 * u); g.closePath(); g.stroke();
      }
    }
    g.restore();
    // trend vector (10 s prediction)
    const tr = E.accel * 10;
    if (Math.abs(tr) > 2 && !s.onGround) {
      const y1 = clamp(cy - tr * pp, top, bot);
      g.strokeStyle = B.green; g.lineWidth = Math.max(1, u * 0.4);
      g.beginPath(); g.moveTo(x + w + 0.6 * u, cy); g.lineTo(x + w + 0.6 * u, y1);
      const d = tr > 0 ? 1 : -1;
      g.moveTo(x + w - 0.6 * u, y1 + d * 1.4 * u); g.lineTo(x + w + 0.6 * u, y1); g.lineTo(x + w + 1.8 * u, y1 + d * 1.4 * u); g.stroke();
    }
    // current speed box; the ones digit sits in an expanded drum window (Boeing style)
    const bh = 6.4 * u, bxl = x + 0.2 * u, bxr = x + w - 0.4 * u, ow = 3.6 * u, oh = 10 * u;
    g.fillStyle = B.black; g.strokeStyle = B.white; g.lineWidth = Math.max(1, u * 0.35);
    g.beginPath();
    g.moveTo(bxl, cy - bh / 2); g.lineTo(bxr - ow, cy - bh / 2); g.lineTo(bxr - ow, cy - oh / 2); g.lineTo(bxr, cy - oh / 2);
    g.lineTo(bxr, cy - 1 * u); g.lineTo(bxr + 1.4 * u, cy); g.lineTo(bxr, cy + 1 * u);
    g.lineTo(bxr, cy + oh / 2); g.lineTo(bxr - ow, cy + oh / 2); g.lineTo(bxr - ow, cy + bh / 2); g.lineTo(bxl, cy + bh / 2); g.closePath();
    g.fill(); g.stroke();
    const spdColor = s.overspeed || ias > vmax + 1 ? B.red : B.white;
    if (ias >= 30) drumDigits(g, ias, bxr, cy, bh, oh, ow, spdColor);
    else text(g, '---', (bxl + bxr) / 2, cy, B.white, fonts.l, 'center');
    // selected speed above, Mach / GS below
    if (s.ap?.autothrottle || s.ap?.engaged) text(g, F.int(num(s.ap.speed) / KT), x + w * 0.5, top - 2.6 * u, B.magenta, fonts.n, 'center');
    if (mach >= 0.4) text(g, fmt.mach3(Math.round(mach * 1000)), x + w * 0.5, bot + 3 * u, B.white, fonts.n, 'center');
    else { text(g, 'GS', x + 0.5 * u, bot + 3 * u, B.white, fonts.xs, 'left'); text(g, F.int(num(s.groundSpeed) / KT), x + w, bot + 3 * u, B.white, fonts.n, 'right'); }
  }

  function barber(g, x, y0, w, y1) {
    if (y1 <= y0) return;
    g.fillStyle = '#000'; g.fillRect(x, y0, w, y1 - y0);
    g.fillStyle = B.red; const st = w * 1.6;
    for (let y = y0; y < y1; y += st * 2) g.fillRect(x, y, w, Math.min(st, y1 - y));
  }

  // rolling drum readout: the ones digit scrolls continuously in the tall window, tens/hundreds roll on 9 → 0
  function drumDigits(g, v, xr, cy, bh, oh, ow, color) {
    const ones = v % 10, base = Math.floor(v / 10);
    const fl = Math.floor(ones), fr = ones - fl;
    const dh = oh * 0.48, xc = xr - ow / 2;
    g.save(); g.beginPath(); g.rect(xr - ow, cy - oh / 2 + 0.3 * u, ow, oh - 0.6 * u); g.clip();
    for (let k = -1; k <= 2; k++) text(g, F.int(((fl + k) % 10 + 10) % 10), xc, cy + (fr - k) * dh + 0.2 * u, color, fonts.l, 'center');
    g.restore();
    const roll9 = fl === 9 ? fr : 0;
    g.save(); g.beginPath(); g.rect(xr - ow - 9 * u, cy - bh / 2 + 0.3 * u, 9 * u, bh - 0.6 * u); g.clip();
    for (let k = 0; k <= 1; k++) {
      const v2 = base + k;
      if (v2 > 0) text(g, F.int(v2), xr - ow, cy + (roll9 - k) * bh * 0.9 + 0.2 * u, color, fonts.l, 'right');
    }
    g.restore();
  }

  // altitude tape: feet, 20-ft drum, selected altitude bug, baro setting
  function altTape(g, s, E) {
    const x = 75 * u, w = 15 * u, top = 14 * u, bot = 77 * u, cy = 45.5 * u;
    const alt = num(s.altitude) / FT;
    const pp = (bot - top) / 800;      // ±400 ft visible
    const lw = Math.max(1, u * 0.3);
    g.fillStyle = B.gray; g.fillRect(x, top, w, bot - top);
    g.save(); g.beginPath(); g.rect(x - 4 * u, top, w + 4 * u, bot - top); g.clip();
    g.strokeStyle = B.white; g.lineWidth = lw; g.beginPath();
    for (let a = Math.ceil((alt - 440) / 100) * 100; a <= alt + 440; a += 100) {
      const y = Math.round(cy + (alt - a) * pp) + 0.5;
      g.moveTo(x, y); g.lineTo(x + 1.8 * u, y);
      if (a % 200 === 0) text(g, F.int(a), x + w - 0.6 * u, y, B.white, fonts.s, 'right');
      if (a % 1000 === 0) { g.moveTo(x + 2.4 * u, y - 2.6 * u); g.lineTo(x + w, y - 2.6 * u); g.moveTo(x + 2.4 * u, y + 2.6 * u); g.lineTo(x + w, y + 2.6 * u); }
    }
    g.stroke();
    // ground reference (landing elevation of the destination / ILS runway) as an amber hatched band
    const elevFt = (E.nav.ils.active ? E.nav.ils.rwy.elevation : (E.nav.dest?.elevation ?? null));
    if (elevFt !== null && E.nav.distNM < 30) {
      const y = cy + (alt - elevFt / FT) * pp;
      if (y < bot) {
        g.strokeStyle = B.amber; g.lineWidth = Math.max(1, u * 0.4); g.beginPath(); g.moveTo(x, y); g.lineTo(x + w * 0.5, y);
        for (let k = 0; k < 8; k++) { g.moveTo(x + k * 2 * u, y); g.lineTo(x + k * 2 * u - 2 * u, y + 2 * u); }
        g.stroke();
      }
    }
    // selected altitude bug
    if (s.ap?.engaged) {
      const sa = num(s.ap.altitude) / FT;
      const y = clamp(cy + (alt - sa) * pp, top, bot);
      g.strokeStyle = B.magenta; g.lineWidth = Math.max(1, u * 0.45);
      g.beginPath(); g.moveTo(x, y - 3 * u); g.lineTo(x + 2.2 * u, y - 3 * u); g.lineTo(x + 2.2 * u, y - 1 * u); g.lineTo(x + 0.8 * u, y); g.lineTo(x + 2.2 * u, y + 1 * u); g.lineTo(x + 2.2 * u, y + 3 * u); g.lineTo(x, y + 3 * u); g.stroke();
    }
    g.restore();
    // readout box: thousands + hundreds fixed, last two digits on a 20-ft drum
    const bh = 7 * u, bxl = x - 1.4 * u, bxr = x + w + 0.2 * u;
    g.fillStyle = B.black; g.strokeStyle = B.white; g.lineWidth = Math.max(1, u * 0.35);
    g.beginPath(); g.moveTo(bxl + 1.4 * u, cy - bh / 2); g.lineTo(bxr, cy - bh / 2); g.lineTo(bxr, cy + bh / 2); g.lineTo(bxl + 1.4 * u, cy + bh / 2); g.lineTo(bxl + 1.4 * u, cy + 1 * u); g.lineTo(bxl, cy); g.lineTo(bxl + 1.4 * u, cy - 1 * u); g.closePath();
    g.fill(); g.stroke();
    const neg = alt < 0, aa = Math.abs(alt);
    const v20 = aa / 20, b20 = Math.floor(v20), f20 = v20 - b20;
    const dh = bh * 0.55, drX = bxr - 0.6 * u;
    g.save(); g.beginPath(); g.rect(drX - u * 5.6, cy - bh / 2 + 0.3 * u, u * 5.8, bh - 0.6 * u); g.clip();
    for (let k = -1; k <= 2; k++) {
      const n = (((b20 + k) % 5) + 5) % 5;
      text(g, F.pad2(n * 20), drX, cy + (f20 - k) * dh + 0.2 * u, B.white, fonts.n, 'right');
    }
    g.restore();
    // hundreds / thousands (roll while the drum passes 80 → 00)
    const hund = Math.floor(aa / 100), rollH = (b20 % 5 === 4) ? f20 : 0;
    g.save(); g.beginPath(); g.rect(bxl + 1.6 * u, cy - bh / 2 + 0.3 * u, drX - u * 5.6 - bxl - 1.6 * u, bh - 0.6 * u); g.clip();
    for (let k = 0; k <= 1; k++) {
      const h2 = hund + k;
      const th = Math.floor(h2 / 10), hd = h2 % 10;
      const yy = cy + (rollH - k) * bh * 0.8 + 0.2 * u;
      if (h2 > 0 || neg) text(g, F.int(hd), drX - u * 5.6, yy, B.white, fonts.n, 'right');
      if (th > 0 || neg) text(g, (neg ? '-' : '') + F.int(th), drX - u * 8.6, yy, B.white, fonts.l, 'right');
    }
    g.restore();
    // selected altitude (top) and baro (bottom)
    if (s.ap?.engaged) text(g, F.int(Math.round(num(s.ap.altitude) / FT / 100) * 100), x + w / 2, top - 2.6 * u, B.magenta, fonts.n, 'center');
    text(g, '29.92', x + w - 3.6 * u, bot + 3 * u, B.green, fonts.n, 'right');
    text(g, 'IN', x + w + 0.2 * u, bot + 3 * u, B.green, fonts.xs, 'right');
  }

  // vertical speed indicator: non-linear scale 0/1/2/6 ×1000 fpm with a needle from an off-scale pivot
  const vsMap = (v) => { const a = Math.abs(v); const f = a <= 1000 ? 0.45 * a / 1000 : a <= 2000 ? 0.45 + 0.27 * (a - 1000) / 1000 : 0.72 + 0.28 * Math.min(1, (a - 2000) / 4000); return Math.sign(v) * f; };
  function vsi(g, s) {
    const x = 91.5 * u, w = 6.5 * u, cy = 45.5 * u, hh = 27 * u;
    g.fillStyle = B.gray;
    g.beginPath(); g.moveTo(x, cy - hh + 4 * u); g.lineTo(x + w * 0.5, cy - hh); g.lineTo(x + w, cy - hh); g.lineTo(x + w, cy + hh); g.lineTo(x + w * 0.5, cy + hh); g.lineTo(x, cy + hh - 4 * u); g.closePath(); g.fill();
    g.strokeStyle = B.white; g.lineWidth = Math.max(1, u * 0.3); g.beginPath();
    for (const v of [-6000, -2000, -1500, -1000, -500, 500, 1000, 1500, 2000, 6000]) {
      const y = cy - vsMap(v) * hh * 0.92, major = Math.abs(v) === 1000 || Math.abs(v) === 2000 || Math.abs(v) === 6000;
      g.moveTo(x + 0.4 * u, y); g.lineTo(x + (major ? 1.8 : 1.1) * u, y);
      if (major) text(g, F.int(Math.abs(v) / 1000), x + 3.4 * u, y, B.white, fonts.xs, 'center');
    }
    g.moveTo(x + 0.4 * u, cy); g.lineTo(x + 2.6 * u, cy);
    g.stroke();
    const vs = num(s.verticalSpeed) / FPM;
    const yv = cy - vsMap(vs) * hh * 0.92;
    g.strokeStyle = B.white; g.lineWidth = Math.max(1.5, u * 0.55);
    g.beginPath(); g.moveTo(x + w + 6 * u, cy); g.lineTo(x + 0.6 * u, yv); g.stroke();
    if (Math.abs(vs) > 400) text(g, F.int(Math.round(Math.abs(vs) / 50) * 50), x + w * 0.6, vs > 0 ? cy - hh - 2.6 * u : cy + hh + 2.6 * u, B.white, fonts.xs, 'center');
  }

  // compass rose segment at the bottom of the PFD (heading pointer, track line, selected heading bug)
  function headingRose(g, s, nav) {
    const cx = 50 * u, R = 40 * u, cy = 87 * u + R;
    const hdg = num(s.heading) * RAD;
    g.save(); g.beginPath(); g.rect(14 * u, 83 * u, 72 * u, 17 * u); g.clip();
    g.fillStyle = B.gray; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    g.strokeStyle = B.white; g.lineWidth = Math.max(1, u * 0.3); g.beginPath();
    for (let d = Math.ceil((hdg - 45) / 5) * 5; d <= hdg + 45; d += 5) {
      const a = (d - hdg) * DEG - Math.PI / 2, l = d % 10 === 0 ? 2.2 * u : 1.2 * u;
      g.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.lineTo(cx + Math.cos(a) * (R - l), cy + Math.sin(a) * (R - l));
      if (d % 10 === 0) {
        const v = wrap360(d) / 10, tx = cx + Math.cos(a) * (R - 4.4 * u), ty = cy + Math.sin(a) * (R - 4.4 * u);
        g.save(); g.translate(tx, ty); g.rotate(a + Math.PI / 2);
        text(g, F.int(v === 0 ? 36 : v), 0, 0, B.white, d % 30 === 0 ? fonts.n : fonts.xs, 'center');
        g.restore();
      }
    }
    g.stroke();
    // track line
    const trk = wrap180(num(s.track) * RAD - hdg);
    if (num(s.groundSpeed) > 15) {
      const a = trk * DEG - Math.PI / 2;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.lineTo(cx + Math.cos(a) * (R * 0.7), cy + Math.sin(a) * (R * 0.7)); g.stroke();
    }
    if (s.ap?.engaged) {
      const a = wrap180(num(s.ap.heading) * RAD - hdg) * DEG - Math.PI / 2;
      g.save(); g.translate(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.rotate(a + Math.PI / 2);
      g.strokeStyle = B.magenta; g.lineWidth = Math.max(1, u * 0.45); g.beginPath();
      g.moveTo(-2 * u, 0); g.lineTo(-2 * u, -1.4 * u); g.lineTo(-0.8 * u, -1.4 * u); g.lineTo(0, 0); g.lineTo(0.8 * u, -1.4 * u); g.lineTo(2 * u, -1.4 * u); g.lineTo(2 * u, 0); g.stroke();
      g.restore();
    }
    g.restore();
    // fixed pointer + digital heading
    g.fillStyle = B.white; g.beginPath(); g.moveTo(cx, cy - R + 0.2 * u); g.lineTo(cx - 1.3 * u, cy - R - 2 * u); g.lineTo(cx + 1.3 * u, cy - R - 2 * u); g.closePath(); g.fill();
    text(g, F.deg3(Math.round(hdg)), cx - 6 * u, 84.5 * u, B.white, fonts.n, 'right');
    text(g, 'TRU', cx + 6 * u, 84.5 * u, B.green, fonts.xs, 'left');
  }

  // ======================================== ND (MAP, track-up) ========================================
  function nd(g, d, E) {
    const { s, nav, ctx } = E;
    setScale(d);
    g.save(); g.translate(d.x, d.y);
    g.beginPath(); g.rect(0, 0, d.w, d.h); g.clip();
    const ax = 50 * u, ay = 80 * u, R = 64 * u;
    const gsm = num(s.groundSpeed);
    const trk = (gsm > 15 ? num(s.track) : num(s.heading)) * RAD;
    const hdg = num(s.heading) * RAD;
    // auto range: fit the destination when it's reasonably close, minimum by altitude
    const want = clamp(Math.max(nav.distNM * 1.15, num(s.agl, 0) / FT < 3000 ? 5 : 10), 5, 320);
    let r = ND_RANGES.find(x => x >= want) || 320;
    if (r < ndRange && want > r * 0.85) r = ndRange;     // hysteresis
    ndRange = r;
    const scale = R / (ndRange * NM);
    const st = Math.sin(trk * DEG), ct = Math.cos(trk * DEG);
    const P = { x: 0, y: 0 };
    const toScr = (wx, wz) => { const dx = wx - s.position.x, dn = -(wz - s.position.z); const f = dx * st + dn * ct, rr = dx * ct - dn * st; P.x = ax + rr * scale; P.y = ay - f * scale; return P; };
    // compass arc
    g.save();
    g.beginPath(); g.rect(0, 9 * u, d.w, d.h - 9 * u); g.clip();
    g.strokeStyle = B.white; g.lineWidth = Math.max(1, u * 0.3);
    g.beginPath(); g.arc(ax, ay, R, -Math.PI / 2 - 52 * DEG, -Math.PI / 2 + 52 * DEG); g.stroke();
    g.beginPath();
    for (let dg = Math.ceil((trk - 55) / 5) * 5; dg <= trk + 55; dg += 5) {
      const a = (dg - trk) * DEG - Math.PI / 2, l = dg % 10 === 0 ? 2.4 * u : 1.3 * u;
      g.moveTo(ax + Math.cos(a) * R, ay + Math.sin(a) * R); g.lineTo(ax + Math.cos(a) * (R - l), ay + Math.sin(a) * (R - l));
      if (dg % 30 === 0) {
        const v = wrap360(dg) / 10;
        g.save(); g.translate(ax + Math.cos(a) * (R - 5 * u), ay + Math.sin(a) * (R - 5 * u)); g.rotate(a + Math.PI / 2);
        text(g, F.int(v === 0 ? 36 : v), 0, 0, B.white, fonts.n, 'center'); g.restore();
      }
    }
    g.stroke();
    // range ring (half range) dashed + label
    g.setLineDash([u * 1.2, u * 1.6]); g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.beginPath(); g.arc(ax, ay, R / 2, -Math.PI / 2 - 70 * DEG, -Math.PI / 2 + 70 * DEG); g.stroke();
    g.setLineDash([]);
    text(g, F.int(ndRange / 2 >= 1 ? ndRange / 2 : 1), ax - Math.sin(60 * DEG) * R / 2 - 1.5 * u, ay - Math.cos(60 * DEG) * R / 2, B.white, fonts.xs, 'right');
    // airports and runways
    for (const a of AIRPORTS) {
      const p = toScr(a.position.x, a.position.z);
      if (p.x < -10 * u || p.x > d.w + 10 * u || p.y < 0 || p.y > d.h + 5 * u) continue;
      const isDest = nav.dest && a.id === nav.dest.id;
      const px = p.x, py = p.y;
      const rwPx = 3000 * scale;
      if (rwPx > 8) {
        for (const rw of a.runways) {
          const hd = rw.heading * DEG, dx = Math.sin(hd) * rw.length / 2, dz = -Math.cos(hd) * rw.length / 2;
          const p1 = toScr(rw.center.x - dx, rw.center.z - dz); const x1 = p1.x, y1 = p1.y;
          const p2 = toScr(rw.center.x + dx, rw.center.z + dz);
          const wpx = Math.max(1.5, rw.width * scale);
          g.strokeStyle = B.white; g.lineWidth = wpx; g.beginPath(); g.moveTo(x1, y1); g.lineTo(p2.x, p2.y); g.stroke();
          if (wpx > 4) { g.strokeStyle = '#000'; g.lineWidth = Math.max(1, wpx - 2.5); g.beginPath(); g.moveTo(x1, y1); g.lineTo(p2.x, p2.y); g.stroke(); }
        }
        // extended centreline for the active ILS runway
        if (nav.ils.active && nav.ils.rwy.airport === a) {
          const rr = nav.ils.rwy, q1 = toScr(rr.threshold.x, rr.threshold.z); const tx = q1.x, ty = q1.y;
          const q2 = toScr(rr.threshold.x - rr.dir.x * 14 * NM, rr.threshold.z - rr.dir.z * 14 * NM);
          g.setLineDash([u * 2, u * 1.4]); g.strokeStyle = B.white; g.lineWidth = Math.max(1, u * 0.3);
          g.beginPath(); g.moveTo(tx, ty); g.lineTo(q2.x, q2.y); g.stroke(); g.setLineDash([]);
        }
        text(g, a.id, px + Math.max(4 * u, rwPx * 0.6), py - 2 * u, isDest ? B.magenta : B.cyan, fonts.s, 'left');
      } else {
        g.strokeStyle = isDest ? B.magenta : B.cyan; g.lineWidth = Math.max(1, u * 0.35);
        g.beginPath(); g.arc(px, py, 1.6 * u, 0, Math.PI * 2); g.stroke();
        text(g, a.id, px + 2.6 * u, py - 1.8 * u, isDest ? B.magenta : B.cyan, fonts.s, 'left');
      }
    }
    // route: direct-to line to the destination
    if (nav.dest) {
      const p = toScr(nav.dest.position.x, nav.dest.position.z);
      g.strokeStyle = B.magenta; g.lineWidth = Math.max(1.5, u * 0.5);
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(p.x, p.y); g.stroke();
    }
    // trend vector: predicted path at 30/60/90 s from the current bank angle
    if (!s.onGround && gsm > 30) {
      const omega = 9.80665 * Math.tan(clamp(num(s.roll), -1.2, 1.2)) / Math.max(30, num(s.tas, gsm));
      g.strokeStyle = B.green; g.lineWidth = Math.max(1, u * 0.45);
      let px = ax, py = ay, ang = 0;
      g.beginPath(); g.moveTo(px, py);
      for (let tt = 1; tt <= 90; tt += 3) {
        ang += omega * 3; px += Math.sin(ang) * gsm * 3 * scale; py -= Math.cos(ang) * gsm * 3 * scale;
        if (tt % 30 < 3 && tt > 3) { g.lineTo(px, py); g.stroke(); g.beginPath(); g.moveTo(px + Math.cos(ang) * u * 0.6, py + Math.sin(ang) * u * 0.6); }
        else g.lineTo(px, py);
      }
      g.stroke();
    }
    g.restore();
    // heading pointer on the arc, selected heading bug
    {
      const a = wrap180(hdg - trk) * DEG - Math.PI / 2;
      g.fillStyle = B.white; g.save(); g.translate(ax + Math.cos(a) * R, ay + Math.sin(a) * R); g.rotate(a + Math.PI / 2);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(-1.4 * u, -2.6 * u); g.lineTo(1.4 * u, -2.6 * u); g.closePath(); g.fill(); g.restore();
      if (s.ap?.engaged) {
        const b = wrap180(num(s.ap.heading) * RAD - trk) * DEG - Math.PI / 2;
        g.save(); g.translate(ax + Math.cos(b) * R, ay + Math.sin(b) * R); g.rotate(b + Math.PI / 2);
        g.strokeStyle = B.magenta; g.lineWidth = Math.max(1, u * 0.45); g.beginPath();
        g.moveTo(-2.2 * u, 0); g.lineTo(-2.2 * u, -1.6 * u); g.lineTo(-0.9 * u, -1.6 * u); g.lineTo(0, 0); g.lineTo(0.9 * u, -1.6 * u); g.lineTo(2.2 * u, -1.6 * u); g.lineTo(2.2 * u, 0); g.stroke(); g.restore();
      }
    }
    // own-ship symbol
    g.strokeStyle = B.white; g.lineWidth = Math.max(1.5, u * 0.5);
    g.beginPath(); g.moveTo(ax, ay - 3.4 * u); g.lineTo(ax - 2.2 * u, ay + 2.6 * u); g.lineTo(ax + 2.2 * u, ay + 2.6 * u); g.closePath(); g.stroke();
    // track box at the top
    g.fillStyle = B.black; g.fillRect(ax - 11 * u, 1.2 * u, 22 * u, 6.2 * u);
    g.strokeStyle = B.white; g.lineWidth = 1; g.strokeRect(ax - 7.5 * u, 1.2 * u, 15 * u, 6.2 * u);
    text(g, 'TRK', ax - 8.5 * u, 4.4 * u, B.green, fonts.xs, 'right');
    text(g, F.deg3(Math.round(trk)), ax, 4.4 * u, B.white, fonts.l, 'center');
    text(g, 'TRU', ax + 8.5 * u, 4.4 * u, B.green, fonts.xs, 'left');
    // ground speed / true airspeed, wind
    text(g, 'GS', 2 * u, 4 * u, B.white, fonts.xs, 'left'); text(g, F.int(gsm / KT), 7.5 * u, 4 * u, B.white, fonts.n, 'left');
    text(g, 'TAS', 17 * u, 4 * u, B.white, fonts.xs, 'left'); text(g, F.int(num(s.tas) / KT), 23.5 * u, 4 * u, B.white, fonts.n, 'left');
    const w = ctx.weather;
    if (w && num(w.windSpeed) > 0.5) {
      const wf = num(w.windFrom), ws = num(w.windSpeed) / KT;
      text(g, fmt.wind(Math.round(wf) * 1000 + Math.round(ws)), 2 * u, 9 * u, B.white, fonts.s, 'left');
      const a = (wf + 180 - trk) * DEG;    // arrow: direction the wind blows, track-up
      const cx = 6 * u, cy = 15.5 * u, L = 3.2 * u;
      g.strokeStyle = B.white; g.lineWidth = Math.max(1, u * 0.4);
      const ex = cx + Math.sin(a) * L, ey = cy - Math.cos(a) * L;
      g.beginPath(); g.moveTo(cx - Math.sin(a) * L, cy + Math.cos(a) * L); g.lineTo(ex, ey);
      g.moveTo(ex, ey); g.lineTo(ex - Math.sin(a - 0.5) * u * 1.6, ey + Math.cos(a - 0.5) * u * 1.6);
      g.moveTo(ex, ey); g.lineTo(ex - Math.sin(a + 0.5) * u * 1.6, ey + Math.cos(a + 0.5) * u * 1.6); g.stroke();
    }
    // destination: ident, ETA, distance (top right)
    if (nav.dest) {
      text(g, nav.dest.id, 98 * u, 3.6 * u, B.magenta, fonts.n, 'right');
      const tod = num(ctx.time?.timeOfDay, 12);
      if (isFinite(nav.ttg)) text(g, fmt.hhmm(Math.round(((tod + nav.ttg / 3600) % 24) * 600)), 98 * u, 8.6 * u, B.white, fonts.s, 'right');
      text(g, nav.distNM < 100 ? F.tenth(Math.round(nav.distNM * 10)) : F.int(nav.distNM), 92 * u, 13.4 * u, B.white, fonts.n, 'right');
      text(g, 'NM', 98 * u, 13.4 * u, B.white, fonts.xs, 'right');
    }
    if (nav.ils.active) {
      text(g, nav.ils.ident, 98 * u, 92 * u, B.white, fonts.s, 'right');
      text(g, 'DME', 85 * u, 96.5 * u, B.white, fonts.xs, 'right');
      text(g, F.tenth(Math.round(nav.ils.dme * 10)), 98 * u, 96.5 * u, B.white, fonts.s, 'right');
    }
    text(g, 'MAP', 2 * u, 96.5 * u, B.green, fonts.xs, 'left');
    g.restore();
  }

  // ======================================== EICAS ========================================
  function eicas(g, d, E) {
    const { s, def } = E;
    setScale({ w: d.h });         // units from the display height so fonts match the PFD
    g.save(); g.translate(d.x, d.y);
    g.beginPath(); g.rect(0, 0, d.w, d.h); g.clip();
    const en = s.engines?.length ? s.engines : [{}, {}];
    const n = Math.min(2, en.length);
    const colW = d.w / Math.max(2, n);
    for (let i = 0; i < n; i++) {
      const e = en[i] || {};
      const cx = colW * (i + 0.5);
      dial(g, cx - 2 * u, 21 * u, 13 * u, num(e.n1) * 100, 0, 110, 104, F.tenth(Math.round(num(e.n1) * 1000)), 'N1', num(s.throttle) * 75 + 25, e.reverser > 0.1 ? 'REV' : '');
      dial(g, cx - 2 * u, 49 * u, 9.5 * u, num(e.egt), 0, 1100, 950, F.int(num(e.egt)), 'EGT', null, '');
    }
    // fuel flow row
    let y = 64 * u;
    text(g, 'FF', d.w / 2, y, B.cyan, fonts.xs, 'center');
    for (let i = 0; i < n; i++) text(g, F.tenth(Math.round(num(en[i]?.fuelFlow) * 3600 / LB / 100)), colW * (i + 0.5), y, B.white, fonts.n, 'center');
    // fuel quantity, total (lb ×1000)
    y = 73 * u;
    text(g, 'FUEL', 5 * u, y, B.cyan, fonts.xs, 'left');
    text(g, F.tenth(Math.round(num(s.fuel) / LB / 100)), 34 * u, y, s.fuelCapacity > 0 && s.fuel < s.fuelCapacity * 0.1 ? B.amber : B.white, fonts.l, 'right');
    text(g, 'LB×1000', 36 * u, y, B.cyan, fonts.xs, 'left');
    // gear indicators (three boxes)
    const gear = num(s.surfaces?.gear, 1);
    const gx = 5 * u, gy = 80 * u, gw = 11 * u, gh = 5 * u;
    for (let i = 0; i < 3; i++) {
      const bx = gx + i * (gw + 1.2 * u) + (i === 1 ? 0 : 0), by = gy + (i === 1 ? -0 : 0);
      if (gear > 0.98) { g.strokeStyle = B.green; g.lineWidth = Math.max(1, u * 0.35); g.strokeRect(bx, by, gw, gh); text(g, 'DOWN', bx + gw / 2, by + gh / 2 + 0.2 * u, B.green, fonts.xs, 'center'); }
      else if (gear > 0.02) { g.fillStyle = B.amber; g.strokeStyle = B.amber; g.lineWidth = Math.max(1, u * 0.35); g.strokeRect(bx, by, gw, gh); g.fillRect(bx + 1, by + 1, gw - 2, gh - 2); }
      else { g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 1; g.strokeRect(bx, by, gw, gh); text(g, 'UP', bx + gw / 2, by + gh / 2 + 0.2 * u, 'rgba(255,255,255,0.6)', fonts.xs, 'center'); }
    }
    text(g, 'GEAR', gx, gy + gh + 2.8 * u, B.cyan, fonts.xs, 'left');
    // flap position gauge (vertical tape 0..40)
    const fl = num(s.surfaces?.flaps, 0);
    const fxg = d.w - 9 * u, fyt = 66 * u, fyb = 92 * u;
    g.strokeStyle = B.white; g.lineWidth = Math.max(1, u * 0.3); g.strokeRect(fxg - 1.4 * u, fyt, 2.8 * u, fyb - fyt);
    g.fillStyle = B.green; g.fillRect(fxg - 1.4 * u, fyt, 2.8 * u, (fyb - fyt) * fl);
    text(g, 'FLAPS', fxg + 1.4 * u, fyb + 3 * u, B.cyan, fonts.xs, 'right');
    const det = flapDetent(fl);
    text(g, det, fxg - 3 * u, fyt + (fyb - fyt) * fl, B.green, fonts.n, 'right');
    // discrete annunciations
    let ay = 92 * u;
    const ann = (txt, c) => { text(g, txt, 5 * u, ay, c, fonts.s, 'left'); ay -= 4.4 * u; };
    const sb = num(s.surfaces?.speedbrake, 0);
    if (s.parkingBrake) ann('PARKING BRAKE', B.amber);
    if (sb > 0.05) ann(s.onGround ? 'SPEED BRAKE EXT' : 'SPEED BRAKE EXT', B.amber);
    if (en.some(e => e && e.running === false)) ann('ENG SHUTDOWN', B.amber);
    g.restore();
  }

  // round dial: 210° arc, red-line, needle, digital box; cmd = thrust-lever reference (cyan tick)
  function dial(g, cx, cy, r, v, vmin, vmax, red, label, name, cmd, extra) {
    const a0 = Math.PI * 0.75 - Math.PI * 0.5 + Math.PI / 2, sweep = Math.PI * 1.17;   // start at ~ 7 o'clock... going clockwise
    const start = Math.PI * 0.5 + Math.PI * 0.25 + 0.1;  // ~ 7:30
    const toA = (x) => start + clamp((x - vmin) / (vmax - vmin), 0, 1.05) * sweep;
    g.lineWidth = Math.max(1, u * 0.4);
    // filled sector up to the value (dim), arc, red line
    g.fillStyle = 'rgba(160,170,180,0.28)'; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, r, start, toA(v)); g.closePath(); g.fill();
    g.strokeStyle = B.white; g.beginPath(); g.arc(cx, cy, r, start, toA(red)); g.stroke();
    g.strokeStyle = B.red; g.lineWidth = Math.max(1.5, u * 0.6); g.beginPath();
    const ar = toA(red); g.moveTo(cx + Math.cos(ar) * r, cy + Math.sin(ar) * r); g.lineTo(cx + Math.cos(ar) * (r + 2.2 * u), cy + Math.sin(ar) * (r + 2.2 * u)); g.stroke();
    if (cmd !== null && cmd !== undefined) {
      const ac = toA(cmd); g.strokeStyle = B.cyan; g.lineWidth = Math.max(1, u * 0.45);
      g.beginPath(); g.moveTo(cx + Math.cos(ac) * (r + 0.4 * u), cy + Math.sin(ac) * (r + 0.4 * u)); g.lineTo(cx + Math.cos(ac) * (r + 2.4 * u), cy + Math.sin(ac) * (r + 2.4 * u)); g.stroke();
    }
    const av = toA(v);
    g.strokeStyle = v > red ? B.red : B.white; g.lineWidth = Math.max(1.5, u * 0.55);
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(av) * r * 0.95, cy + Math.sin(av) * r * 0.95); g.stroke();
    // digital readout box (upper right of the dial)
    const bw = 11 * u, bh = 5.2 * u, bx = cx + r * 0.3, by = cy - r - bh * 1.0;
    g.fillStyle = B.black; g.fillRect(bx, by, bw, bh);
    g.strokeStyle = B.white; g.lineWidth = 1; g.strokeRect(bx, by, bw, bh);
    text(g, label, bx + bw - 0.8 * u, by + bh / 2 + 0.2 * u, v > red ? B.red : B.white, fonts.n, 'right');
    text(g, name, cx - r * 0.1, cy + r * 0.55, B.cyan, fonts.xs, 'center');
    if (extra) text(g, extra, cx, cy - r * 0.35, B.green, fonts.xs, 'center');
  }

  // compact engine/config strip (phones)
  function strip(g, d, E) {
    const { s } = E;
    const en = s.engines?.length ? s.engines : [{}];
    setScale({ w: d.vertical ? d.h : d.w });
    g.save(); g.translate(d.x, d.y);
    const items = [];
    for (let i = 0; i < Math.min(2, en.length); i++) items.push([i ? 'N1 2' : 'N1 1', F.tenth(Math.round(num(en[i].n1) * 1000)), B.white]);
    const gear = num(s.surfaces?.gear, 1);
    items.push(['GEAR', gear > 0.98 ? 'DOWN' : gear < 0.02 ? 'UP' : 'TRANS', gear > 0.98 ? B.green : gear < 0.02 ? B.white : B.amber]);
    items.push(['FLAPS', flapDetent(num(s.surfaces?.flaps, 0)), B.green]);
    items.push(['FUEL', F.tenth(Math.round(num(s.fuel) / LB / 100)), B.white]);
    if (num(s.surfaces?.speedbrake, 0) > 0.05) items.push(['SPD BRK', 'EXT', B.amber]);
    if (s.parkingBrake) items.push(['PARK BRK', 'SET', B.amber]);
    const n = items.length;
    for (let i = 0; i < n; i++) {
      const [lab, val, c] = items[i];
      let x, y;
      if (d.vertical) { x = d.w * 0.1; y = d.h * (i + 0.5) / n; text(g, lab, x, y - fs * 0.55, B.cyan, fonts.xs, 'left'); text(g, val, x, y + fs * 0.5, c, fonts.n, 'left'); }
      else { x = d.w * (i + 0.5) / n; y = d.h / 2; text(g, lab, x, y - fs * 0.6, B.cyan, fonts.xs, 'center'); text(g, val, x, y + fs * 0.55, c, fonts.n, 'center'); }
    }
    g.restore();
  }

  return { draw, invalidate() { key = -1; } };
}
