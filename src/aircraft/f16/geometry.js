// F-16C Block 50 — reference geometry in BODY axes: origin = nominal CG, +X right wing, +Y up, -Z nose. Metres.
// This file is the shared contract between the visual model and the physics config:
//   * visual model owner may refine numbers (keep the field names),
//   * physics reads gear contact points / cgHeight from here at runtime — never hardcode them elsewhere.
export default {
  length: 15.03, span: 9.96, height: 4.88, wingArea: 27.87,
  noseZ: -8.5, tailZ: 6.53,
  cgHeight: 1.55,                         // body origin above the ground when parked (static gear compression)
  pilotEye: [0, 1.05, -4.45],
  gear: [                                 // tire contact point when parked; first = nose, then left main, right main
    { name: 'nose',  pos: [0, -1.55, -3.25],   wheelRadius: 0.23, steerable: true,  braked: false },
    { name: 'left',  pos: [-1.18, -1.55, 0.75], wheelRadius: 0.35, steerable: false, braked: true },
    { name: 'right', pos: [1.18, -1.55, 0.75],  wheelRadius: 0.35, steerable: false, braked: true },
  ],
  engines: [{ nozzle: [0, 0.05, 6.4], intake: [0, -0.75, -3.6], nozzleRadius: 0.55 }],
  wingtips: [[-4.75, 0.0, 0.9], [4.75, 0.0, 0.9]],
  lights: { navLeft: [-4.75, 0.0, 0.9], navRight: [4.75, 0.0, 0.9], tail: [0, 3.2, 6.2], strobe: [0, 3.3, 6.0], beacon: [0, 3.3, 6.0], landing: [0, -1.0, -3.2] },
};
