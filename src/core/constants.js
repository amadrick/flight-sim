// Shared constants. Owned by the integrator — do not edit from module branches.
export const EARTH_RADIUS = 6371000;      // m
export const G0 = 9.80665;                // m/s^2
export const SEA_LEVEL = 0;               // world y of mean sea level
export const DEG = Math.PI / 180;
export const KTS = 0.514444;              // m/s per knot
export const FT = 0.3048;                 // m per foot
export const NM = 1852;                   // m per nautical mile
export const LBF = 4.4482216;             // N per pound-force
export const LB = 0.45359237;             // kg per pound

// Radiometric convention (see ARCHITECTURE.md §Lighting): a white Lambertian surface facing the
// noon sun has outgoing radiance ~1.0. Sun illuminance at the top of the atmosphere:
export const SUN_ILLUMINANCE = 4.0;

// three.js layers
export const LAYERS = {
  MAIN: 0,       // normal scene geometry: gets aerial perspective + clouds composited over it
  POST: 1,       // drawn AFTER atmosphere/cloud composite, depth-tested against the scene (particles, contrails, light flares, cockpit glass)
  COCKPIT: 2,    // (reserved) cockpit interior
};
