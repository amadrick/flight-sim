// A-10C Thunderbolt II — reference geometry in BODY axes: origin = nominal CG, +X right wing, +Y up, -Z nose. Metres.
// Shared contract between the visual model and the physics config (see f16/geometry.js for the rules).
// Source: docs/aircraft/a10.md (published figures + proportion-derived estimates, see its confidence notes).
export default {
  length: 16.26, span: 17.53, height: 4.47, wingArea: 47.01,
  noseZ: -7.35, tailZ: 8.91,
  cgHeight: 1.65,
  pilotEye: [0, 0.95, -3.95],
  gear: [
    { name: 'nose', pos: [0.3, -1.65, -4.7], wheelRadius: 0.28, steerable: true, braked: false },
    { name: 'left', pos: [-2.5, -1.65, 0.4], wheelRadius: 0.45, steerable: false, braked: true },
    { name: 'right', pos: [2.5, -1.65, 0.4], wheelRadius: 0.45, steerable: false, braked: true },
  ],
  engines: [
    { nozzle: [-1.3, 0.85, 5.35], intake: [-1.3, 0.85, 1.65], nozzleRadius: 0.5 },
    { nozzle: [1.3, 0.85, 5.35], intake: [1.3, 0.85, 1.65], nozzleRadius: 0.5 },
  ],
  wingtips: [[-8.765, 0.45, 0.35], [8.765, 0.45, 0.35]],
  lights: { navLeft: [-8.7, 0.45, 0.35], navRight: [8.7, 0.45, 0.35], tail: [0, 1.4, 8.85], strobe: [0, 2.6, 8.25], beacon: [0, 0.9, 2.25], landing: [0.3, -0.6, -4.75] },
};
