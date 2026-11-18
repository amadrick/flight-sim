// Boeing 747-8 Intercontinental — published reference numbers (SI). Derivation and confidence notes: docs/aircraft/b748.md
// hudType rationale: commercial transport EFIS layout
export default {
  id: 'b748', name: 'Boeing 747-8 Intercontinental', manufacturer: 'Boeing',
  category: 'airliner', role: 'Long-haul wide-body airliner (four-engine)', service: 'Commercial', firstFlight: 2010,
  hudType: 'airliner',
  sound: { engine: 'jet-highbypass', afterburner: false },
  specs: {
    emptyMass: 220100,
    maxTakeoffMass: 447700,
    typicalMass: 360000,
    fuelCapacity: 191000,
    engineCount: 4,
    engineType: 'turbofan-highbypass',
    engineName: 'General Electric GEnx-2B67',
    thrustDry: 296000,
    thrustMax: 296000,
    maxMach: 0.9,
    maxSpeedSeaLevel: 185,
    serviceCeiling: 13100,
    climbRate: 10,
    stallSpeed: 68,
    approachSpeed: 77,
    rotateSpeed: 84,
    cruiseSpeed: 250,
    maxG: 2.5,
    minG: -1,
  },
};
