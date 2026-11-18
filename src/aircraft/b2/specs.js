// B-2A Spirit — published reference numbers (SI). Derivation and confidence notes: docs/aircraft/b2.md
// hudType rationale: no fighter-style HUD in the usual sense; large-aircraft flight-instrument style (EFIS) fits the sim better
export default {
  id: 'b2', name: 'B-2A Spirit', manufacturer: 'Northrop Grumman',
  category: 'bomber', role: 'Strategic stealth bomber (flying wing)', service: 'U.S. Air Force', firstFlight: 1989,
  hudType: 'airliner',
  sound: { engine: 'jet-highbypass', afterburner: false },
  specs: {
    emptyMass: 71700,
    maxTakeoffMass: 171000,
    typicalMass: 140000,
    fuelCapacity: 75750,
    engineCount: 4,
    engineType: 'turbofan-highbypass',
    engineName: 'General Electric F118-GE-100',
    thrustDry: 77000,
    thrustMax: 77000,
    maxMach: 0.95,
    maxSpeedSeaLevel: 280,
    serviceCeiling: 15200,
    climbRate: 15,
    stallSpeed: 65,
    approachSpeed: 75,
    rotateSpeed: 85,
    cruiseSpeed: 230,
    maxG: 2.5,
    minG: -1,
  },
};
