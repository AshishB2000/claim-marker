# claim-marker — accident scenario builder (v2)

The second half of the claims tool. The damage marker ([spec.md](spec.md)) says *what* was
damaged; the scenario builder says *how it happened*: pick a road layout, place the vehicles,
draw the path each one travelled, mark the point of impact.

The reference point is the "drag the car to show what happened" diagram in a first-notice-of-loss
form. Same job, done properly in 3D.

## Scope

Paths, not animation. Each vehicle carries a short draggable path drawn as a curved arrow — enough
to express "he turned left across me", which is the single most disputed fact in a two-car claim.
No timeline, no playback, no per-vehicle speed. An animation is a bigger build and a bigger surface
for "the animation is wrong, so the claim is wrong".

Damage marking is integrated: selecting a vehicle and choosing **Mark damage** opens the v1 widget
over the diagram for that vehicle's body, and the result is embedded in the scenario document.

## Schema

A sibling of `claim-marker/1`, not a replacement for it. The marker schema is shipped and
versioned; breaking it would force a migration on consumers who never asked for a scenario.

```json
{
  "schema": "claim-scenario/1",
  "layout": "intersection",
  "vehicles": [
    {
      "id": "a",
      "role": "insured",
      "body": "sedan",
      "position": [-2.4, 8.1],
      "heading": 3.14,
      "path": [[-2.4, 24.0], [-2.4, 14.0]],
      "damages": [
        { "zone": "front_bumper", "point": [0.18, 0.32, 1.24], "severity": "dent", "note": "" }
      ]
    }
  ],
  "impact": [0.6, 1.2],
  "note": ""
}
```

- `position` and `impact` are ground-plane `[x, z]` in metres.
- `heading` is Y-rotation in radians; the nose points at +Z when it is 0. Same axes as the marker,
  so nothing has to be reconciled between the two documents.
- `damages` is the exact `Damage` shape from `claim-marker/1`, in that vehicle's own local frame.
  The scenario reuses the damage vocabulary rather than redefining it.
- `role` is `insured` or `other`.

**`position` and `path` stay independent.** `path` is the approach; `position` is where the vehicle
came to rest; the arrow is drawn through `[...path, position]`. Making the vehicle the last waypoint
instead would mean dragging the car silently rewrites its own path.

Coordinates round to the millimetre and headings to four decimals, so `export → load → export` is
byte-identical — the same bar the marker holds.

## Vehicles

The feature needs the deferred SUV and pickup: two cars in one diagram have to be tellable apart,
and different Kenney bodies come with different baked paint, which is the cheapest way to get that.

`sedan.glb`, `suv.glb`, `truck.glb` — all CC0, all with the same node layout (`body` + four wheels)
and the same units. Each gets its own zone anchors profiled from its own mesh, not scaled from the
sedan's, and the "no zone is shadowed by a neighbour" test loops all three rather than hardcoding
one.

## Layouts

Four, composed from two primitives — a rotatable `Strip` and a `Dashed` line. Roads, stop
lines, bay markings and kerbs are all strips at different sizes, so no further vocabulary was
needed:

| id | |
| --- | --- |
| `intersection` | Four-way. Two crossing roads, centre lines, stop lines on each approach. |
| `t_junction` | Three-way. Pulling out and failure-to-yield. |
| `straight` | Two-lane road. Rear-endings, head-ons, lane changes. |
| `parking_lot` | Marked bays either side of a drive lane. |

Each layout is one small function in a map, so a roundabout later is one more entry.

## Decisions taken here

**Camera clamped to looking down** (polar 0°–65°). Dragging on the ground plane gets ambiguous as
the camera approaches horizontal. Clamping is one line and removes the whole class of problem, so
there is no need for a separate placement mode and presentation mode.

**Rotation is a drag handle, not a gizmo.** A single puck ahead of the selected vehicle; drag it and
the nose points at it. One draggable object, works on touch, no modes.

**One entry point, all three models inlined** — 852 kB, 219 kB gzipped, of which 788 kB is the
models and 44 kB is code. The original plan was to let bundlers tree-shake the unused bodies, but
that cannot work: tree-shaking is per binding, and a `Record<Vehicle, url>` map references all of
its values. Making it work would mean per-body exports, which would let
`<DamageMarker vehicle="suv">` silently render a sedan when no URL was threaded to it — a worse
API than the bytes it saves. If the size ever matters, the fix is separate `.` and `./scenario`
entry points, not a cleverer map.

**The impact cross is DOM, not geometry.** It floats above the vehicles rather than lying on the
road, where the two cars it sits between hid it. Raising it in 3D is not enough on its own: the
vehicle labels are drei `<Html>`, so they paint over the canvas and no amount of height puts WebGL
in front of them. The badge is therefore an `<Html>` too, with a higher `zIndexRange`, and
`pointerEvents: none` so the pointer falls through to an invisible disc behind it and dragging
still goes through the normal 3D path. A leader line and a ground ring keep it tied to the point.

**Drags track the pointer from `window`, not from r3f's `pointer`**, which only updates while the
cursor is over the canvas. The selected-vehicle panel sits on top of the diagram, so dragging a car
under it froze the drag the moment the pointer crossed the panel. Each drag also intersects a plane
at the height of the handle being held — the impact badge floats, and intersecting `y = 0` would
snap it to the ground point under the cursor the instant it was picked up.

**Flat surfaces are layered on Y**: ground 0, asphalt 0.010, the crossing carriageway 0.014,
paint 0.022. Two coincident road planes z-fight visibly across the intersection box, and giving
the crossing road its own layer also reads correctly — one carriageway passes over the other.

**The scene is lit dimly on purpose.** Ambient plus a key light plus a bright environment together
washed the asphalt from its authored `#5b636f` out to `#a7b0bc`, which stops reading as road at
all. Measured back off the rendered pixels rather than judged by eye — `scripts/pixel.mjs` samples
a PNG, and asphalt now lands on `#5a6371`.

**`src/` gets grouped into `marker/` and `scenario/`**, with `schema.ts`, `zones.ts`, `style.ts` and
`models.ts` shared at the root. Churn on working code, but this feature roughly doubles the file
count and the alternative is nineteen flat files spanning two unrelated features.

## Deliberately not built

Animated playback · road width and lane-count controls · satellite or map backdrop · custom element
· weather and time of day · more than add/remove for the vehicle list (the schema takes any number,
the UI does not elaborate on it).

## Verification

`npm run lint`, `npm test`, `npm run build`, and a screenshot of the scenario demo with two vehicles,
their paths, an impact point and damage marked on one of them.
