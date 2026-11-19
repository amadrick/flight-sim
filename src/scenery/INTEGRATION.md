# Scenery (airports) — integration notes

`createScenery(ctx)` keeps the stub API and adds:

```
ctx.scenery = {
  update(dt),
  airports: [{
    id, name, kind, data,            // data = the AIRPORTS entry
    layout,                          // airfield plan (airport-local metres, see layout.js)
    root,                            // anchored THREE.Group (world pos = airport position, y = elevation)
    towerPosition,                   // world Vector3: controller eye point inside the tower cab (for the tower camera)
    towerHeading,                    // deg true, primary runway heading (a sensible default view direction)
    parking: [{ position, heading, size, number, occupied }],  // world Vector3 of the NOSE-WHEEL stop mark, heading deg
                                     // true, size 'heavy'|'medium'|'fighter'|'light'; occupied = a static aircraft
                                     // stands there (deterministic per airport; jet bridges of empty gates are retracted)
  }],
  surfaceAt(x, z, out),              // the registered surface provider (also usable directly)
  nearest(x, z),                     // nearest airport record
  lights,                            // light system (uniforms: uGain, uOn, uDayK, uMinPx …)
  stats(),                           // { bootMs, drawables, triangles, lights, instances }
  dispose(),
}
```

Surface provider: `out.type` = `'runway'` (runway + blast pads), `'taxiway'` (taxiways, paved shoulders), `'apron'`;
`out.height` = airport elevation; `out.friction` = 0.8 runway / 0.75 others, reduced up to 45 % in rain. Rejects by
per-airport AABB first, so it is cheap for far queries.

What is built per airport (all procedural, generated at boot)
- Pavement (one draw): asphalt with paving-lane tone steps, seams, soft-edged patches, tar-sealed crack network,
  transverse cracks; concrete with 7.5/6 m slabs, sealed joints, tar over-banding, spalled corners, stains; rubber in
  both touchdown zones; wet response. Small strips use asphalt aprons. Soft soil / dry-grass verges around every
  paved rectangle (one transparent draw) so pavement sits in the turf.
- Paint (one draw): ICAO/FAA runway, taxiway, holding-position, stand markings; worn and chipped paint; soft stain
  blobs under engines/nose gear/APU and tyre scuffs on lead-in lines (glyph 'o' in the paint atlas).
- Buildings (merged per material): terminal + piers with curtain-wall glazing that ray-traces an interior per storey
  (curtain.js), service level with roller shutters, roof overhang, sun fins, skylights; towers; maintenance and
  military hangars, hardened shelters and desert sun shades (KRDR); cargo terminal with freighter stands (hubs);
  hotel, garages, office park, gatehouses; fire stations with crash tenders; fuel farms; fences (perimeter fence with
  gates and service road at hubs and the air base); alpine and island terminals.
- Parked aircraft (one instanced draw per type): narrowbody, widebody, tanker, turboprop, fighter, light aircraft,
  two-colour fictional liveries via instance colour + aLiv2. GSE (tugs, belt loaders, catering, fuel, stairs, buses,
  GPUs, carts, follow-me, ARFF, cones, chocks) baked into one static mesh per airport. Cars, trees instanced.
- Signs: mandatory (white on red), location (yellow on black), direction (black on yellow with arrow), distance
  remaining.

Rendering contract notes
- Lights are one instanced draw call per airport on `LAYERS.POST`, MAX-blended (overlapping distant fixtures do not
  add up into blobs). Energy-conserving: the lamp lens has fixed radiance (140 × relative intensity); once smaller than
  the minimum sprite (uMinPx ≈ 0.85 px) its flux is spread over that footprint, so far lights get dimmer, not bigger.
  An exposure-aware soft cap (uCap, in display units, using `ctx.env.exposure`) keeps cores crisp instead of feeding
  the bloom; flashers get a higher cap. Directional beams with an omni leak (edge lights toed in 3.5°, ±14°).
  Extinction by `ctx.weather.visibility`. Occlusion: if the pipeline renders POST into
  a target whose `depthTexture === ctx.uniforms.frame.tSceneDepth.value`, the hardware depth test is used (sprites are
  pulled toward the camera so the ground never clips them). Otherwise the vertex shader samples `tSceneDepth` (5 taps)
  at the light centre and hides the whole sprite when occluded. Either works; no change needed in the pipeline.
- All scenery materials apply `curvatureDrop()` in the vertex shader so far airports sit on the curved terrain.
- Pavement sits 1–3 cm above the airport elevation plus `polygonOffset` (paint has a larger offset).
- Emissives: windows ≈ 0.5–0.9, signs ≈ 1.5, scaled by `ctx.env.nightFactor`; floodlight pools are added as emissive
  irradiance on pavement, aircraft, vehicles and buildings (no real `Light`s, so no per-light shader cost).

Debug URL params (ignored unless present): `scam=x,y,z` + `slook=x,y,z` (airport-local) or `shdg/spitch`;
`srwy=27R,dist,height[,lateral]`; `sfov`; `sap=KRDR`; `slgain` (light gain multiplier); `slocc=0`; `sldbg=1`;
`shide=paint,mid,lights`; `snoscn=1`; `sdebug=1` (logs stats).

No changes are required in integrator-owned files.
