// A-10C Thunderbolt II — published reference numbers (SI). Derivation and confidence notes: docs/aircraft/a10.md
// hudType rationale: pilot has a HUD; fighter-style symbology fits
export default {
  id: 'a10', name: 'A-10C Thunderbolt II', manufacturer: 'Fairchild Republic (upgrade by Lockheed Martin / Boeing)',
  category: 'attack', role: 'Close air support / ground attack', service: 'U.S. Air Force', firstFlight: 1972,
  hudType: 'fighter',
  sound: { engine: 'jet-highbypass', afterburner: false },
  specs: {
    emptyMass: 11321,
    maxTakeoffMass: 22950,
    typicalMass: 15500,
    fuelCapacity: 4850,
    engineCount: 2,
    engineType: 'turbofan-highbypass',
    engineName: 'General Electric TF34-GE-100A',
    thrustDry: 40300,
    thrustMax: 40300,
    maxMach: 0.75,
    maxSpeedSeaLevel: 195,
    serviceCeiling: 13636,
    climbRate: 30,
    stallSpeed: 55,
    approachSpeed: 65,
    rotateSpeed: 62,
    cruiseSpeed: 150,
    maxG: 7.33,
    minG: -3,
  },
};
