# claim-marker — the claimant's page (v4)

v1–v3 built two embeddable widgets and a developer demo. This version turns the repo into
the thing a customer actually lands on: they click **"Tell us what happened"** on their
insurer's site and arrive here. Nothing developer-facing is on screen — no JSON, no schema
names, no mount() page. The output is still a versioned document, but it goes to the insurer,
not to the customer's eyes.

Three things the customer asked for, in their words: it is a public page for a claims
company; the location should be a real map; the cars should be real, and theirs to choose —
which ones, and how many.

## The flow

Five steps, one screen each, progress kept in `localStorage` so a refresh does not lose the
claim.

1. **Where and when.** An address search with suggestions as you type, a "use my location"
   button, date and time. A live map underneath flies to the result; the pin can be dragged
   to the exact spot.
2. **Vehicles.** Your vehicle: body type, colour, and optional make, model and plate. Then
   the other vehicles, as many as were involved, each with body and colour. Body types are
   rendered live in the chosen colour, not shown as icons.
3. **What happened.** The map from step 1, in satellite view, tilted, with the vehicles from
   step 2 standing on it as 3D models, a little over true scale so they read as cars. Drag a car to where it was, drag the
   handle ahead of it to turn it, drag the white dots to draw where it came from, place the
   point of impact. A sentence or two of description.
4. **Damage.** The 3D damage marker from v1, on your vehicle in your colour: tap a panel,
   pick a severity. Optional for the other vehicles.
5. **Review and submit.** Everything on one page, then submit. The confirmation shows a
   reference number and offers a copy for the customer's records.

## Maps

**MapLibre GL** with keyless sources, so the page works out of the box and the insurer can
swap in their own keyed provider by changing one tile URL:

- Streets: Esri World Street Map raster tiles. OpenFreeMap's vector `liberty` style was the
  first choice and was dropped after its tile server started answering every tile with 200
  and an empty body, which paints as a blank cream page; CARTO's free raster now watermarks
  "API KEY REQUIRED".
- Satellite: Esri World Imagery raster tiles.
- Search and reverse geocoding: Photon (komoot), which is built for as-you-type queries.

**Drawn grounds for the places a map cannot see.** A collision in a parking garage, a
covered car park, a driveway under trees or a private garage has nothing to show from above,
and the satellite view of a roof is worse than useless there: it looks like the page failed.
So the diagram has four grounds, chosen on the scenario step and saved in the document as
`incident.surface`: `satellite`, `streets`, and two drawn ones — `lot`, rows of 2.7 × 5.5 m
bays back to back with 7 m aisles, the incident in the middle of an aisle; and `paper`,
squared paper at 5 m. Both are ordinary MapLibre styles with the lines inline as GeoJSON laid
out in metres around the incident, so the cars, paths, markers, review page and export work
on them unchanged, and the lines stay in metres at every zoom (a `fill-pattern` would be in
pixels). The sheet extends 200 m, past what the minimum zoom shows.

The v1 "no network at runtime" rule was right for a widget inside someone else's form and is
wrong for a page whose whole point is a real map. It is retired here, on purpose.

## Cars on the map

The vehicles are a **three.js custom layer** inside MapLibre — the same WebGL context, the
map's own projection matrix each frame, so tilt and rotate keep the cars glued to the ground
and `preserveDrawingBuffer` lets the review page export exactly what is on screen.

**Interaction is DOM markers, not raycasting.** Each vehicle, its heading handle, its
waypoints and the impact point are MapLibre `Marker`s with `draggable: true`; the 3D model
follows its marker. Raycasting into a custom layer means inverting the map's projection
matrix by hand; markers already project correctly under pitch and work on touch, so the
layer stays purely visual.

**Each vehicle is one marker, its own footprint.** The marker is a rectangle the size of the
body at the map's scale — metres per pixel at the car's latitude and the current zoom, resized
on every zoom event — rotated to the heading with MapLibre's `rotationAlignment: 'map'`, so
the thing a finger lands on is exactly the car. Dragging the body moves it and draws its path;
a handle floating ahead of the nose turns it: pointer events on the handle compute the bearing
from the car's projected centre to the pointer, and the handle swallows the mouse and touch
events MapLibre's marker drag listens for, so a turn never becomes a move. The slider in the
panel does the same job for anyone who prefers it. The label is a child of the rotated
marker, counter-rotated about the car's centre and lifted, so it stays upright and above the
car whatever way the car faces.

**Playback.** "Play it back" drives every car along its route — the path it was dragged along,
ending where it came to rest — and they all arrive together, at the moment of impact.
`posesAt(vehicles, t)` is a pure function of the claim; the hook feeds its frames to the map
as `poses`, which the 3D layer draws instead of the vehicles while the markers hide. The
longest route sets the clock, 1.5–6 s at a diagram's 20 km/h, with an ease in and out. The
review page can play it too, which is the point: the insurer sees what happened, not a
still.

**The damage is worked out from the diagram.** With an impact and a heading there is a panel
that took the hit: the impact point seen from the car's centre, turned into the car's own frame
(nose +Z, its left +X), lands nearest one zone — distance to the anchor less the zone's radius,
ignoring height (the impact is on the ground) and never glass, the roof or a mirror. Before
that, the common collisions: within 25° of head-on or rear-end it is the bumper, full stop,
because a rear-end shunt at a slight angle is a bumper hit however close the taillight's anchor
sits to the point. That zone is marked as a dent before the
customer reaches the damage step, and the scenario panel says "hit on the front bumper" as they
turn the car. A mark made this way follows the impact — move the cars and it moves, lose the
impact and it goes — until the customer marks that vehicle themselves, after which their marks
are never touched (`autoDamage` in the store: `auto` follows, `user` is final). The marker
echoes back values it is handed, so only a real change of content counts as the customer's.

Headings are compass bearings in degrees, clockwise from north, which is what a map wants.
Positions are `[lng, lat]`. Paths are lines of `[lng, lat]`. The v2 metres-on-a-plane frame
is gone with the abstract road layouts.

## Real-looking cars from public-domain models

Kenney's Car Kit (CC0) has a body for every type a claim form needs — sedan, hatchback,
coupe, SUV, pickup, van, box truck — and one colour map. At load time the body mesh is split
into two material groups by sampling that colour map per triangle: the **paint** becomes a
clearcoat physical material in the customer's chosen colour; everything else keeps its
texture under a glossier physical material. Wheels get a matte rubber material. A room
environment gives the paint something to reflect. Same models, recolourable and no longer flat.

Finding the paint took three attempts, all measured on the kit rather than guessed:

1. *Largest colour by area* picked the underside — two enormous dark triangles. Faces pointing
   down are excluded from the vote.
2. The colour map's swatches are faint gradients, so one paint lands on a dozen keys a few RGB
   steps apart, and only the single most common key was being recoloured. Keys within 34 RGB
   units are clustered first.
3. The trim — bumpers, sills, mirrors, wheel arches — is the same bluish grey on every body
   and on the pickup and the SUV covers *more* area than the paint. The paint is the saturated
   colour, so area is weighted by saturation. Some bodies wear two shades of their paint, so
   anything saturated within 30° of the winner's hue is paint too.

`paintStats(body)` in `src/vehicles/load.ts` prints the per-colour table the rule was tuned
on; use it before changing the rule.

Realistic licensed models were considered — the BMW in `car-sim` is CC BY — but a claim form
needs seven body types that match each other, and one photoreal coupe beside six boxy toys
would look worse than seven consistent bodies.

**The real car is a photograph, not a model.** A customer who picks "2021 Toyota Camry"
expects to see a Camry, and no generic body will ever be one. Per-make 3D models are
commercial, trademarked and would number in the thousands, so the vehicle card shows a
photograph instead: Wikipedia's page-image API (keyless, CORS-open) searched with the year,
make and model, which usually lands on the generation page — "Toyota Camry (XV70)" for 2021,
"(XV40)" for 2010, "Acura Integra (2023)" for 2024 — so the shape is right as well as the
badge. The best-ranked pictured result whose title names the make wins, list articles are
skipped, and the photo is credited to Wikimedia Commons with a link to the file. The 3D body
is still what stands on the map and takes the damage marks; it shows on the card only until a
make and model are chosen. `VITE_VEHICLE_PHOTO_URL` replaces the lookup with a licensed
provider's URL template (make, model, year, colour) for an insurer that has one.

## The report around the reconstruction

v4 built the part no other claim form has — the map, the cars, the diagram, the damage — and
left out most of what every claim form does have. Against GEICO's, Progressive's and State
Farm's first-notice-of-loss flows and California's SR-1 accident report, the missing sections
were: the kind of incident, who was driving and who else was there, injuries, the police
report, the other party's insurer, photographs, the state of the car now, other property,
conditions, who is reporting, and an attestation. v5 adds all of them, additively, in `claim/1`.

**The kind comes first because it prunes the rest.** `KIND_INFO` carries two flags per kind:
`others` (are other vehicles expected — a collision yes, hail no, hit-while-parked yes but the
driver may be unknown) and `diagram` (is there anything to draw — theft, glass and weather
have none). `stepsFor(kind)` drops the scene step accordingly, so the flow is seven steps or
six, and `setKind` drops the other vehicles and the people in them when the kind has no other
party, or adds one to fill in when a collision has none. The default is a collision,
pre-selected, because it is the common case and a form that starts blank starts slower.

**People are one flat list, like an accident report form.** `Person.role` is driver, passenger,
pedestrian or witness; drivers and passengers carry the vehicle they were in, the other two
carry null. A driver is created on first edit by `setDriver` — "I was driving" is the default
and leaves no record; only "someone else" or a mark of injury makes one. One driver per
vehicle, enforced in `toDocument`. Injuries live on the person (`injured`, `injury` in the
customer's words) because "who was hurt" is what an adjuster reads first; there is no separate
medical object. "The other driver left" is stored as the literal name `Unknown — left the
scene` rather than a flag: it is what the adjuster needs to read, and it survives any consumer.

**Photographs are downscaled on the phone and kept with the draft.** A phone photo is 3–8 MB
and the draft lives in localStorage with a ~5 MB budget, so `shrink` re-encodes each one at
1280 px on the long edge as JPEG (~100–300 kB) before it is stored; twelve is the cap. They sit
in `attachments.photos` — the one attachment the draft persists, because unlike the rendered
PNGs they cannot be regenerated. `createImageBitmap` with `imageOrientation: 'from-image'` keeps
a portrait shot upright.

**The attestation is stamped at send, and send waits for it.** `agreed` and `name` are the
customer's; `at` is written by the page in the same instant as `submittedAt`, never before, and
the Send button is disabled until both are given. The fraud notice above the signature is
state-mandated wording, so `VITE_FRAUD_NOTICE` overrides the default.

**Who is reporting sits on the review page**, not the first step: on an insurer's own site it
comes from the login, and a person who has just crashed should be asked about the crash before
they are asked for their email. The document has the slot (`reporter`) either way.

**The review is a document, not a dump of fields.** The first version listed everything as
dot-separated fragments — "drivable no · airbags yes · towed yes" — and a customer rightly said
it did not make sense. It is now written the way the report will be read: one card with a
header (the kind, where, when, the conditions), then sections in one style — label/value rows
where a form reads back, sentences where a person is described, the description as a quotation,
the map as a figure with a legend, the marks listed beside the 3D render with the same numbers
as on the car, the photos captioned, the state of the car and other property as rows. Every
way of naming a person or a vehicle lives in `src/claim/describe.ts`, so the people step, the
review and the summary all say "Sam Lee, passenger in your 2022 Toyota Camry" the same way.
Anything not given says "Not given" rather than vanishing or printing a dash. Above the
document, `gaps(claim)` lists what an adjuster would ring up to ask — no description, no
photo, the other driver unknown, police unanswered, drivability unanswered, no way to reach
the customer — each linking to its step. None of it blocks sending: a report with gaps beats no
report, but each gap is a call saved.

**What was left out on purpose:** rental and repair-shop preferences (the insurer's next
conversation, not the report), a separate medical section (injury text on the person covers
it), and anything about fault.

## The assistant

Two directions across one endpoint, both optional and both off unless `VITE_ASSIST_URL` is
set: the customer's words become the diagram, and the diagram becomes the written statement.

**Why an endpoint and not the API.** An API key in a Vite bundle is a published API key.
So the page speaks `claim-assist/1` to one route the insurer runs, and that route holds the
credential and decides the provider — the Anthropic API, Bedrock, Vertex, an internal gateway.
`scripts/assist-server.mjs` implements it in ~200 lines with no dependencies, both as a way to
run the thing locally and as the file an insurer copies; moving providers is its `askClaude`
function and nothing else. The contract is the JSON, not the model.

**Positions on the wire are metres east and north of the incident**, not `[lng, lat]`. A model
reasons well about "six metres back from the junction" and cannot do spherical arithmetic;
`src/assist/frame.ts` converts at the boundary and a test pins the two functions as inverses.
Headings stay compass bearings, which is what both a map and a sentence want.

**The model can only rearrange what the customer already entered.** `parseScene` drops a
vehicle that is malformed, out of range, or not in the claim, and `applyScene` does nothing at
all when nothing usable came back — otherwise an empty answer would still re-run the impact
and the damage over an unchanged scene, which is how the first version of this quietly moved
the cars. The customer's own text is in the prompt, so this is the boundary that matters: a
crafted description can at worst draw a wrong diagram, in front of the person who can drag it.

**The impact from a description is the customer's, not the geometry's.** A scene that names an
impact sets `impactManual`, so dragging afterwards does not overwrite what they said; a scene
without one falls through to the same `settle()` a drag uses. Either way the damage suggestion
runs, so a described accident arrives at the damage step with the panels already marked.

**No fault, ever, and it says it is AI.** The prompts forbid blame, speeds, injuries and
anything not in the diagram, and the written statement is labelled and editable before it is
sent. A claimant-facing page that appeared to decide liability would be a different and much
worse product.

**What is deliberately not here:** a chat assistant (generic, and the five steps already ask
the questions), damage assessment from photos (worth doing, but needs photo upload first) and
a pre-submit consistency check (cheap and useful, next). Dictation into the description box
would suit the "just tell us what happened" idea and is the Web Speech API, no key.

## Document

`claim/1` wraps the v1 damage shape rather than redefining it:

```json
{
  "schema": "claim/1",
  "reference": "CM-7F3K2Q",
  "submittedAt": "2026-09-07T22:14:03Z",
  "incident": {
    "at": "2026-09-06T17:30",
    "location": { "lng": -73.9859, "lat": 40.7573, "address": "Times Square, Manhattan, New York" },
    "description": "Other car turned left across me"
  },
  "vehicles": [
    {
      "id": "a", "role": "insured", "body": "sedan", "color": "#b91c1c",
      "make": "Honda", "model": "Civic", "plate": "",
      "position": [-73.98592, 40.75731], "heading": 12,
      "path": [[-73.98601, 40.75712]],
      "damages": [{ "zone": "front_bumper", "point": [0.18, 0.32, 1.24], "severity": "dent", "note": "" }]
    }
  ],
  "impact": [-73.98588, 40.75736],
  "attachments": { "scene": "data:image/png;base64,…", "damage": { "a": "data:image/png;base64,…" } }
}
```

Coordinates round to six decimals (about 10 cm) and headings to a degree, so the round trip
is stable. `parseClaim` throws on structural nonsense and drops a malformed vehicle rather
than losing the rest, as v1 and v2 did.

**Submission** posts the document to `VITE_SUBMIT_URL` when it is set. When it is not, the
page behaves as if it had — reference number, confirmation — and says so in the README, not
on screen.

## Left is +X

Writing the map transform forced the question the widget era had answered by assertion: with
the nose at +Z and up at +Y in a right-handed frame, the car's right is at −X, which is also
what the glTF specification says of an asset's front. v1–v3 had documented right = +X, so
every `right_*` zone in every stored document was on the driver's left. Fixed at the one
place it originates, the `pair()` helper in `zones.ts`, and pinned by a test. Documents
written by the widget era have their sides mirrored; there are none in production.

## Things that bit

**MapLibre's worker was a 404, and nothing said so.** maplibre-gl 6 starts its worker from a
module file beside its bundle, `new URL('./maplibre-gl-worker.mjs', import.meta.url)`. Vite
serves the bundle from `.vite/deps/` in dev and from a hashed chunk in the build, with no
worker file beside either, so the URL 404s. The worker never answers and MapLibre never
reports it: GeoJSON sources stay "loading" for ever, `isStyleLoaded()` stays false, vector
tiles never decode. Three commits shipped with the travel paths and arrowheads in the store
and the document but invisible on the map, and the "blank" OpenFreeMap street map was most
likely this, not the provider. `src/map/worker.ts` now sets the URL through Vite's own
worker bundling (`?worker&url`), which is right in dev and in the build, and
`scripts/smoke.mjs` samples the canvas for the path's blue rather than trusting the store.

- **three.js lights in view space and takes the eye to be the view-space origin.** With the
  map's projection used as the camera matrix and nothing else, that origin is on the ground
  among the cars; every roof is seen at a grazing angle and Fresnel turns the paint white. The
  layer now reads the eye back out of the projection (the pre-image of `(0, 0, −1, 0)`) and
  stands the three camera there, folding the same offset back into the projection so the clip
  result is unchanged. `eyeFrom` has a unit test against a known three.js camera.
- **MapLibre's projection mirrors window-space winding** and three.js only compensates for the
  model matrix, so it culled every outer face and lit the inner ones with inverted normals: a
  red car rendered grey, and double-sided materials made it worse. Diagnosed by swapping the
  paint for an unlit red — 23 % red pixels under the marker — against 0 % lit. The layer draws
  geometry wound the other way, one cached copy per body; the studio scenes keep the original.
- A MapLibre marker reads its position the moment it is added to the map; adding a heading
  handle before `setLngLat` threw inside a React effect and unmounted the whole page.
- MapLibre's attribution button lives in the bottom-right corner; a toolbar chip placed there
  cannot be clicked. The map's bottom toolbar sits 40 px up.
- A `[lng, lat]` tuple rebuilt every render must not be an effect dependency by identity, or
  the map recentres on every keystroke.

## What is gone

The npm package, `mount()`, the vanilla page, the four abstract road layouts, the demo's JSON
panes. All of it is one `git checkout` away, and none of it belongs on a page a customer sees.

## Verification

`npm run lint`, `npm test`, `npm run build`, and `node scripts/smoke.mjs`, which now drives
the whole flow headlessly: searches an address, picks vehicles, drags a car on the map,
marks a damage, submits, and checks the document that came out. `node scripts/shoot.mjs`
regenerates the README images from the real map.
