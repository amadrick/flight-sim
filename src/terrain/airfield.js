// Airfield map: a signed-distance field of the pavement of the airport nearest the camera, baked on the GPU into an
// RG16F texture the ground shaders read with one bilinear fetch.
//     r = signed distance to the nearest pavement of any kind (runway, taxiway, apron, shoulder, blast pad, fillet,
//         road, car park), metres, negative inside;   g = signed distance to runway pavement (runway + blast pads).
// Distances to straight edges are linear across an edge, so bilinear filtering reproduces them exactly between the
// corners: the grass can wear, thin out and stop at the pavement edge to a few centimetres at a 2 m texel.
// Users: the terrain surface (worn edges, mowing strips, short / long grass zones), the near-field turf (it never
// grows through pavement) and the grass tufts. Layouts come from ctx.scenery (the airports' plans), read lazily, so
// nothing needs to change in other modules. One airport at a time; rebuilt (one pass, ~0.1-2 ms on a GPU) when the
// nearest airport changes.
import * as THREE from 'three';
import { FULLSCREEN_VERT, fullscreenTriangle } from '../core/glsl.js';

const DEG = Math.PI / 180;
const MAXP = 1024;                 // primitives per airport

export const AIRFIELD_GLSL = /* glsl */`
uniform sampler2D tAirMap;
uniform vec4 uAirMap;      // xy = render-space xz of the map's low corner, zw = 1 / extent (m)
uniform vec4 uAirInfo;     // xy = mowing axis (unit world xz, along the primary runway), z = 1 when a map is bound, w = texel (m)
// x = signed distance to any pavement, y = to runway pavement (m); 1e4 outside the map
vec2 airMap(vec2 rxz) {
  vec2 uv = (rxz - uAirMap.xy) * uAirMap.zw;
  if (uAirInfo.z < 0.5 || any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec2(1.0e4);
  return textureLod(tAirMap, uv, 0.0).rg;
}
// Mowing plan of the airfield turf (shared by the ground shader and the near-field turf so they agree): w = world xz,
// dP = distance to pavement, nA / nB = two independent noise values ~ U(0,1) varying over hundreds of metres, nC over
// tens of metres. dir = unit world xz direction the blades lie, lay 0..1, H = sward height (m), longG 0 mown .. 1 long
// grass zone, since 0..1 time since mowing, pf = position across the mower pass 0..1.
struct TurfP { vec2 dir; float lay; float H; float longG; float since; float pf; float passW; };
TurfP turfPlan(vec2 w, float dP, float nA, float nB, float nC) {
  TurfP T;
  vec2 ax = uAirInfo.z > 0.5 ? uAirInfo.xy : vec2(1.0, 0.0), axp = vec2(-ax.y, ax.x);
  T.passW = 6.4;
  float acr = dot(w, axp) + 5.0 * (nB - 0.5) + 1.2 * (nC - 0.5), alg = dot(w, ax);
  float pid = floor(acr / T.passW);
  T.pf = fract(acr / T.passW);
  // the field is not all cut on one day: blocks of passes at different times since mowing
  vec2 bq = vec2(floor(alg / 310.0 + 0.3 * nA), floor(acr / (T.passW * 7.0))) + 811.0;
  uvec2 q = uvec2(ivec2(bq));
  uint hh = q.x * 0x8da6b343u + q.y * 0xd8163841u + 0x9e3779b9u;
  hh ^= hh >> 15; hh *= 0x2c1b3c6du; hh ^= hh >> 12; hh *= 0x297a2d39u; hh ^= hh >> 15;
  T.since = float(hh & 0xffffu) / 65536.0;
  T.longG = clamp((dP + 50.0 * (nA - 0.5) + 20.0 * (nC - 0.5) - 55.0) / 65.0, 0.0, 1.0);
  T.longG = T.longG * T.longG * (3.0 - 2.0 * T.longG);
  T.H = mix(0.04, 0.13, T.longG) * (0.8 + 0.45 * T.since);
  T.lay = mix(0.70, 0.18, T.longG) * (1.0 - 0.55 * T.since);
  T.dir = ax * (mod(pid, 2.0) < 0.5 ? 1.0 : -1.0);
  return T;
}
`;

const GEN_FRAG = /* glsl */`
precision highp float; precision highp int;
out vec4 outColor;
uniform sampler2D tPrim;
uniform int uCount;
uniform vec4 uDom;        // xy = airport-local min corner, zw = extent
uniform vec2 uSize;
float sdBox(vec2 q, vec2 b) { vec2 e = abs(q) - b; return length(max(e, 0.0)) + min(max(e.x, e.y), 0.0); }
float sdTri(vec2 p, vec2 a, vec2 b, vec2 c) {
  vec2 e0 = b - a, e1 = c - b, e2 = a - c, v0 = p - a, v1 = p - b, v2 = p - c;
  vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)), vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
               vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}
void main() {
  vec2 p = uDom.xy + gl_FragCoord.xy / uSize * uDom.zw;
  float dA = 1.0e4, dR = 1.0e4;
  for (int i = 0; i < ${MAXP}; i++) {
    if (i >= uCount) break;
    vec4 a = texelFetch(tPrim, ivec2(i * 2, 0), 0), b = texelFetch(tPrim, ivec2(i * 2 + 1, 0), 0);
    float d;
    if (b.z > 1.5) d = sdTri(p, a.xy, a.zw, b.xy);
    else { vec2 q = p - a.xy; d = sdBox(vec2(dot(q, a.zw), dot(q, vec2(-a.w, a.z))), b.xy); }
    dA = min(dA, d);
    if (b.z > 0.5 && b.z < 1.5) dR = min(dR, d);
  }
  outColor = vec4(clamp(dA, -500.0, 4000.0), clamp(dR, -500.0, 4000.0), 0.0, 1.0);
}`;

/** Primitives (airport-local) of a layout: [{ t: 0 rect | 1 runway rect | 2 triangle, ... }]. */
export function airfieldPrimitives(L) {
  const P = [];
  const rect = (x, z, hdg, len, wid, t) => { const h = hdg * DEG; P.push({ t, x, z, dx: Math.sin(h), dz: -Math.cos(h), hl: len / 2, hw: wid / 2 }); };
  for (const r of L.pave || []) rect(r.x, r.z, r.hdg, r.len, r.wid, r.kind === 'rwy' || r.kind === 'rwyConcrete' || r.kind === 'blast' ? 1 : 0);
  for (const R of L.roads || []) for (let i = 0; i + 1 < R.pts.length; i++) {
    const a = R.pts[i], b = R.pts[i + 1], dx = b.x - a.x, dz = b.z - a.z;
    rect((a.x + b.x) / 2, (a.z + b.z) / 2, Math.atan2(dx, -dz) / DEG, Math.hypot(dx, dz) + R.wid, R.wid, 0);
  }
  for (const Q of L.parkingLots || []) rect(Q.x, Q.z, Q.hdg, Q.len, Q.wid, 0);
  for (const t of L.fillets || []) P.push({ t: 2, a: t[0], b: t[1], c: t[2] });
  return P.slice(0, MAXP);
}

/** CPU twin of the baked field (airport-local x, z): [dAny, dRunway]. For tests and placement on the CPU. */
export function airfieldDistance(prims, x, z) {
  let dA = 1e4, dR = 1e4;
  for (const p of prims) {
    let d;
    if (p.t === 2) {
      const tri = [p.a, p.b, p.c];
      let m = Infinity, inside = true, s0 = 0;
      for (let k = 0; k < 3; k++) {
        const A = tri[k], B = tri[(k + 1) % 3], ex = B.x - A.x, ez = B.z - A.z, vx = x - A.x, vz = z - A.z;
        const t = Math.max(0, Math.min(1, (vx * ex + vz * ez) / (ex * ex + ez * ez)));
        m = Math.min(m, Math.hypot(vx - ex * t, vz - ez * t));
        const cr = ex * vz - ez * vx;
        if (k === 0) s0 = Math.sign(cr); else if (Math.sign(cr) !== s0) inside = false;
      }
      d = inside ? -m : m;
    } else {
      const qx = x - p.x, qz = z - p.z;
      const ea = Math.abs(qx * p.dx + qz * p.dz) - p.hl, ec = Math.abs(-qx * p.dz + qz * p.dx) - p.hw;
      d = Math.hypot(Math.max(ea, 0), Math.max(ec, 0)) + Math.min(Math.max(ea, ec), 0);
    }
    dA = Math.min(dA, d);
    if (p.t === 1) dR = Math.min(dR, d);
  }
  return [dA, dR];
}

export function createAirfieldMap(ctx, { texel = 2, margin = 320, maxSize = 2048 } = {}) {
  const renderer = ctx.renderer;
  const dummy = new THREE.DataTexture(new Uint16Array([THREE.DataUtils.toHalfFloat(1e4), THREE.DataUtils.toHalfFloat(1e4), 0, 0]), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  dummy.needsUpdate = true;
  const uniforms = {
    tAirMap: { value: dummy },
    uAirMap: { value: new THREE.Vector4(0, 0, 1e-6, 1e-6) },
    uAirInfo: { value: new THREE.Vector4(1, 0, 0, texel) },
  };
  const primData = new Float32Array(MAXP * 2 * 4);
  const primTex = new THREE.DataTexture(primData, MAXP * 2, 1, THREE.RGBAFormat, THREE.FloatType);
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false,
    uniforms: { tPrim: { value: primTex }, uCount: { value: 0 }, uDom: { value: new THREE.Vector4() }, uSize: { value: new THREE.Vector2() } },
    vertexShader: FULLSCREEN_VERT, fragmentShader: GEN_FRAG,
  });
  const tri = fullscreenTriangle();
  const scene = new THREE.Scene(), mesh = new THREE.Mesh(tri, mat), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  mesh.frustumCulled = false; scene.add(mesh);
  let rt = null, current = null, stats = { airport: null, size: [0, 0], texel: 0, prims: 0, ms: 0, bytes: 0 };
  const state = { ap: null, pos: null, prims: null, dom: null };

  function build(ap) {
    const t0 = performance.now();
    const L = ap.layout, pos = ap.data.position;
    const prims = airfieldPrimitives(L);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const grow = (x, z) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); };
    for (const r of [...(L.pave || []), ...(L.parkingLots || [])]) {
      const h = r.hdg * DEG, ex = Math.abs(Math.sin(h)) * r.len / 2 + Math.abs(Math.cos(h)) * r.wid / 2, ez = Math.abs(Math.cos(h)) * r.len / 2 + Math.abs(Math.sin(h)) * r.wid / 2;
      grow(r.x - ex, r.z - ez); grow(r.x + ex, r.z + ez);
    }
    x0 -= margin; z0 -= margin; x1 += margin; z1 += margin;
    const t = Math.max(texel, (x1 - x0) / maxSize, (z1 - z0) / maxSize);
    const W = Math.ceil((x1 - x0) / t), H = Math.ceil((z1 - z0) / t);
    primData.fill(0);
    prims.forEach((p, i) => {
      const o = i * 8;
      if (p.t === 2) primData.set([p.a.x, p.a.z, p.b.x, p.b.z, p.c.x, p.c.z, 2, 0], o);
      else primData.set([p.x, p.z, p.dx, p.dz, p.hl, p.hw, p.t, 0], o);
    });
    primTex.needsUpdate = true;
    if (rt) rt.dispose();
    rt = new THREE.WebGLRenderTarget(W, H, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: false, colorSpace: THREE.NoColorSpace,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    });
    mat.uniforms.uCount.value = prims.length;
    mat.uniforms.uDom.value.set(x0, z0, W * t, H * t);
    mat.uniforms.uSize.value.set(W, H);
    const prev = renderer.getRenderTarget(), prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(rt); renderer.render(scene, cam);
    renderer.setRenderTarget(prev); renderer.autoClear = prevAuto;
    uniforms.tAirMap.value = rt.texture;
    const rw = ap.data.runways?.[0];
    const hv = rw ? rw.heading * DEG : 0;
    uniforms.uAirInfo.value.set(Math.sin(hv), -Math.cos(hv), 1, t);
    state.ap = ap; state.pos = pos; state.prims = prims; state.dom = [x0, z0, W * t, H * t];
    stats = { airport: ap.id, size: [W, H], texel: t, prims: prims.length, ms: +(performance.now() - t0).toFixed(1), bytes: W * H * 8 };
  }

  return {
    uniforms, glsl: AIRFIELD_GLSL,
    get stats() { return stats; },
    /** CPU distance [dAny, dRunway] at world (x, z) for the airport currently mapped (1e4 if none). */
    distanceAt(x, z) { return state.prims ? airfieldDistance(state.prims, x - state.pos.x, z - state.pos.z) : [1e4, 1e4]; },
    update(camWX, camWZ, org) {
      const aps = ctx.scenery?.airports;
      if (aps && aps.length) {
        let best = null, bd = Infinity;
        for (const ap of aps) {
          const p = ap.data?.position; if (!p || !ap.layout) continue;
          const d = Math.hypot(p.x - camWX, p.z - camWZ);
          if (d < bd) { bd = d; best = ap; }
        }
        if (best && best !== current && bd < 25000) { current = best; build(best); }
      }
      if (state.dom) {
        uniforms.uAirMap.value.set(state.pos.x + state.dom[0] - org.x, state.pos.z + state.dom[1] - org.z, 1 / state.dom[2], 1 / state.dom[3]);
      }
    },
    dispose() { if (rt) rt.dispose(); primTex.dispose(); dummy.dispose(); mat.dispose(); tri.dispose(); },
  };
}
