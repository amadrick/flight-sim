// F-22A Raptor — published reference numbers (SI). Derivation and confidence notes: docs/aircraft/f22.md
// hudType rationale: single-seat fighter with a wide-FOV HUD
export default {
  id: 'f22', name: 'F-22A Raptor', manufacturer: 'Lockheed Martin (with Boeing)',
  category: 'fighter', role: 'Air-dominance stealth fighter', service: 'U.S. Air Force', firstFlight: 1997,
  hudType: 'fighter',
  sound: { engine: 'jet-lowbypass', afterburner: true },
  specs: {
    emptyMass: 19700,
    maxTakeoffMass: 38000,
    typicalMass: 27000,
    fuelCapacity: 8200,
    engineCount: 2,
    engineType: 'turbofan-afterburning',
    engineName: 'Pratt & Whitney F119-PW-100',
    thrustDry: 116000,
    thrustMax: 156000,
    maxMach: 2.25,
    maxSpeedSeaLevel: 410,
    serviceCeiling: 19800,
    climbRate: 300,
    stallSpeed: 60,
    approachSpeed: 72,
    rotateSpeed: 80,
    cruiseSpeed: 260,
    maxG: 9,
    minG: -3,
  },
};
