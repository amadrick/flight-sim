// Aircraft kit — texture atlas + procedural paint pipeline + finish (PBR) library.
//
// One atlas = one material = (ideally) one draw call for all static geometry. It holds
//   * CHARTS: rectangles onto which big surfaces are projected (fuselage unwrap, wing plan views, fin side views…),
//   * SWATCHES: flat colour/roughness/metalness cells for everything that needs no painted detail (gear, cockpit, tyres…).
// Layers painted on 2D canvases at build time: colour (sRGB), height (→ normal map), ORM (G roughness, B metalness, half res)
// and an optional emissive layer (half res).
//
// Workflow:   const atlas = createAtlas({ size, base });   atlas.chart(...) × n;   atlas.pack();
//             build geometry (charts and swatches now give UVs);   paint with atlas.pen(chart);   atlas.material(ctx)
import * as THREE from 'three';
import { skinMaterial, packTargets, packOnGPU, packOnCPU } from './skin.js';

// ---- finish library ------------------------------------------------------------------------------------------------------
// A finish is { color (CSS sRGB), rough, metal }. Functions take a colour and return a finish.
export const FINISH = {
  gloss: (color) => ({ color, rough: 0.2, metal: 0 }),                 // airliner polyurethane, demo-team paint
  semigloss: (color) => ({ color, rough: 0.4, metal: 0 }),             // navy greys, fresh camouflage
  matte: (color) => ({ color, rough: 0.66, metal: 0 }),                // tactical flat greys
  ram: (color = '#5d6468') => ({ color, rough: 0.58, metal: 0.25 }),   // low-observable coating: slightly metallic sheen
  composite: (color = '#2a2c2e') => ({ color, rough: 0.5, metal: 0 }), // radomes, dielectric panels
  bareMetal: { color: '#b4b8bc', rough: 0.36, metal: 1 },
  polished: { color: '#d9dbdd', rough: 0.12, metal: 1 },               // leading edges, polished lips
  titanium: { color: '#8b867e', rough: 0.44, metal: 1 },
  heatStained: { color: '#6a5a4e', rough: 0.5, metal: 1 },             // hot-section titanium / inconel
  exhaust: { color: '#2e2a28', rough: 0.62, metal: 0.85 },             // sooty nozzle interior
  steel: { color: '#74787c', rough: 0.4, metal: 1 },
  chrome: { color: '#eef0f2', rough: 0.07, metal: 1 },                 // oleo pistons
  anodised: { color: '#9aa1a8', rough: 0.42, metal: 0.9 },             // landing-gear forgings
  gearWhite: { color: '#dfe0dc', rough: 0.35, metal: 0 },              // painted gear / wells
  primer: { color: '#9aa27c', rough: 0.6, metal: 0 },                  // zinc-chromate interiors
  rubber: { color: '#151516', rough: 0.9, metal: 0 },
  black: { color: '#0c0d0e', rough: 0.55, metal: 0 },
  darkGrey: { color: '#2a2d30', rough: 0.6, metal: 0 },
  interior: { color: '#3d4144', rough: 0.7, metal: 0 },                // cockpit grey
  fabric: { color: '#4a4f3e', rough: 0.95, metal: 0 },                 // seat cushions, flight suit
  paintedGlass: { color: '#080b10', rough: 0.05, metal: 0 },           // windows drawn into the paint
  lens: { color: '#c9d2d8', rough: 0.1, metal: 0.6 },
};
const fin = (f, c) => (typeof f === 'function' ? f(c) : f);

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

let _noise = null;
function noiseTiles() {
  if (_noise) return _noise;
  // tileable, isotropic "cloud" noise: a sum of random plane waves with integer wave vectors (1/f spectrum)
  const S = 128, r = rng(7), val = new Float32Array(S * S), cs = new Float32Array(S), sn = new Float32Array(S);
  for (let i = 0; i < S; i++) { cs[i] = Math.cos(i / S * Math.PI * 2); sn[i] = Math.sin(i / S * Math.PI * 2); }
  for (let w = 0; w < 72; w++) {
    const kr = 1 + Math.pow(r(), 1.6) * 21, ka = r() * Math.PI * 2, kx = Math.round(kr * Math.cos(ka)), ky = Math.round(kr * Math.sin(ka)), ph = Math.floor(r() * S);
    if (!kx && !ky) continue;
    const amp = 1 / Math.pow(Math.hypot(kx, ky), 1.1);
    for (let y = 0, o = 0; y < S; y++) { let i = ky * y + ph; for (let x = 0; x < S; x++, o++, i += kx) val[o] += amp * cs[i & 127]; }   // S is a power of two: wrap with a mask
  }
  let mean = 0, sd = 0; for (let i = 0; i < val.length; i++) mean += val[i]; mean /= val.length;
  for (let i = 0; i < val.length; i++) sd += (val[i] - mean) ** 2; sd = Math.sqrt(sd / val.length) || 1;
  for (let i = 0; i < val.length; i++) val[i] = 0.5 + (val[i] - mean) / sd * 0.2;
  const mk = (fn) => { const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), im = g.createImageData(S, S); for (let i = 0; i < S * S; i++) { const q = fn(val[i]); im.data[i * 4] = q[0]; im.data[i * 4 + 1] = q[1]; im.data[i * 4 + 2] = q[2]; im.data[i * 4 + 3] = q[3]; } g.putImageData(im, 0, 0); return c; };
  const sm = (v) => { const q = Math.min(1, Math.max(0, (v - 0.1) / 0.8)); return q * q * (3 - 2 * q); };
  _noise = {
    dark: mk(v => [0, 0, 0, 255 * sm(v)]),                              // black with noise alpha → darkening
    light: mk(v => [255, 255, 255, 255 * sm(v)]),                       // white with noise alpha → fading/chalking
    rough: mk(v => [255, 255 * sm(v), 0, 255]),                         // for 'lighter' on the ORM layer (G only matters)
    grey: mk(v => { const q = 255 * sm(v); return [q, q, q, 255]; }),
  };
  return _noise;
}

// ---- charts ----------------------------------------------------------------------------------------------------------------
class Chart {
  constructor(atlas, name, spec) {
    this.atlas = atlas; this.name = name; this.spec = spec; this.type = spec.type; this.density = spec.density ?? 1;
    this.strips = []; this.body = spec.body || null;
    const d = this.density;
    if (this.type === 'unwrap') {
      const n = spec.strips ?? 1, [z0, z1] = spec.z, L = (z1 - z0) / n;
      this.z0 = z0; this.z1 = z1; this.splits = [];
      for (let k = 0; k < n; k++) { this.strips.push({ a0: z0 + k * L, a1: z0 + (k + 1) * L, b0: 0, b1: 1, req: [L * d, (spec.girth ?? 3) * d * (spec.vScale ?? 1)] }); if (k > 0) this.splits.push(z0 + k * L); }
    } else {
      let a, b;
      if (this.type === 'plan') { a = spec.x; b = spec.z; this.U = [1, 0, 0]; this.V = [0, 0, 1]; this.readFlip = spec.view === 'bottom'; }
      else if (this.type === 'side') { a = spec.z; b = spec.y; this.U = [0, 0, 1]; this.V = [0, 1, 0]; this.readFlip = spec.view === 'right'; this.bUp = true; }
      else if (this.type === 'proj') { a = spec.a; b = spec.b; this.U = spec.u; this.V = spec.v; this.readFlip = !!spec.flip; this.bUp = !!spec.bUp; }
      else { a = [0, spec.w]; b = [0, spec.h]; this.U = [1, 0, 0]; this.V = [0, 1, 0]; }
      this.O = spec.origin || [0, 0, 0]; this.mirror = !!spec.mirror;
      this.strips.push({ a0: a[0], a1: a[1], b0: b[0], b1: b[1], req: [(a[1] - a[0]) * d, (b[1] - b[0]) * d * (spec.vScale ?? 1)] });
    }
  }
  /** paint coords → pixel (strip k) */
  px(a, b, k = 0) { const s = this.strips[k]; return [s.tx + a * s.sx, s.ty + b * s.sy]; }
  stripAt(z) { const n = this.strips.length; if (n === 1) return 0; const k = Math.floor((z - this.z0) / (this.z1 - this.z0) * n); return k < 0 ? 0 : k >= n ? n - 1 : k; }
  _uv(pxl) { const S = this.atlas.size; return [pxl[0] / S, 1 - pxl[1] / S]; }
  /** UV for an unwrap chart at body station z and ring parameter t. */
  uvUnwrap(z, t, strip = 0) { return this._uv(this.px(z, t, strip)); }
  /** Paint coords of a body-space point (projected charts). */
  local(x, y, z) { if (this.mirror) x = Math.abs(x); const O = this.O, dx = x - O[0], dy = y - O[1], dz = z - O[2], U = this.U, V = this.V; return [dx * U[0] + dy * U[1] + dz * U[2], dx * V[0] + dy * V[1] + dz * V[2]]; }
  /** UV of a body-space point (projected charts). */
  uv3(x, y, z) { const l = this.local(x, y, z); return this._uv(this.px(l[0], l[1])); }
  /** UV from paint coords. */
  uv(a, b) { return this._uv(this.px(a, b)); }
}

export function createAtlas(o = {}) {
  const size = o.size ?? 2048, pad = o.pad ?? 5, SW = 16, swatchCols = 16, swatchRows = o.swatchRows ?? 4;
  const base = o.base || FINISH.matte('#8a9096');
  const charts = [], byName = {};
  const layers = {};
  let packed = false, swatchRect = null, swatchN = 0; const swatches = new Map();
  const atlas = {
    size, charts: byName, FINISH,
    /** Declare a chart (before pack()). See the README for the spec of each type. */
    chart(name, spec) { const c = new Chart(atlas, name, spec); charts.push(c); byName[name] = c; return c; },
    /** Assign atlas rectangles: finds the largest uniform scale at which every chart fits. */
    pack() {
      const items = [];
      for (const c of charts) for (const s of c.strips) items.push({ s, w: s.req[0], h: s.req[1] });
      const sw = { fixed: true, w: SW * swatchCols, h: SW * swatchRows };
      const tryPack = (k) => {
        const rects = items.map(it => ({ it, w: Math.ceil(it.w * k) + 2 * pad, h: Math.ceil(it.h * k) + 2 * pad }));
        rects.push({ it: sw, w: sw.w, h: sw.h });
        rects.sort((a, b) => b.h - a.h);
        let x = 0, y = 0, rowH = 0;
        for (const r of rects) {
          if (r.w > size) return null;
          if (x + r.w > size) { x = 0; y += rowH; rowH = 0; }
          if (y + r.h > size) return null;
          r.x = x; r.y = y; x += r.w; rowH = Math.max(rowH, r.h);
        }
        return rects;
      };
      let lo = 0.01, hi = o.maxDensity ?? 1024, best = null;
      for (let i = 0; i < 28; i++) { const mid = Math.sqrt(lo * hi), r = tryPack(mid); if (r) { best = r; lo = mid; } else hi = mid; }
      if (!best) throw new Error('atlas: charts do not fit');
      atlas.scale = lo;
      for (const r of best) {
        if (r.it === sw) { swatchRect = { x: r.x, y: r.y, w: r.w, h: r.h }; continue; }
        const s = r.it.s; s.rect = { x: r.x + pad, y: r.y + pad, w: r.w - 2 * pad, h: r.h - 2 * pad };
      }
      for (const c of charts) for (const s of c.strips) {
        s.sx = s.rect.w / (s.a1 - s.a0); s.tx = s.rect.x - s.a0 * s.sx;
        if (c.bUp) { s.sy = -s.rect.h / (s.b1 - s.b0); s.ty = s.rect.y + s.rect.h - s.b0 * s.sy; }
        else { s.sy = s.rect.h / (s.b1 - s.b0); s.ty = s.rect.y - s.b0 * s.sy; }
      }
      const mkLayer = (scale, fill, read = false) => { const c = document.createElement('canvas'); c.width = c.height = size * scale; const g = c.getContext('2d', { willReadFrequently: read }); if (fill) { g.fillStyle = fill; g.fillRect(0, 0, c.width, c.height); } return { canvas: c, ctx: g, scale }; };
      layers.color = mkLayer(1, base.color, true);
      layers.height = mkLayer(o.heightScale ?? 1, '#808080', true);
      layers.orm = mkLayer(0.5, ormStyle(base.rough, base.metal), true);
      packed = true;
      return atlas;
    },
    /** UV of a flat finish cell. `key` is any string; the same key returns the same cell. */
    swatch(key, finish) {
      if (!packed) throw new Error('atlas: pack() before swatch()');
      if (finish === undefined && typeof key === 'object') { finish = key; key = JSON.stringify(key); }
      let uv = swatches.get(key);
      if (uv) return uv;
      if (!finish) throw new Error('atlas: unknown swatch ' + key);
      const i = swatchN++; if (i >= swatchCols * swatchRows) throw new Error('atlas: out of swatches (raise swatchRows)');
      const x = swatchRect.x + (i % swatchCols) * SW, y = swatchRect.y + Math.floor(i / swatchCols) * SW;
      for (const L of [layers.color, layers.orm, layers.height]) {
        const g = L.ctx, k = L.scale; g.setTransform(1, 0, 0, 1, 0, 0);
        g.fillStyle = L === layers.color ? finish.color : L === layers.orm ? ormStyle(finish.rough ?? 0.5, finish.metal ?? 0) : '#808080';
        g.fillRect(x * k, y * k, SW * k, SW * k);
      }
      if (finish.emissive) { const L = lazyLayer('emis'), g = L.ctx; g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = finish.emissive; g.fillRect(x * L.scale, y * L.scale, SW * L.scale, SW * L.scale); }
      uv = [(x + SW / 2) / size, 1 - (y + SW / 2) / size]; swatches.set(key, uv); return uv;
    },
    /**
     * A row of `cells` swatch cells painted as one small gradient texture (tyre cross-sections, wheel dishes, heat-stained
     * pipes…): fn(g, layerName) draws in a unit square (x 0 → 1 along the strip) on 'color', 'orm' (use atlas.ormStyle) and
     * 'height'. Returns { uv(t) } (t 0 → 1 along the strip) or null when the swatch block is full (use a flat swatch then).
     */
    strip(key, cells, fn) {
      if (!packed) throw new Error('atlas: pack() before strip()');
      if (strips.has(key)) return strips.get(key);
      if ((swatchN % swatchCols) + cells > swatchCols) swatchN += swatchCols - (swatchN % swatchCols);
      if (cells > swatchCols || swatchN + cells > swatchCols * swatchRows || (tex && !pending)) { strips.set(key, null); return null; }
      const i = swatchN; swatchN += cells;
      const x = swatchRect.x + (i % swatchCols) * SW, y = swatchRect.y + Math.floor(i / swatchCols) * SW, w = cells * SW;
      for (const name of ['color', 'orm', 'height']) {
        const L = layers[name], g = L.ctx, k = L.scale;
        g.save(); g.setTransform(w * k, 0, 0, SW * k, x * k, y * k); g.beginPath(); g.rect(0, 0, 1, 1); g.clip();
        g.fillStyle = name === 'height' ? '#808080' : name === 'orm' ? ormStyle(0.5, 0) : '#888'; g.fillRect(0, 0, 1, 1);
        fn(g, name); g.restore();
      }
      if (atlas.tex) atlas.tex.map.needsUpdate = true;
      const st = { uv: (t) => [(x + 2 + Math.min(1, Math.max(0, t)) * (w - 4)) / size, 1 - (y + SW / 2) / size] };
      strips.set(key, st); return st;
    },
    ormStyle,
    /** A pen paints one chart. */
    pen(chart) { return new Pen(atlas, typeof chart === 'string' ? byName[chart] : chart, layers, lazyLayer); },
    layers, skin: o.skin || null,
    /** The lazily created layers: 'emis' (emissive, half res) and 'ao' (baked ambient occlusion, quarter res, white = open). */
    layer: (name) => lazyLayer(name),
    /**
     * Build the textures: colour (sRGB canvas), the packed DETAIL map (normal.xy + roughness + metalness, full res), the AUX
     * map (occlusion + cavity, quarter res) and the optional emissive map. With a renderer the packing is one GPU draw that
     * runs in rig.build() (or right after createVisual returns); opts.normalStrength scales the height → normal conversion.
     */
    textures(ctx, opts = {}) {
      if (atlas.tex) return atlas.tex;
      atlas.flush();
      const renderer = ctx?.renderer;
      const aniso = Math.min(ctx?.quality?.anisotropy ?? 4, renderer?.capabilities?.getMaxAnisotropy?.() ?? 4);
      const setup = (t, srgb) => { t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = aniso; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; return t; };
      const map = setup(new THREE.CanvasTexture(layers.color.canvas), true);
      const emissiveMap = layers.emis ? setup(new THREE.CanvasTexture(layers.emis.canvas), true) : null;
      const sk = { ...(o.skin || {}), ...(opts.skin || {}) };
      const pack = { strength: (opts.normalStrength ?? 2.2) * layers.height.scale, cavity: sk.cavity ?? 1 };
      let normalMap, auxMap;
      if (renderer?.isWebGLRenderer && renderer.capabilities?.isWebGL2 !== false && !o.cpuPack) {
        targets = packTargets(size, aniso); normalMap = targets.detail.texture; auxMap = targets.aux.texture;
        pending = { renderer, pack, keep: ctx?.params?.raw?.atlas !== undefined || !!o.keepLayers };
        Promise.resolve().then(() => atlas.bake());                   // safety net when no rig calls bake()
      } else {
        const t = packOnCPU(layers, pack); normalMap = setup(t.detail, false); auxMap = t.aux;
      }
      atlas.tex = { map, normalMap, ormMap: normalMap, auxMap, emissiveMap };
      return atlas.tex;
    },
    /** Composite the deferred noise buffers onto the colour and roughness layers (idempotent). */
    flush() {
      if (!tone) return atlas;
      const put = (L, src, comp) => { const g = L.ctx; g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = comp; g.imageSmoothingEnabled = true; g.drawImage(src.canvas, 0, 0, L.canvas.width, L.canvas.height); g.restore(); src.canvas.width = src.canvas.height = 1; };
      put(layers.color, tone.color, 'source-over'); put(layers.orm, tone.rough, 'lighter'); tone = null;
      if (atlas.tex) atlas.tex.map.needsUpdate = true;
      return atlas;
    },
    /** Pack the painted layers into the DETAIL / AUX textures now (idempotent; rig.build() calls it after baking occlusion). */
    bake() {
      if (!pending) return atlas;
      atlas.flush();
      const { renderer, pack, keep } = pending; pending = null;
      try { packOnGPU(renderer, layers, targets, pack); }
      catch (e) { console.warn('[kit] GPU atlas packing failed, using the CPU path', e); const t = packOnCPU(layers, pack); t.detail.needsUpdate = true; atlas.tex.normalMap = atlas.tex.ormMap = t.detail; atlas.tex.auxMap = t.aux; if (atlas.mat) { atlas.mat.normalMap = t.detail; atlas.mat.userData.kitSkin.tKitAux.value = t.aux; atlas.mat.needsUpdate = true; } }
      if (!keep) for (const k of ['height', 'orm', 'ao']) if (layers[k]) layers[k].canvas.width = layers[k].canvas.height = 1;     // free ~20 MB
      return atlas;
    },
    /** True until bake() has run: the height / roughness / occlusion layers can still be painted. */
    get paintable() { return !atlas.tex || !!pending; },
    /**
     * The skin material driven entirely by the atlas (see skin.js). opts: { envMapIntensity, normalStrength, normalScale,
     * emissiveIntensity, skin: { weathering, waviness, framePitch, orangePeel, clearcoat, heatTint, cavity, mipBias, detail } }
     */
    material(ctx, opts = {}) {
      const t = atlas.tex || atlas.textures(ctx, opts);
      const m = skinMaterial(ctx, t, { ...opts, skin: { ...(o.skin || {}), ...(opts.skin || {}) } });
      atlas.mat = m;
      return m;
    },
    dispose() {
      pending = null;
      if (atlas.tex) for (const k in atlas.tex) atlas.tex[k]?.dispose();
      if (targets) { targets.detail.dispose(); targets.aux.dispose(); }
      atlas.mat?.dispose();
      for (const k in layers) { layers[k].canvas.width = layers[k].canvas.height = 1; }
    },
  };
  let targets = null, pending = null, tex = null; const strips = new Map();
  Object.defineProperty(atlas, 'tex', { get: () => tex, set: (v) => { tex = v; }, enumerable: true });
  let tone = null;
  function lazyLayer(name = 'emis') {
    if (name === 'tone') {
      if (!tone) {
        const mk = (fill) => { const c = document.createElement('canvas'); c.width = c.height = size * 0.25; const g = c.getContext('2d', { willReadFrequently: true }); if (fill) { g.fillStyle = fill; g.fillRect(0, 0, c.width, c.height); } return { canvas: c, ctx: g, scale: 0.25 }; };
        tone = { color: mk(null), rough: mk('#000') };
      }
      return tone;
    }
    if (layers[name]) return layers[name];
    if (name !== 'emis' && name !== 'ao') return undefined;
    const k = name === 'ao' ? 0.25 : 0.5, c = document.createElement('canvas'); c.width = c.height = size * k;
    const g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = name === 'ao' ? '#fff' : '#000'; g.fillRect(0, 0, c.width, c.height);
    return (layers[name] = { canvas: c, ctx: g, scale: k });
  }
  return atlas;
}

function ormStyle(rough, metal) { return `rgb(255,${Math.round(Math.min(1, Math.max(0, rough)) * 255)},${Math.round(Math.min(1, Math.max(0, metal)) * 255)})`; }

// ---- pen -------------------------------------------------------------------------------------------------------------------
const ID = [1, 0, 0, 1, 0, 0];
export class Pen {
  constructor(atlas, chart, layers, lazyLayer) { this.atlas = atlas; this.chart = chart; this.layers = layers; this._lazy = lazyLayer; this.rand = rng(1234 + chart.name.length * 77); }
  /** Low-level: run fn(g, setPaintTransform, strip, layer) for a layer with clipping to each strip of the chart. */
  each(layerName, fn) {
    const L = typeof layerName === 'object' ? layerName : this.layers[layerName] || this._lazy(layerName), g = L.ctx, k = L.scale, bleed = 3;
    this.chart.strips.forEach((s, si) => {
      g.save(); g.setTransform(...ID); g.beginPath();
      g.rect((s.rect.x - bleed) * k, (s.rect.y - bleed) * k, (s.rect.w + 2 * bleed) * k, (s.rect.h + 2 * bleed) * k); g.clip();
      const setT = () => g.setTransform(s.sx * k, 0, 0, s.sy * k, s.tx * k, s.ty * k);
      setT(); fn(g, setT, s, L, si); g.restore();
    });
  }
  _path(path) {
    if (typeof path === 'function') return path;
    if (path === 'all') return (g, s) => g.rect(s.a0 - 1, s.b0 - 1, s.a1 - s.a0 + 2, s.b1 - s.b0 + 2);
    return (g) => { path.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); };
  }
  /** Fill a region with a finish. path: 'all' | [[a, b], ...] polygon | (g, strip) => path commands in paint coords. o: { alpha, feather (px, soft sprayed edge) } */
  fill(path, finish, o = {}) {
    const pf = this._path(path), f = fin(finish), alpha = o.alpha ?? 1;
    const run = (name, style) => this.each(name, (g, setT, s, L) => { g.globalAlpha = alpha; g.fillStyle = style; if (o.feather) { g.shadowColor = style; g.shadowBlur = o.feather * L.scale; } g.beginPath(); pf(g, s); g.fill(o.rule || 'nonzero'); });
    if (f.color) run('color', f.color);
    if (f.rough !== undefined) run('orm', ormStyle(f.rough, f.metal ?? 0));
    if (f.height !== undefined) run('height', greyStyle(f.height));
    if (f.emissive) run('emis', f.emissive);
    return this;
  }
  /** Stroke a path. width in metres (o.px for a width in atlas pixels instead). */
  stroke(path, width, finish, o = {}) {
    const pf = this._path(path), f = fin(finish), alpha = o.alpha ?? 1;
    const run = (name, style) => this.each(name, (g, setT, s, L) => {
      g.globalAlpha = alpha; g.strokeStyle = style; g.lineCap = o.cap || 'butt'; g.lineJoin = o.join || 'round'; g.beginPath(); pf(g, s);
      g.setTransform(...ID); g.lineWidth = Math.max(0.6, (o.px ?? width * Math.sqrt(Math.abs(s.sx * s.sy))) * L.scale); if (o.dash) g.setLineDash(o.dash.map(d => d * L.scale)); g.stroke();
    });
    if (f.color) run('color', f.color);
    if (f.rough !== undefined) run('orm', ormStyle(f.rough, f.metal ?? 0));
    if (f.height !== undefined) run('height', greyStyle(f.height));
    return this;
  }
  /** Panel line / gap: a groove in the height layer plus a darkened line in the colour layer. o: { px = 1.2, depth = .55, dark = .35, color } */
  groove(path, o = {}) {
    const pf = this._path(path), px = o.px ?? 1.2;
    const run = (name, style, w) => this.each(name, (g, setT, s, L) => { g.strokeStyle = style; g.lineJoin = 'round'; g.beginPath(); pf(g, s); g.setTransform(...ID); g.lineWidth = Math.max(0.75, w * L.scale); g.stroke(); });
    run('height', `rgba(0,0,0,${o.depth ?? 0.55})`, px);
    if ((o.dark ?? 0.35) > 0) run('color', o.color || `rgba(10,12,14,${o.dark ?? 0.35})`, px);
    return this;
  }
  /** Open polyline groove through paint-coordinate points. */
  line(pts, o) { return this.groove((g) => pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))), o); }
  /** Rectangle outline groove (access panels, doors). r = corner radius in metres. */
  panel(a0, b0, a1, b1, o = {}) {
    const r = o.r ?? 0;
    return this.groove((g) => { if (r > 0 && g.roundRect) g.roundRect(Math.min(a0, a1), Math.min(b0, b1), Math.abs(a1 - a0), Math.abs(b1 - b0), r); else g.rect(a0, b0, a1 - a0, b1 - b0); }, o);
  }
  /** Row of rivets / fasteners from (a0, b0) to (a1, b1) every `spacing` metres. o: { px = 1.5, depth = .4, dark = .22, raised = false } */
  rivets(a0, b0, a1, b1, spacing = 0.05, o = {}) {
    const n = Math.max(1, Math.round(Math.hypot(a1 - a0, b1 - b0) / spacing)), px = o.px ?? 1.5;
    const run = (name, style) => this.each(name, (g, setT, s, L) => {
      g.setTransform(...ID); g.fillStyle = style; const w = Math.max(1, px * L.scale);
      for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n, b = b0 + (b1 - b0) * i / n; g.fillRect((s.tx + a * s.sx) * L.scale - w / 2, (s.ty + b * s.sy) * L.scale - w / 2, w, w); }
    });
    run('height', o.raised ? `rgba(255,255,255,${o.depth ?? 0.4})` : `rgba(0,0,0,${o.depth ?? 0.4})`);
    if ((o.dark ?? 0.22) > 0) run('color', `rgba(10,12,14,${o.dark ?? 0.22})`);
    return this;
  }
  /**
   * Decal frame on a projected chart: fn(g, layerName) draws in METRES with x → reading direction and y → down as it will be
   * seen on the aircraft (bottom / right-side views are pre-mirrored). o: { rot = 0 (deg, clockwise as seen), layers = ['color'], mirror }
   */
  decal(a, b, o, fn) {
    if (typeof o === 'function') { fn = o; o = {}; }
    const c = this.chart, flip = (o.mirror ?? c.readFlip) ? -1 : 1, rot = (o.rot ?? 0) * Math.PI / 180;
    for (const name of o.layers || ['color']) this.each(name, (g, setT, s, L) => {
      const k = L.scale, ax = Math.abs(s.sx) * k, ay = Math.abs(s.sy) * k, cs = Math.cos(rot), sn = Math.sin(rot);
      g.setTransform(flip * cs * ax, sn * ay, -flip * sn * ax, cs * ay, (s.tx + a * s.sx) * k, (s.ty + b * s.sy) * k);
      fn(g, name);
    });
    return this;
  }
  /**
   * Decal on the side of a lofted body (unwrap chart with chart.body set): anchor at station z, height y on side 'L' | 'R' | 'both'.
   * fn(g, layerName, side) draws in metres, x → reading direction, y → down, as seen from that side (side-view projection).
   */
  decalOn(z, y, side, o, fn) {
    if (typeof o === 'function') { fn = o; o = {}; }
    if (side === 'both') { this.decalOn(z, y, 'L', o, fn); return this.decalOn(z, y, 'R', o, fn); }
    const body = this.chart.body, tR = body.tAtY(z, y), d = 0.04, dtdy = Math.max(1e-4, Math.abs(body.tAtY(z, y + d) - body.tAtY(z, y - d)) / (2 * d));
    const t = side === 'L' ? 1 - tR : tR, sg = side === 'L' ? 1 : -1, rot = (o.rot ?? 0) * Math.PI / 180, cs = Math.cos(rot), sn = Math.sin(rot);
    for (const name of o.layers || ['color']) this.each(name, (g, setT, s, L) => {
      const k = L.scale, ax = sg * s.sx * k, ay = sg * s.sy * dtdy * k;
      g.setTransform(cs * ax, sn * ay, -sn * ax, cs * ay, (s.tx + z * s.sx) * k, (s.ty + t * s.sy) * k);
      fn(g, name, side);
    });
    return this;
  }
  /** Decal on an unwrap chart addressed by ring parameter (top / belly markings): x → +z (aft), y → +t; rot in degrees. */
  decalT(z, t, o, fn) {
    if (typeof o === 'function') { fn = o; o = {}; }
    const body = this.chart.body, girth = o.girth ?? (body ? body.girthAt(z, t) : 3), rot = (o.rot ?? 0) * Math.PI / 180, cs = Math.cos(rot), sn = Math.sin(rot);
    for (const name of o.layers || ['color']) this.each(name, (g, setT, s, L) => {
      const k = L.scale, ax = s.sx * k, ay = s.sy / girth * k;
      g.setTransform(cs * ax, sn * ay, -sn * ax, cs * ay, (s.tx + z * s.sx) * k, (s.ty + t * s.sy) * k);
      fn(g, name);
    });
    return this;
  }
  /** Fill between two heights along a body side (cheatlines, belly colour…). yLo / yHi: numbers or functions of z. */
  band(z0, z1, yLo, yHi, finish, o = {}) {
    const body = this.chart.body, n = Math.max(2, Math.ceil(Math.abs(z1 - z0) / (o.step ?? 0.2)));
    const f = (v, z) => (typeof v === 'function' ? v(z) : v);
    for (const side of o.side === 'L' || o.side === 'R' ? [o.side] : ['L', 'R']) {
      const lo = [], hi = [];
      for (let i = 0; i <= n; i++) {
        const z = z0 + (z1 - z0) * i / n; let ta = f(yLo, z) === -Infinity ? 0 : body.tAtY(z, f(yLo, z)), tb = f(yHi, z) === Infinity ? 0.5 : body.tAtY(z, f(yHi, z));
        if (side === 'L') { ta = 1 - ta; tb = 1 - tb; }
        lo.push([z, ta]); hi.push([z, tb]);
      }
      this.fill(lo.concat(hi.reverse()), finish, o);
    }
    return this;
  }
  /** Groove (or stroke with o.finish) at constant height along a body side. */
  yLine(z0, z1, y, o = {}) {
    const body = this.chart.body, n = Math.max(2, Math.ceil(Math.abs(z1 - z0) / 0.2)), f = (z) => (typeof y === 'function' ? y(z) : y);
    for (const side of o.side === 'L' || o.side === 'R' ? [o.side] : ['L', 'R']) {
      const pts = []; for (let i = 0; i <= n; i++) { const z = z0 + (z1 - z0) * i / n, t = body.tAtY(z, f(z)); pts.push([z, side === 'L' ? 1 - t : t]); }
      const path = (g) => pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      if (o.finish) this.stroke(path, o.width ?? 0.05, o.finish, o); else this.groove(path, o);
    }
    return this;
  }
  /**
   * Row of painted cabin windows on both body sides (unwrap chart with chart.body set). zs: array of window-centre stations.
   * o: { w = .26, h = .36, r = .1, side = 'both', frame = '#b9bdc0' | null, lit = .7 (fraction glowing at night), glow = '#ffd9a0', seed }
   * Paints dark glossy glass, a thin frame, a shallow recess, and (emissive layer) warm light for the lit fraction.
   */
  windows(zs, y, o = {}) {
    const w = o.w ?? 0.26, h = o.h ?? 0.36, r = o.r ?? 0.1, lit = o.lit ?? 0.7, rnd = rng(o.seed ?? 4242), glass = FINISH.paintedGlass;
    const rr = (g, k) => { g.beginPath(); g.roundRect(-w / 2 - k, -h / 2 - k, w + 2 * k, h + 2 * k, r + k); };
    for (const side of o.side === 'L' || o.side === 'R' ? [o.side] : ['L', 'R']) for (const z of zs) {
      const on = rnd() < lit, shade = rnd();
      this.decalOn(z, y, side, { layers: lit > 0 ? ['color', 'orm', 'height', 'emis'] : ['color', 'orm', 'height'] }, (g, layer) => {
        if (layer === 'color') { if (o.frame !== null) { g.fillStyle = o.frame || '#b9bdc0'; rr(g, 0.022); g.fill(); } g.fillStyle = glass.color; rr(g, 0); g.fill(); if (shade < 0.25) { g.fillStyle = 'rgba(190,195,200,0.5)'; g.beginPath(); g.roundRect(-w / 2, -h / 2, w, h * (0.3 + shade * 2), r); g.fill(); } }
        else if (layer === 'orm') { g.fillStyle = ormStyle(glass.rough, 0); rr(g, 0); g.fill(); }
        else if (layer === 'height') { g.fillStyle = 'rgba(0,0,0,0.35)'; rr(g, 0.012); g.fill(); }
        else if (on) { g.fillStyle = o.glow || '#ffd9a0'; g.globalAlpha = 0.55 + 0.45 * shade; rr(g, -0.01); g.fill(); }
      });
    }
    return this;
  }
  /** Rectangle outline groove on a body side between stations z0..z1 and heights y0..y1 (doors, hatches). o: groove options + side, r */
  doorOn(z0, z1, y0, y1, o = {}) {
    const body = this.chart.body, zm = (z0 + z1) / 2;
    for (const side of o.side === 'L' || o.side === 'R' ? [o.side] : ['L', 'R']) {
      const m = (t) => (side === 'L' ? 1 - t : t), n = 6, pts = [];
      for (let i = 0; i <= n; i++) pts.push([z0, m(body.tAtY(z0, y0 + (y1 - y0) * i / n))]);
      for (let i = n; i >= 0; i--) pts.push([z1, m(body.tAtY(z1, y0 + (y1 - y0) * i / n))]);
      pts.push(pts[0]);
      this.line(pts, o);
      if (o.handle) this.decalOn(zm, (y0 + y1) / 2, side, (g) => { g.fillStyle = 'rgba(30,32,36,0.8)'; g.fillRect(-0.09, -0.02, 0.18, 0.04); });
    }
    return this;
  }
  /** Groove around the body at station z between ring parameters t0..t1. */
  ring(z, t0 = 0, t1 = 1, o = {}) { return this.groove((g) => { g.moveTo(z, t0); g.lineTo(z, t1); }, o); }
  /** Text. On projected charts (a, b) are paint coords; h = cap height in metres. o: { color, font, weight, align, rot, spacing, finish, stretch } */
  text(str, a, b, h, o = {}) { return this.decal(a, b, { rot: o.rot, layers: o.finish ? ['color', 'orm'] : ['color'], mirror: o.mirror }, (g, layer) => drawText(g, str, h, o, layer)); }
  /** Text on a body side (see decalOn). */
  textOn(str, z, y, side, h, o = {}) { return this.decalOn(z, y, side, { rot: o.rot, layers: o.finish ? ['color', 'orm'] : ['color'] }, (g, layer) => drawText(g, str, h, o, layer)); }
  /** Tonal noise over the chart: o { alpha = .12, scale = 1.5 (metres per noise tile), stretch = [1, 1], mode: 'dark' | 'light', rough = 0 } */
  noise(o = {}) {
    const tiles = noiseTiles(), mode = o.mode || 'dark', sc = o.scale ?? 1.5, st = o.stretch || [1, 1];
    // Tone and roughness noise is low-frequency: it accumulates in quarter-resolution buffers that are composited onto the
    // layers once (atlas.flush(), called by textures()) — 16 times fewer pixels per call than painting it at full size.
    const acc = this.atlas.paintable !== false ? this._lazy('tone') : null;
    const paint = (layerName, tile, comp, alpha) => this.each(acc && layerName !== 'height' ? (layerName === 'color' ? acc.color : acc.rough) : layerName, (g, setT, s, L) => {
      const pat = g.createPattern(tile, 'repeat'); g.setTransform(...ID);
      const m = new DOMMatrix().translateSelf(s.rect.x * L.scale, s.rect.y * L.scale).scaleSelf(Math.abs(s.sx) * sc * st[0] / 128 * L.scale, Math.abs(s.sy) * (this.chart.type === 'unwrap' ? sc / (this.chart.spec.girth ?? 3) : sc) * st[1] / 128 * L.scale);
      pat.setTransform(m); g.globalAlpha = alpha; g.globalCompositeOperation = comp; g.fillStyle = pat;
      if (o.path) { setT(); g.beginPath(); this._path(o.path)(g, s); g.setTransform(...ID); g.fill(); } else g.fillRect(0, 0, L.canvas.width, L.canvas.height);
    });
    if ((o.alpha ?? 0.12) > 0) paint('color', mode === 'light' ? tiles.light : tiles.dark, 'source-over', o.alpha ?? 0.12);
    if (o.rough) paint('orm', tiles.rough, 'lighter', o.rough);
    if (o.bump) paint('height', tiles.grey, 'overlay', o.bump);
    return this;
  }
  /** Soft-edged stain (exhaust soot, oil, hydraulic streak): linear gradient from (a0,b0) to (a1,b1), `width` metres wide. */
  streak(a0, b0, a1, b1, width, o = {}) {
    const col = o.color || '20,18,16', al = o.alpha ?? 0.35;
    this.each('color', (g) => {
      const gr = g.createLinearGradient(a0, b0, a1, b1); gr.addColorStop(0, `rgba(${col},${al})`); gr.addColorStop(1, `rgba(${col},0)`);
      const dx = a1 - a0, dy = b1 - b0, l = Math.hypot(dx, dy) || 1, nx = -dy / l * width / 2, ny = dx / l * width / 2;
      g.fillStyle = gr; g.beginPath(); g.moveTo(a0 + nx * 0.4, b0 + ny * 0.4); g.lineTo(a1 + nx, b1 + ny); g.lineTo(a1 - nx, b1 - ny); g.lineTo(a0 - nx * 0.4, b0 - ny * 0.4); g.closePath(); g.fill();
    });
    if (o.rough) this.each('orm', (g) => { g.globalCompositeOperation = 'lighter'; g.fillStyle = `rgba(0,255,0,${o.rough})`; g.beginPath(); g.moveTo(a0, b0 - width / 2); g.lineTo(a1, b1 - width / 2); g.lineTo(a1, b1 + width / 2); g.lineTo(a0, b0 + width / 2); g.fill(); });
    return this;
  }
  /** Chipped / worn paint along a path (leading edges): irregular dashes of a lighter finish. */
  wear(path, width, finish = FINISH.bareMetal, o = {}) {
    const r = this.rand, dash = []; for (let i = 0; i < 24; i++) dash.push(2 + r() * 14, 3 + r() * 22);
    return this.stroke(path, width, finish, { alpha: o.alpha ?? 0.55, dash, cap: 'round' });
  }
}

function greyStyle(h) { const v = Math.round(128 + Math.max(-1, Math.min(1, h)) * 127); return `rgb(${v},${v},${v})`; }

export const FONT = { round: '"Trebuchet MS", "Verdana", "DejaVu Sans", Arial, sans-serif', sans: '"Arial Narrow", "Helvetica Neue", Arial, "Liberation Sans Narrow", "Liberation Sans", sans-serif', wide: 'Arial, "Helvetica Neue", "Liberation Sans", sans-serif', serif: 'Georgia, "Times New Roman", "Liberation Serif", serif', mono: '"B612 Mono", "DejaVu Sans Mono", Menlo, Consolas, monospace' };

/** Draw text of cap height h (metres) at the origin of the current decal frame. o: { color, font, weight = 700, align = 'center', italic, spacing = 0, stretch = 1, outline, finish } */
export function drawText(g, str, h, o = {}, layer = 'color') {
  const PX = 100;
  g.save(); g.scale(h / (PX * 0.72) * (o.stretch ?? 1), h / (PX * 0.72));
  g.font = `${o.italic ? 'italic ' : ''}${o.weight ?? 700} ${PX}px ${o.font || FONT.sans}`;
  g.textAlign = o.align || 'center'; g.textBaseline = o.baseline || 'middle';
  try { g.letterSpacing = `${(o.spacing ?? 0) * PX}px`; } catch { /* older canvas */ }
  if (layer === 'orm') g.fillStyle = ormStyle(o.finish?.rough ?? 0.4, o.finish?.metal ?? 0); else g.fillStyle = o.color || o.finish?.color || '#000';
  if (o.outline && layer === 'color') { g.lineWidth = o.outlineWidth ?? 10; g.strokeStyle = o.outline; g.lineJoin = 'round'; g.strokeText(str, 0, 0); }
  g.fillText(str, 0, 0);
  g.restore();
}

/** USAF / USN star-and-bar at the decal origin. size = diameter of the roundel disc (m). o: { lowVis: colour | false } */
export function drawStarBar(g, size, o = {}) {
  const R = size / 2, lv = o.lowVis, blue = lv || '#1b2a5a', white = lv ? null : '#f4f4f4', red = lv ? null : '#b01c2e';
  const star = () => { g.beginPath(); for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / 5, b = a + Math.PI / 5; g.lineTo(Math.cos(a) * R, Math.sin(a) * R); g.lineTo(Math.cos(b) * R * 0.382, Math.sin(b) * R * 0.382); } g.closePath(); };
  const barW = R, barH = R * 0.5, by = -R * 0.25;                     // bars: one radius long, half a radius high, top aligned with the star arms
  if (lv) {
    g.strokeStyle = lv; g.lineWidth = R * 0.07; g.lineJoin = 'miter';
    g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.stroke(); star(); g.stroke();
    g.strokeRect(-R - barW, by, barW, barH); g.strokeRect(R, by, barW, barH);
    return;
  }
  const o2 = R * 0.125;
  g.fillStyle = blue; g.fillRect(-R - barW - o2, by - o2, 2 * (R + barW + o2), barH + 2 * o2); g.beginPath(); g.arc(0, 0, R + o2, 0, Math.PI * 2); g.fill();
  g.fillStyle = white; g.fillRect(-R - barW, by, barW, barH); g.fillRect(R, by, barW, barH);
  g.fillStyle = red; g.fillRect(-R - barW, by + barH / 3, barW, barH / 3); g.fillRect(R, by + barH / 3, barW, barH / 3);
  g.fillStyle = blue; g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();
  g.fillStyle = white; star(); g.fill();
}
