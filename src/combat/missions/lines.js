// Radio line bank. Every line here is original to Skyward. Several variants per situation; the radio never repeats the
// variant it used last for a key. Placeholders: {cs} player call sign, {me} speaker, {t} target, {who} subject,
// {dir} clock direction ("four o'clock low"), {n} a number, {brg} bearing, {rng} range in miles.
//
// Cast (all invented):
//   Cathedral   — the controller (airborne early warning). Calm, precise, quietly funny.
//   Halyard     — the player's flight, 88th Fighter Squadron out of Haven. Halyard 2 dry, Halyard 3 eager, Halyard 4 old hand.
//   Furnace     — the Cendrine Directorate's ground controller; their pilots fly as Cinder, Slag, Flint, Gravel, Kiln.
//   Quillon     — Colonel Anselm Drey, the Directorate's best: courteous, vain, very good.
//   Haven Tower / Redrock Tower / Meridian — tower and the boat.

export const LINES = {
  // ---------------- controller ----------------
  'awacs.checkin': [
    '{cs}, Cathedral. Radar contact. Picture follows.',
    'Cathedral has you, {cs}. Weapons hot when you see them.',
    '{cs}, Cathedral. Loud and clear. Let\'s go to work.',
  ],
  'awacs.picture': [
    '{cs}, Cathedral. Group bearing {brg}, {rng} miles, {n} contacts, hostile.',
    'New group, bearing {brg} for {rng}. {n} ship. Hostile, cleared hot.',
    'Pop-up group bearing {brg}, {rng} miles. {n} contacts. They\'re coming to meet you.',
    'Cathedral: {n} hostiles, bearing {brg}, {rng} miles and closing. Cleared to engage.',
  ],
  'awacs.pictureSingle': [
    '{cs}, Cathedral. Single contact bearing {brg}, {rng} miles, hostile.',
    'Single bandit, bearing {brg} for {rng}. Nose hot. Cleared to engage.',
    'One hostile, bearing {brg}, {rng} miles and closing. All yours, {cs}.',
  ],
  'awacs.splash': [
    'Cathedral copies the splash.',
    'Good kill, {cs}.',
    'That one\'s off my scope. Nice shooting.',
    'Splash confirmed. The scope is getting quieter.',
    'Kill confirmed. Paint another one on the jet.',
  ],
  'awacs.remaining': ['{n} hostiles remaining.', '{n} left on my scope.', 'I hold {n} more.', '{n} to go, {cs}.'],
  'awacs.lastOne': [
    'One bandit left. Finish it.',
    'Last hostile on the board, {cs}. Bring it home.',
    'Single contact remaining. It\'s all yours.',
  ],
  'awacs.clean': [
    'Picture clean. Outstanding work, {cs}.',
    'Scope is clean. Cathedral thanks you for the quiet.',
    'No hostiles remaining. That\'s how it\'s done.',
  ],
  'awacs.friendlyDown': [
    '{who} is down! Anyone see a chute?',
    'Lost {who}. {who} is down.',
    '{who} is off my scope. We lost them.',
  ],
  'awacs.chute': ['Good chute on {who}. Rescue is rolling.', 'Beacon from {who}. They\'re out and floating down.'],
  'awacs.missileInbound': [
    '{cs}, launch on you, {dir}! Break!',
    'Missile in the air, {cs}, {dir}. Defend!',
    '{cs}, missile, {dir}! Flares and turn!',
  ],
  'awacs.objectiveDone': ['Objective complete.', 'That\'s a tick on the board, {cs}.', 'Good. Stand by for the next task.'],
  'awacs.objectiveFailed': ['We\'ve lost that one, {cs}.', 'Objective failed. Make the rest count.', 'That\'s a miss. Keep fighting.'],
  'awacs.optionalDone': ['Bonus task complete. Someone upstairs noticed.', 'Extra credit, {cs}. Nicely done.'],
  'awacs.bingo': ['{cs}, you\'re showing bingo fuel. Start thinking about home.', '{cs}, fuel state is getting thin.'],
  'awacs.winchester': [
    '{cs}, you\'re winchester. Drag them toward your wingmen.',
    'Cathedral shows an empty jet, {cs}. Stay out of the merge.',
  ],
  'awacs.gunsLow': ['{cs}, you\'re low on rounds. Short bursts.', 'Gun\'s nearly dry, {cs}. Make them count.'],
  'awacs.missilesOut': ['{cs}, last missile gone. Cannon only from here.', 'Missiles expended, {cs}. Time for the gun.'],
  'awacs.leaving': [
    '{cs}, you\'re leaving the area. Come back.',
    'Wrong way, {cs}. The fight is behind you.',
    '{cs}, return to the operating area.',
  ],
  'awacs.bugout': [
    'Cathedral: the bandits are bingo too. They\'re turning for home.',
    'Cathedral shows the bandits running north. Fight\'s over, {cs}.',
    'They\'ve had enough. Bandits extending away, {cs}. Let them go.',
  ],
  'awacs.bingoFail': [
    'Not enough of them went down, {cs}. They\'ll be back tomorrow. So will we.',
    'They still own the sky out here, {cs}. Bring the jet home and we\'ll try again.',
  ],
  'awacs.oneMinute': ['{cs}, one minute remaining.', 'Sixty seconds, {cs}.', 'Clock says one minute. Hurry it up.'],
  'awacs.rtb': [
    '{cs}, mission complete. You\'re cleared to RTB.',
    'Cathedral to all players: that\'s the job. Head home.',
    'Good work out there. Cathedral is buying.',
  ],
  'awacs.fail': [
    '{cs}, Cathedral. That\'s a no-go. Regroup and we\'ll run it again.',
    'Mission failed, {cs}. Bring the jet home.',
  ],
  'awacs.playerDown': ['{cs} is down! {cs} is down!', 'Lost {cs}. Rescue is on the way. Sit tight down there.'],
  'awacs.wave': ['Next group inbound, {cs}. Bearing {brg}, {rng} miles.', 'More company: bearing {brg}, {rng} miles.', 'Another wave on the scope. Bearing {brg}.'],

  // ---------------- wingmen (speaker is the wingman) ----------------
  'wing.checkin': ['{me}, in position.', '{me}, on your wing. Let\'s dance.', '{me} is with you, lead.', '{me}, visual on lead.'],
  'wing.tally': ['{me}, tally bandit.', '{me}, eyes on {t}.', 'Tally one, {me}.', '{me}, I have the bandit.'],
  'wing.engaging': ['{me}, engaging.', '{me} is in. Cover me.', '{me}, committing on {t}.', '{me}, taking {t}.'],
  'wing.fox2': ['{me}, fox two!', 'Fox two, {me}.', '{me}, heater away!'],
  'wing.fox3': ['{me}, fox three!', 'Fox three, {me}.', '{me}, radar missile away.'],
  'wing.guns': ['{me}, guns, guns!', '{me}, guns.', '{me}, rounds away.'],
  'wing.defending': ['{me}, defending!', '{me}, spiked, defending!', '{me} defensive. Give me a second.'],
  'wing.missileInbound': ['{me}, missile on me!', '{me}, launch on me. Breaking!', '{me}, I\'ve got one coming!'],
  'wing.onMySix': ['{me}, bandit on my six! Somebody!', '{me}, I\'ve got a tail and it isn\'t mine!', '{me}, can someone get this guy off me?'],
  'wing.hit': ['{me}, I\'m hit! Still flying.', '{me}, took some rounds. Jet\'s ugly but holding.', '{me}, hit! Warning lights everywhere.'],
  'wing.splash': ['{me}, splash one!', '{me}, splash! That\'s a kill.', '{me}, scratch one bandit.', 'Splash, {me}. Next.'],
  'wing.winchester': ['{me}, winchester.', '{me} is out of missiles. Guns only.', '{me}, I\'m empty.'],
  'wing.mayday': ['{me}, mayday, mayday! Going down!', '{me}, I\'m out. Ejecting!', '{me}, lost the jet! Punching out!'],
  'wing.rejoin': ['{me}, rejoining.', '{me}, coming back to your wing.', '{me}, off target, rejoining.'],
  'wing.press': ['{me}, pressing.', '{me}, staying on him.', '{me}, still in the fight.'],
  'wing.playerHit': ['{cs}, you\'re hit!', 'Lead, you\'re trailing smoke!', '{cs}, you took one. You OK?', 'Lead, that hurt to watch. Still with us?'],
  'wing.playerBadlyHit': ['{cs}, you\'re on fire! Get out of the fight!', 'Lead, you\'re burning. Disengage!', 'Lead, that jet\'s coming apart. Extend!'],
  'wing.playerSplash': ['Nice shot, lead!', 'Good kill, {cs}!', 'That\'s how it\'s done.', 'Lead with the splash!', 'Remind me never to annoy you, lead.'],
  'wing.playerGunKill': ['Guns kill! Somebody buy that pilot a drink.', 'Up close and personal. Beautiful, lead.', 'With the cannon? Show-off.'],
  'wing.warnPlayer': ['Lead, launch on you, {dir}! Break!', '{cs}, missile {dir}! Flares!', 'Break {dir}, {cs}! Missile!'],
  'wing.missileMissed': ['It went stupid. You\'re clear, lead.', 'That one\'s chasing a flare. Nice.', 'Missed you, lead. Good break.'],
  'wing.friendlyDown': ['No! {who}\'s down!', '{who} is gone. I saw a chute. I think I saw a chute.', 'We lost {who}! Get some payback.'],
  'wing.checkSix': ['Lead, check six! Bandit {dir}!', '{cs}, bandit at your {dir}! Move!', 'Lead, someone\'s on your tail!'],

  // ---------------- the player's own calls (voice 'player') ----------------
  'lead.fox2': ['{cs}, fox two!', 'Fox two!', '{cs}, heater away.'],
  'lead.fox3': ['{cs}, fox three!', 'Fox three!', '{cs}, radar missile away.'],
  'lead.splash': ['Splash one!', '{cs}, splash!', 'Scratch one.', '{cs}, kill.'],
  'lead.splashGun': ['Guns kill!', 'Splash, guns!', '{cs}, splash with the gun.'],
  'lead.flares': ['{cs}, flares!', 'Defending!', '{cs}, breaking!'],

  // ---------------- the adversary (heard rarely, for flavour) ----------------
  'enemy.engaging': ['Furnace, {me}, committing.', '{me}, engaging. They look nervous.', '{me}: I have them. Follow me in.'],
  'enemy.fox': ['{me}, missile away!', '{me}: launching. Goodbye.', '{me}, shot, shot!'],
  'enemy.splash': ['{me}: one down! Mark it, Furnace.', 'Got one! Did you see that?', '{me}, kill. Who\'s next?'],
  'enemy.defending': ['{me}, defending! Who is this pilot?', '{me}: he\'s on me, somebody help!', 'This one is good. Breaking!'],
  'enemy.mayday': ['{me}, I\'m hit. Ejecting!', 'Furnace, {me} is going down!', 'Tell the quartermaster I lost the jet.'],
  'enemy.hit': ['{me}, I\'m hit!', 'Damage! Still in it!', '{me}: I\'m leaking something important.'],
  'enemy.retreat': ['Furnace, we\'re breaking off. Too hot.', 'All flights, extend north. Now.', 'This is not worth it. Turning for home.'],
};

/** Map from AI semantic calls ('ai:call' events) to line-bank keys, per side, with minimum spacing (s) per speaker. */
export const AI_CALLS = {
  tally: { blue: 'wing.tally', gap: 25, pr: 0 },
  engaging: { blue: 'wing.engaging', red: 'enemy.engaging', gap: 15, pr: 0 },
  fox2: { blue: 'wing.fox2', red: 'enemy.fox', gap: 3, pr: 1 },
  fox3: { blue: 'wing.fox3', red: 'enemy.fox', gap: 3, pr: 1 },
  guns: { blue: 'wing.guns', gap: 6, pr: 0 },
  defending: { blue: 'wing.defending', red: 'enemy.defending', gap: 8, pr: 1 },
  'missile-inbound': { blue: 'wing.missileInbound', gap: 5, pr: 1 },
  'on-my-six': { blue: 'wing.onMySix', gap: 10, pr: 1 },
  hit: { blue: 'wing.hit', red: 'enemy.hit', gap: 6, pr: 1 },
  splash: { blue: 'wing.splash', red: 'enemy.splash', gap: 1, pr: 1 },
  winchester: { blue: 'wing.winchester', gap: 60, pr: 0 },
  mayday: { blue: 'wing.mayday', red: 'enemy.mayday', gap: 5, pr: 2 },
  rejoin: { blue: 'wing.rejoin', gap: 30, pr: 0 },
  press: { blue: 'wing.press', gap: 20, pr: 0 },
};
