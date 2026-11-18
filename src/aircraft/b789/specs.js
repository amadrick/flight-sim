// Boeing 787-9 Dreamliner — published reference numbers (SI). Derivation and confidence notes: docs/aircraft/b789.md
// hudType rationale: commercial transport EFIS layout (a HUD is optional on the real aircraft)
export default {
  id: 'b789', name: 'Boeing 787-9 Dreamliner', manufacturer: 'Boeing',
  category: 'airliner', role: 'Long-haul wide-body airliner (twin-engine, composite)', service: 'Commercial', firstFlight: 2013,
  hudType: 'airliner',
  sound: { engine: 'jet-highbypass', afterburner: false },
  specs: {
    emptyMass: 128850,
    maxTakeoffMass: 254000,
    typicalMass: 200000,
    fuelCapacity: 101000,
    engineCount: 2,
    engineType: 'turbofan-highbypass',
    engineName: 'General Electric GEnx-1B74/75',
    thrustDry: 330000,
    thrustMax: 330000,
    maxMach: 0.9,
    maxSpeedSeaLevel: 170,
    serviceCeiling: 13100,
    climbRate: 12,
    stallSpeed: 59,
    approachSpeed: 70,
    rotateSpeed: 77,
    cruiseSpeed: 245,
    maxG: 2.5,
    minG: -1,
  },
};
