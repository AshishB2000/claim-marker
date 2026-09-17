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

## Roadside polish (v6)

Passes over the page as a customer on a phone would meet it, each a small change:

- **The VIN fills the card.** A full 17-character VIN in the box is decoded by the same NHTSA
  database the model list comes from (`decodeVin`, `parseVin` in `src/vehicles/catalog.ts`)
  and fills make, model, year and the closest shape — the VIN is on the insurance card, and
  typing it is quicker than three dropdowns. What the customer already picked is never
  overwritten: a VIN that says otherwise ("This VIN is a 2003 Honda Accord, not a 2021 Honda
  CR-V") is pointed out with one tap to take its word, because a mistyped VIN and a wrongly
  picked model look the same from here and only the customer knows which. The make is matched
  to the picker's list case-insensitively; a make the list does not carry is kept as typed.
  The shape is only changed when no damage has been marked on the current one, the rule
  `guessBody` already follows.
- **The description can be spoken.** `src/app/Describe.tsx` is the one "in your own words"
  box, with a dictation button where the browser has speech recognition (Chrome, Safari,
  Edge — the Web Speech API, no key, nothing sent from the page but the browser's own audio
  handling). Dictation appends to what is typed. The box also now appears on the damage step
  for the kinds with nothing to diagram — theft, glass, weather, fire, vandalism — which the
  review page had been linking to for a description that was not there.
- **A tap places the pin.** With no address to search for — a track, a field, the middle of a
  car park — tapping the location map drops the pin; with no address to reverse-geocode, the
  coordinates stand in. On a phone the map sits directly under the address box so the jump
  is visible, and while it is empty it says what to do.
- **Yes / no are buttons a thumb can hit** (`.seg`), not chips; "not sure" is stored as no
  answer, so it clears the choice rather than lighting up as one.
- **Photos have a zone**: take one with the camera, choose from the gallery, or drop them on
  desktop. Two file inputs, because `capture` on one input hides the gallery on a phone.
- **The shell says where you are** — "Step 3 of 7 · The vehicles" under the dots on a
  phone, where the step names do not fit; the reason Continue is disabled shows there too;
  each step eases in, unless the customer asked for reduced motion.

## Integration (v7)

Everything before this was the customer's page. This is how an insurer puts it on their
site and receives what it sends, in five parts, each proven by `scripts/integration-smoke.mjs`.

**Settings arrive at runtime** (`src/config.ts`). An insurer does not rebuild a Vite app to
change a URL, so the settings that differ per deployment — where to POST, the token, the
brand, the fraud notice, the assist endpoint, prefill — come from the host page's `config`
message when embedded, else from `window.CLAIM_MARKER`, else `?token=`, else the `VITE_*`
defaults. Provider settings (tiles, geocoder, vehicle database) stay build-time: chosen once
per deployment, not per customer. `main.tsx` settles the config before the first render,
because prefill has to be in the store before the vehicles step shows and the brand before
the header does. The assist client reads its URL at call time for the same reason.

**The host page is a trust boundary.** Config is accepted only from origins listed in
`VITE_ALLOWED_HOSTS`; unset, any origin is accepted and the console says so. Everything that
arrives is parsed: URLs must be http(s), strings are capped, prefill goes through
`parsePrefill`. Events go back only to the origin the config came from, and `embed.js`
checks the iframe's own window and origin on every message.

**An iframe, not a script SDK.** A script that mounts React into the insurer's page would
share its CSS, its globals and its CSP, and would put the customer's photographs in the
host's DOM. An iframe shares nothing, works on any stack, and costs one `postMessage`
channel: `ready` → `config`, then `step`, `height` (so the host sizes it and there is no inner
scrollbar), `submitted` and `queued`. `embed.js` is plain script with no build step, and sets
`allow="geolocation; camera; microphone"` on the iframe, without which none of "use my
location", the camera or dictation work inside it.

**Prefill fills what is empty, never what was typed** (`src/claim/prefill.ts`). The portal
knows the customer's name, contact, policy and the cars on the policy. One vehicle fills the
insured card; several become a "which of your vehicles?" pick on the vehicles step, and only
that explicit pick overwrites. The reporter's details land on the review page.

**Delivery is one POST that cannot lose the report** (`src/app/submit.ts`). The token as a
bearer, the document's reference as `Idempotency-Key`, three retries with backoff, and then
the outbox: IndexedDB, because a document with photographs is megabytes and localStorage
has five. It drains on `online` and on the next page load, with the token stored beside each
document because the host that minted it may be gone by then. A `4xx` other than 408, 429,
401 and 403 is a refusal shown to the customer; everything else is an outage and waits. The
server's own reference, if it returns one, replaces the page's on the done page; a queued
report shows the page's reference and says plainly that it is waiting for a signal.

**The reference server is one dependency-free file** (`server/claim-server.mjs`), like the
assist server, so it can be read in one sitting and copied into anything. It validates with
the page's own parser, built to `dist/lib/claim.js` by `vite.lib.config.ts` so the two can
never disagree. Each report is a folder: `claim.json` as received, plus every attachment
decoded to a real file, because that is what a document store and an adjuster's screen want.
The webhook carries the document without its attachments, links to the files, and an
HMAC-SHA256 signature of the raw body, and is retried three times; the receiver is told to
be idempotent on the reference. Two tokens, one for the page and one for the desk, so a leak
of the customer-facing one exposes nothing.

**The claims desk reuses the document** (`src/adjuster/`, `adjuster.html`, a second Vite
entry). `ReportDocument` was extracted from the review step so the insurer reads exactly what
the customer reviewed, minus the edit links: the map with playback, the 3D marks, the
photographs, then a "reported by" block the customer never needed. Status is three values
and a PATCH; printing is `window.print()` and a print stylesheet, which is the whole PDF story.

**The schema is published and tested** (`docs/claim-1.schema.json`, `test/jsonschema.test.ts`).
Draft 2020-12; the enums are asserted equal to the code's lists, and what `toDocument`
produces must validate, so the schema cannot drift from the page.

**Left out on purpose:** anything beyond a bearer token (the host mints it; how is theirs),
a translation layer (the copy is English throughout and would need a proper pass, not a
JSON file), and server-side PDF rendering (the desk prints; a system that needs PDFs
generated has a renderer already).

## Production (v8)

The integration was the contract; this is the deployment. `node server/claim-server.mjs` is
now the whole product on one port — the customer's page, the claims desk and the API — and
what it refuses to do matters as much as what it does.

**The settings are injected into the HTML, not fetched.** At startup the server reads both
built pages once and inserts `<script>window.CLAIM_MARKER={…}</script>` before `</head>`:
`submitUrl: '/claims'`, `claimsApi: ''` (the same origin), the brand, the assist URL, the
allowed hosts. A `/config.js` request would have been the other option and was not taken: it
is a second round trip before the page can render, and it cannot be covered by a script hash
in the CSP. Because the config is injected, `src/config.ts` resolves a relative `submitUrl`
against `location.href`, and the desk's API falls back to the injected `claimsApi` — where an
empty string means "the same origin", which is why that chain is not a plain `||`.

**One built image serves any insurer.** That is the whole point of the injection: `VITE_*`
variables become build-time *defaults* rather than the deployment, so `docker compose up` with
a different `BRAND` is a different insurer's page. `vite.lib.config.ts` gained
`publicDir: false`, which had been quietly copying `public/` into `dist/lib/` as well.

**The CSP is built once, with the hash of that script.** `frame-ancestors` comes from
`ALLOWED_HOSTS` (unset: `*`, and a warning at startup); `connect-src` lists the providers the
page ships with plus `CONNECT_SRC` extras. Two entries look like padding and are not:
`worker-src 'self' blob:`, because MapLibre's worker is a file and three's are blobs, and
`data:` in **connect-src**, because the Kenney bodies carry their texture as a data URI and
three fetches it — a browser treats that as a connection, not an image, so without it every
car loads untextured. That one was found by loading the served page, not by reading the spec.

**Sessions replace the shared token** (`server/session.mjs`, `test/session.test.ts`). A
`CLAIM_TOKEN` is the same for every customer, so a report arrives anonymous. `POST /sessions`
— server to server, `x-api-key`, and a `403` for anything carrying an `Origin` header — mints
`base64url({sub,policy,exp}).base64url(hmac-sha256)` and returns it with the prefill ready for
`ClaimMarker.mount`. The receipt and the webhook then carry `customer: { id, policy }`.
Not a JWT on purpose: a JWT names its algorithm in the token, and an algorithm in the token is
how `alg: none` happens. An expired token is a `401`, which the page already treats as "wait",
so the host renews it with `update({ token })` and the outbox drains.

**Safe by default, or it does not start.** With `NODE_ENV=production` the server exits unless
a token or a session secret is set, `DESK_TOKEN` is set, and `CLAIM_ORIGIN` is not `*`; an
unset `CLAIM_ORIGIN` in production means no CORS header at all, which is right for a page it
serves itself. `POST /claims` and `POST /sessions` are rate limited per IP before the auth
check, because a flood of bad tokens is still a flood, and answer `429` with `Retry-After`,
which the page treats as an outage and queues. Static serving refuses anything resolving
outside `dist/`, any directory, and `/lib/` — that last one is the parser this server itself
imports.

**Docker is a convenience, not the product.** A multi-stage build on `node:24-alpine` copies
`dist/` and `server/` only, runs as `node`, and keeps reports on a volume at `/data`. It was
not built or run here: Docker is not installed on the machine this was written on, so the
image is unverified and the server changes are proven by `scripts/integration-smoke.mjs`
instead.

## Two voices

The same `claim/1` document is read by two people, and until now it spoke to both as if they
were the customer: "You, driving your Camry", "Your vehicle". On an adjuster's screen that is
wrong twice over — the person is not in the room, and they are one of several parties whose
accounts the adjuster is weighing.

`src/claim/describe.ts` now takes a `Voice`. Every function defaults to `'customer'`, so the
steps and the review page are untouched by construction; `ReportDocument` takes `voice` and
the desk is the one caller that passes `'desk'`. In that voice "your"/"their" becomes "the
policyholder's"/"the other party's", "You, driving" becomes "The policyholder, driving", and
the tag beside a vehicle becomes "Policyholder's vehicle". `gaps()` stays second person: it
only ever runs on the customer's own review page.

It stayed in `describe.ts` rather than becoming a prop drilled through the document because
that is the rule the project already had — every sentence naming a person, a vehicle or a
condition comes from one file — and the voice is exactly the kind of thing that would
otherwise be re-decided inline in four places and disagree in a fifth.

**Search on the desk** is the other half: an adjuster with a caller on the line has a name, a
plate or a street, almost never a reference. One `<input type="search">` over the reference,
the customer's reference, the reporter, the address and the plates, Enter opening the first
match, Escape clearing. The server's `summarise()` gained `plates` for it, which is the only
reason the inbox row carries them.

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

## Checks and photographs

Two more tasks on the same endpoint, both optional, both off with `VITE_ASSIST_URL` unset.

**A second look, on the review page.** `check` sends the finished report back and gets at most
five short questions — the kind a claims handler would ring up about: the airbags went off but
the car is marked drivable, someone is hurt but the police were not called, no photographs at
all. Each carries the step that answers it, so the question is one click from the field.

Two decisions make it safe to ship. It **never blocks sending**: nothing in that card touches
`canSend`, because a claim held up by a machine's doubt is worse than a claim with a gap in
it, and a customer at the roadside with a bad signal cannot argue with it. And what goes over
the wire is **the shape of the accident, not the people in it** — no reporter, no names,
phones, licences, plates, VINs or insurers, and no attachments. A consistency check needs to
know that *someone* is marked hurt and the police were not called; it does not need to know
who. `brief()` set that precedent for the diagram and `CheckRequest` keeps it; the smoke walks
every key of the request and fails on any of the forbidden ones, three levels down included.

**Damage from the photographs, on the damage step.** `damage` sends the photographs of one
vehicle — six at most, the ones tagged to it — along with that body's own panel list, and gets
back rows with an "Add" button each. Nothing lands on the car until the customer presses Add,
and pressing it flips `autoDamage` to `user`, which is correct: they confirmed it.

The zone list goes on the wire because zone sets differ per body — a pickup has no rear doors —
and `parseSuggestions` re-checks it against the body anyway. **The point is always the zone's
own anchor**, never anything the endpoint sent: a model cannot see where a panel sits in the
car's frame, and a mark that misses the panel it names makes the marked-up car in the report a
lie. It picks the panel; the geometry stays ours.

`parseChecks` cuts a question to 200 characters, drops anything that is not text, keeps a
question whose `step` this page does not have (minus the link — the question may still be
good), dedupes and caps at five. Both parsers answer `[]` to garbage, like `parseScene`.

**Still deliberately not here:** a chat assistant (generic, and the steps already ask the
questions), and anything at all about fault, liability, speeds or cost — that is out of scope
of the contract, not just of the prompts. Dictation into the description box suits the "just
tell us what happened" idea and is already there: the Web Speech API, no key.

## Offline shell

The outbox already covered a report that cannot be *sent*. It did not cover a report that
cannot be *started*: the page had to have loaded first. At the roadside — a car park, a
basement, a motorway with one bar — that is the more likely failure.

`public/sw.js` is hand-written, sixty lines, and every rule in it is a decision:

- **No `skipWaiting`.** An open page may still ask for a lazily-loaded chunk from the build it
  was served by. A new worker taking over immediately would have deleted that build's cache
  and the chunk would 404 in the middle of a claim. The new shell takes over when the last old
  tab closes, which for a form someone is filling in is the right trade.
- **Precached entries are matched by path, not by request.** A reload marks its subresources
  `cache: 'reload'`, and `Cache.match` then answers nothing at all for them — a blank page
  with the network gone. Found by killing the server, not by reading the spec.
- **Opaque responses are never stored.** A cross-origin response without CORS cannot be read
  and costs about 7 MB of quota each; the runtime cache keeps only `ok`, non-opaque responses,
  trimmed to 400 entries.
- **Navigations go to the network first**, so a deploy is picked up, with the cached
  `index.html` behind it. `/adjuster*` is left alone: an adjuster with no signal has no claims
  to work on either.
- **Everything else is untouched** — `/claims`, `/sessions`, the assist endpoint. Delivery is
  the outbox's job and always was.

**The precache list cannot be hand-maintained**, because the asset names are content hashes.
An inline plugin in `vite.config.ts` takes what rollup emitted — minus the claims desk, which
is the insurer's screen and has no business on a claimant's phone — adds the files Vite copies
straight from `public/` (the environment map, the textures, the icons, the manifest), and
patches `dist/sw.js` in place. Vite copies `public/` at `renderStart`, so the file is already
there to patch. The version is a hash of the finished list, so a build that changed nothing
keeps its caches. The patch targets the two *declarations* by name rather than the bare
tokens: those also appear in the file's own doc comment, and replacing the first occurrence
there ships a worker that does nothing at all — which is exactly what happened first.

`vite-plugin-pwa` would have generated roughly this file, plus a manifest, plus a registration
helper, plus a configuration surface to learn. The whole of it here is one file of sixty
lines, one plugin of thirty, and one registration of twenty.

Registration is production-only (`src/app/offline.ts`): in development the worker would serve
a stale bundle and there is nothing to patch its list with. A failed registration is swallowed
— Safari refuses service workers in cross-site iframes, so the embedded case degrades to the
behaviour it had before this existed. On the first install a plain-DOM `role="status"` toast
says "Works offline now" for five seconds; plain DOM because it runs before React has anything
on the page.

**The proof is `scripts/offline-smoke.mjs`, and it kills the server.** Emulating offline is not
enough: a service worker's own `fetch` still reaches localhost, so a page quietly served by a
dead-but-not-dead server would pass a test that proves nothing. It waits until the whole
precache list is on the device, kills the `vite preview` *process group* (`npx` is a wrapper;
killing the wrapper leaves vite serving), goes offline, reloads, and then checks not that the
HTML came back but that the claim works: the damage step renders and the 3D car is drawn,
which needs the body, the environment map and the textures. It reads the marker's canvas
rather than a vehicle card's, because the marker is the one kept with `preserveDrawingBuffer`
— the card previews render fine and read back blank.

## A live instance

Until now nobody could see the product without cloning the repo. This is what it takes to put
the one-port server on a public URL, and what that URL has to refuse to do. **It has not been
deployed**: there is no Fly account behind it yet, flyctl and Docker are not installed on the
machine it was written on, and everything below is proven against a local server started in
production mode, not against Fly.

**Fly, because it builds the Dockerfile for us.** No Docker here means an image cannot be built
locally; Fly builds it on its own builders from `fly.toml`, gives it a volume for `CLAIM_DIR`,
TLS on a `fly.dev` hostname, secrets as environment, and stops the machine when nobody is
looking. Render does the same from `render.yaml` and is the documented alternative, at the cost
of a paid instance for the disk. The six commands are Ashish's to run
([integration.md](integration.md#deploy-to-fly)): an account and credentials are not something
to create on someone's behalf.

**Retention (`RETAIN_DAYS`), because a public demo collects strangers' photographs.** A report
older than the limit is deleted — the folder with its images, and the `by-client/` entry that
mapped the page's reference to it — at startup and every six hours on an `unref`ed timer.
Unset keeps everything, which is still the default for an insurer's own deployment where
retention is a policy decision and not this server's. The age test is a pure
`expired(receivedAt, days, now)` in `server/retention.mjs` with its own test; it never deletes
a report whose date does not parse. `/health` says what the limit is, so the live check can
report it. The integration smoke seeds a report from 2000 and asserts it is gone by the time
the server answers.

**Three things found by reading, not by deploying**, each a line:

- A Fly volume is mounted over `/data` owned by root, and the image ran as `node`: the first
  `mkdir` would have failed with `EACCES` and the machine would never have passed a health
  check. The image now starts as root, takes the reports folder for `node`, and `su-exec`s to
  `node` — what the official postgres and redis images do. Not recursive, because everything
  inside was written by `node`.
- With `TRUST_PROXY=1` the rate limit keyed on the *first* `X-Forwarded-For` entry, which is
  whatever the client sent when a proxy appends. Fly's rightmost entry is its own address, so
  "last" would have put every visitor in one bucket. It now prefers `Fly-Client-IP`, which the
  proxy sets itself, and falls back to the first entry elsewhere.
- `PORT`, `CLAIM_DIR`, `STATIC_DIR` and `RATE_LIMIT` were read with `??`, so the empty values an
  `.env` or compose's `${X:-}` produce meant port 0, the current directory (whose `index.html`
  is the Vite *source*), or zero requests a minute. They are `||` now.

**The proof is `scripts/live-check.mjs <url>`, and it needs no browser.** A deployed instance is
checked from outside with `fetch`, using the `API_KEY` and `DESK_TOKEN` it was deployed with:
`/health` up and serving the page; `/` is HTML whose CSP has `frame-ancestors` and the hash of
the injected config, which says `"submitUrl":"/claims"`; a hashed asset is `immutable`;
`/lib/claim.js` and a `%2f`-encoded `..` path are 404 (encoded so `fetch` does not fold the
`..` away before it leaves the machine); `/sessions` is 401 without the key and mints with it;
a `claim/1` built by `toDocument(emptyClaim())` from `dist/lib/claim.js` is filed with an `INS-`
reference and sent again is a `200` duplicate; the desk is 401 without its token and lists the
report with it; and the report is then PATCHed `closed`, so the inbox a prospect opens is not a
wall of test reports.

## The demo portal

A prospect could not see the product without cloning the repo, and a live URL on its own would
have dropped them on an empty form with no policy, no token and no idea what the insurer's side
looks like. `server/demo/` is the missing half: Acme Mutual's own site, served by the claim
server at `/demo/` when `DEMO=1`.

**Plain HTML on purpose.** Three pages, one stylesheet, one script, no build step — because the
thing being demonstrated is that the report embeds into *someone else's* stack. A React demo
portal would have proved nothing. The sign-in cards are rendered into `index.html` at startup
from `customers.mjs`, the same way the page's config is injected, so the sample customers live
in one file and a static page still shows them without a fetch.

**Sign-in is the insurer's backend, minus the hop.** `POST /demo/login` calls the same
`createSession(customer, vehicles, ttl)` that `POST /sessions` does — the refactor is the whole
change to minting — and answers the token and prefill that `ClaimMarker.mount` wants. There is
nobody to authenticate, so each sign-in mints a customer id of its own (`demo-<who>-<random>`):
two visitors who pick the same sample customer must not end up reading each other's reports.

**What a public demonstration must not do.** People will type real names into it. So: a receipt
minted from a demo session is tagged `demo: true` and swept after a day whatever `RETAIN_DAYS`
says; the desk's reader is scoped — `DESK_TOKEN` still reads everything, but a demo visitor
reads reports filed under their own id and nothing else, with the very session that filed them
(`claims.html` puts it where the desk looks, so the "see what the claims team sees" link just
opens). The plan had that link show the instance's `DESK_TOKEN`, which would have handed every
visitor every other visitor's photographs. The production guard is untouched: `DEMO=1` relaxes
nothing, and the portal has no business on an instance taking real claims.

**Two lines elsewhere.** `src/config.ts` now trusts a `config` message from its *own* origin: a
page on the same origin can already reach into the iframe directly, so the message grants it
nothing new, and without it the portal's iframe would have been ignored whenever `ALLOWED_HOSTS`
was set. That is why there is no `PUBLIC_ORIGIN` variable — the only thing left needing the
server's own origin is `frame-ancestors`, which gains `'self'` when `DEMO=1`. And `public/sw.js`
leaves `/demo` to the network as it already leaves `/adjuster`: the insurer's own screens are
not part of a claimant's offline shell.

**The proof is a second walk in `scripts/integration-smoke.mjs`**, which is also the first time
anything drove the *built* page rather than the dev server: `/demo` redirects to `/demo/`,
signing in as the two-vehicle customer makes the policy pick show two vehicles, the report is
filed with an `INS-` reference on `claims.html`, its link opens the desk on that report in the
adjuster's voice, and that visitor's own token lists exactly one report. `scripts/record-demo.mjs`
is the one-off that records `docs/demo.gif` from the same journey, sped up and palette-mapped
through ffmpeg.

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
