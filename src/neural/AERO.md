# Neural aerodynamics layer

Small per-aircraft networks, trained offline on a nonlinear vortex-lattice solver, correct the stability and control
derivatives of the tuned analytic flight model past the stall. Runtime: `src/neural/aero.js` (typed arrays, no
allocation), weights `src/neural/aero-weights.js`, hook in `src/physics/aero.js` (`computeAero`). Offline pipeline:
`tools/neural/aero/`.

**Switch.** On by default. `?aero=classic` gives the analytic model alone. `?aeroOff=cnp,clr` keeps the analytic term
for single outputs (names below). `?aeroGe=1` switches on the learned ground-effect pitch term (off by default, see
"Ground effect"). In node: `createMockContext({ aero: 'classic' })` or the environment variables `SKYWARD_AERO`,
`SKYWARD_AERO_OFF`, `SKYWARD_AERO_GE` (e.g. `SKYWARD_AERO=classic node tools/flight-test.mjs b738`).

## The reference solver (`tools/neural/aero/solver.py`)

Nonlinear Weissinger / vortex-lattice method in numpy, batched over flight conditions:

- wing, horizontal tail and fin(s) of each aircraft from its real planform (`planforms.py`); one horseshoe vortex per
  spanwise strip (12 per half wing, 6 per half tail, 5 per fin): bound vortex on the quarter-chord line, chordwise
  bound legs to the trailing edge, trailing legs along the free stream, flow tangency at 3/4 chord;
- viscous section model coupled by alpha-based decambering (van Dam; Mukherjee and Gopalarathnam) with
  under-relaxation and spanwise artificial viscosity: attached lift, a sigmoid separation function, Hoerner flat-plate
  normal force when separated, section drag and centre-of-pressure shift; flap, aileron, elevator, rudder and
  all-moving surfaces change the section zero-lift angle and its stall angle;
- Prandtl-Glauert stretching for compressibility (trusted to Mach 0.85);
- a full mirror-image vortex system for ground effect at any height, pitch and bank;
- the wing wake acts on the tail through the trailing vortices (downwash) and through a DATCOM-type dynamic-pressure
  deficit that follows the separated wake (tail and fin blanketing);
- forces from Kutta-Joukowski on the bound segments with Trefftz-plane induced velocities.

The section model of each aircraft is calibrated to the tuned model (`calibrate.py`: camber to CL0, CG to the static
margin, flap deflection to the landing lift increment, section stall angle and width to the tuned angle of maximum
lift). The solver knows nothing about leading-edge-extension vortex lift or forebody vortices: for the fighters the
section "stall angle" is an effective value of 18 to 31 degrees.

Validation (`validate.py`, numbers in `tools/neural/aero/results/validation.json`):

| case | quantity | solver | reference | error |
|---|---|---|---|---|
| elliptic wing AR 6 / 10 / 20 | CL_alpha | 4.43 / 5.08 / 5.65 | Helmbold 4.53 / 5.15 / 5.69 | -2.3 / -1.5 / -0.7 % |
| same | CL_alpha | | lifting line 4.71 / 5.24 / 5.71 | -6.1 / -3.1 / -1.2 % |
| same, 12 -> 40 strips | span efficiency | 1.04 -> 1.02 | 1.00 | +4 -> +2 % |
| rectangular AR 6 | CL_alpha | 4.28 | 4.53 (Glauert, Helmbold) | -5.4 % |
| rectangular AR 6 | span efficiency | 1.08 | 0.956 (Glauert) | +12.8 % |
| Warren-12 swept wing | CL_alpha, Cm_alpha | 2.781, -3.095 | 2.743, -3.10 | +1.4 %, 0.2 % |
| 45 deg swept AR 5 (Bertin and Smith), 4 strips | CL_alpha | 3.428 | 3.443 (book VLM), 3.4 measured | -0.4 % |
| rectangular AR 8 | Cl_p | -0.537 | -0.524 (lifting line) | 2.6 % |
| rectangular AR 8, 5 deg dihedral | Cl_beta | -0.088 | -0.102 (strip theory, upper bound) | 14 % below |
| elliptic AR 8, downwash 0.5 / 1 / 5 spans aft | epsilon | 0.0366 / 0.0340 / 0.0331 | 0.0379 / 0.0346 / 0.0333 | -3.2 / -1.6 / -0.8 % |
| ground effect, rectangular AR 8, h/b 0.25 / 0.2 / 0.15 / 0.1 | CDi/CL^2 ratio | 0.74 / 0.67 / 0.57 / 0.42 | Prandtl biplane 0.77 / 0.71 / 0.63 / 0.52 | -4 / -5 / -9 / -19 % |
| stall, rectangular wing | first separation | root (eta 0.05) | root | |
| stall, taper 0.4 | first separation | eta 0.60 | outboard | |
| stall, 35 deg sweep, taper 0.3 | first separation, pitch break | eta 0.76, nose up | tip stall, pitch-up | |

Weak spots: the induced drag of the rectangular wing is about 11 % low at 12 strips (the networks never use drag);
very close to the ground (h/b below 0.1) the lifting-surface effects make the result drift from Prandtl's
lifting-line value; the fin in the wake of a flapped wing loses too much (see flap fade below).

## The networks (`train.py`, `export.py`)

One set of nine heads per aircraft, each 4 inputs -> 10 -> 10 -> n outputs, ISRU activation `x / sqrt(1 + x^2)`,
outputs bounded as `B * isru(z)`, inputs clamped to the trained range. 1605 weights per aircraft, int16-quantised
(75 kB for all 16 aircraft). Trained with Levenberg-Marquardt on 2000 solver configurations x 8 solves (free air)
and 1500 x 3 solves (ground) per aircraft, one sixth held out.

`alpha_n` = angle of attack / tuned angle of maximum lift (positive or negative side, with the tuned flap, slat and
Mach effects), flap = low-speed flap lift increment / its maximum, Mach clamped to 0.1 .. 0.85 (0.45 from 30 % flap).

| head | fourth input | outputs (name: meaning) |
|---|---|---|
| beta | abs(sin beta) / sin 25 deg | `cyb`, `cnb`, `clb`: ratio - 1 of side force, weathercock stability, dihedral effect |
| p | abs(pb/2V) / 0.25 | `clp`: ratio - 1 of roll damping (not used, see below); `cnp`: residual yaw due to roll rate |
| r | abs(rb/2V) / 0.15 | `cnr`: ratio - 1 of yaw damping; `clr`: residual roll due to yaw rate |
| da | abs(roll control) | `clda`: ratio - 1 of roll-control power; `cnda`: residual adverse yaw |
| dr | abs(rudder) | `cndr`: ratio - 1 of rudder power |
| de | pitch surface, signed | `cmde`: ratio - 1 of pitch-control power |
| q | (qc/2V) / 0.03, signed | `cmq`: ratio - 1 of pitch damping |
| m | - | `cm`: pitch break, in units of full-travel pitch-control power |
| g | (ln h/b, alpha_n, flap, bank / 12 deg) | `gcm`: pitch change near the ground (same unit); `gcl`: rolling moment per sin(bank) near the ground |

A *ratio* is the solver's secant response at the given amplitude divided by the solver's own clean attached-flow
derivative at the same Mach number (for `clb`: by its attached form d0 + d1 CL). A *residual* is the solver's secant
derivative minus its attached form d0 + d1 CL, scaled by tuned / solver size of the effect that drives it.

Held-out fit error over the 16 aircraft (weighted like the runtime uses the outputs; ratios are dimensionless):

| output | median rms | worst rms | median rms / spread | worst (aircraft) |
|---|---|---|---|---|
| cyb, cnb, clb | 0.029, 0.037, 0.018 | 0.070, 0.069, 0.099 | 0.09, 0.14, 0.16 | 0.19 (sr71), 0.31 (fa18), 0.51 (f22) |
| cnp, clr | 0.008, 0.008 | 0.017, 0.025 | 0.08, 0.10 | 0.19 (fa18), 0.26 (b2) |
| cnr, cmq | 0.045, 0.029 | 0.26, 0.11 | 0.11, 0.14 | 0.24 (f22), 0.35 (f22) |
| clda, cnda, cndr | 0.036, 0.0004, 0.012 | 0.12, 0.006, 0.046 | 0.17, 0.11, 0.08 | 0.39, 0.38, 0.28 (fa18) |
| cmde, cm | 0.030, 0.011 | 0.066, 0.022 | 0.11, 0.08 | 0.28 (b2), 0.12 (b2) |
| gcm, gcl | 0.004, 0.003 | 0.008, 0.015 | 0.04, 0.07 | 0.08 (c17), 0.33 (c17) |
| clp (trained, not used) | 0.041 | 0.108 | 0.11 | 0.26 (c17) |

Full table per aircraft: `tools/neural/aero/results/fit.json`.

## How the layer joins the tuned model

The tuned performance must not move, so:

1. **Lift and drag are never touched.** Stall speeds, turn rates, climb, cruise and glide come from the analytic model
   alone (asserted by the unit tests: `CL` and `CD` are bit-identical with and without the networks).
2. **Free-air gate.** All free-air corrections are multiplied by
   `G = smoothstep(1.0, 1.25, |alpha_n|) * (1 - smoothstep(2.0, 2.8, |alpha_n|))`, further faded to zero between
   Mach 0.85 and 1.05 and with the F-14's wing sweep. Below the angle of maximum lift the free-air model is
   bit-identical to the analytic one (the networks are not even evaluated). The gate opens only at maximum lift because the flight
   tests pin tuned numbers right up to it: the roll test of the fly-by-wire airliners is flown clean near the stall,
   the instantaneous-turn test at maximum lift. An earlier gate from 0.55 failed four aircraft. Beyond 2.8 times the
   angle of maximum lift (the deep stall, far outside what a lifting-surface method can claim) the tuned model takes
   over again.
3. **Ratios multiply tuned derivatives**: `Cn_r = cnr_tuned * (1 + G * (ratio - 1))`, likewise side force, dihedral
   effect, pitch-control power and pitch damping. Where the analytic model has its own high-alpha modifier
   (directional blanking `cnb -> cnbPost`, rudder loss, aileron loss) the result is blended from the analytic value
   to `tuned * ratio` as the gate opens. Residuals and the pitch break are added with the same gate; lateral terms
   multiply the lateral input, so symmetric flight stays symmetric.
4. **Valid flags.** Where the solver has no clean reference for a derivative (B-2 without a fin: `cyb`, `cnb`, `cnr`,
   `cndr`, `cmq`; SR-71: `clda`, `cnr`, `cmde`, `cmq`, `cm`, `gcm`), the output is switched off and the analytic term
   stays. **Flap fade**: outputs whose flapped solver reference differs by more than 25 to 33 % from the clean one
   (mostly `cnb`, `cyb` of the airliners: the fin blanketed by the flapped wing's wake) fade out with flap extension.
5. **Ground effect.** Lift and induced drag in ground effect stay analytic (the tuned take-off and landing distances
   hang on them). The network adds a restoring rolling moment with bank near the ground (`gcl`), zero above 1.5
   spans. The learned pitch change in ground effect (`gcm`, nose-down as the tail downwash goes: 10 to 27 % of
   full elevator at wheel height on the conventional aircraft) is implemented but **off by default**: the scripted
   flare of the landing test has a 4 % margin and fails with it (737-800 touchdown sink 2.93 m/s -> 3.16 / 3.44 /
   3.99 m/s at 25 / 50 / 100 % strength). `?aeroGe=1` switches it on; it then acts in the air only (0.8 s lag after
   the main wheels leave or touch the ground), so the tuned take-off rotation is unchanged.

## What stays analytic, and why

- **Lift, drag, ground-effect lift and induced drag**: tuned numbers.
- **Everything below the angle of maximum lift**, including the gradual loss of aileron power and damping the solver
  shows from about 0.6 of that angle: tuned tests live there.
- **Roll damping past the stall (`clp`)**: the solver (quasi-steady strip theory) drives Cl_p to zero or positive
  right past the stall for every wing. Flown, that rolls the A-10 and the 737 onto their backs within 6 s of a held
  stall (roll-off 179 / 161 degrees against 38 / 11 analytic), which their docile real stalls do not support. The
  tuned `clpPost` is kept. For the same reason yaw and pitch damping may fade to zero but are never reversed.
- **Deep stall beyond 2.8 times the angle of maximum lift, supersonic flight, the F-14 with wings swept**.
- **The fighters' vortex lift**: not in the solver; their corrections rest on an effective section model.
- No interaction between channels (sideslip with roll rate, and so on): each head sees one disturbance.

## Regenerating

```
node tools/neural/aero/dump_models.mjs            # tuned numbers -> results/models.json
python3 tools/neural/aero/calibrate.py            # section model per aircraft (6 min)
python3 tools/neural/aero/gen_dataset.py <ids>    # solver data, about 80 s per aircraft (data/, not committed)
python3 tools/neural/aero/train.py                # networks (8 min) -> results/nets, results/fit.json
python3 tools/neural/aero/export.py               # -> src/neural/aero-weights.js, test-vectors-aero.json
python3 tools/neural/aero/validate.py             # solver against classical results
node tools/neural/aero/manoeuvres.mjs             # before / after in telling manoeuvres
```

Retrain after any change of the tuned stall angles, control travels or planforms. Unit tests:
`src/neural/aero.test.js`.
