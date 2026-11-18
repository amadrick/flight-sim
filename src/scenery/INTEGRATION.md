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
    parking: [{ position, heading, size, number }],  // world Vector3 of the NOSE-WHEEL stop mark, heading deg true,
                                     // size 'heavy'|'medium'|'fighter'|'light'; ~70 % are occupied by static aircraft
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

Rendering contract notes
- Lights are one instanced draw call per airport on `LAYERS.POST`, additive, HDR radiance (≈140 × relative intensity at
  60 m, falling off with distance, extinction by `ctx.weather.visibility`). Occlusion: if the pipeline renders POST into
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
