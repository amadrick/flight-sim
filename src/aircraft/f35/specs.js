// F-35A Lightning II — published reference numbers (SI). Derivation and confidence notes: docs/aircraft/f35.md
// hudType rationale: single-seat; its real cockpit uses a helmet-mounted display, but the sim uses a fighter HUD symbology
export default {
  id: 'f35', name: 'F-35A Lightning II', manufacturer: 'Lockheed Martin',
  category: 'fighter', role: 'Stealth multirole strike fighter', service: 'U.S. Air Force (and export partners)', firstFlight: 2006,
  hudType: 'fighter',
  sound: { engine: 'jet-lowbypass', afterburner: true },
  specs: {
    emptyMass: 13290,
    maxTakeoffMass: 31800,
    typicalMass: 20000,
    fuelCapacity: 8278,
    engineCount: 1,
    engineType: 'turbofan-afterburning',
    engineName: 'Pratt & Whitney F135-PW-100',
    thrustDry: 125000,
    thrustMax: 191000,
    maxMach: 1.6,
    maxSpeedSeaLevel: 400,
    serviceCeiling: 15240,
    climbRate: 230,
    stallSpeed: 62,
    approachSpeed: 70,
    rotateSpeed: 76,
    cruiseSpeed: 240,
    maxG: 9,
    minG: -3,
  },
};
