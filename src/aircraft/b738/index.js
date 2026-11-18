// Boeing 737-800 definition glue. Owned by the integrator.
import geometry from './geometry.js';
import physics from './physics.js';
import { createVisual } from './visual.js';

export default {
  id: 'b738', name: 'Boeing 737-800', manufacturer: 'Boeing',
  category: 'airliner', role: 'Narrow-body airliner', service: 'Commercial', firstFlight: 1997,
  hudType: 'airliner',
  specs: {
    emptyMass: 41413, maxTakeoffMass: 79016, typicalMass: 65000, fuelCapacity: 20894,
    engineCount: 2, engineType: 'turbofan-highbypass', engineName: 'CFM56-7B27',
    thrustDry: 121400, thrustMax: 121400,
    maxMach: 0.82, maxSpeedSeaLevel: 175,
    serviceCeiling: 12500, climbRate: 15,
    stallSpeed: 55, approachSpeed: 72, rotateSpeed: 75, cruiseSpeed: 230,
    maxG: 2.5, minG: -1,
  },
  sound: { engine: 'jet-highbypass', afterburner: false },
  geometry, physics, createVisual,
};
