// Boeing 747-8 Intercontinental — reference geometry in BODY axes: origin = nominal CG, +X right wing, +Y up, -Z nose. Metres.
// Shared contract between the visual model and the physics config (see f16/geometry.js for the rules).
// Source: docs/aircraft/b748.md (published figures + proportion-derived estimates, see its confidence notes).
export default {
  length: 76.25, span: 68.4, height: 19.4, wingArea: 554,
  noseZ: -38.5, tailZ: 37.75,
  cgHeight: 5.2,
  pilotEye: [-0.55, 3.35, -31.45],
  gear: [
    { name: 'nose', pos: [0, -5.2, -27.5], wheelRadius: 0.55, steerable: true, braked: false },
    { name: 'left', pos: [-5.5, -5.2, 0.7], wheelRadius: 0.6, steerable: false, braked: true },
    { name: 'right', pos: [5.5, -5.2, 0.7], wheelRadius: 0.6, steerable: false, braked: true },
    { name: 'bodyLeft', pos: [-2.5, -5.2, 4.7], wheelRadius: 0.6, steerable: false, braked: true },
    { name: 'bodyRight', pos: [2.5, -5.2, 4.7], wheelRadius: 0.6, steerable: false, braked: true },
  ],
  engines: [
    { nozzle: [-23.5, -1.6, 7.4], intake: [-23.5, -1.6, 0.8], nozzleRadius: 0.9 },
    { nozzle: [-11.5, -3.0, -1.4], intake: [-11.5, -3.0, -8], nozzleRadius: 0.9 },
    { nozzle: [11.5, -3.0, -1.4], intake: [11.5, -3.0, -8], nozzleRadius: 0.9 },
    { nozzle: [23.5, -1.6, 7.4], intake: [23.5, -1.6, 0.8], nozzleRadius: 0.9 },
  ],
  wingtips: [[-34.2, 1.45, 16.0], [34.2, 1.45, 16.0]],
  lights: { navLeft: [-34.25, 1.45, 15.7], navRight: [34.25, 1.45, 15.7], tail: [0, 1.13, 37.86], strobe: [0, 1.45, 37.6], beacon: [0, -3.5, -8.5], landing: [-4.5, -2.25, -9.5] },
};
