// F-15E Strike Eagle — reference geometry in BODY axes: origin = nominal CG, +X right wing, +Y up, -Z nose. Metres.
// Shared contract between the visual model and the physics config (see f16/geometry.js for the rules).
// Source: docs/aircraft/f15.md (published figures + proportion-derived estimates, see its confidence notes).
export default {
  length: 19.43, span: 13.05, height: 5.63, wingArea: 56.5,
  noseZ: -10.2, tailZ: 9.23,
  cgHeight: 1.85,
  pilotEye: [0, 1.05, -5.4],
  gear: [
    { name: 'nose', pos: [0, -1.85, -4.9], wheelRadius: 0.28, steerable: true, braked: false },
    { name: 'left', pos: [-1.375, -1.85, 0.5], wheelRadius: 0.44, steerable: false, braked: true },
    { name: 'right', pos: [1.375, -1.85, 0.5], wheelRadius: 0.44, steerable: false, braked: true },
  ],
  engines: [
    { nozzle: [-1, 0.2, 9], intake: [-1.4, 0, -3.9], nozzleRadius: 0.55 },
    { nozzle: [1, 0.2, 9], intake: [1.4, 0, -3.9], nozzleRadius: 0.55 },
  ],
  wingtips: [[-6.525, 0.35, 3.5], [6.525, 0.35, 3.5]],
  lights: { navLeft: [-6.5, 0.35, 3.5], navRight: [6.5, 0.35, 3.5], tail: [0, 3.2, 9], strobe: [-1.55, 3.3, 8.4], beacon: [0, 1, 3], landing: [0, -0.9, -4.7] },
};
