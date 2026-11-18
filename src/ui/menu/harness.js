// Test harness: boots the full sim with a padded 16-type roster so the aircraft list can be checked at scale.
// node tools/shot.mjs --entry src/ui/menu/harness.js --html dist/menu.html --params "menu=main" --size 1280x720
import { AIRCRAFT } from '../../aircraft/registry.js';
import '../../main.js';
const extra = [
  ['f22', 'F-22A Raptor', 'fighter', 'Air superiority fighter'], ['f35', 'F-35A Lightning II', 'fighter', 'Stealth multirole fighter'],
  ['fa18', 'F/A-18E Super Hornet', 'fighter', 'Carrier-based strike fighter'], ['f15', 'F-15E Strike Eagle', 'fighter', 'Dual-role strike fighter'],
  ['f14', 'F-14D Tomcat', 'fighter', 'Carrier interceptor'], ['a10', 'A-10C Thunderbolt II', 'attack', 'Close air support'],
  ['sr71', 'SR-71A Blackbird', 'recon', 'Strategic reconnaissance'], ['b2', 'B-2A Spirit', 'bomber', 'Stealth bomber'],
  ['c17', 'C-17A Globemaster III', 'transport', 'Strategic airlifter'], ['b748', 'Boeing 747-8', 'airliner', 'Wide-body airliner'],
  ['b77w', 'Boeing 777-300ER', 'airliner', 'Wide-body airliner'], ['b789', 'Boeing 787-9', 'airliner', 'Wide-body airliner'],
  ['a320', 'Airbus A320neo', 'airliner', 'Narrow-body airliner'], ['a388', 'Airbus A380-800', 'airliner', 'Double-deck airliner'],
];
const base = { fighter: AIRCRAFT[0], airliner: AIRCRAFT[1] };
for (const [id, name, category, role] of extra) {
  const b = category === 'airliner' ? base.airliner : base.fighter;
  AIRCRAFT.push({ ...b, id, name, category, role, lore: id === 'sr71' ? { tagline: 'Still the fastest air-breathing crewed aircraft.', description: 'Mach 3.2 at 85,000 ft. Outran every missile fired at it.' } : undefined });
}
// main.js boots asynchronously (awaits before the menu reads AIRCRAFT), so mutating after its evaluation is safe.
