// Boeing 787-9 Dreamliner — reference geometry in BODY axes: origin = nominal CG, +X right wing, +Y up, -Z nose. Metres.
// Shared contract between the visual model and the physics config (see f16/geometry.js for the rules).
// Source: docs/aircraft/b789.md (published figures + proportion-derived estimates, see its confidence notes).
export default {
  length: 62.81, span: 60.12, height: 17.02, wingArea: 377,
  noseZ: -29.9, tailZ: 32.91,
  cgHeight: 4.2,
  pilotEye: [-0.5, 0.9, -24.9],
  gear: [
    { name: 'nose', pos: [0, -4.2, -23.3], wheelRadius: 0.5, steerable: true, braked: false },
    { name: 'left', pos: [-5.35, -4.2, 2.3], wheelRadius: 0.56, steerable: false, braked: true },
    { name: 'right', pos: [5.35, -4.2, 2.3], wheelRadius: 0.56, steerable: false, braked: true },
  ],
  engines: [
    { nozzle: [-9.5, -1.95, -1.7], intake: [-9.5, -2.1, -8.6], nozzleRadius: 0.85 },
    { nozzle: [9.5, -1.95, -1.7], intake: [9.5, -2.1, -8.6], nozzleRadius: 0.85 },
  ],
  wingtips: [[-30.06, 1.84, 11.9], [30.06, 1.84, 11.9]],
  lights: { navLeft: [-29.98, 1.83, 11.1], navRight: [29.98, 1.83, 11.1], tail: [0, 0.95, 32.95], strobe: [0, 1.25, 32.93], beacon: [0, -3.03, -13.5], landing: [-3.4, -1.25, -7.5] },
};
