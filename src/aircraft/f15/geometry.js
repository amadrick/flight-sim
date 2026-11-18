// F-15E Strike Eagle — reference geometry in BODY axes: origin = nominal CG, +X right wing, +Y up, -Z nose. Metres.
// Shared contract between the visual model and the physics config (see f16/geometry.js for the rules).
// Source: docs/aircraft/f15.md (published figures + proportion-derived estimates, see its confidence notes).
export default {
  length: 19.43, span: 13.05, height: 5.63, wingArea: 56.5,
  noseZ: -11.95, tailZ: 7.48,
  cgHeight: 1.85,
  pilotEye: [0, 1.05, -7.15],
  gear: [
    { name: 'nose', pos: [0, -1.85, -4.9], wheelRadius: 0.28, steerable: true, braked: false },
    { name: 'left', pos: [-1.375, -1.85, 0.5], wheelRadius: 0.44, steerable: false, braked: true },
    { name: 'right', pos: [1.375, -1.85, 0.5], wheelRadius: 0.44, steerable: false, braked: true },
  ],
  engines: [
    { nozzle: [-1, 0.2, 7.25], intake: [-1.4, 0, -5.65], nozzleRadius: 0.55 },
    { nozzle: [1, 0.2, 7.25], intake: [1.4, 0, -5.65], nozzleRadius: 0.55 },
  ],
  wingtips: [[-6.525, 0.35, 1.75], [6.525, 0.35, 1.75]],
  lights: { navLeft: [-6.5, 0.35, 1.75], navRight: [6.5, 0.35, 1.75], tail: [0, 3.2, 7.25], strobe: [-1.55, 3.3, 6.65], beacon: [0, 1, 1.25], landing: [0, -0.9, -6.45] },
};
