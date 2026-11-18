// Airbus A320neo — published reference numbers (SI). Derivation and confidence notes: docs/aircraft/a320.md
// hudType rationale: commercial transport EFIS layout (sidestick FBW)
export default {
  id: 'a320', name: 'Airbus A320neo', manufacturer: 'Airbus',
  category: 'airliner', role: 'Narrow-body short/medium-haul airliner', service: 'Commercial', firstFlight: 2014,
  hudType: 'airliner',
  sound: { engine: 'jet-highbypass', afterburner: false },
  specs: {
    emptyMass: 44300,
    maxTakeoffMass: 79000,
    typicalMass: 64000,
    fuelCapacity: 19400,
    engineCount: 2,
    engineType: 'turbofan-highbypass',
    engineName: 'CFM International LEAP-1A26',
    thrustDry: 120600,
    thrustMax: 120600,
    maxMach: 0.82,
    maxSpeedSeaLevel: 180,
    serviceCeiling: 12000,
    climbRate: 14,
    stallSpeed: 53,
    approachSpeed: 70,
    rotateSpeed: 72,
    cruiseSpeed: 230,
    maxG: 2.5,
    minG: -1,
  },
};
