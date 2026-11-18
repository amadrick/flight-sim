// Menu copy for each aircraft. Keys are aircraft ids.
export const AIRCRAFT_LORE = {
  f16: {
    tagline: 'Lightweight multirole fighter with fly-by-wire controls',
    description: 'The F-16 is a single-engine multirole fighter developed in the 1970s as a lighter, lower-cost complement to the F-15. Its fly-by-wire flight controls and relaxed static stability give it quick, agile handling. It is flown for both air combat and ground attack.',
    tips: [
      'Keep the throttle at military power or above in a hard turn; the F-16 bleeds energy quickly at low thrust.',
      'Let the flight control computer hold angle of attack at its limit; pulling against the limiter gains nothing.',
      'Set up the approach at a speed suited to your weight and fuel, typically 140 to 160 knots.',
    ],
    facts: [
      'The YF-16 prototype first flew on 2 February 1974.',
      'It is powered by one Pratt & Whitney F100 or General Electric F110 afterburning turbofan.',
    ],
    nickname: 'Viper',
  },
  f22: {
    tagline: 'Stealth air superiority fighter with supercruise',
    description: 'The F-22 is a twin-engine stealth fighter built for air superiority. It can sustain supersonic flight without afterburner, a capability called supercruise. Its thrust-vectoring nozzles give it exceptional low-speed agility at high angles of attack.',
    tips: [
      'Use supercruise to close on targets, but watch fuel, since sustained supersonic flight burns it quickly.',
      'Pitch-vectoring gives strong nose authority at high AoA, but sustained maneuvering bleeds energy fast.',
      'Keep weapons internal in a stealth profile; external stores greatly increase radar cross section.',
    ],
    facts: [
      'The YF-22 prototype first flew on 29 September 1990.',
      'It is powered by two Pratt & Whitney F119 turbofans with pitch-vectoring nozzles.',
    ],
    nickname: '',
  },
  f35: {
    tagline: 'Fifth-generation stealth fighter with sensor fusion',
    description: 'The F-35 is a single-engine stealth fighter that combines a low radar signature with a sensor suite that fuses data into one picture for the pilot. The F-35A is the conventional takeoff and landing variant. Its helmet-mounted display presents much of the sensor information directly in the pilot\'s view.',
    tips: [
      'Keep power on through final; engine response is slower than a legacy fighter, so set up early.',
      'Rely on the fused sensor picture rather than manual scanning, and use the helmet display to cue targets.',
      'Carry weapons internally when stealth matters; add external stores only when the mission allows it.',
    ],
    facts: [
      'The first F-35 prototype, AA-1, flew on 15 December 2006.',
      'It is powered by a single Pratt & Whitney F135 turbofan.',
    ],
    nickname: '',
  },
  fa18: {
    tagline: 'Carrier-capable multirole fighter with strong endurance',
    description: 'The F/A-18E Super Hornet is a larger, more capable evolution of the original Hornet, designed for carrier operations. It carries a heavier weapons load and more fuel than its predecessor. It is known for its endurance on combat air patrols and its reliable carrier handling.',
    tips: [
      'On a carrier approach, hold about 8.1 units AoA and fly the pitch cues rather than chasing airspeed.',
      'Fly combat air patrols at military power; use afterburner in short bursts since it burns fuel fast.',
      'Use leading-edge extensions and flaps for low-speed handling, and watch sink rate on short final.',
    ],
    facts: [
      'The F/A-18E and F variants are powered by two General Electric F414 turbofans.',
      'The Super Hornet has a longer fuselage and more internal fuel than the original F/A-18C and D Hornet.',
    ],
    nickname: 'Rhino',
  },
  f15: {
    tagline: 'Two-seat dual-role fighter with heavy weapons load',
    description: 'The F-15E Strike Eagle is a two-seat, dual-role derivative of the F-15 that carries a large weapons load for ground attack alongside air combat. A weapons systems officer in the rear seat manages the sensors and attack systems. Its thrust and fuel capacity give it long range and strong acceleration.',
    tips: [
      'Switch between air-to-air and air-to-ground modes early, since rear seat workload rises fast in a strike.',
      'Full afterburner accelerates hard but burns fuel fast, so decide how much you will spend before the target.',
      'Expect a longer takeoff roll and higher approach speed when carrying heavy external stores.',
    ],
    facts: [
      'The F-15E first flew on 11 December 1986.',
      'It is powered by two Pratt & Whitney F100 turbofans, and its rear cockpit is occupied by a weapons systems officer.',
    ],
    nickname: 'Mudhen',
  },
  f14: {
    tagline: 'Variable-geometry carrier fighter with long-range radar',
    description: 'The F-14 Tomcat is a twin-engine carrier fighter with wings that sweep from forward to fully aft. It was built around a long-range radar and the AIM-54 Phoenix missile for engaging targets at a distance. Its variable geometry let it cover both slow carrier operations and high-speed intercepts.',
    tips: [
      'Sweep the wings forward for low-speed approach and turning, and aft for supersonic flight to reduce drag.',
      'Hold a stable radar track before firing the Phoenix, since it needs a clean solution at long range.',
      'Watch the sweep schedule when changing speed, since handling differs noticeably at each setting.',
    ],
    facts: [
      'The F-14A prototype first flew on 21 December 1970.',
      'The wings sweep from 20 degrees forward to 68 degrees aft.',
    ],
    nickname: '',
  },
  a10: {
    tagline: 'Close air support attack aircraft built around a cannon',
    description: 'The A-10C Thunderbolt II is a single-seat close air support aircraft designed to fly low and slow over the battlefield. Its titanium armored cockpit protects the pilot from ground fire. It is best known for its 30 mm GAU-8 rotary cannon and its ability to absorb damage and keep flying.',
    tips: [
      'Keep airspeed well above stall on a strafe run; the aircraft stalls if pulled hard at low altitude.',
      'Fire the GAU-8 in short bursts, because its very high rate of fire consumes ammunition in seconds.',
      'Use a shallow, steady descent into the target area so you can maintain a stable gun solution.',
    ],
    facts: [
      'The YA-10 prototype first flew on 10 May 1972.',
      'The pilot sits inside a titanium armored bathtub that protects the cockpit.',
    ],
    nickname: 'Warthog',
  },
  sr71: {
    tagline: 'High-altitude reconnaissance aircraft capable of Mach 3',
    description: 'The SR-71A Blackbird is a twin-engine strategic reconnaissance aircraft that flew at Mach 3 class speeds at very high altitude. Its airframe is built largely of titanium and was designed to outrun threats rather than avoid them with stealth. It remains one of the most studied high-speed aircraft ever flown.',
    tips: [
      'Plan for the airframe to grow in heat at speed, and expect fuel leaks on the ground before takeoff.',
      'Keep the engine inlets configured for the current speed, because a poor inlet setting can cause an unstart.',
      'Slow down deliberately and early before landing, as the aircraft needs a long, controlled deceleration.',
    ],
    facts: [
      'The SR-71 first flew on 22 December 1964.',
      'On 28 July 1976 an SR-71 set the speed record for air-breathing aircraft at about 2,193 mph.',
    ],
    nickname: 'Blackbird',
  },
  b2: {
    tagline: 'Stealth flying-wing strategic bomber',
    description: 'The B-2A Spirit is a flying-wing stealth bomber with no vertical tail, designed for long-range penetration of defended airspace. Its low radar signature comes from its shape and materials. It is a heavy aircraft that flies with deliberate, smooth control inputs.',
    tips: [
      'Yaw comes from drag rudders at the wing trailing edge, not a vertical tail, so use smooth turn inputs.',
      'Keep a generous speed margin on approach; the aircraft is heavy and engines respond slowly at low thrust.',
      'Make gentle pitch changes at low altitude to stay within load limits.',
    ],
    facts: [
      'The B-2 first flew on 17 July 1989.',
      'It is powered by four General Electric F118 turbofan engines.',
    ],
    nickname: '',
  },
  c17: {
    tagline: 'Heavy-lift strategic airlifter for austere airfields',
    description: 'The C-17A Globemaster III is a four-engine strategic airlifter that can carry heavy cargo and operate from short, austere runways. It can deliver outsize loads directly to forward locations. Its powerful reverse thrust and flap system help it stop quickly on short fields.',
    tips: [
      'For a short-field landing, use full flaps, a steeper approach and reverse thrust to decelerate.',
      'The approach speed depends heavily on load, so check the reference speed for your current weight before final.',
      'The four engines spool slowly, so set go-around power early rather than waiting for response.',
    ],
    facts: [
      'The C-17 first flew on 15 September 1991.',
      'It is powered by four Pratt & Whitney F117 turbofan engines.',
    ],
    nickname: '',
  },
  b738: {
    tagline: 'Short- to medium-range narrowbody airliner',
    description: 'The Boeing 737-800 is a twin-engine narrowbody airliner used on short and medium-range routes worldwide. It is the best-known variant of the 737 family that has been produced in greater numbers than almost any other jetliner. Its handling is conventional and predictable for a jet of its size.',
    tips: [
      'Fly a stabilized approach with a sink rate of about 1,000 feet per minute or less, flaps set early.',
      'Use idle thrust and speedbrakes for descent; the CFM56 engines take seconds to spool up.',
      'If you go around, commit to takeoff thrust early, because the engines need time to accelerate.',
    ],
    facts: [
      'The 737-800 is powered by two CFM56-7B turbofan engines.',
      'The 737 is one of the most produced jetliner families in aviation history.',
    ],
    nickname: '',
  },
  b748: {
    tagline: 'Long-range four-engine jumbo jet with a stretched fuselage',
    description: 'The Boeing 747-8 Intercontinental is the final variant of the 747 family, with a longer fuselage and upgraded engines. It is a long-range four-engine airliner that has been flown for decades on the busiest routes. It is often called the Queen of the Skies by enthusiasts.',
    tips: [
      'Plan descents early; the four engines respond slowly, leaving little margin for a late descent.',
      'Use a stabilized approach with landing flaps set, and keep power on until the flare to avoid sink.',
      'Plan for an engine failure on takeoff, because climb performance on three engines is much lower.',
    ],
    facts: [
      'The 747-8 is powered by four GEnx-2B turbofan engines.',
      'It is the last variant of the 747 family, which was first introduced in the late 1960s.',
    ],
    nickname: 'Queen of the Skies',
  },
  b77w: {
    tagline: 'Long-range twin-engine wide-body with folding wingtips',
    description: 'The Boeing 777-300ER is a long-range twin-engine wide-body airliner with a stretched fuselage. Its folding wingtips let it operate at gates with limited space. It is often used on high-capacity long-haul routes.',
    tips: [
      'Use the autothrottle for approach speed, since manual thrust changes on large twin engines can lag.',
      'Set up for a stabilized approach early; crosswind landings need extra attention given the aircraft size.',
      'Manage climbs at a steady speed, since GE90 thrust can overshoot target altitude if not monitored.',
    ],
    facts: [
      'The 777-300ER first flew on 24 January 2003.',
      'It is powered by two GE90-115B turbofans, among the most powerful jet engines ever built.',
    ],
    nickname: 'Triple Seven',
  },
  b789: {
    tagline: 'Mid-size long-range jet built mostly from composites',
    description: 'The Boeing 787-9 Dreamliner is a mid-size long-range twin-engine jet built largely from carbon-fiber composite materials. It is designed for efficient long-haul flights at high altitudes. Its composite construction allows higher cabin pressure and humidity than older designs.',
    tips: [
      'The 787 is efficient at high altitude, so climb early to reach higher flight levels for cruise.',
      'Use speedbrakes and a steady descent profile, and keep the approach stabilized at reference speed.',
      'Use autoland or autopilot for low-visibility approaches, and monitor the autothrottle closely at final.',
    ],
    facts: [
      'The 787 first flew on 15 December 2010.',
      'The 787-9 is powered by Rolls-Royce Trent 1000 or General Electric GEnx-1B turbofans.',
    ],
    nickname: '',
  },
  a320: {
    tagline: 'Fly-by-wire narrowbody airliner with new-generation engines',
    description: 'The Airbus A320neo is a twin-engine narrowbody airliner with fly-by-wire flight controls and new-generation engines. Its flight envelope protections limit bank and angle of attack automatically. It is widely used on short and medium-range routes.',
    tips: [
      'Keep sidestick inputs smooth; envelope protections limit bank and pitch, so abrupt inputs are unnecessary.',
      'Aim for a stabilized approach by 1,000 feet above the airport, with the correct speed and configuration set.',
      'Check the other pilot input on the sidestick when using autopilot, since both sidesticks are independent.',
    ],
    facts: [
      'The first A320neo flew on 25 September 2014.',
      'It is powered by CFM LEAP-1A or Pratt & Whitney PW1100G turbofan engines.',
    ],
    nickname: '',
  },
  a388: {
    tagline: 'Double-deck four-engine superjumbo airliner',
    description: 'The Airbus A380-800 is a four-engine double-deck airliner and the largest passenger airliner ever built. It has two full-length passenger decks and a very wide wing. It is operated mainly on high-capacity routes between large hub airports.',
    tips: [
      'Rotate smoothly and avoid overrotation, since the aircraft has a long fuselage and a low tail-strike margin.',
      'Keep the wingspan in mind on taxiways and turns, because the wings extend far beyond the fuselage.',
      'Plan power changes early on approach, since the four large engines respond more slowly than smaller airliners.',
    ],
    facts: [
      'The A380 first flew on 27 April 2005.',
      'It is powered by four Engine Alliance GP7200 or Rolls-Royce Trent 900 turbofan engines.',
    ],
    nickname: 'Superjumbo',
  },
};
