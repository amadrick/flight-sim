// Briefing "tactical map": a schematic plan view of the mission area on a 2D canvas — land / sea from the terrain
// height function (sampled once per mission and cached), airports with their runways, range rings, the player's start
// and, when the mission definition says where they are, the opening hostile and friendly groups.
// Mission fields read (all optional): location (airport id), start { airport, offset { bearing, distance }, hdg },
// enemies / friends [{ bearing, distance }] relative to the start anchor (placeholder format), or map { center {x,z},
// radius, player {x,z,hdg}, hostiles [{x,z}], friendlies [{x,z}] } if the missions agent provides one.
import { AIRPORTS } from '../../data/airports.js';

const DEG = Math.PI / 180;
const NM = 1852;
const hv = (bearingDeg) => ({ x: Math.sin(bearingDeg * DEG), z: -Math.cos(bearingDeg * DEG) });

/** Pure: world positions of everything the map shows. Exported for tests. */
export function mapScene(def = {}) {
  const st = def.start || {};
  const m = def.map || {};
  const aptId = st.airport || def.location;
  const apt = AIRPORTS.find(a => a.id === aptId);
  const base = apt ? apt.position : { x: 0, z: 0 };
  let player = null;
  if (m.player && Number.isFinite(m.player.x)) player = { x: m.player.x, z: m.player.z, hdg: m.player.hdg ?? st.hdg ?? 0 };
  else if (st.offset) { const v = hv(st.offset.bearing || 0); player = { x: base.x + v.x * (st.offset.distance || 0), z: base.z + v.z * (st.offset.distance || 0), hdg: st.hdg ?? 0 }; }
  else if (apt) player = { x: base.x, z: base.z, hdg: st.hdg ?? 0 };
  const anchor = player || base;
  const rel = (list) => (Array.isArray(list) ? list : []).map(d => {
    if (Number.isFinite(d?.x) && Number.isFinite(d?.z)) return { x: d.x, z: d.z };
    if (!Number.isFinite(d?.bearing)) return null;
    const v = hv(d.bearing); return { x: anchor.x + v.x * (d.distance || 0), z: anchor.z + v.z * (d.distance || 0) };
  }).filter(Boolean);
  const hostiles = rel(m.hostiles || def.enemies), friendlies = rel(m.friendlies || def.friends);
  // frame: centre between the player and the groups, radius to include them (at least 25 km)
  const pts = [anchor, ...hostiles, ...friendlies];
  let cx = 0, cz = 0; for (const p of pts) { cx += p.x; cz += p.z; } cx /= pts.length; cz /= pts.length;
  if (m.center && Number.isFinite(m.center.x)) { cx = m.center.x; cz = m.center.z; }
  let r = 0; for (const p of pts) r = Math.max(r, Math.hypot(p.x - cx, p.z - cz));
  const radius = Number.isFinite(m.radius) ? m.radius : Math.max(25000, r * 1.35 + 6000);
  return { center: { x: cx, z: cz }, radius, player, hostiles, friendlies, airportId: apt?.id || null };
}

const cache = new Map();   // mission id + size → land/sea ImageData-ish canvas

/** Draw the map into `canvas` (sized from its CSS box). ctx: simulator context (terrain height lookup). */
export function drawMap(canvas, def, ctx, key) {
  const cssW = canvas.clientWidth || 0, cssH = canvas.clientHeight || 0;
  if (cssW < 40 || cssH < 40) return false;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(cssW * dpr), H = Math.round(cssH * dpr);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const g = canvas.getContext('2d'); if (!g) return false;
  const sc = mapScene(def);
  const k = Math.min(W, H) / 2 / sc.radius;          // px per metre
  const toPx = (x, z) => [W / 2 + (x - sc.center.x) * k, H / 2 + (z - sc.center.z) * k];
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);

  // land / sea (cached per mission and size): coarse grid of terrain heights
  const ck = `${key}|${W}x${H}`;
  let bg = cache.get(ck);
  const hfn = ctx?.world?.terrainHeightAt || ctx?.world?.groundHeightAt;
  if (!bg && typeof hfn === 'function') {
    try {
      const gw = 72, gh = Math.max(16, Math.round(gw * H / W));
      const off = document.createElement('canvas'); off.width = gw; off.height = gh;
      const og = off.getContext('2d'), img = og.createImageData(gw, gh), d = img.data;
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
        const x = sc.center.x + ((i + 0.5) / gw * W - W / 2) / k, z = sc.center.z + ((j + 0.5) / gh * H - H / 2) / k;
        let hgt = 0; try { hgt = +hfn.call(ctx.world, x, z) || 0; } catch { hgt = 0; }
        const o = (j * gw + i) * 4;
        if (hgt <= 0.5) { d[o] = 22; d[o + 1] = 52; d[o + 2] = 78; d[o + 3] = 150; }
        else { const t = Math.min(1, hgt / 2200); d[o] = 52 + t * 60; d[o + 1] = 62 + t * 46; d[o + 2] = 54 + t * 34; d[o + 3] = 120 + t * 60; }
      }
      og.putImageData(img, 0, 0);
      bg = off; cache.set(ck, bg);
      if (cache.size > 12) cache.delete(cache.keys().next().value);
    } catch { bg = null; }
  }
  if (bg) { g.imageSmoothingEnabled = true; g.globalAlpha = 0.9; g.drawImage(bg, 0, 0, W, H); g.globalAlpha = 1; }

  // grid + range rings around the player (10 NM steps)
  g.lineWidth = 1 * dpr;
  const P = sc.player || { x: sc.center.x, z: sc.center.z, hdg: 0 };
  const [px, py] = toPx(P.x, P.z);
  g.strokeStyle = 'rgba(255,255,255,0.10)';
  const step = sc.radius > 90000 ? 20 * NM : 10 * NM;
  for (let rr = step; rr < sc.radius * 2; rr += step) { g.beginPath(); g.arc(px, py, rr * k, 0, Math.PI * 2); g.stroke(); }
  g.fillStyle = 'rgba(214,226,238,0.5)'; g.font = `${10 * dpr}px "B612 Mono", ui-monospace, monospace`; g.textAlign = 'left'; g.textBaseline = 'bottom';
  g.fillText(`${Math.round(step / NM)} NM`, px + step * k + 3 * dpr, py - 2 * dpr);

  // airports
  for (const a of AIRPORTS) {
    const [ax, ay] = toPx(a.position.x, a.position.z);
    if (ax < -40 || ay < -40 || ax > W + 40 || ay > H + 40) continue;
    g.strokeStyle = 'rgba(242,246,250,0.85)'; g.lineWidth = 2.2 * dpr; g.lineCap = 'round';
    for (const rw of a.runways) {
      const v = hv(rw.heading), [cx, cy] = toPx(rw.center.x, rw.center.z), half = Math.max(5 * dpr, rw.length / 2 * k);
      g.beginPath(); g.moveTo(cx - v.x * half, cy - v.z * half); g.lineTo(cx + v.x * half, cy + v.z * half); g.stroke();
    }
    g.fillStyle = 'rgba(242,246,250,0.8)'; g.textBaseline = 'top'; g.textAlign = 'center';
    g.fillText(a.id, ax, ay + 7 * dpr);
  }
  // groups
  const chevron = (x, z, color, size) => {
    const [cx, cy] = toPx(x, z);
    g.fillStyle = color; g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1 * dpr;
    g.beginPath(); g.moveTo(cx, cy - size); g.lineTo(cx + size, cy); g.lineTo(cx, cy + size); g.lineTo(cx - size, cy); g.closePath(); g.fill(); g.stroke();
  };
  for (const f of sc.friendlies) chevron(f.x, f.z, '#4cc9f0', 4.5 * dpr);
  for (const h of sc.hostiles) chevron(h.x, h.z, '#ff5a3c', 5 * dpr);
  // player: aircraft symbol + heading line
  if (sc.player) {
    const v = hv(P.hdg || 0), s = 7 * dpr;
    g.strokeStyle = '#ffb000'; g.lineWidth = 2 * dpr;
    g.beginPath(); g.moveTo(px, py); g.lineTo(px + v.x * s * 3.2, py + v.z * s * 3.2); g.stroke();
    g.fillStyle = '#ffb000'; g.beginPath(); g.arc(px, py, s * 0.6, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1 * dpr; g.stroke();
  }
  // north
  g.fillStyle = 'rgba(242,246,250,0.75)'; g.textAlign = 'right'; g.textBaseline = 'top';
  g.fillText('N ↑', W - 8 * dpr, 7 * dpr);
  return true;
}
