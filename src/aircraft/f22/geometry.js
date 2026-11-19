// F-22A Raptor — reference geometry in BODY axes: origin = nominal CG, +X right wing, +Y up, -Z nose. Metres.
// Shared contract between the visual model and the physics config (see f16/geometry.js for the rules).
// Source: docs/aircraft/f22.md (published figures + proportion-derived estimates, see its confidence notes).
export default {
  length: 18.92, span: 13.56, height: 5.08, wingArea: 78.04,
  noseZ: -10.9, tailZ: 8.02,
  cgHeight: 1.7,
  pilotEye: [0, 1.02, -5.9],
  gear: [
    { name: 'nose', pos: [0, -1.7, -5.5], wheelRadius: 0.25, steerable: true, braked: false },
    { name: 'left', pos: [-2.15, -1.7, 0.6], wheelRadius: 0.4, steerable: false, braked: true },
    { name: 'right', pos: [2.15, -1.7, 0.6], wheelRadius: 0.4, steerable: false, braked: true },
  ],
  engines: [
    { nozzle: [-1.15, 0.1, 8], intake: [-1.3, -0.43, -4.1], nozzleRadius: 0.55 },
    { nozzle: [1.15, 0.1, 8], intake: [1.3, -0.43, -4.1], nozzleRadius: 0.55 },
  ],
  wingtips: [[-6.78, -0.34, 2.66], [6.78, -0.34, 2.66]],
  lights: { navLeft: [-6.8, -0.34, 2.45], navRight: [6.8, -0.34, 2.45], tail: [0, 0.0, 7.76], strobe: [0, 0.66, -1.6], beacon: [0, -0.84, 1.8], landing: [-0.08, -1.12, -5.66] },
};
