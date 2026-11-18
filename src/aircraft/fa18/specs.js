// F/A-18E Super Hornet — published reference numbers (SI). Derivation and confidence notes: docs/aircraft/fa18.md
// hudType rationale: single-seat fighter with a conventional HUD
export default {
  id: 'fa18', name: 'F/A-18E Super Hornet', manufacturer: 'Boeing (McDonnell Douglas)',
  category: 'fighter', role: 'Carrier-based multirole strike fighter', service: 'U.S. Navy', firstFlight: 1995,
  hudType: 'fighter',
  sound: { engine: 'jet-lowbypass', afterburner: true },
  specs: {
    emptyMass: 14552,
    maxTakeoffMass: 29900,
    typicalMass: 21000,
    fuelCapacity: 6530,
    engineCount: 2,
    engineType: 'turbofan-afterburning',
    engineName: 'General Electric F414-GE-400',
    thrustDry: 62000,
    thrustMax: 97900,
    maxMach: 1.8,
    maxSpeedSeaLevel: 400,
    serviceCeiling: 15000,
    climbRate: 230,
    stallSpeed: 60,
    approachSpeed: 70,
    rotateSpeed: 75,
    cruiseSpeed: 235,
    maxG: 7.5,
    minG: -3,
  },
};
