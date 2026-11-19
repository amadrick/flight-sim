// B-2A Spirit — reference geometry in BODY axes: origin = nominal CG, +X right wing, +Y up, -Z nose. Metres.
// Shared contract between the visual model and the physics config (see f16/geometry.js for the rules).
// Source: docs/aircraft/b2.md (published figures + proportion-derived estimates, see its confidence notes).
export default {
  length: 20.9, span: 52.4, height: 5.18, wingArea: 478,
  noseZ: -9.4, tailZ: 11.5,
  cgHeight: 3,
  pilotEye: [-0.55, 1.45, -5.0],
  gear: [
    { name: 'nose', pos: [0, -3, -6], wheelRadius: 0.4, steerable: true, braked: false },
    { name: 'left', pos: [-4.6, -3, 0.9], wheelRadius: 0.55, steerable: false, braked: true },
    { name: 'right', pos: [4.6, -3, 0.9], wheelRadius: 0.55, steerable: false, braked: true },
  ],
  engines: [
    { nozzle: [-3.95, 0.44, 6.8], intake: [-3.85, 1.15, -2.3], nozzleRadius: 0.45 },
    { nozzle: [-1.95, 0.53, 7.4], intake: [-2.05, 1.27, -2.3], nozzleRadius: 0.45 },
    { nozzle: [1.95, 0.53, 7.4], intake: [2.05, 1.27, -2.3], nozzleRadius: 0.45 },
    { nozzle: [3.95, 0.44, 6.8], intake: [3.85, 1.15, -2.3], nozzleRadius: 0.45 },
  ],
  wingtips: [[-26.2, 0.12, 7.95], [26.2, 0.12, 7.95]],
  lights: { navLeft: [-26.1, 0.13, 7.96], navRight: [26.1, 0.13, 7.96], tail: [0, 0.31, 11.3], strobe: [0, 1.34, 1.6], beacon: [0, -1.03, 0.1], landing: [-0.16, -1.15, -5.62] },
};
