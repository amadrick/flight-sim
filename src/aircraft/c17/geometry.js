// C-17A Globemaster III — reference geometry in BODY axes: origin = nominal CG, +X right wing, +Y up, -Z nose. Metres.
// Shared contract between the visual model and the physics config (see f16/geometry.js for the rules).
// Source: docs/aircraft/c17.md (published figures + proportion-derived estimates, see its confidence notes).
export default {
  length: 53.04, span: 51.75, height: 16.79, wingArea: 353,
  noseZ: -25.5, tailZ: 27.54,
  cgHeight: 3.9,
  pilotEye: [-0.75, 1, -21.1],
  gear: [
    { name: 'nose', pos: [0, -3.9, -18], wheelRadius: 0.55, steerable: true, braked: false },
    { name: 'left', pos: [-5.1, -3.9, 2], wheelRadius: 0.6, steerable: false, braked: true },
    { name: 'right', pos: [5.1, -3.9, 2], wheelRadius: 0.6, steerable: false, braked: true },
  ],
  engines: [
    { nozzle: [-16.5, -0.8, 2.1], intake: [-16.5, -0.8, -2.9], nozzleRadius: 0.95 },
    { nozzle: [-8, -1.2, -2.1], intake: [-8, -1.2, -7.1], nozzleRadius: 0.95 },
    { nozzle: [8, -1.2, -2.1], intake: [8, -1.2, -7.1], nozzleRadius: 0.95 },
    { nozzle: [16.5, -0.8, 2.1], intake: [16.5, -0.8, -2.9], nozzleRadius: 0.95 },
  ],
  wingtips: [[-25.88, 4.83, 7.6], [25.88, 4.83, 7.6]],
  lights: { navLeft: [-24.45, 1.84, 4.12], navRight: [24.45, 1.84, 4.12], tail: [0, 2.1, 27.6], strobe: [0, 12.7, 27.55], beacon: [0, -2.8, 1.5], landing: [0, -2.8, -16.5] },
};
