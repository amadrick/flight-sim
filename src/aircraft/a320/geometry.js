// Airbus A320neo — reference geometry in BODY axes: origin = nominal CG, +X right wing, +Y up, -Z nose. Metres.
// Shared contract between the visual model and the physics config (see f16/geometry.js for the rules).
// Source: docs/aircraft/a320.md (published figures + proportion-derived estimates, see its confidence notes).
export default {
  length: 37.57, span: 35.8, height: 11.76, wingArea: 122.6,
  noseZ: -17.7, tailZ: 19.87,
  cgHeight: 3.2,
  pilotEye: [-0.5, 0.8, -14.8],
  gear: [
    { name: 'nose', pos: [0, -3.2, -11.5], wheelRadius: 0.38, steerable: true, braked: false },
    { name: 'left', pos: [-3.8, -3.2, 1.14], wheelRadius: 0.57, steerable: false, braked: true },
    { name: 'right', pos: [3.8, -3.2, 1.14], wheelRadius: 0.57, steerable: false, braked: true },
  ],
  engines: [
    { nozzle: [-5.75, -1.5, -0.5], intake: [-5.75, -1.5, -4.9], nozzleRadius: 0.55 },
    { nozzle: [5.75, -1.5, -0.5], intake: [5.75, -1.5, -4.9], nozzleRadius: 0.55 },
  ],
  wingtips: [[-17.9, 1.2, 5.1], [17.9, 1.2, 5.1]],
  lights: { navLeft: [-17.8, 0.1, 4.7], navRight: [17.8, 0.1, 4.7], tail: [0, 3, 19.5], strobe: [0, 2.3, 7.3], beacon: [0, -2.2, -3.7], landing: [-1, -1.7, -3.2] },
};
