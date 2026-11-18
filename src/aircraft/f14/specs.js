// F-14D Tomcat — published reference numbers (SI). Derivation and confidence notes: docs/aircraft/f14.md
// hudType rationale: pilot has a HUD in the D model; fighter symbology
export default {
  id: 'f14', name: 'F-14D Tomcat', manufacturer: 'Grumman',
  category: 'fighter', role: 'Carrier-based variable-sweep fleet-defence fighter', service: 'U.S. Navy (retired 2006)', firstFlight: 1970,
  hudType: 'fighter',
  sound: { engine: 'jet-lowbypass', afterburner: true },
  specs: {
    emptyMass: 19838,
    maxTakeoffMass: 33720,
    typicalMass: 26500,
    fuelCapacity: 7350,
    engineCount: 2,
    engineType: 'turbofan-afterburning',
    engineName: 'General Electric F110-GE-400',
    thrustDry: 73900,
    thrustMax: 122800,
    maxMach: 2.34,
    maxSpeedSeaLevel: 410,
    serviceCeiling: 16150,
    climbRate: 230,
    stallSpeed: 59,
    approachSpeed: 70,
    rotateSpeed: 78,
    cruiseSpeed: 235,
    maxG: 7.5,
    minG: -3,
  },
};
