---
name: add-vehicle-body
description: Use when adding, replacing or removing a vehicle body in claim-marker, when a new Kenney model needs damage zones, or when a body's zones classify taps onto the wrong panel.
---

# Adding a vehicle body

The mechanics are small — two files, and everything else derives. **The zone set is the
decision**, and it is the one thing no tool checks for you.

## Only two files are edit points

`src/zones.ts` (a `*_ZONES` array plus a `VEHICLES` entry) and `src/models.ts` (the URL).
`VEHICLE_IDS` drives the scenario's body picker, `isVehicle` guards parsing, and the tests
loop the list — none of that needs touching.

## Decide the zone set before placing a single anchor

Zone ids are **per body**, not global. `ZoneId` is the union across all bodies, and
`parse`/`parseScenario` silently drop a damage whose zone does not exist on that body. A
zone set that is wrong in a way that still typechecks loses customer data on load.

Work from the render, not from the nearest existing body:

- **One zone per panel a person would point at**, that a tap can actually land on.
- **Rename when the panel is genuinely different.** The pickup has `bed_side`, not
  `rear_quarter_panel`, because there is no quarter panel there. A panel van has one
  unbroken slab behind the front door, so it wants a single `cargo_panel` pair rather than
  `rear_door` + `rear_quarter_panel`.
- **Do not invent a zone with no distinct surface.** The probe will show it starved or
  unreachable.
- Reuse a shared id (`hood`, `roof`, `front_bumper`) whenever the panel really is the same
  thing — that is what keeps the vocabulary comparable across bodies.

If two readings of the body are defensible, say so and ask rather than picking silently.
This is the call a reviewer will want to make.

## Kenney models need the texture inlined

Their GLBs reference `Textures/colormap.png` as an external URI. Copying the `.glb` in on
its own gives a model that loads untextured:

```bash
node scripts/embed-texture.mjs "<kit>/van.glb" "<kit>/Textures/colormap.png" src/models/van.glb
```

## Verify orientation — do not infer it

Nose at +Z, car's right at +X. **Kenney's node names are wrong about sidedness on every
body** (`wheel-front-left` sits at +X). `scripts/profile-body.mjs` prints the z-profile and
the long low end is the hood; that plus the wheel positions settles it. Confirm for the body
you are adding, not by analogy with the others.

## The two tools

```bash
node scripts/profile-body.mjs src/models/van.glb   # measurements to place anchors from
node scripts/probe-zones.ts van                    # what those anchors actually do
```

`probe-zones` samples every triangle and reports which zone each surface point classifies
to. A zone with **0 samples is unreachable** — it exists and can never be picked. The unit
tests cannot catch this: they only check each anchor against itself. Exits non-zero, so it
is a check, not just a report.

Expect wheels to claim a large share; wheel meshes carry far more triangles than flat
panels, so the percentages are weighted by triangle count, not surface area.

## Tripwires — update them, do not work around them

- `test/zones.test.ts` asserts `VEHICLE_IDS` **exactly**, and holds a per-body zone-count
  table. Both are meant to fail when a body is added.
- `src/models.ts` and `README.md` quote bundle sizes. Re-measure from `npm run build`.
- `src/models/LICENSE-ASSETS.md` lists every model and its provenance.

## Not living documents

`docs/spec.md` and `docs/spec-scenario.md` are dated design records. `spec.md` still lists
"SUV and pickup" as not built, months after they shipped. Leave them unless asked.

## Verify

`npm run lint`, `npm test`, `node scripts/probe-zones.ts`, `npm run build`, and — because a
new body reaches the widgets through data — `node scripts/smoke.mjs` against a dev server.
