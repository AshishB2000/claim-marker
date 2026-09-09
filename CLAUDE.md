# claim-marker

The page a customer lands on to report a car accident: a real map (MapLibre), the vehicles they
choose standing on it in 3D (three.js as a custom map layer), the damage marked on their car
(react-three-fiber), and around it the whole first-notice-of-loss report: what kind of incident,
who was driving and who was hurt, the police, the other party's insurer, photographs, the state
of the car, the conditions, who is reporting, their signed attestation. Seven steps (six when the
kind has nothing to diagram), then a `claim/1` document is POSTed or handed to the host page.
No accounts; the AI is optional and never runs in the page. v1–v3 were an embeddable widget
library; that era is in git history and in
`docs/spec.md`, `docs/spec-scenario.md`, `docs/spec-polish.md`.

Design decisions and their reasoning live in [docs/spec-app.md](docs/spec-app.md). Read it before
changing behaviour it describes.

## Commands

```bash
npm run dev            # vite, http://localhost:5173
npm run lint           # oxlint — must be silent, warnings included (react-compiler-style rules are on)
npm test               # vitest, ~210 tests across 11 files
npm run build          # tsc -b, then the static site into dist/
```

Two end-to-end scripts need `npm run dev` running in another shell and reach the internet
(map tiles, the geocoder):

```bash
node scripts/smoke.mjs     # the whole flow: search, vehicles, drag a car and its heading, damage, send
node scripts/shoot.mjs     # regenerates docs/*.png and asserts the attachments aren't blank frames
```

`node scripts/assist-smoke.mjs` starts its own stub endpoint and its own dev server on 5174,
so it needs no API key: it covers this page's half of the assistant contract. The model's own
judgement is not covered by anything — that needs a key and `scripts/assist-server.mjs`.

Helpers: `scripts/probe-zones.ts <body>` proves every zone claims bodywork; `scripts/profile-body.mjs <glb>`
prints the measurements zone anchors are placed against; `scripts/embed-texture.mjs` inlines a Kenney
texture; `scripts/pixel.mjs` samples pixels out of a PNG. Adding a body has its own skill:
`.claude/skills/add-vehicle-body`.

## Sandbox

**Playwright and `gh` only work with `dangerouslyDisableSandbox: true`.** Both fail in ways
that look like real errors but are not:

- Chromium dies with `bootstrap_check_in ... Permission denied (1100)` — the sandbox blocks
  Mach port rendezvous. A Playwright script outside the project also cannot resolve the
  `playwright` package; import it by absolute path or run from the repo.
- `gh` and `git push` report `token in default is invalid`, `Device not configured` or
  `x509: OSStatus -26276` — the sandbox blocks keychain access.

`npm install` needs it too. Everything else runs sandboxed normally. `npm test` and `tsc` print
`failed to copy trust settings of system certificate` under the sandbox; harmless.

## Conventions that are easy to get wrong

**Coordinate frame.** Nose at +Z, up +Y, the car's **left at +X** and right at −X — left/right
as seen from the driver's seat, the insurance convention. This is what glTF's right-handed
frame forces and Kenney's node names agree (`wheel-front-left` sits at +X). v1–v3 said the
opposite and were wrong; a test in `test/zones.test.ts` now pins it. On the map, positions are
`[lng, lat]` and `heading` is a compass bearing in degrees, clockwise from north.

**Cars on the map are positioned relative to a floating origin** (the incident) and the layer
folds the offset into the projection (`src/map/transform.ts`). Absolute mercator coordinates
are ~0.3 with a metre at 1e-7, which float32 cannot hold; without this the cars jitter by
half a metre at street zoom. `CAR_BASIS` has determinant −1 on purpose: mercator's
(east, south, up) labelling is left-handed, so a physical rotation shows up as a reflection.
Two more things the layer does that look removable and are not: it stands the three camera at
the eye recovered from the map's projection (`eyeFrom`), or Fresnel turns every roof white;
and it draws geometry with reversed winding (`reverseWinding`), or the map's mirrored
projection makes three cull the outer faces. `scripts/smoke.mjs` checks a red car is red.

**MapLibre's worker URL is set by hand** (`src/map/worker.ts`, imported before any map is
made). maplibre-gl 6 looks for its worker beside its bundle; Vite serves the bundle from
`.vite/deps/` (dev) or a hashed chunk (build) with no worker there, the URL 404s, and MapLibre
never says so — GeoJSON sources and vector tiles just never appear and `isStyleLoaded()` is
false for ever. Do not gate anything on `isStyleLoaded()`; the smoke test samples pixels for
the path instead of trusting the store.

**Interaction on the map is DOM markers, never raycasting into the three.js layer.** Each car
is one `Marker` — its footprint in metres, sized on every zoom, rotated to its heading — with a
turn handle ahead of the nose that swallows MapLibre's drag events and turns the car by pointer
bearing; waypoints and the impact point are markers too; the 3D model follows. Playback hands
`poses` to the scene and the 3D layer draws those instead (`src/map/playback.ts` is pure).

**Damage follows the impact until the customer touches it.** `src/claim/suggest.ts` picks the
zone nearest the impact in the car's frame; the store's `autoDamage` is `auto` (follows the
diagram) or `user` (final). `setDamages` compares normalised content before flipping to `user`,
because the marker echoes back the value it is given.

**Materials are inferred from the colour map per triangle** (`src/vehicles/load.ts`): the kit's
swatches are clustered and each cluster is assigned a role — paint, glass, plastic, headlight,
taillight, rim, rubber — then re-authored as physical materials, with normals creased at 35°.
The underside is excluded from the paint vote. `paintStats(body)` prints the table it is tuned on.

**Make/model/year come from the NHTSA vPIC database** (`src/vehicles/catalog.ts`), keyless and
CORS-open, filtered to cars/pickups/SUVs, cached per make+year, with a bundled fallback list and
a free-text "Other". `guessBody(model)` maps a model name to the closest of the seven shapes.

**The scenario map is a north-up, top-down diagram** (`src/map/MapScene.tsx`): rotation and tilt
are disabled. Dragging a car *is* the input — it moves, leaves its travel path behind it and
turns to face the drag (`dragVehicle` in the store). The impact places itself when two bodies
come within `TOUCHING` of each other and follows them until the customer places it by hand,
which sets `impactManual` and stops it. Facing can also be set with a slider; single points can
be tapped on in a `tapMode`.

**Both basemaps are keyless Esri raster.** Two providers were tried against live tiles and
rejected: OpenFreeMap's vector planet returns 200 with an empty body for every tile on earth
(the map paints its background and nothing else, which looks like it is still loading), and
CARTO's free raster now comes back stamped "API KEY REQUIRED". `scripts/smoke.mjs` counts
distinct colours on the location map so a blank basemap fails the build, not the customer.
Two more grounds are drawn, not fetched (`lotStyle`, `paperStyle` in `src/map/styles.ts`):
a parking lot and squared paper, laid out in metres around the incident as inline GeoJSON,
for garages and covered car parks the satellite cannot see. The choice is `incident.surface`
in the document, so the review page draws the same ground.

**The "real car" on a vehicle card is a Wikipedia photograph** (`src/vehicles/photo.ts`),
searched with the year so it lands on the right generation's page. There is no free 3D model
per make, and the answer to "make it look like a real Camry" is that photo, not more shader
work on the kit body. Photos are credited; `VITE_VEHICLE_PHOTO_URL` swaps in a licensed
provider.

**Bodies are stretched to real dimensions** (`PROPORTION` in `src/vehicles/bodies.ts`). The kit's
sedan is 1.50 × 1.45 × 2.55 where a real one is 1.84 × 1.45 × 4.88 — half again too wide and
too tall for its length, which is exactly what reads as a cartoon. After the stretch one unit
is one metre everywhere. Zone anchors and stored damage points stay in kit units because
`claim-marker/1` records them that way; `toWorld` and `toModel` convert at the boundaries.

**Zone anchors are measured, not eyeballed.** Every anchor in `src/zones.ts` comes from
`scripts/profile-body.mjs` output, and `scripts/probe-zones.ts` must show every zone reachable.
The unit tests assert no zone's anchor classifies as a neighbour's — if that fails, the anchors
are wrong, not the test.

**The AI never runs in the page.** `VITE_ASSIST_URL` points at an endpoint the insurer runs and
that holds the key (`scripts/assist-server.mjs` is a reference one); unset, no AI exists in the
page. Positions on that wire are metres east/north of the incident, not `[lng, lat]`, because a
model cannot do spherical arithmetic. Treat every answer as untrusted input: `parseScene` drops
anything malformed or naming a vehicle the customer did not enter, and `applyScene` is a no-op
when nothing usable comes back — an earlier version re-ran the impact anyway and moved the cars.

**The kind of incident drives the flow** (`KIND_INFO` in `src/claim/schema.ts`, `stepsFor` in the
store): `others` says whether other vehicles are expected, `diagram` whether the map step is shown.
`setKind` drops the other vehicles — and the people in them — when the kind has no other party.
People are one flat list like an accident report form (`Person.role`, `vehicle`); drivers are
created on first edit by `setDriver`, one per vehicle; "the other driver left" is the literal
name `UNKNOWN_DRIVER`, not a flag. Photos are downscaled to 1280 px JPEG before they are kept
(`src/claim/photos.ts`) and live in `attachments.photos`, the one attachment the draft persists.
The attestation's `at` is stamped only at send. Send is disabled until agreed and signed.
Every sentence that names a person, a vehicle or a condition comes from `src/claim/describe.ts`
(`personLine`, `vehicleName`, `conditionLabels`, `gaps`); do not compose those inline in a step.

**Schemas are versioned and frozen.** `claim/1` embeds the `claim-marker/1` damage shape. Both
guarantee `export → load → export` is byte-identical, which is why coordinates round on the way
in. Adding a field is fine; changing or removing one means a new schema version. `parseClaim`
throws on structural nonsense but drops individual bad vehicles.

**drei `<Html>` paints over the marker's canvas** regardless of 3D depth; anything that must
appear above it has to be `<Html>` too with a higher `zIndexRange`.

**Lint enforces React-compiler rules:** no writing refs during render (write them in an effect),
no components defined inside components, effects list every dependency (capture mount-time
props in `useState` when a thing is built once), no non-component exports from component files.

**A blank canvas in a screenshot is usually not a bug.** three.js skips objects whose shaders
are still linking; under headless or software GL the lit materials take seconds. The scripts
poll for a rendered frame (`settled()`); do the same before trusting any capture, and use
`scripts/pixel.mjs` to check.

**The marker's CSS is injected, scoped under `.cm-`** (`src/style.ts`), a leftover of the widget
era that still suits it. The app itself is Tailwind (`src/app.css`).

## Layout

```
src/app/          the five steps, the shell, submit
src/claim/        the claim/1 document and the persisted store
src/map/          MapLibre scene, the three.js car layer, the transform maths, styles
src/vehicles/     model loading + paint re-authoring, body previews, the paint palette
src/marker/       the 3D damage marker
src/assist/      the optional assistant: the wire contract, the metric frame, the client
src/zones.ts models.ts schema.ts geo.ts geocode.ts   shared
```

## Before saying it works

Run `npm run lint`, `npm test`, `npm run build`, and — for anything touching the map, the
marker, the steps or the document — `node scripts/smoke.mjs`. Paste the real output. A
screenshot that looks right is not evidence the export path works; `scripts/shoot.mjs` reads
the pixels back.

## Out of bounds

`~/Projects/car-sim` and `~/Projects/car-parts-site` are read-only reference. Never modify
them. Do not push unless asked, and never on weekdays 08:00–18:00 local time: a global
PreToolUse hook (`~/.claude/hooks/block-push-workhours.sh`) denies pushes in that window.
