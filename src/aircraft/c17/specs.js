// C-17A Globemaster III — published reference numbers (SI). Derivation and confidence notes: docs/aircraft/c17.md
// hudType rationale: large transport; the sim uses airliner-style PFD/instrument layout (the real C-17 has two HUDs, but airliner style serves transports)
export default {
  id: 'c17', name: 'C-17A Globemaster III', manufacturer: 'McDonnell Douglas (Boeing)',
  category: 'transport', role: 'Strategic and tactical airlifter (STOL capable)', service: 'U.S. Air Force (and allied air forces)', firstFlight: 1991,
  hudType: 'airliner',
  sound: { engine: 'jet-highbypass', afterburner: false },
  specs: {
    emptyMass: 128100,
    maxTakeoffMass: 265350,
    typicalMass: 200000,
    fuelCapacity: 107600,
    engineCount: 4,
    engineType: 'turbofan-highbypass',
    engineName: 'Pratt & Whitney F117-PW-100 (PW2040)',
    thrustDry: 180000,
    thrustMax: 180000,
    maxMach: 0.77,
    maxSpeedSeaLevel: 180,
    serviceCeiling: 13716,
    climbRate: 12,
    stallSpeed: 55,
    approachSpeed: 70,
    rotateSpeed: 78,
    cruiseSpeed: 210,
    maxG: 2.5,
    minG: -1,
  },
};
