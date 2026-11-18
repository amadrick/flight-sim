// Physics surface provider: tells ctx.world.groundAt() where the pavement is. Pure (node-testable).
// Called many times per frame (every wheel, every probe): AABB rejection per airport, then a short list of oriented
// rectangles in priority order (runway > taxiway > apron). Height on pavement = airport elevation.
const DEG = Math.PI / 180;
const PRIORITY = { runway: 3, taxiway: 2, apron: 1 };
export const FRICTION = { runway: 0.8, taxiway: 0.75, apron: 0.75 };

/**
 * airports: [{ position:{x,z}, elevation }]; layouts: matching buildLayout() results (airport-local rects).
 * getWetness() → 0..1 (rain) lowers the reported braking friction coefficient. Returns provider(x, z, out).
 */
export function createSurfaceProvider(airports, layouts, getWetness = () => 0) {
  const sites = airports.map((ap, i) => {
    const L = layouts[i];
    const rects = L.pave.filter((r) => r.surf).map((r) => {
      const h = r.hdg * DEG;
      return { cx: r.x, cz: r.z, dx: Math.sin(h), dz: -Math.cos(h), hl: r.len / 2, hw: r.wid / 2, type: r.surf, pri: PRIORITY[r.surf] || 0 };
    }).sort((a, b) => b.pri - a.pri);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const r of rects) {
      const ex = Math.abs(r.dx) * r.hl + Math.abs(r.dz) * r.hw, ez = Math.abs(r.dz) * r.hl + Math.abs(r.dx) * r.hw;
      minX = Math.min(minX, r.cx - ex); maxX = Math.max(maxX, r.cx + ex);
      minZ = Math.min(minZ, r.cz - ez); maxZ = Math.max(maxZ, r.cz + ez);
    }
    return { px: ap.position.x, pz: ap.position.z, elev: ap.elevation, rects, minX, maxX, minZ, maxZ };
  });
  return function scenerySurface(x, z, out) {
    for (let s = 0; s < sites.length; s++) {
      const S = sites[s];
      const lx = x - S.px, lz = z - S.pz;
      if (lx < S.minX || lx > S.maxX || lz < S.minZ || lz > S.maxZ) continue;
      const R = S.rects;
      for (let i = 0; i < R.length; i++) {
        const r = R[i];
        const ox = lx - r.cx, oz = lz - r.cz;
        const al = ox * r.dx + oz * r.dz;
        if (al > r.hl || al < -r.hl) continue;
        const cr = -ox * r.dz + oz * r.dx;
        if (cr > r.hw || cr < -r.hw) continue;
        out.type = r.type; out.height = S.elev; out.friction = FRICTION[r.type] * (1 - 0.45 * getWetness());
        return;
      }
      return;
    }
  };
}
