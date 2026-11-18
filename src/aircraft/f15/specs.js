// F-15E Strike Eagle — published reference numbers (SI). Derivation and confidence notes: docs/aircraft/f15.md
// hudType rationale: fighter HUD for the pilot
export default {
  id: 'f15', name: 'F-15E Strike Eagle', manufacturer: 'McDonnell Douglas (Boeing)',
  category: 'fighter', role: 'Dual-role air-to-ground and air-superiority fighter', service: 'U.S. Air Force', firstFlight: 1986,
  hudType: 'fighter',
  sound: { engine: 'jet-lowbypass', afterburner: true },
  specs: {
    emptyMass: 14300,
    maxTakeoffMass: 36700,
    typicalMass: 25000,
    fuelCapacity: 6100,
    engineCount: 2,
    engineType: 'turbofan-afterburning',
    engineName: 'Pratt & Whitney F100-PW-229',
    thrustDry: 79200,
    thrustMax: 129000,
    maxMach: 2.5,
    maxSpeedSeaLevel: 400,
    serviceCeiling: 18300,
    climbRate: 250,
    stallSpeed: 65,
    approachSpeed: 75,
    rotateSpeed: 80,
    cruiseSpeed: 250,
    maxG: 9,
    minG: -3,
  },
};
