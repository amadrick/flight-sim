// Boeing 737-800 — reference geometry in BODY axes: origin = nominal CG, +X right wing, +Y up, -Z nose. Metres.
// Shared contract between the visual model and the physics config (see f16/geometry.js for the rules).
export default {
  length: 39.47, span: 35.79, height: 12.55, wingArea: 124.6,
  noseZ: -18.4, tailZ: 21.07,
  cgHeight: 2.9,
  pilotEye: [-0.53, 1.25, -15.9],
  gear: [
    { name: 'nose',  pos: [0, -2.9, -14.4],   wheelRadius: 0.34, steerable: true,  braked: false },
    { name: 'left',  pos: [-2.86, -2.9, 1.2], wheelRadius: 0.57, steerable: false, braked: true },
    { name: 'right', pos: [2.86, -2.9, 1.2],  wheelRadius: 0.57, steerable: false, braked: true },
  ],
  engines: [
    { nozzle: [-4.83, -1.6, -1.2], intake: [-4.83, -1.6, -5.4], nozzleRadius: 0.75 },
    { nozzle: [4.83, -1.6, -1.2],  intake: [4.83, -1.6, -5.4],  nozzleRadius: 0.75 },
  ],
  wingtips: [[-17.9, 1.9, 6.2], [17.9, 1.9, 6.2]],
  lights: { navLeft: [-17.6, 1.2, 5.6], navRight: [17.6, 1.2, 5.6], tail: [0, 2.6, 21.0], strobe: [0, 9.3, 19.5], beacon: [0, 2.2, -2.0], landing: [0, -0.9, -3.0] },
};
