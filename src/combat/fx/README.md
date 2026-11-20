# Combat effects (`src/combat/fx/`)

`createCombatFx(combat) → { update(dt), explode, explodeAircraft, groundImpact, clear, stats, dispose }`
(COMBAT.md §10; everything past `update` is additive).

| file | what |
|---|---|
| `index.js` | orchestration: per-entity records, event handlers, fire-light choice, debug params |
| `shared.js` | uniform block / GLSL header / anchor / noise textures (reuses `src/effects/*`; uses `ctx.effects.shared` if exposed) |
| `sprites.js` | ONE instanced draw for tracers (motion-blur streaks), muzzle flashes, motor / afterburner / fire flames, flares, nav + strobe lights, far-aircraft glint dots |
| `ribbons.js` + `ribbon-pool.js` | ONE instanced draw for every volumetric tube trail: missile smoke, damage / wreck smoke, flare smoke, debris trails, AI contrails, AI wingtip vapour, fuel-leak vapour (style table per point) |
| `recipes.js` | GPU-particle spawn recipes (hits, ground strikes, gun smoke, flame licks, launch puff, warhead, kill fireball, splash) |
| `meshes.js` / `debris.js` | instanced lit missile bodies; pooled tumbling debris with heat glow and trails |
| `ribbon-pool.test.js` | `node --test src/combat/fx/` — pool layout, allocation/stealing, run connectivity, dirty ranges, origin-shift rebase |

## What drives what
- **Tracers**: `weapons.bullets` (tracer rounds only). Streak = velocity relative to the camera × 1/50 s, capped by
  the distance flown; `gun` id scales width (`gau8` 1.6×, `gau22` 1.25×); blue team warm orange, red team yellow-green;
  fade over the last 25 % of `life`. Sub-pixel streaks widen to 0.9 px with their energy kept.
- **Muzzle**: while `loadout.gun.firing`: star flash + glow at `weapons.muzzleOf(e)` if present, else the gun port
  from `weapons/specs.js gunPort(def)`; gun smoke stream. GAU-8 ×2, GAU-22 ×1.3.
- **Hits**: `bullet:hit` sparks + flash + puff + dull fragments (bigger for 30 mm), `bullet:ground` dust / water spout.
- **Missiles**: body per missile (`spec.diameter`, length by seeker), flame + glow + thick lit white smoke while
  `missile.motor` (fallback: boost + sustain time from `spec.motor`), a thinning wisp for 2.5 s after burnout.
  `missile:launch` puff + flash, `missile:hit` warhead burst, `missile:miss` small burst only when `detonated`.
- **Flares**: brightness from `flare.heat` (fallback: age/life), flicker, halo, lit smoke trail.
- **Damage** (every aircraft incl. the player): `damage.smoke` grey → black ribbon, `damage.fire` > 0.12 switches to the
  burning style (flame tongue sprite + flame-lick particles + soot ribbon). Source: dead engine (`engineOut`), else the
  worst-hit wing (`parts`), else the nozzle centre. `damage.leak` → thin white vapour from the wing.
- **Kills** (`kill`, not the player): particle fireball (bright core cooling to rolling soot, sparks, black smoke),
  debris burst (16 pieces missile kill, 8 gun kill, 34 incl. 5 large sections if `info.disintegrated`/`hidden`).
  Wrecks (`world.wrecks`) and the falling player wreck trail fire + heavy black smoke until the ground.
- **`wreck:impact`**: land — simulator particle explosion + neural ground fireball (`effects/explosion.js`, D from
  fuel) + smoke column (`emitters.wreckUpdate`) + debris; water — spray column.
- **AI aircraft**: afterburner flame + nozzle glow per engine (`engines[i].afterburner`), dull nozzle glow at night,
  contrail above the ISA −40 °C level, wingtip vapour by g / humidity / dynamic pressure, nav + strobe lights at night,
  glint dot when the model spans < ~4 px (fades in between 4.5 and 2.5 px).

## Budget
Draw calls, everything active: sprites 1 + ribbons 1 + particles 1 + smoke 1 + missile bodies 1 + debris 1
(+ ≤ 3 neural fireball boxes and their bakes, only after a ground impact) → **6** (each hidden when empty;
**0 with no mission** — `combat.step` does not call us and `mission:abort` hides everything).
Measured in the 2v2 mission: 260 total render calls with 4 combat-fx draws visible; free flight 182.
Buffers (allocated once): sprites 2048 × 64 B; ribbons 32 long (256 pts) + 64 short (64 pts) slices = 12 449 records × 48 B
(≈ 0.6 MB); particles 6144 + 3072 × 80 B; 48 missile and 128 debris instances. Per frame: only the sprite slice in use,
the dirty ribbon ranges (one per slice touched) and freshly spawned particles are uploaded. No per-frame allocations
in the hot paths (records are created on first sight of an entity / on events).
Counts scale with `ctx.quality.particles` (spawn rates); fixed capacities.

## Debug params
`cfxfb=0` no neural fireball · `cfxairfb=1` neural fireball for air kills · `cfxgfb=1` neural fireball for ground crashes (default: particle fireball + soot column) · `cfxdmg=<0..1>` damage on all aircraft ·
`cfxcontrail=1` · `cfxvapor=1` · `cfxoff=sprites,ribbons,ps,smoke` hide systems · `cfxnoemis=1` no trail emission.
