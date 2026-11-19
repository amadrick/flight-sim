// Boeing 777-300ER — reference geometry in BODY axes: origin = nominal CG, +X right wing, +Y up, -Z nose. Metres.
// Shared contract between the visual model and the physics config (see f16/geometry.js for the rules).
// Source: docs/aircraft/b77w.md (published figures + proportion-derived estimates, see its confidence notes).
export default {
  length: 73.86, span: 64.8, height: 18.5, wingArea: 436.8,
  noseZ: -36.3, tailZ: 37.56,
  cgHeight: 4.5,
  pilotEye: [-0.5, 1.45, -30.8],
  gear: [
    { name: 'nose', pos: [0, -4.5, -28.4], wheelRadius: 0.55, steerable: true, braked: false },
    { name: 'left', pos: [-5.5, -4.5, 2.8], wheelRadius: 0.64, steerable: false, braked: true },
    { name: 'right', pos: [5.5, -4.5, 2.8], wheelRadius: 0.64, steerable: false, braked: true },
  ],
  engines: [
    { nozzle: [-10.9, -2, -1.0], intake: [-10.9, -2, -8.6], nozzleRadius: 1 },
    { nozzle: [10.9, -2, -1.0], intake: [10.9, -2, -8.6], nozzleRadius: 1 },
  ],
  wingtips: [[-32.4, 1.52, 12.0], [32.4, 1.52, 12.0]],
  lights: { navLeft: [-32.46, 1.52, 11.85], navRight: [32.46, 1.52, 11.85], tail: [0, 1.2, 37.6], strobe: [0, 0.72, 37.62], beacon: [0, 3.12, -4.0], landing: [-4.4, -1.25, -7.62] },
};
