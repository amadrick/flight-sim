// F-35A Lightning II — reference geometry in BODY axes: origin = nominal CG, +X right wing, +Y up, -Z nose. Metres.
// Shared contract between the visual model and the physics config (see f16/geometry.js for the rules).
// Source: docs/aircraft/f35.md (published figures + proportion-derived estimates, see its confidence notes).
export default {
  length: 15.67, span: 10.7, height: 4.38, wingArea: 42.7,
  noseZ: -9.25, tailZ: 6.42,
  cgHeight: 1.6,
  pilotEye: [0, 1.15, -5.25],
  gear: [
    { name: 'nose', pos: [0, -1.6, -5.1], wheelRadius: 0.2, steerable: true, braked: false },
    { name: 'left', pos: [-1.6, -1.6, 0.5], wheelRadius: 0.33, steerable: false, braked: true },
    { name: 'right', pos: [1.6, -1.6, 0.5], wheelRadius: 0.33, steerable: false, braked: true },
  ],
  engines: [
    { nozzle: [0, 0.1, 5.75], intake: [0, -0.1, -3.35], nozzleRadius: 0.5 },
  ],
  wingtips: [[-5.36, 0.03, 1.6], [5.36, 0.03, 1.6]],
  lights: { navLeft: [-5.36, 0.03, 1.05], navRight: [5.36, 0.03, 1.05], tail: [1.0, 0.2, 6.2], strobe: [0, 1.0, 2.4], beacon: [0, -0.835, 0.9], landing: [-0.06, -1.02, -5.03] },
};
