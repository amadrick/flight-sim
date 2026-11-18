// B-2A Spirit — reference geometry in BODY axes: origin = nominal CG, +X right wing, +Y up, -Z nose. Metres.
// Shared contract between the visual model and the physics config (see f16/geometry.js for the rules).
// Source: docs/aircraft/b2.md (published figures + proportion-derived estimates, see its confidence notes).
export default {
  length: 20.9, span: 52.4, height: 5.18, wingArea: 478,
  noseZ: -9.4, tailZ: 11.5,
  cgHeight: 3,
  pilotEye: [-0.55, 0.9, -5.5],
  gear: [
    { name: 'nose', pos: [0, -3, -6], wheelRadius: 0.4, steerable: true, braked: false },
    { name: 'left', pos: [-4.6, -3, 0.9], wheelRadius: 0.55, steerable: false, braked: true },
    { name: 'right', pos: [4.6, -3, 0.9], wheelRadius: 0.55, steerable: false, braked: true },
  ],
  engines: [
    { nozzle: [-4.1, 0.6, 8], intake: [-4.3, 0.9, -2.2], nozzleRadius: 0.45 },
    { nozzle: [-1.9, 0.7, 8], intake: [-2, 1, -2.2], nozzleRadius: 0.45 },
    { nozzle: [1.9, 0.7, 8], intake: [2, 1, -2.2], nozzleRadius: 0.45 },
    { nozzle: [4.1, 0.6, 8], intake: [4.3, 0.9, -2.2], nozzleRadius: 0.45 },
  ],
  wingtips: [[-26.2, 0.1, 7.9], [26.2, 0.1, 7.9]],
  lights: { navLeft: [-26.1, 0.1, 7.9], navRight: [26.1, 0.1, 7.9], tail: [0, 0.2, 11.2], strobe: [0, 1.15, 1.6], beacon: [0, -1.05, 0.1], landing: [0, -0.9, -5.6] },
};
