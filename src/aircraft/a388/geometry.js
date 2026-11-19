// Airbus A380-800 — reference geometry in BODY axes: origin = nominal CG, +X right wing, +Y up, -Z nose. Metres.
// Shared contract between the visual model and the physics config (see f16/geometry.js for the rules).
// Source: docs/aircraft/a388.md (published figures + proportion-derived estimates, see its confidence notes).
export default {
  length: 72.72, span: 79.75, height: 24.09, wingArea: 845,
  noseZ: -37.5, tailZ: 35.22,
  cgHeight: 5.7,
  pilotEye: [-0.55, 2.35, -32.3],
  gear: [
    { name: 'nose', pos: [0, -5.7, -28.4], wheelRadius: 0.55, steerable: true, braked: false },
    { name: 'left', pos: [-6.25, -5.7, 0.8], wheelRadius: 0.6, steerable: false, braked: true },
    { name: 'right', pos: [6.25, -5.7, 0.8], wheelRadius: 0.6, steerable: false, braked: true },
    { name: 'bodyLeft', pos: [-2.65, -5.7, 4.9], wheelRadius: 0.6, steerable: false, braked: true },
    { name: 'bodyRight', pos: [2.65, -5.7, 4.9], wheelRadius: 0.6, steerable: false, braked: true },
  ],
  engines: [   // order = state.engines / physics.engines.each order: inboard L, outboard L, inboard R, outboard R
    { nozzle: [-12.7, -3.35, -2.5], intake: [-12.7, -3.35, -9.3], nozzleRadius: 1 },
    { nozzle: [-25.2, -2.4, 7.8], intake: [-25.2, -2.4, 1], nozzleRadius: 1 },
    { nozzle: [12.7, -3.35, -2.5], intake: [12.7, -3.35, -9.3], nozzleRadius: 1 },
    { nozzle: [25.2, -2.4, 7.8], intake: [25.2, -2.4, 1], nozzleRadius: 1 },
  ],
  wingtips: [[-39.875, 2.1, 14.5], [39.875, 2.1, 14.5]],
  lights: { navLeft: [-39.95, 2.05, 12.2], navRight: [39.95, 2.05, 12.2], tail: [0, 1.4, 35.0], strobe: [0, 1.68, 34.75], beacon: [0, -4.25, -16.5], landing: [-4.8, -2.62, -10.55] },
};
