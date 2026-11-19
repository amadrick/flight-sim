// SR-71A Blackbird — reference geometry in BODY axes: origin = nominal CG, +X right wing, +Y up, -Z nose. Metres.
// Shared contract between the visual model and the physics config (see f16/geometry.js for the rules).
// Source: docs/aircraft/sr71.md (published figures + proportion-derived estimates, see its confidence notes).
export default {
  length: 32.74, span: 16.94, height: 5.64, wingArea: 167,
  noseZ: -20, tailZ: 12.74,
  cgHeight: 2,
  pilotEye: [0, 0.72, -13],
  gear: [
    { name: 'nose', pos: [0, -2, -11], wheelRadius: 0.3, steerable: true, braked: false },
    { name: 'left', pos: [-2.5, -2, 1.2], wheelRadius: 0.47, steerable: false, braked: true },
    { name: 'right', pos: [2.5, -2, 1.2], wheelRadius: 0.47, steerable: false, braked: true },
  ],
  engines: [
    { nozzle: [-3.7, -0.1, 10.5], intake: [-3.7, -0.1, -3.5], nozzleRadius: 0.68 },
    { nozzle: [3.7, -0.1, 10.5], intake: [3.7, -0.1, -3.5], nozzleRadius: 0.68 },
  ],
  wingtips: [[-8.47, -0.1, 8], [8.47, -0.1, 8]],
  lights: { navLeft: [-8.51, -0.1, 7.9], navRight: [8.51, -0.1, 7.9], tail: [0, 0.07, 12.79], strobe: [-2.91, 3.72, 6.9], beacon: [0, 0.85, -8], landing: [0, -1.05, -11.12] },
};
