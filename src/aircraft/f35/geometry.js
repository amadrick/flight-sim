// F-35A Lightning II — reference geometry in BODY axes: origin = nominal CG, +X right wing, +Y up, -Z nose. Metres.
// Shared contract between the visual model and the physics config (see f16/geometry.js for the rules).
// Source: docs/aircraft/f35.md (published figures + proportion-derived estimates, see its confidence notes).
export default {
  length: 15.67, span: 10.7, height: 4.38, wingArea: 42.7,
  noseZ: -8.6, tailZ: 7.07,
  cgHeight: 1.6,
  pilotEye: [0, 0.85, -4.7],
  gear: [
    { name: 'nose', pos: [0, -1.6, -5.1], wheelRadius: 0.2, steerable: true, braked: false },
    { name: 'left', pos: [-1.6, -1.6, 0.5], wheelRadius: 0.33, steerable: false, braked: true },
    { name: 'right', pos: [1.6, -1.6, 0.5], wheelRadius: 0.33, steerable: false, braked: true },
  ],
  engines: [
    { nozzle: [0, 0.1, 6.4], intake: [0, -0.1, -2.7], nozzleRadius: 0.5 },
  ],
  wingtips: [[-5.35, 0, 2], [5.35, 0, 2]],
  lights: { navLeft: [-5.3, 0, 2], navRight: [5.3, 0, 2], tail: [0, 2.2, 6.5], strobe: [0, 2.3, 6.2], beacon: [0, 0.65, 2], landing: [0, -0.7, -4.8] },
};
