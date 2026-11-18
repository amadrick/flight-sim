// F-16C definition glue. Owned by the integrator; visual.js belongs to the aircraft-kit agent, physics.js to the physics agent.
import geometry from './geometry.js';
import physics from './physics.js';
import { createVisual } from './visual.js';

export default {
  id: 'f16', name: 'F-16C Fighting Falcon', manufacturer: 'General Dynamics / Lockheed Martin',
  category: 'fighter', role: 'Multirole fighter', service: 'U.S. Air Force', firstFlight: 1974,
  hudType: 'fighter',
  specs: {   // published reference numbers (display + physics validation targets)
    emptyMass: 8570, maxTakeoffMass: 19200, typicalMass: 12000, fuelCapacity: 3200,
    engineCount: 1, engineType: 'turbofan-afterburning', engineName: 'GE F110-GE-129',
    thrustDry: 76300, thrustMax: 131000,                 // N per engine
    maxMach: 2.05, maxSpeedSeaLevel: 410,                // m/s at sea level ~ M1.2
    serviceCeiling: 15240, climbRate: 254,               // m, m/s
    stallSpeed: 62, approachSpeed: 72, rotateSpeed: 72, cruiseSpeed: 240,   // m/s (IAS-ish)
    maxG: 9, minG: -3,
  },
  sound: { engine: 'jet-lowbypass', afterburner: true },
  geometry, physics, createVisual,
};
