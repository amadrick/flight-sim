// The world's airports. Owned by the integrator. World space: +X east, +Z south (north = -Z), metres.
// Terrain MUST be flat at `elevation` within `flattenRadius` of `position` and blend out smoothly beyond it.
import { DEG } from '../core/constants.js';

/**
 * runway.heading = true heading (degrees) when rolling from the first-named end toward the second.
 * runway.center  = world {x, z} of the runway midpoint.
 */
export const AIRPORTS = [
  {
    id: 'KHVN', name: 'Haven International', kind: 'international',
    description: 'Coastal hub on a wide plain. Long parallel runways, the default home base.',
    position: { x: 0, z: 0 }, elevation: 12, flattenRadius: 4500,
    runways: [
      { id: '09L/27R', heading: 90, length: 3800, width: 60, center: { x: 0, z: -900 }, surface: 'asphalt', lighting: 'full' },
      { id: '09R/27L', heading: 90, length: 3200, width: 45, center: { x: 300, z: 900 }, surface: 'asphalt', lighting: 'full' },
    ],
  },
  {
    id: 'KRDR', name: 'Redrock Air Force Base', kind: 'military',
    description: 'Desert test base on a dry lakebed, 140 km east. One enormous runway.',
    position: { x: 140000, z: -30000 }, elevation: 702, flattenRadius: 5200,
    runways: [
      { id: '04/22', heading: 40, length: 4500, width: 90, center: { x: 140000, z: -30000 }, surface: 'concrete', lighting: 'full' },
    ],
  },
  {
    id: 'KPNC', name: 'Pinecrest Regional', kind: 'regional',
    description: 'A short strip in a high mountain valley. Terrain on every side.',
    position: { x: -20000, z: -95000 }, elevation: 1650, flattenRadius: 2300,
    runways: [
      { id: '15/33', heading: 150, length: 2100, width: 30, center: { x: -20000, z: -95000 }, surface: 'asphalt', lighting: 'basic' },
    ],
  },
  {
    id: 'PCRK', name: 'Coral Key', kind: 'island',
    description: 'A single runway on a small tropical island far out to sea.',
    position: { x: -85000, z: 85000 }, elevation: 5, flattenRadius: 2700,
    runways: [
      { id: '12/30', heading: 120, length: 2400, width: 45, center: { x: -85000, z: 85000 }, surface: 'asphalt', lighting: 'basic' },
    ],
  },
  {
    id: 'KBAY', name: 'Baywater International', kind: 'international',
    description: 'Second major hub, 265 km west across the bay. A natural airliner destination.',
    position: { x: -260000, z: -60000 }, elevation: 6, flattenRadius: 4500,
    runways: [
      { id: '16L/34R', heading: 160, length: 3600, width: 60, center: { x: -259400, z: -60000 }, surface: 'asphalt', lighting: 'full' },
      { id: '16R/34L', heading: 160, length: 3600, width: 60, center: { x: -260900, z: -60300 }, surface: 'asphalt', lighting: 'full' },
    ],
  },
];

// Aircraft carrier (static for now). Deck is a surface provider registered by the scenery/carrier module.
export const CARRIER = {
  id: 'CVN', name: 'USS Meridian', position: { x: 15000, z: 45000 }, heading: 280, deckHeight: 19.8,
  length: 333, beam: 77, landingAreaAngle: -9, // angled deck is rotated 9° to port of the hull axis
};

export function getAirport(id) { return AIRPORTS.find(a => a.id === id) || AIRPORTS[0]; }

/** Unit vector (world x,z) pointing along a true heading in degrees. */
export function headingVector(deg) { const a = deg * DEG; return { x: Math.sin(a), z: -Math.cos(a) }; }

/**
 * Geometry of one runway direction. end = 0 → use the first-named end (takeoff along runway.heading),
 * end = 1 → the reciprocal. Returns threshold (start of the runway for that direction), heading (deg), dir.
 */
export function runwayEnd(runway, end = 0) {
  const hdg = (runway.heading + (end ? 180 : 0)) % 360;
  const d = headingVector(hdg);
  const half = runway.length / 2;
  return {
    name: runway.id.split('/')[end] || runway.id,
    heading: hdg, dir: d,
    threshold: { x: runway.center.x - d.x * half, z: runway.center.z - d.z * half },
    farEnd: { x: runway.center.x + d.x * half, z: runway.center.z + d.z * half },
    length: runway.length, width: runway.width,
  };
}

/** Signed along-track / cross-track of world point relative to a runway centerline (metres). */
export function runwayLocal(runway, x, z) {
  const d = headingVector(runway.heading);
  const dx = x - runway.center.x, dz = z - runway.center.z;
  return { along: dx * d.x + dz * d.z, cross: dx * -d.z + dz * d.x };
}
