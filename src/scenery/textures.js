// Procedural textures for the airports (generated once at boot; no network).
import * as THREE from 'three';

// ---------- tileable value noise helpers ----------
function hash2(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function tileNoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const m = (a) => ((a % period) + period) % period;
  const a = hash2(m(xi), m(yi), seed), b = hash2(m(xi + 1), m(yi), seed);
  const c = hash2(m(xi), m(yi + 1), seed), d = hash2(m(xi + 1), m(yi + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, period, oct, seed) {
  let s = 0, amp = 0.5, f = 1, n = 0;
  for (let o = 0; o < oct; o++) { s += amp * tileNoise(x * f, y * f, period * f, seed + o * 17); n += amp; amp *= 0.5; f *= 2; }
  return s / n;
}

function finishData(tex, ctx) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = Math.min(ctx.quality?.anisotropy || 4, ctx.renderer.capabilities.getMaxAnisotropy?.() || 1);
  tex.needsUpdate = true;
  return tex;
}

/**
 * RGBA pavement noise, 256² tileable:
 *  R aggregate (high-frequency speckle), G mid fbm, B low fbm (blotches), A crack network (ridged noise).
 */
export function makePavementNoise(ctx, N = 256) {
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4;
    const u = x / N, v = y / N;
    const speck = 0.55 * hash2(x, y, 3) + 0.45 * tileNoise(u * 64, v * 64, 64, 5);
    const mid = fbm(u * 8, v * 8, 8, 4, 11);
    const low = fbm(u * 3, v * 3, 3, 4, 23);
    const rn = fbm(u * 6, v * 6, 6, 3, 37);
    const ridge = Math.pow(1 - Math.abs(rn * 2 - 1), 14);
    data[i] = speck * 255; data[i + 1] = mid * 255; data[i + 2] = low * 255; data[i + 3] = Math.min(1, ridge) * 255;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  return finishData(tex, ctx);
}

// ---------- glyph atlas for painted markings ----------
export const GLYPHS = '0123456789LRC-';
export const ATLAS = { cellW: 80, cellH: 240, cols: GLYPHS.length + 1, rows: 2, w: 1280, h: 512 };

function drawRunwayGlyph(g, ch, x, y, w, h) {
  // FAA runway numerals: uniform-stroke, tall, condensed. Draw with the font, then squeeze to fit the cell.
  g.save();
  g.translate(x + w / 2, y + h / 2);
  g.font = `bold ${Math.round(h * 1.0)}px "DIN Condensed","Roboto Condensed","Arial Narrow","Liberation Sans Narrow","DejaVu Sans Condensed",Arial,sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const m = g.measureText(ch);
  const asc = m.actualBoundingBoxAscent || h * 0.36, desc = m.actualBoundingBoxDescent || h * 0.36;
  const gh = asc + desc, gw = (m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || m.width);
  const sy = (h * 0.94) / gh, sx = (w * 0.86) / Math.max(1, gw);
  g.scale(sx, sy);
  g.fillText(ch, 0, (asc - desc) / 2);
  g.restore();
}

export function makeGlyphAtlas(ctx) {
  const c = document.createElement('canvas');
  c.width = ATLAS.w; c.height = ATLAS.h;
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff';
  const { cellW, cellH } = ATLAS;
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < GLYPHS.length; i++) {
      const ch = GLYPHS[i];
      const x = i * cellW, y = row * cellH;
      if (ch === '-') { g.fillRect(x + cellW * 0.15, y + cellH * 0.46, cellW * 0.7, cellH * 0.08); continue; }
      if (row === 1) {
        // outline row: draw dilated glyph (black borders on concrete) by stamping offsets
        for (let a = 0; a < 16; a++) {
          const ox = Math.cos(a / 16 * Math.PI * 2) * 6, oy = Math.sin(a / 16 * Math.PI * 2) * 6;
          drawRunwayGlyph(g, ch, x + ox, y + oy, cellW, cellH);
        }
      } else drawRunwayGlyph(g, ch, x, y, cellW, cellH);
    }
    // solid cell
    g.fillRect(GLYPHS.length * cellW + 4, row * cellH + 4, cellW - 8, cellH - 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = Math.min(ctx.quality?.anisotropy || 4, ctx.renderer.capabilities.getMaxAnisotropy?.() || 1);
  return tex;
}
/** UV rect [u0, v0, u1, v1] for a glyph (or the solid cell when ch is null). flipY=true canvas convention. */
export function glyphUV(ch, outline = false) {
  let i = ch == null ? GLYPHS.length : GLYPHS.indexOf(ch);
  if (i < 0) i = GLYPHS.length;
  const { cellW, cellH, w, h } = ATLAS;
  const row = outline ? 1 : 0;
  const pad = ch == null ? 10 : 0;
  const u0 = (i * cellW + pad) / w, u1 = ((i + 1) * cellW - pad) / w;
  const y0 = (row * cellH + pad) / h, y1 = ((row + 1) * cellH - pad) / h;
  // CanvasTexture flipY = true: v = 1 - y
  return [u0, 1 - y1, u1, 1 - y0];
}

// ---------- building facades (albedo + emissive) ----------
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function texFrom(c, ctx, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = Math.min(ctx.quality?.anisotropy || 4, 8);
  return t;
}
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function grain(g, w, h, amt, r) { const id = g.getImageData(0, 0, w, h), d = id.data; for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * amt; d[i] += n; d[i + 1] += n; d[i + 2] += n; } g.putImageData(id, 0, 0); }

/**
 * Facade set. Each entry: { map, emissive?, tile: [metres per texture repeat in u, v] }.
 */
export function makeFacades(ctx) {
  const R = rng(7);
  const F = {};
  // Glass curtain wall: 8 bays × 2 floors per tile (12 m × 9 m)
  {
    const [c, g] = canvas(512, 384), [ce, ge] = canvas(512, 384);
    const grd = g.createLinearGradient(0, 0, 0, 384);
    grd.addColorStop(0, '#5d7286'); grd.addColorStop(0.5, '#33465a'); grd.addColorStop(1, '#2a3a4a');
    g.fillStyle = grd; g.fillRect(0, 0, 512, 384);
    ge.fillStyle = '#000'; ge.fillRect(0, 0, 512, 384);
    for (let f = 0; f < 2; f++) {
      const y0 = f * 192;
      g.fillStyle = '#9aa3aa'; g.fillRect(0, y0 + 176, 512, 16);         // floor slab / spandrel
      for (let b = 0; b < 8; b++) {
        const x0 = b * 64;
        g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(x0 + 4, y0 + 4, 28, 168);
        const lit = R() < 0.6;
        const warm = (90 + R() * 120) * (f === 0 ? 1 : 0.8);
        ge.fillStyle = lit ? `rgb(${warm},${warm * 0.85},${warm * 0.6})` : 'rgb(20,18,14)';
        ge.fillRect(x0 + 3, y0 + 2, 58, 172);
      }
    }
    g.fillStyle = '#b8bec4';
    for (let b = 0; b <= 8; b++) g.fillRect(b * 64 - 2, 0, 4, 384);
    for (let f = 0; f < 4; f++) g.fillRect(0, f * 96 + 94, 512, 3);
    F.glass = { map: texFrom(c, ctx), emissive: texFrom(ce, ctx), tile: [12, 9] };
  }
  // Office: 2 floors of 3.6 m, window bands; tile 14.4 m × 7.2 m
  {
    const [c, g] = canvas(512, 256), [ce, ge] = canvas(512, 256);
    g.fillStyle = '#c9c5bc'; g.fillRect(0, 0, 512, 256);
    ge.fillStyle = '#000'; ge.fillRect(0, 0, 512, 256);
    for (let f = 0; f < 2; f++) for (let w = 0; w < 8; w++) {
      const x = w * 64 + 8, y = f * 128 + 40;
      g.fillStyle = '#2c3540'; g.fillRect(x, y, 48, 60);
      g.fillStyle = 'rgba(160,190,220,0.25)'; g.fillRect(x + 2, y + 2, 20, 56);
      g.fillStyle = '#8f8a80'; g.fillRect(x - 2, y + 60, 52, 4);
      if (R() < 0.45) { const k = 160 + R() * 90; ge.fillStyle = `rgb(${k},${k * 0.92},${k * 0.75})`; ge.fillRect(x, y, 48, 60); }
    }
    grain(g, 512, 256, 14, R);
    F.office = { map: texFrom(c, ctx), emissive: texFrom(ce, ctx), tile: [14.4, 7.2] };
  }
  // Corrugated cladding: vertical ribs, tile 4 m × 4 m (tinted by vertex colour)
  {
    const [c, g] = canvas(256, 256);
    for (let x = 0; x < 256; x++) {
      const k = 0.5 + 0.5 * Math.cos((x / 256) * Math.PI * 2 * 16);
      const v = Math.round(185 + 45 * k);
      g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, 0, 1, 256);
    }
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 126, 256, 3);
    grain(g, 256, 256, 10, R);
    F.metal = { map: texFrom(c, ctx), tile: [4, 4] };
  }
  // Hangar / bay door: horizontal panels, tile 8 m × 8 m
  {
    const [c, g] = canvas(256, 256);
    g.fillStyle = '#d0d0cc'; g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 32) { g.fillStyle = '#8e8e8a'; g.fillRect(0, y, 256, 3); g.fillStyle = '#e6e6e2'; g.fillRect(0, y + 3, 256, 2); }
    g.fillStyle = '#7a7a76'; g.fillRect(0, 0, 4, 256); g.fillRect(126, 0, 4, 256);
    grain(g, 256, 256, 12, R);
    F.door = { map: texFrom(c, ctx), tile: [8, 8] };
  }
  // Concrete: panels with form-tie holes, tile 6 m × 6 m
  {
    const [c, g] = canvas(256, 256);
    g.fillStyle = '#b5b1a8'; g.fillRect(0, 0, 256, 256);
    grain(g, 256, 256, 26, R);
    g.fillStyle = 'rgba(60,55,50,0.35)'; g.fillRect(0, 0, 256, 2); g.fillRect(0, 0, 2, 256);
    for (let y = 32; y < 256; y += 64) for (let x = 32; x < 256; x += 64) { g.fillStyle = 'rgba(50,50,50,0.4)'; g.beginPath(); g.arc(x, y, 2.5, 0, 7); g.fill(); }
    for (let k = 0; k < 10; k++) { const x = R() * 256; const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(70,65,60,0.14)'); gr.addColorStop(1, 'rgba(70,65,60,0)'); g.fillStyle = gr; g.fillRect(x, 0, 6 + R() * 10, 256); }
    F.concrete = { map: texFrom(c, ctx), tile: [6, 6] };
  }
  // Roof membrane / gravel, tile 20 m
  {
    const [c, g] = canvas(256, 256);
    g.fillStyle = '#8c8a86'; g.fillRect(0, 0, 256, 256);
    grain(g, 256, 256, 40, R);
    g.fillStyle = 'rgba(40,40,40,0.15)';
    for (let k = 0; k < 6; k++) g.fillRect(0, k * 43, 256, 1);
    F.roof = { map: texFrom(c, ctx), tile: [20, 20] };
  }
  // Parking garage: open floors (dark gaps), tile 12 m × 6 m (2 decks of 3 m)
  {
    const [c, g] = canvas(256, 128), [ce, ge] = canvas(256, 128);
    g.fillStyle = '#bdb8ae'; g.fillRect(0, 0, 256, 128);
    ge.fillStyle = '#000'; ge.fillRect(0, 0, 256, 128);
    for (let f = 0; f < 2; f++) {
      g.fillStyle = '#26282a'; g.fillRect(0, f * 64 + 22, 256, 36);
      ge.fillStyle = '#6a6250'; ge.fillRect(0, f * 64 + 24, 256, 32);
      g.fillStyle = '#a8a39a'; for (let x = 0; x < 256; x += 64) g.fillRect(x, f * 64 + 22, 8, 36);
    }
    grain(g, 256, 128, 14, R);
    F.garage = { map: texFrom(c, ctx), emissive: texFrom(ce, ctx), tile: [12, 6] };
  }
  // Tower cab glass: tile 3 m × 4 m (one pane)
  {
    const [c, g] = canvas(128, 128), [ce, ge] = canvas(128, 128);
    const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, '#4f6a6e'); gr.addColorStop(1, '#22343a');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#30363a'; g.fillRect(0, 0, 6, 128); g.fillRect(0, 0, 128, 6);
    ge.fillStyle = '#000'; ge.fillRect(0, 0, 128, 128);
    ge.fillStyle = '#4a5a40'; ge.fillRect(8, 8, 120, 120);
    ge.fillStyle = '#9a8a60'; ge.fillRect(8, 90, 120, 38);
    F.cab = { map: texFrom(c, ctx), emissive: texFrom(ce, ctx), tile: [3, 4] };
  }
  return F;
}

/** Sign atlas: black/red/yellow sign faces with text (distance-remaining, holding position, location). */
export function makeSignAtlas(ctx, texts) {
  const cellW = 256, cellH = 96, cols = 8;
  const rows = Math.ceil(texts.length / cols);
  const [c, g] = canvas(cellW * cols, Math.max(1, cellH * rows));
  const index = new Map();
  texts.forEach((t, i) => {
    const x = (i % cols) * cellW, y = Math.floor(i / cols) * cellH;
    const [kind, txt] = t.split(':');
    const bg = kind === 'hold' ? '#c0141a' : kind === 'loc' ? '#111' : '#0d0d0d';
    const fg = kind === 'hold' ? '#ffffff' : kind === 'loc' ? '#ffd21c' : '#f4f4f4';
    g.fillStyle = bg; g.fillRect(x, y, cellW, cellH);
    if (kind === 'loc') { g.strokeStyle = '#ffd21c'; g.lineWidth = 6; g.strokeRect(x + 10, y + 10, cellW - 20, cellH - 20); }
    g.fillStyle = fg;
    g.font = 'bold 66px "Arial Narrow","Liberation Sans Narrow",Arial,sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(txt, x + cellW / 2, y + cellH / 2 + 3, cellW - 30);
    index.set(t, [x / c.width, 1 - (y + cellH) / c.height, (x + cellW) / c.width, 1 - y / c.height]);
  });
  const tex = texFrom(c, ctx);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return { tex, index };
}

/** Chain-link fence texture with alpha. */
export function makeFenceTexture(ctx) {
  const [c, g] = canvas(128, 128);
  g.clearRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(190,195,198,0.9)'; g.lineWidth = 1.6;
  for (let k = -128; k < 256; k += 16) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 128, 128); g.stroke(); g.beginPath(); g.moveTo(k, 128); g.lineTo(k + 128, 0); g.stroke(); }
  g.fillStyle = 'rgba(150,150,150,1)'; g.fillRect(0, 0, 128, 4); g.fillRect(0, 124, 128, 4);
  const t = texFrom(c, ctx);
  return t;
}
