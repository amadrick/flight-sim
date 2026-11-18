// Boeing 777-300ER — published reference numbers (SI). Derivation and confidence notes: docs/aircraft/b77w.md
// hudType rationale: commercial transport EFIS layout
export default {
  id: 'b77w', name: 'Boeing 777-300ER', manufacturer: 'Boeing',
  category: 'airliner', role: 'Long-haul wide-body airliner (twin-engine)', service: 'Commercial', firstFlight: 2003,
  hudType: 'airliner',
  sound: { engine: 'jet-highbypass', afterburner: false },
  specs: {
    emptyMass: 167800,
    maxTakeoffMass: 351500,
    typicalMass: 280000,
    fuelCapacity: 145500,
    engineCount: 2,
    engineType: 'turbofan-highbypass',
    engineName: 'General Electric GE90-115B',
    thrustDry: 513000,
    thrustMax: 513000,
    maxMach: 0.89,
    maxSpeedSeaLevel: 170,
    serviceCeiling: 13137,
    climbRate: 11,
    stallSpeed: 64,
    approachSpeed: 72,
    rotateSpeed: 80,
    cruiseSpeed: 245,
    maxG: 2.5,
    minG: -1,
  },
};
