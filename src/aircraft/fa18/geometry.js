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
    { nozzle: [-0.72, 0.05, 8.55], intake: [-1.08, -0.1, -3.8], nozzleRadius: 0.45 },
    { nozzle: [0.72, 0.05, 8.55], intake: [1.08, -0.1, -3.8], nozzleRadius: 0.45 },
  ],
  wingtips: [[-6.25, 0.18, 1.2], [6.25, 0.18, 1.2]],
  lights: { navLeft: [-6.12, 0.18, 0.03], navRight: [6.12, 0.18, 0.03], tail: [0, 0.08, 7.97], strobe: [-2.17, 3.2, 6.05], beacon: [0, 0.83, 1.4], landing: [0, -0.72, -4.86] },
};
