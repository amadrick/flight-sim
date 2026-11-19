// Aircraft kit — stores and small external details: missiles, tanks, launch rails, probes, antennas, wicks, fences.
import * as THREE from 'three';
import { Mesh, lathe, tube, prism } from './mesh.js';

const rotZ = (m, a) => m.transform(new THREE.Matrix4().makeRotationZ(a));

/** Thin flat fin: outline [[z, r], ...] in the plane through the axis, `n` copies around Z starting at `roll` degrees. */
function fins(outline, n, t, roll, uv) {
  const m = new Mesh();
  for (let i = 0; i < n; i++) m.add(rotZ(prism(outline, -t / 2, t / 2, uv), (roll + i * 360 / n) * Math.PI / 180));
  return m;
}

/**
 * Air-to-air missile along Z (nose at z = 0, tail at z = length), centred on the axis. Defaults ≈ AIM-9M Sidewinder.
 * opts: { length = 2.87, radius = .0635, uvBody, uvNose, uvFin, canards: { z, chord, span }, wings: { z, chord, span }, roll = 45 }
 */
export function missile(o = {}) {
  const L = o.length ?? 2.87, r = o.radius ?? 0.0635, uvB = o.uvBody || [0, 0], uvN = o.uvNose || uvB, uvF = o.uvFin || uvB, roll = o.roll ?? 45;
  const m = lathe([[0, 0], [r * 0.5, 0.035], [r * 0.82, 0.1], [r, 0.2, 1]], { segments: 12, uv: uvN });
  m.add(lathe([[r, 0.2], [r, L - 0.06], [r * 0.82, L, 1], [0, L]], { segments: 12, uv: uvB }));
  const c = o.canards ?? { z: 0.42, chord: 0.2, span: 0.19 }, w = o.wings ?? { z: L - 0.6, chord: 0.56, span: 0.25 };
  if (c) m.add(fins([[c.z, r * 0.8], [c.z + c.chord * 0.55, r + c.span], [c.z + c.chord * 0.85, r + c.span], [c.z + c.chord, r * 0.8]], 4, 0.012, roll, uvF));
  if (w) m.add(fins([[w.z, r * 0.8], [w.z + w.chord * 0.62, r + w.span], [w.z + w.chord, r + w.span], [w.z + w.chord, r * 0.8]], 4, 0.016, roll, uvF));
  return m;
}

/** Wingtip / pylon launch rail: a slim beam from z0 to z1 at (x, y). opts: { x, y, z0, z1, w = .07, h = .11, uv } */
export function launchRail(o) {
  const h = o.h ?? 0.11, w = o.w ?? 0.07;
  return prism([[o.z0, o.y], [o.z0 + 0.25, o.y + h / 2], [o.z1 - 0.1, o.y + h / 2], [o.z1, o.y + h * 0.2], [o.z1, o.y - h * 0.2], [o.z1 - 0.1, o.y - h / 2], [o.z0 + 0.25, o.y - h / 2]], o.x - w / 2, o.x + w / 2, o.uv);
}

/** Drop tank / pod: ogive nose and tail on a cylinder along Z. opts: { length, radius, nose = .28, tail = .38 (fractions), uv, fins = 0 } */
export function tank(o) {
  const L = o.length, r = o.radius, nz = L * (o.nose ?? 0.28), tz = L * (o.tail ?? 0.38), prof = [];
  for (let i = 0; i <= 8; i++) { const f = i / 8; prof.push([r * Math.sin(f * Math.PI / 2) ** 0.8 * (i === 0 ? 0 : 1), nz * (1 - Math.cos(f * Math.PI / 2))]); }
  prof.push([r, L - tz]);
  for (let i = 1; i <= 8; i++) { const f = i / 8; prof.push([r * Math.cos(f * Math.PI / 2) ** 0.9 * (i === 8 ? 0 : 1), L - tz + tz * Math.sin(f * Math.PI / 2)]); }
  const m = lathe(prof, { segments: o.segments ?? 16, uv: o.uv });
  if (o.fins) m.add(fins([[L - tz * 0.75, r * 0.6], [L - tz * 0.3, r * 1.6], [L - tz * 0.1, r * 1.6], [L - tz * 0.1, r * 0.2]], o.fins, 0.015, o.finRoll ?? 0, o.uvFin || o.uv));
  return m;
}

/** Pitot / air-data probe from `a` to `b` (tip). */
export function probe(a, b, r = 0.012, uv) {
  const m = tube(a, [a[0] + (b[0] - a[0]) * 0.7, a[1] + (b[1] - a[1]) * 0.7, a[2] + (b[2] - a[2]) * 0.7], r, r * 0.8, { segments: 8, uv });
  return m.add(tube([a[0] + (b[0] - a[0]) * 0.7, a[1] + (b[1] - a[1]) * 0.7, a[2] + (b[2] - a[2]) * 0.7], b, r * 0.55, r * 0.3, { segments: 8, uv }));
}

/**
 * Blade antenna standing on a surface point. opts: { pos: [x, y, z], height = .2, chord = .22, sweep = .12 (aft lean at the tip),
 *   thickness = .015, down = false (hang below), uv }
 */
export function bladeAntenna(o) {
  const [x, y, z] = o.pos, h = (o.height ?? 0.2) * (o.down ? -1 : 1), c = o.chord ?? 0.22, s = o.sweep ?? 0.12, t = o.thickness ?? 0.015;
  return prism([[z - c / 2, y], [z + c / 2, y], [z + c * 0.35 + s, y + h], [z - c * 0.05 + s, y + h]], x - t / 2, x + t / 2, o.uv);
}

/** Static discharge wicks: thin rods trailing aft from the given points. */
export function staticWicks(points, length = 0.18, uv) {
  const m = new Mesh();
  for (const p of points) m.add(tube(p, [p[0], p[1] - length * 0.08, p[2] + length], 0.004, 0.002, { segments: 4, uv }));
  return m;
}

/** Row of vortex generators (tiny vanes) between two surface points. opts: { a, b, n, height = .025, chord = .05, toe = 15 (deg), up = [0,1,0], uv } */
export function vortexGenerators(o) {
  const m = new Mesh(), n = o.n ?? 12, h = o.height ?? 0.025, c = o.chord ?? 0.05;
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0.5 : i / (n - 1), p = [o.a[0] + (o.b[0] - o.a[0]) * f, o.a[1] + (o.b[1] - o.a[1]) * f, o.a[2] + (o.b[2] - o.a[2]) * f];
    const v = prism([[-c / 2, 0], [c / 2, 0], [c / 2, h], [-c * 0.1, h]], -0.002, 0.002, o.uv).rotateY(((o.toe ?? 15) * (i % 2 ? 1 : -1)) * Math.PI / 180);
    m.add(v.translate(p[0], p[1], p[2]));
  }
  return m;
}

/** Wing fence / strake plate: outline [[z, y], ...] at spanwise station x. */
export function fence(outline, x, t = 0.012, uv) { return prism(outline, x - t / 2, x + t / 2, uv); }


