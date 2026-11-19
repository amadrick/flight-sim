// A-10C Thunderbolt II — reference geometry in BODY axes: origin = nominal CG, +X right wing, +Y up, -Z nose. Metres.
// Shared contract between the visual model and the physics config (see f16/geometry.js for the rules).
// Source: docs/aircraft/a10.md (published figures + proportion-derived estimates, see its confidence notes).
export default {
  length: 16.26, span: 17.53, height: 4.47, wingArea: 47.01,
  noseZ: -7.35, tailZ: 8.91,
  cgHeight: 1.65,
  pilotEye: [0, 1.3, -3.95],
  gear: [
    { name: 'nose', pos: [0.3, -1.65, -4.7], wheelRadius: 0.28, steerable: true, braked: false },
    { name: 'left', pos: [-2.5, -1.65, 0.4], wheelRadius: 0.45, steerable: false, braked: true },
    { name: 'right', pos: [2.5, -1.65, 0.4], wheelRadius: 0.45, steerable: false, braked: true },
  ],
  engines: [
    { nozzle: [-1.2, 1.45, 5.12], intake: [-1.2, 1.45, 1.65], nozzleRadius: 0.5 },
    { nozzle: [1.2, 1.45, 5.12], intake: [1.2, 1.45, 1.65], nozzleRadius: 0.5 },
  ],
  wingtips: [[-8.77, 0.12, 0.05], [8.77, 0.12, 0.05]],
  lights: { navLeft: [-8.8, 0.12, -0.45], navRight: [8.8, 0.12, -0.45], tail: [0, 0.6, 8.93], strobe: [2.75, 2.86, 7.95], beacon: [0, 1.0, 2.6], landing: [0.3, -0.9, -4.73] },
};
