---
name: add-vehicle-body
description: Use when adding, replacing or removing a vehicle body in claim-marker, when a new Kenney model needs damage zones, or when a body's zones classify taps onto the wrong panel.
---

# Adding a vehicle body

The widgets pick a new body up from data — `VEHICLE_IDS` drives the scenario's body picker,
`isVehicle` guards parsing, the tests loop the list. **The zone set is the decision**, and it
is the part no tool decides for you.

## What you edit

| file | what |
| --- | --- |
| `src/zones.ts` | a `*_ZONES` array, a `VEHICLES` entry, **and a line in the `ZoneId` union** — that union is hand-written per body, not derived |
| `src/models.ts` | the model URL |
| `src/models/<body>.glb` | the asset, texture inlined (below) |
| `test/zones.test.ts` | see Tripwires — these failures are intended |
| `README.md`, `src/models/LICENSE-ASSETS.md` | model list, zone counts, bundle sizes |

`LICENSE-ASSETS.md` claims all bodies share an identical `body`-plus-four-wheels layout.
Check whether yours does — Kenney's box van adds a separate `door` mesh — and correct the
claim if not.

## Decide the zone set before placing an anchor

Zone ids are **per body**. `parse`/`parseScenario` silently drop a damage whose zone does not
exist on that body, so a zone set that is wrong in a way that still typechecks loses customer
data on load. That is the consequence that makes this decision matter.

Work from the render:

- **One zone per panel a person would point at**, that a tap can land on.
- **Rename when the panel is genuinely different.** The pickup has `bed_side`, not
  `rear_quarter_panel`, because there is no quarter panel there.
- **Do not invent a zone with no distinct surface** — the probe will show it starved.
- Reuse a shared id (`hood`, `roof`, `front_bumper`) when the panel really is the same thing.

**A long panel is the hard case and has no settled answer.** One anchor cannot hold a 2 m
slab: its far ends fall closer to the neighbouring anchors, so taps there classify wrongly
even though the zone passes every check. Splitting it fixes the ends and then the roof
above needs splitting too, and the zone count climbs. Probe the panel's **corners**, not
just its centre, find out how bad the bleed is, and put the trade-off to a human rather than
picking silently. The shipped pickup already bleeds its rear flank into `taillight`; that is
the current quality bar, not a target.

## Kenney models need the texture inlined

Their GLBs reference `Textures/colormap.png` as an external URI; copying the `.glb` in alone
gives a model that loads untextured. The texture lives beside the models, in the GLB folder:

```bash
KIT="/path/to/carkit/Models/GLB format"
node scripts/embed-texture.mjs "$KIT/delivery.glb" "$KIT/Textures/colormap.png" src/models/delivery.glb
```

## Verify orientation — do not infer it

Nose at +Z, car's right at +X. **Kenney's node names are wrong about sidedness on every
body** (`wheel-front-left` sits at +X). Confirm for the body you are adding.

## The two tools, in order

`profile-body.mjs` runs on any path, **before** you edit anything:

```bash
node scripts/profile-body.mjs "$KIT/delivery.glb"
```

It only reads the node literally named `body`, so extra meshes are invisible to it, and its
derived `cabin` and `beltline` lines assume a car silhouette — on a box van both are reading
the cargo box. Trust the x/y/z envelope, the wheel centres and the z-profile; treat the rest
as a hint.

`probe-zones.ts` runs **after** the body is registered in `zones.ts` and `models.ts` — it
only accepts an id already in `VEHICLE_IDS`:

```bash
node scripts/probe-zones.ts delivery
```

It samples every triangle and reports which zone each surface point lands in, weighted by
triangle area. A zone with **0 samples is unreachable** — it exists and can never be picked.
The unit tests cannot prove reachability: they check each anchor against itself and enforce a
15 cm gap between anchors, neither of which says a zone claims any bodywork. Exits non-zero,
so it is a check, not just a report. Read the printed centroids too — a centroid far from its
anchor means the anchor is in the wrong place even when the share looks healthy.

Both scripts need no `node_modules`, but `probe-zones.ts` is TypeScript run directly, so it
needs Node ≥ 23.6 (type stripping). It is unrelated to the package's own supported versions.

## Tripwires — update them, do not work around them

`test/zones.test.ts` asserts `VEHICLE_IDS` **exactly**, names the body count in a test title,
and holds a per-body zone-count table. All three are meant to fail when a body is added.
`README.md` and `src/models.ts` quote bundle sizes — re-measure from `npm run build`.

## Check the camera still frames it

`src/marker/Scene.tsx` fixes the camera position and `OrbitControls` `minDistance`, tuned for
a 1.3 m sedan. A taller or longer body can sit outside the default frame, and `smoke.mjs`
does not assert framing — it checks write-back and drags. Look at it.

## Verify

Run `/verify`, plus `node scripts/probe-zones.ts`. `docs/spec*.md` are dated design records
rather than living docs; leave them unless asked.
