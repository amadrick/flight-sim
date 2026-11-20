// Semantic radio calls the AI emits as combat.events 'ai:call' { entity, call, target? }. The missions agent turns them
// into radio text. Minimum seconds between two calls of the same kind by the same pilot (plus a 1.2 s gap between any
// two calls of one pilot; 'splash', 'fox2', 'fox3' and 'mayday' are never dropped by the shared gap).
export const CALLS = ['tally', 'engaging', 'fox2', 'fox3', 'guns', 'defending', 'missile-inbound', 'on-my-six', 'hit', 'splash', 'winchester',
  'mayday', 'rejoin', 'press'];

export const CALL_GAP = {
  tally: 25, engaging: 20, fox2: 2, fox3: 2, guns: 10, defending: 12, 'missile-inbound': 6, 'on-my-six': 12, hit: 8, splash: 1,
  winchester: 600, mayday: 60, rejoin: 30, press: 20,
};
