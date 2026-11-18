// SR-71A Blackbird — published reference numbers (SI). Derivation and confidence notes: docs/aircraft/sr71.md
// hudType rationale: no head-up display; conventional round-dial/ADI instruments suit the sim's "airliner" instrument style better than fighter HUD symbology
export default {
  id: 'sr71', name: 'SR-71A Blackbird', manufacturer: 'Lockheed (Skunk Works)',
  category: 'recon', role: 'Strategic reconnaissance, Mach 3+ cruise', service: 'U.S. Air Force (retired 1998; NASA flew two as research aircraft)', firstFlight: 1964,
  hudType: 'airliner',
  sound: { engine: 'jet-lowbypass', afterburner: true },
  specs: {
    emptyMass: 30600,
    maxTakeoffMass: 77100,
    typicalMass: 62000,
    fuelCapacity: 36100,
    engineCount: 2,
    engineType: 'turbofan-afterburning',
    engineName: 'Pratt & Whitney J58 (JT11D-20)',
    thrustDry: 111000,
    thrustMax: 144600,
    maxMach: 3.3,
    maxSpeedSeaLevel: 300,
    serviceCeiling: 25900,
    climbRate: 60,
    stallSpeed: 70,
    approachSpeed: 85,
    rotateSpeed: 100,
    cruiseSpeed: 200,
    maxG: 3,
    minG: -1,
  },
};
