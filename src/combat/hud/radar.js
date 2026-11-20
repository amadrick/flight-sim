// Combat HUD — tactical situation scope: heading-up, own ship in the centre, range rings, friends / enemies / missiles,
// the designated target, steer point and home base. The outer band doubles as the radar-warning ring: who is locking
// us (amber chevrons) and inbound missiles (red, with their bearing).
// The static layer (rings, cone, own-ship symbol) is cached; per frame ≈ 40–80 draw calls.
import { radarPoint, relBearing, autoRange, RADAR_RANGES_NM, NM, RAD } from './math.js';
import { F, makeLayer } from '../../ui/hud/common.js';

export function createRadar(cv, tok) {
  const g = cv.getContext('2d');
  let layer = null, key = '', S = 1, R = 1, dpr = 1, fs = 10;
  const pt = { x: 0, y: 0, r: 0, clipped: false };
  let rangeNm = 10;
  let manual = 0;          // 0 = auto, else index+1 into RADAR_RANGES_NM
  const C = { hud: tok.hud, red: '#ff5a4a', blue: '#5ec8ff', amber: tok.accent, mag: '#ff6cf4', fg: tok.fg, dim: 'rgba(214,226,238,0.55)', faint: 'rgba(214,226,238,0.16)' };
  const fontS = () => `600 ${fs}px ${tok.mono}`;
  let fS = '', fXS = '';

  function build() {
    layer = layer || makeLayer(1, 1);
    layer.width = Math.round(S * dpr); layer.height = Math.round(S * dpr);
    const l = layer.getContext('2d');
    l.setTransform(dpr, 0, 0, dpr, 0, 0); l.clearRect(0, 0, S, S);
    const c = S / 2;
    // scope disc
    l.fillStyle = 'rgba(4,10,14,0.28)'; l.beginPath(); l.arc(c, c, R, 0, Math.PI * 2); l.fill();
    l.strokeStyle = C.faint; l.lineWidth = 1;
    for (const k of [1 / 3, 2 / 3]) { l.beginPath(); l.arc(c, c, R * k, 0, Math.PI * 2); l.stroke(); }
    l.strokeStyle = 'rgba(214,226,238,0.32)'; l.beginPath(); l.arc(c, c, R, 0, Math.PI * 2); l.stroke();
    // RWR band ticks every 30°, longer at the cardinal relative bearings
    l.strokeStyle = C.dim; l.beginPath();
    for (let a = 0; a < 360; a += 30) {
      const r0 = R + 2, r1 = R + (a % 90 === 0 ? 7 : 4), s = Math.sin(a / RAD), co = Math.cos(a / RAD);
      l.moveTo(c + s * r0, c - co * r0); l.lineTo(c + s * r1, c - co * r1);
    }
    l.stroke();
    // radar coverage cone ±60°
    l.strokeStyle = 'rgba(93,255,155,0.22)'; l.setLineDash([3, 4]); l.beginPath();
    const a = 60 / RAD;
    l.moveTo(c, c); l.lineTo(c + Math.sin(a) * R, c - Math.cos(a) * R);
    l.moveTo(c, c); l.lineTo(c - Math.sin(a) * R, c - Math.cos(a) * R);
    l.stroke(); l.setLineDash([]);
    // own ship
    const k = Math.max(5, S * 0.035);
    l.strokeStyle = C.hud; l.lineWidth = 1.6; l.beginPath();
    l.moveTo(c, c - k * 1.2); l.lineTo(c, c + k); l.moveTo(c - k, c - k * 0.1); l.lineTo(c + k, c - k * 0.1); l.moveTo(c - k * 0.45, c + k); l.lineTo(c + k * 0.45, c + k);
    l.stroke();
  }

  function fit(size, d) {
    const k = size + ':' + d;
    if (k === key) return;
    key = k; S = size; dpr = d;
    cv.width = Math.round(S * dpr); cv.height = Math.round(S * dpr);
    R = Math.round(S / 2 - Math.max(11, S * 0.07));
    fs = Math.round(Math.max(9, Math.min(12, S * 0.055)));
    fS = fontS(); fXS = `600 ${Math.max(8, fs - 1)}px ${tok.display}`;
    build();
  }

  /** Cycle range on tap: auto → 5 → … → 80 → auto. Returns the label. */
  function cycle() { manual = (manual + 1) % (RADAR_RANGES_NM.length + 1); return manual ? RADAR_RANGES_NM[manual - 1] : 'auto'; }

  function tri(x, y, a, s) {
    const ca = Math.cos(a), sa = Math.sin(a);
    // nose at (0,-s) rotated by a (screen, heading-up)
    g.moveTo(x + sa * s, y - ca * s);
    g.lineTo(x + (-sa * 0.6 * s) - ca * 0.65 * s, y + ca * 0.6 * s - sa * 0.65 * s);
    g.lineTo(x + (-sa * 0.6 * s) + ca * 0.65 * s, y + ca * 0.6 * s + sa * 0.65 * s);
    g.closePath();
  }

  /**
   * D: { player, aircraft[], missiles[], target, waypoint (world Vector3-like | null), home ({x,z} | null), threats[], t, reduced }
   */
  function draw(D, size, d) {
    fit(size, d);
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, S, S);
    g.drawImage(layer, 0, 0, S, S);
    const p = D.player; if (!p) return;
    const ps = p.state.position, hdg = p.state.heading || 0, c = S / 2;
    // range: auto keeps the designated target (else the nearest enemy) on the scope
    if (manual) rangeNm = RADAR_RANGES_NM[manual - 1];
    else {
      let ref = D.target && D.target.alive ? D.target : null, best = Infinity;
      if (!ref) for (const e of D.aircraft) if (e !== p && e.team !== p.team) { const dd = e.state.position.distanceToSquared(ps); if (dd < best) { best = dd; ref = e; } }
      rangeNm = ref ? autoRange(Math.hypot(ref.state.position.x - ps.x, ref.state.position.z - ps.z), rangeNm) : 10;
    }
    const range = rangeNm * NM;
    g.lineWidth = 1.4;
    // home base and steer point
    if (D.home) {
      radarPoint(D.home.x - ps.x, D.home.z - ps.z, hdg, range, R, pt);
      const x = c + pt.x, y = c + pt.y, k = 4;
      g.strokeStyle = C.dim; g.beginPath(); g.arc(x, y, k, 0, Math.PI * 2); g.moveTo(x - k * 1.6, y); g.lineTo(x + k * 1.6, y); g.stroke();
    }
    if (D.waypoint) {
      radarPoint(D.waypoint.x - ps.x, D.waypoint.z - ps.z, hdg, range, R, pt);
      const x = c + pt.x, y = c + pt.y, k = 4.5;
      g.strokeStyle = C.mag; g.beginPath(); g.moveTo(x, y - k); g.lineTo(x + k, y); g.lineTo(x, y + k); g.lineTo(x - k, y); g.closePath(); g.stroke();
      if (!pt.clipped) { g.setLineDash([2, 4]); g.beginPath(); g.moveTo(c, c); g.lineTo(x, y); g.stroke(); g.setLineDash([]); }
    }
    // aircraft
    const k = Math.max(4, S * 0.028);
    for (const e of D.aircraft) {
      if (e === p) continue;
      const es = e.state;
      radarPoint(es.position.x - ps.x, es.position.z - ps.z, hdg, range, R, pt);
      const x = c + pt.x, y = c + pt.y, hostile = e.team !== p.team;
      const col = hostile ? C.red : C.blue;
      g.fillStyle = col; g.strokeStyle = col;
      g.beginPath(); tri(x, y, (es.heading || 0) - hdg, k);
      if (pt.clipped) { g.globalAlpha = 0.55; g.stroke(); g.globalAlpha = 1; } else g.fill();
      if (e === D.target) {
        const b = k + 3.5; g.strokeStyle = C.fg; g.lineWidth = 1.2;
        g.strokeRect(Math.round(x - b) + 0.5, Math.round(y - b) + 0.5, Math.round(b * 2), Math.round(b * 2)); g.lineWidth = 1.4;
      }
    }
    // missiles
    for (const m of D.missiles) {
      const ms = m.state;
      radarPoint(ms.position.x - ps.x, ms.position.z - ps.z, hdg, range, R, pt);
      if (pt.clipped) continue;
      const mine = m.owner === p, atMe = m.target === p;
      g.fillStyle = atMe ? C.red : mine ? C.fg : m.team === p.team ? C.blue : 'rgba(255,140,120,0.8)';
      const s = atMe ? 3 : 2;
      g.fillRect(Math.round(c + pt.x - s), Math.round(c + pt.y - s), s * 2, s * 2);
    }
    // radar-warning band
    let anyLaunch = false;
    for (const th of D.threats) {
      const src = th.missile?.state?.position || th.source?.state?.position; if (!src) continue;
      const a = relBearing(src.x - ps.x, src.z - ps.z, hdg), sa = Math.sin(a), ca = Math.cos(a);
      const r0 = R + 1.5, r1 = R + Math.max(9, S * 0.055);
      const x0 = c + sa * r0, y0 = c - ca * r0, x1 = c + sa * r1, y1 = c - ca * r1;
      if (th.type === 'missile') {
        anyLaunch = true;
        const on = D.reduced || (D.t * 4) % 1 < 0.6;
        g.strokeStyle = C.red; g.fillStyle = C.red; g.lineWidth = 3;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
        if (on) { g.beginPath(); g.arc(x1, y1, 3, 0, Math.PI * 2); g.fill(); }
      } else {
        g.strokeStyle = C.amber; g.lineWidth = 2.2;
        const w = 0.12;
        g.beginPath();
        g.moveTo(c + Math.sin(a - w) * r1, c - Math.cos(a - w) * r1); g.lineTo(x0, y0); g.lineTo(c + Math.sin(a + w) * r1, c - Math.cos(a + w) * r1);
        g.stroke();
      }
    }
    if (anyLaunch && (D.reduced || (D.t * 2) % 1 < 0.6)) {
      g.strokeStyle = C.red; g.lineWidth = 2; g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.stroke();
    }
    // corner readouts
    g.font = fS; g.textBaseline = 'top'; g.textAlign = 'left'; g.fillStyle = C.fg;
    g.fillText(F.int(rangeNm), 9, 8);
    g.font = fXS; g.fillStyle = C.dim; g.fillText(manual ? 'NM' : 'NM AUTO', 9, 8 + fs + 2);
    g.font = fS; g.textAlign = 'right'; g.fillStyle = C.fg;
    g.fillText(F.deg3(Math.round((hdg || 0) * RAD)), S - 9, 8);
  }

  return { draw, cycle, get rangeNm() { return rangeNm; } };
}
