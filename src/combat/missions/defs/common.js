// Shared bits for mission definitions: the roster the menu offers, the cast, and a defaults helper.
export const FIGHTERS = ['f16', 'f15', 'fa18', 'f22', 'f35', 'f14'];

/** Speakers beyond the default cast (radio.js DEFAULT_CAST: awacs Cathedral, tower Haven Tower, boat Meridian, enemy Furnace). */
export const CAST = {
  instructor: { name: 'Ridgeback', voice: 'lead', team: 'blue' },
  range: { name: 'Gull Shoal Range', voice: 'tower', team: 'blue' },
  redrock: { name: 'Redrock Tower', voice: 'tower', team: 'blue' },
  boat: { name: 'Meridian', voice: 'tower', team: 'blue' },
  bundle: { name: 'Bundle 1', voice: 'wingman', team: 'blue' },
  ace: { name: 'Quillon', voice: 'enemy', team: 'red' },
  furnace: { name: 'Furnace', voice: 'enemy', team: 'red' },
};

/** Fill the fields every definition carries (the UI builds its screens from exactly these names). */
export function mission(d) {
  return {
    category: 'campaign', aircraft: 'f16', aircraftChoices: FIGHTERS, threat: 2, minutes: 5, objectivesPreview: [],
    callsign: 'Halyard 1', cast: CAST,
    ...d,
  };
}

/** Guns-only loadout (weapons merge it over the default). */
export const GUNS_ONLY = { ir: 0, radar: 0 };
/** A target that cannot fight back. */
export const UNARMED = { gun: 0, ir: 0, radar: 0, flares: 0 };
