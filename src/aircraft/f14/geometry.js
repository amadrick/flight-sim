// F-14D Tomcat — reference geometry in BODY axes: origin = nominal CG, +X right wing, +Y up, -Z nose. Metres.
// Shared contract between the visual model and the physics config (see f16/geometry.js for the rules).
// Source: docs/aircraft/f14.md (published figures + proportion-derived estimates, see its confidence notes).
export default {
  length: 19.1, span: 19.55, height: 4.88, wingArea: 52.5,
  noseZ: -11.5, tailZ: 7.6,
  cgHeight: 1.7,
  pilotEye: [0, 1, -6.6],
  gear: [
    { name: 'nose', pos: [0, -1.7, -6.3], wheelRadius: 0.28, steerable: true, braked: false },
    { name: 'left', pos: [-1.6, -1.7, 0.6], wheelRadius: 0.4, steerable: false, braked: true },
    { name: 'right', pos: [1.6, -1.7, 0.6], wheelRadius: 0.4, steerable: false, braked: true },
  ],
  engines: [
    { nozzle: [-1.05, 0.1, 7.5], intake: [-1.5, -0.2, -3.9], nozzleRadius: 0.55 },
    { nozzle: [1.05, 0.1, 7.5], intake: [1.5, -0.2, -3.9], nozzleRadius: 0.55 },
  ],
  wingtips: [[-9.775, 0.35, 1], [9.775, 0.35, 1]],
  lights: { navLeft: [-9.7, 0.35, 1], navRight: [9.7, 0.35, 1], tail: [0, 0.4, 7.5], strobe: [-1.9, 2.9, 6.3], beacon: [0, 0.7, 1.3], landing: [0, -0.9, -6.7] },
};
