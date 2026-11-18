// Boeing 777-300ER — reference geometry in BODY axes: origin = nominal CG, +X right wing, +Y up, -Z nose. Metres.
// Shared contract between the visual model and the physics config (see f16/geometry.js for the rules).
// Source: docs/aircraft/b77w.md (published figures + proportion-derived estimates, see its confidence notes).
export default {
  length: 73.86, span: 64.8, height: 18.5, wingArea: 436.8,
  noseZ: -36.3, tailZ: 37.56,
  cgHeight: 4.5,
  pilotEye: [-0.5, 1.1, -30.3],
  gear: [
    { name: 'nose', pos: [0, -4.5, -28.4], wheelRadius: 0.55, steerable: true, braked: false },
    { name: 'left', pos: [-5.5, -4.5, 2.8], wheelRadius: 0.64, steerable: false, braked: true },
    { name: 'right', pos: [5.5, -4.5, 2.8], wheelRadius: 0.64, steerable: false, braked: true },
  ],
  engines: [
    { nozzle: [-10.9, -2, 0.2], intake: [-10.9, -2, -7.8], nozzleRadius: 1 },
    { nozzle: [10.9, -2, 0.2], intake: [10.9, -2, -7.8], nozzleRadius: 1 },
  ],
  wingtips: [[-32.4, 0.8, 11.7], [32.4, 0.8, 11.7]],
  lights: { navLeft: [-32.3, 0.8, 11.5], navRight: [32.3, 0.8, 11.5], tail: [0, 6.5, 37.1], strobe: [0, 3.7, 3.7], beacon: [0, -3.1, -6.3], landing: [-5, -2, -4.3] },
};
