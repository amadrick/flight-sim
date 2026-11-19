// F-14D Tomcat — reference geometry in BODY axes: origin = nominal CG, +X right wing, +Y up, -Z nose. Metres.
// Shared contract between the visual model and the physics config (see f16/geometry.js for the rules).
// Source: docs/aircraft/f14.md (published figures + proportion-derived estimates, see its confidence notes).
export default {
  length: 19.1, span: 19.55, height: 4.88, wingArea: 52.5,
  noseZ: -11.5, tailZ: 7.6,
  cgHeight: 1.7,
  pilotEye: [0, 1.08, -6.6],
  gear: [
    { name: 'nose', pos: [0, -1.7, -6.3], wheelRadius: 0.28, steerable: true, braked: false },
    { name: 'left', pos: [-1.6, -1.7, 0.6], wheelRadius: 0.4, steerable: false, braked: true },
    { name: 'right', pos: [1.6, -1.7, 0.6], wheelRadius: 0.4, steerable: false, braked: true },
  ],
  engines: [
    { nozzle: [-1.05, 0.1, 7.5], intake: [-1.5, -0.2, -3.9], nozzleRadius: 0.55 },
    { nozzle: [1.05, 0.1, 7.5], intake: [1.5, -0.2, -3.9], nozzleRadius: 0.55 },
  ],
  wingtips: [[-9.775, 0.35, 2.1], [9.775, 0.35, 2.1]],                        // at 20° sweep (they move with the wing)
  lights: { navLeft: [-9.77, 0.35, 2.31], navRight: [9.77, 0.35, 2.31], tail: [0, 0.19, 7.62], strobe: [-2.05, 3.12, 6.42], beacon: [0, 0.735, 1.3], landing: [0.06, -0.86, -6.33] },
};
