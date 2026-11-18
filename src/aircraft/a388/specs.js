// Airbus A380-800 — published reference numbers (SI). Derivation and confidence notes: docs/aircraft/a388.md
// hudType rationale: commercial transport EFIS layout
export default {
  id: 'a388', name: 'Airbus A380-800', manufacturer: 'Airbus',
  category: 'airliner', role: 'Ultra-large long-haul double-deck airliner', service: 'Commercial', firstFlight: 2005,
  hudType: 'airliner',
  sound: { engine: 'jet-highbypass', afterburner: false },
  specs: {
    emptyMass: 276800,
    maxTakeoffMass: 575000,
    typicalMass: 450000,
    fuelCapacity: 256000,
    engineCount: 4,
    engineType: 'turbofan-highbypass',
    engineName: 'Rolls-Royce Trent 972-84',
    thrustDry: 311000,
    thrustMax: 311000,
    maxMach: 0.89,
    maxSpeedSeaLevel: 175,
    serviceCeiling: 13100,
    climbRate: 8,
    stallSpeed: 66,
    approachSpeed: 76,
    rotateSpeed: 83,
    cruiseSpeed: 250,
    maxG: 2.5,
    minG: -1,
  },
};
