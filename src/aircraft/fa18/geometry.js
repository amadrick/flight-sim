// F/A-18E Super Hornet — reference geometry in BODY axes: origin = nominal CG, +X right wing, +Y up, -Z nose. Metres.
// Shared contract between the visual model and the physics config (see f16/geometry.js for the rules).
// Source: docs/aircraft/fa18.md (published figures + proportion-derived estimates, see its confidence notes).
export default {
  length: 18.31, span: 13.62, height: 4.88, wingArea: 46.5,
  noseZ: -9.5, tailZ: 8.81,
  cgHeight: 1.55,
  pilotEye: [0, 0.85, -5.2],
  gear: [
    { name: 'nose', pos: [0, -1.55, -4.85], wheelRadius: 0.26, steerable: true, braked: false },
    { name: 'left', pos: [-1.7, -1.55, 0.55], wheelRadius: 0.36, steerable: false, braked: true },
    { name: 'right', pos: [1.7, -1.55, 0.55], wheelRadius: 0.36, steerable: false, braked: true },
  ],
  engines: [
    { nozzle: [-0.8, 0.05, 8.5], intake: [-1.1, -0.2, -3.8], nozzleRadius: 0.5 },
    { nozzle: [0.8, 0.05, 8.5], intake: [1.1, -0.2, -3.8], nozzleRadius: 0.5 },
  ],
  wingtips: [[-6.81, 0.2, 0.8], [6.81, 0.2, 0.8]],
  lights: { navLeft: [-6.8, 0.2, 0.8], navRight: [6.8, 0.2, 0.8], tail: [0, 3, 8.4], strobe: [0, 3.1, 8], beacon: [0, 0.7, 3.5], landing: [0, -0.7, -5.1] },
};
