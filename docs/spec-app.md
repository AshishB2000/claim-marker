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

A third voice, `'desk-other'`, reads **the other driver's own account from their side**. In
their document their own car is `insured`, so the desk voice would call it "the policyholder's"
— the one confusion a side-by-side view must not have. In `'desk-other'` it is "the other
driver's Ford", they are "The other driver, driving …", and anyone else's car is "another
party's". `deskVoice(receipt.party)` picks it, from the side the server filed the report as —
never from the document's own `reporter.party`.

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

## Photo-first damage on a phone

Standing at the roadside with one hand free, the first thing anyone does is photograph the car.
The damage step led with a 3D model and kept the photographs in a card below it, which is the
right order on a desk and the wrong one on a phone. So on a narrow screen, **with the assistant
switched on**, the step runs photos → what we read in them → the car for anything they missed.

**Both conditions, not one.** `photoFirst = assistOn() && narrow` (`useNarrow()`,
`matchMedia('(max-width: 640px)')`). Without an endpoint the tiles would ask for photographs
and then have nothing to say about them, which is worse than the layout we had; on a wide
screen the two columns already show the car and the photographs at once. Everywhere else the
step is unchanged — the same DOM, proven against `main` by capturing the step's markup on both
and diffing it, and `scripts/assist-smoke.mjs` fails at 1280 if the tiles appear or if the
photographs are read without the button.

**`useNarrow` is `useSyncExternalStore`**, not an effect that copies `matchMedia` into state: an
effect renders the wrong layout once and then corrects it, and the compiler rules forbid the
synchronous `setState` that would hide the flicker.

**The step is three components now** (`src/app/steps/damage/`): `Capture`, `Suggestions`,
`MarkerPanel`. `Damage.tsx` only chooses the order. Nothing moved between them — the desktop
path renders exactly what it rendered before, including the suggestions card at the foot of the
side column, which is now `children` of `MarkerPanel`.

**Four named shots beat "add photos".** The damage close up, the same from a step back, the whole
side, and the other vehicle with its plate — each a tile with a line drawing that opens the
camera (`capture="environment"`) and then shows what it took. Naming the shot is what gets the
useful photograph; "add photos" gets one blurry close-up. The fourth tile is filed against the
*other* vehicle and is only offered from the customer's own car. Which tile took which photograph
is component state keyed by the data URL, so removing the photograph clears the tile and a
reload leaves the tiles blank while the photographs stay — a fair trade for keeping the
document free of a field only the tiles would use.

**Nothing is pressed to read them.** An effect keyed on the vehicle and its photographs (their
count and sizes, so a swapped photograph reads again and a caption does not) waits 1.2 s for the
burst of shots to end, then calls the same `damageFromPhotos` the desktop button calls, under an
`AbortController`. The loading state is derived — an answer whose key is not the current one is
no answer — because a `setState` inside the effect is what the lint forbids and what makes two
renders out of one. A panel already marked on the car is not offered twice, so a second
photograph of the same dent does not produce a duplicate.

**A failure is one quiet line**: "We could not read the photos this time. Mark the damage on the
car below." Nothing in the card touches Continue, and the car underneath still takes a tap — the
assist smoke proves that with a 502 and then marks the car by hand.

**`Photo.shows` links a photograph to a mark.** Adding a suggestion tags this vehicle's untagged
photographs with the zone it names (`tagPhoto`), and `ReportDocument` shows those thumbnails
beside the mark, so an adjuster reads "front bumper, crack" with the photograph it was read off
next to it. It is additive to `claim/1`: kept only when `of` is a vehicle and the zone exists on
that body, and **absent** rather than null when it is not, so every document written before it
existed still round-trips byte-identically. The caption stays the customer's.

**The three rules hold.** The mark is the zone's own anchor (`parseSuggestions`, untouched);
adding goes through `setDamages`, so the vehicle's damage becomes the customer's; nothing
mentions fault, cost or speed; nothing blocks Continue or sending.

**What none of this proves** is how well a model reads a real dent in a real photograph. The
scripts prove the contract, the parsing and the layout; the judgement needs a key,
`scripts/assist-server.mjs` and photographs of actual cars.

## Spanish

A US insurer cannot ship an English-only first-notice-of-loss form. The customer's page is
now fully Spanish; the document and the claims desk are not, and that asymmetry is the whole
design: **the customer writes in their language, the insurer reads in one.**

**No library** (`src/i18n/`). Flat keys, `{name}` placeholders, two dictionaries. `index.ts`
is pure — `translate(lang, key, vars)`, `pickLang`, `plural` — which is what lets
`src/claim/describe.ts` translate the sentences it composes while still being importable by
the server's parser. `useT()` binds the store's language for components. `es` is typed
`Record<Key, string>`, so a key added in English and forgotten in Spanish **fails the build**
rather than showing an English sentence to someone who asked for Spanish. An i18n library
would have brought a loader, a provider, an interpolation syntax and a plural engine to
replace forty lines and one type.

**Messages live in area files** (`areas/vocab|shell|start|scene|damage.ts`) because four
people translated this page at once and one enormous dictionary is one enormous conflict.
`vocab` is the shared tables — the kinds, the conditions, the steps, the paints, the seven
bodies, the 31 panels, the severities, the roles — written once so "hood" is the same word on
the damage step, the review and the marker. A key defined in two areas is a test failure.
433 keys in all.

**Spanish is not English with the words swapped.** The year goes after the model ("Toyota
Camry 2022"); "de el" contracts to "del"; and both people and cars are gendered, which a
claim form cannot know. So the sentences are built around neutral constructions — "quien
conducía", "alguien que viajaba en…" — and the other party's vehicle is named as "el otro
vehículo (…)" rather than guessing an article for "camioneta SUV". Colours follow "de color",
so one phrasing fits every body. `vehicleOf()` composes owner and name, because in Spanish
`whose` and `vehicleName` cannot simply sit side by side the way they do in English.

**What is deliberately not translated.** The enum *values* in `claim/1`; `UNKNOWN_DRIVER`,
which is data written in English whatever the customer reads and shown through
`displayName()`; the claims desk; the server's messages; `embed.js`. `ReportDocument`,
`MapScene` and the damage marker are rendered by both sides, so they take `lang` as a **prop**
defaulting to English rather than reading the store — otherwise an adjuster whose browser
happens to hold a Spanish draft would read the document in Spanish.

**The document says which language it is in.** `incident.language` is additive to `claim/1`,
defaulting to `en` for every document written before there was a choice, and the desk shows
"Reported in Spanish" beside the description. Every assist request carries `lang`, and the
reference endpoint tells the model which language to answer in.

**The language is chosen in this order:** the host's `lang` (and then the switch is hidden —
an insurer that fixed the language meant it), then what the customer chose before, then the
browser, then English. It is stored in the draft (persist v6) and stamped into the document,
so a report queued offline in Spanish is still Spanish when it leaves.

**Two things that only showed up on screen.** `severity.missing` was "falta la pieza" — three
words, and the marker's picker is `text-transform: capitalize`, so it read "Falta La Pieza";
one word fixed it. And the "Punto de impacto" badge is twice the width of "FOUND", which
squeezed its heading onto two lines until the badge was allowed to wrap.

**The risk, stated plainly:** the Spanish is correct, neutral and Latin American, but
insurance wording varies by market and by state, and **a native claims person should read it
once before an insurer sees it**. The Spanish fraud notice is a plain-language translation and
is *not* legal text; a host must supply its own state's wording, and `fraudNoticeFor()` hands
back whatever it supplies untouched.

## The scene fills itself in (v9)

Every claim form in the world asks the customer what the weather was like. They were in a
crash; they are answering from memory, at the roadside, on a phone. The place and the time are
already in the document, and from those two facts the weather at that hour, the position of the
sun and the road itself are all a matter of public record. So the page looks them up and the
customer **confirms** instead of typing, and the adjuster receives facts no customer would have
given.

**The time had no zone.** `incident.at` is a bare local `YYYY-MM-DDTHH:mm`, which is a wall
clock, not a moment — and both the weather archive and the sun need a moment.
`incident.utcOffset` (minutes east of UTC) makes it one. It is filled by the weather lookup,
which has to resolve the zone for the coordinates anyway; `instantOf(at, utcOffset)` is the
pure reader and returns null without an offset. Taking the browser's own zone instead would be
assuming the customer is standing where their phone is, which after an accident on holiday is
exactly wrong.

**Three keyless sources**, each its own pure module under `src/scene/`, each tested against
recorded fixtures with no network in the test:

- `weather.ts` — Open-Meteo. The archive (`archive-api.open-meteo.com`) for anything older
  than five days, the forecast endpoint with `past_days=7` otherwise, `timezone=auto` so the
  hourly timestamps come back in the incident's own local time and the hour matches `at` by
  string. `toConditions` maps the WMO code to the `WEATHER` enum and works the road state out
  of the last two hours: snow codes → `snow`, at or below freezing with recent precipitation →
  `icy`, any precipitation in the last two hours → `wet`, else `dry`. That two-hour window is
  the whole point — a road is still wet after the rain has stopped.
- `sun.ts` — the NOAA solar-position approximation, forty lines and no dependency. Altitude
  and azimuth, then `lightFrom(altitude, lit)` (above 6° daylight, −6°…6° dusk, below that
  dark — lit or unlit according to the road's own `lit` tag) and `glare(sun, heading)`, true
  when the sun was under 25° up and within 25° of straight ahead.
- `road.ts` — Overpass, one query inside 60 m, against the Kumi Systems mirror because
  `overpass-api.de` answers 406 to whole networks, `/api/status` included. The nearest way gives the name, class, lanes,
  direction, posted limit and whether it is lit; the ways meeting within 25 m give the
  junction (`none`, `T`, `cross`, `roundabout`) and the nodes give what controls it. It also
  returns the ways as GeoJSON, which is what the diagram draws.

**`incident.context` is additive and separate from `conditions` on purpose.** `conditions`
stays the customer's own answer — it is what they signed. `context` is what the record said,
and the two sit side by side on the desk. The lookup *fills* the three selects, and
`autoConditions` is exactly the bargain `autoDamage` already makes for the damage marks:
`auto` means the lookup put it there and it still follows the place and the time; touching a
select makes it `user` and it is the customer's for good. A select the customer had already
filled is never overwritten, whatever the record says.

**"Still looking it up" is derived**, not stored: `contextKey` is the place (to four decimals,
about eleven metres) and hour the store has an answer for, and a mismatch with `sceneKey` of
the current incident *is* the loading state. There is no second flag to keep in step with a
fetch, which is the same rule the photo-first suggestions follow. `contextKey` and the road
geometry are deliberately not persisted: sixty metres of public map is cheap to ask for again
and a cache of it can only go stale.

**On the diagram**, the ways are drawn as a road under the cars — width in ground metres from
the lane count, so it keeps its real width as the map zooms — on the satellite and street
grounds only. On the drawn parking lot and the blank sheet there is no real road to draw and
putting one there would be a lie. When a car is dropped within three metres of a way and
already within thirty degrees of its line, a chip offers to line it up; accepting turns the
car and **never moves it**, because moving a customer's car for them puts words in their mouth
about where it stopped.

**Every one of the three may fail, and nothing depends on any of them.** A blocked host, a
429, an empty answer: the card does not appear, the selects stay empty, and the step is exactly
what it was. `scripts/smoke.mjs` proves that path by blocking the three hosts outright.

**The honest limits.** Open-Meteo's archive is a reanalysis model on a grid of a few
kilometres, not a weather station in that street: it is right about "it was raining at five"
and says nothing about a squall over one junction. OpenStreetMap is as good as whoever mapped
that corner, and outside well-mapped cities the lane count and the posted limit are often
simply absent — which is why every field is nullable and the card prints only what came back.
Neither is evidence; both are context, and the report labels them "from public records" so
nobody mistakes them for the customer's answer.

**That block reads the record and nothing else.** `lookedUpLines(ctx)` takes no conditions: the
weather from its code (`weatherOfCode`, or the archive's own label for a code it does not
list), the road from that hour's precipitation (`roadOfRecord` — the two hours before it that
`toConditions` used are not kept, so a dry hour says "no rain or snow that hour", not "dry
road"), the light from `lightFrom(sun, road.lit)` — "after dark" when the street's lighting is
unknown. Earlier it followed the customer's selects, which put their account under "public
records" exactly when the two disagreed. A lookup for a new place that has no answer for a
select the old lookup filled clears it, rather than leaving the old place's weather marked as
ours.

## Photos that report for you (v9)

A photograph taken at the scene already knows where and when it was taken. The page reads
that, uses it, and throws the coordinates away.

**Read it before it is destroyed.** `shrink()` re-encodes every photograph through a canvas to
get it down to 1280 px, and a canvas keeps no metadata at all. So `addPhotos` reads the
original bytes first: `src/claim/exif.ts` walks the JPEG's segments to the `APP1` "Exif" block,
reads the TIFF header in **either byte order**, and picks out `DateTimeOriginal`,
`OffsetTimeOriginal` and the GPS IFD. About a hundred and twenty lines, no dependency, and
nothing in it throws — a truncated file, a nonsense offset, a zero denominator in a rational
all come back as "it did not say".

**The document records distances, never coordinates.** `Photo.minutesFromIncident` and
`Photo.metresFromScene`, both rounded, absent when the photograph said nothing. This is not a
nicety: a picture chosen from the gallery can carry the customer's home, their child's school,
every place they have been. What a claim needs is "taken two hours later and four hundred
metres away", and that is exactly what it gets. The position itself lives in
`store.photoExif`, in memory only, never persisted and never sent; `scripts/smoke.mjs` walks
every photograph in the sent document and fails on anything coordinate-shaped.

Those distances **follow** the claim: move the pin or change the time and every photograph
still holding its metadata is re-measured. A draft reopened tomorrow keeps the numbers it was
given and simply stops following, because the metadata is not on disk to re-read.

**A third way in.** On the Where step, beside search and "use my location": start from a photo
you took. If it carries a position it is offered **rounded to three decimals** — "that photo was
taken near 40.757, -73.986, 17:42" — and only once the customer taps "use that" is the position
sent to the geocoder for its address and put on the claim. A gallery photo may have been taken
at home; until they agree, its coordinates go nowhere. The offline shell never caches Photon's
`/reverse`, whose query is a raw position, so no position outlives the report in Cache Storage. Offered, never
relied on: **iOS strips the location out of a picked photo unless the customer has granted full
library access**, and a camera-capture input frequently carries none at all. When it says
nothing, the page says so plainly and keeps the photograph anyway, because a photograph of the
scene is worth having either way.

**The live camera guide** (`src/app/steps/damage/CameraGuide.tsx`) opens from the four guided
tiles when `getUserMedia` exists — a phone. A full-screen sheet with the real camera behind an
SVG frame for the shot being asked for: a box for the close-up, the body's own side silhouette
for the whole side, a plate-shaped box for the other vehicle. Every 300 ms it draws the frame
into a 160-px greyscale canvas and runs `src/claim/photoQuality.ts` over it: the variance of a
3×3 Laplacian for blur, the mean and the clipped fractions for exposure. "Hold still", "Too
dark — turn on the light or move", "Step back a little".

**Those are hints and never gates.** The shutter is always enabled. A blurry photograph of real
damage beats no photograph, and a form that refuses to take a picture at the roadside because
it does not like the light is a form people abandon. The shutter draws the full-resolution
frame to a canvas and hands it to the same `addPhotos`, so the downscaling, the cap of twelve
and the photo-first suggestions all behave exactly as they did. Everything that ends the
session — a rejection, Escape, the close button, unmounting — goes through one cleanup that
calls `track.stop()`: `scripts/assist-smoke.mjs` wraps `getUserMedia`, keeps every track the
page was handed, and fails if one is still live after the sheet closes. A page that leaves the
camera light on is a page an insurer stops piloting.

Where `getUserMedia` does not exist the old hidden `<input capture>` path runs, unchanged, and
a camera that refuses to open falls back to it for that tap. The desktop card never opens the
guide: a laptop webcam pointed at a bumper is not a thing that happens.

## What the desk sees, and the customer never does (v9)

An adjuster opening a report wants one thing before they read it: is there anything here worth
a second look? Two independent things can answer that without an AI and without an accusation.

**Three rules hold over all of it.** The customer never sees any of it — `test/desk-only.test.ts`
walks every file under `src/` and fails if anything outside `src/adjuster/Desk.tsx` imports
`plausibility.ts`. The words *fraud*, *fault*, *liability*, *blame* and *suspicious* appear
nowhere, in no code, no message and no comment; a test greps the module's own source for them.
And nothing here blocks or delays a report: it is computed after the fact, on the desk's side.

**The diagram checked against itself** (`src/claim/plausibility.ts`, pure geometry). The panel
marked as damaged against the side the point of impact is on, in the car's own frame. A route
whose last leg arrives from behind the car's nose. Marks on a vehicle standing further from the
impact than its own bodywork reaches. Two bodies drawn a metre into each other. A rear-end
where the panels say the opposite. The customer's stated conditions against what the public
record said. A photograph taken before the stated time, or half a kilometre away.

Each is a `look` or a `note`, each carries its own evidence in numbers, and the phrasing is
what an adjuster could read aloud to the customer without embarrassment — because the usual
explanation for every one of these is somebody mis-remembering a bad afternoon. A car really
can end up facing the way it came after a spin; a memory of the weather is the least reliable
line on any claim form, which is why that one is only ever a `note`.

**The same thing seen before** (`server/signals.mjs`). The claim server keeps three
append-only indexes under `CLAIM_DIR/index/`: photograph fingerprints, VINs, plates, each line
`{ key, reference, customer, at }`. A new report is compared against them *before* it is
recorded: a photograph within six bits of one on a different report, a VIN or plate filed under
a **different** customer id, or three or more reports from one customer inside ninety days. The
result rides on the receipt as `signals`, which is the insurer's own record and never part of
`claim/1`.

Two VINs under the same customer are just that customer's car and say nothing. A null customer
id does not match another null. The retention sweep prunes index lines with the folders they
name, so forgetting a report forgets it here too.

**The fingerprint's ceiling, stated.** It is a difference hash computed **in the page**, at
downscale time, because a server with no dependencies has no image decoder. A determined sender
can put any sixteen characters there. It is marked `ponytail:` in `src/claim/photos.ts` with
the upgrade path — hash server-side with an image library and ignore what the page sent — and
it is worth having as it stands, because the case it actually catches is the same picture sent
twice, which is nearly always a duplicate submission rather than anything else.

**On the desk**, all of it is one "Worth a look" card above the document, with a quiet "Nothing
stands out in the diagram or the photographs" when there is nothing, and a small count on the
inbox row. `ReportDocument` gains nothing: it is the one rendering both screens share, and the
customer renders it too.

## Both drivers, one accident (v9)

Every claim form in the world takes one side of the story. The other driver is standing three
feet away with a phone in their hand, and nobody asks them anything.

**The invite is a QR code, at the scene.** "Ask the other driver to add their side" on the
diagram step and again on the done page: the page POSTs a seed to `/incidents`, gets back a
link and a signed token good for 72 hours, and draws it as a QR code with the URL underneath
and `navigator.share` beside it. The other driver points their camera at it and is filling in
their own account, on their own phone, with no app, no account and no email address anyone has
to spell out over traffic noise.

**What they are given is a seed, and it is a short list.** Where, when, the zone, the ground to
draw on, and the shapes and colours of the inviting customer's cars. No names, no phone
numbers, no licences, no plates, no VINs, no people, no damage, no description, no photographs,
no reference. The server stores only those keys and `src/claim/seed.ts` parses only those keys,
so the two ends agree; `test/seed.test.ts` builds a seed out of a *complete* report and fails
on any trace of it.

**Their page is the same page.** `?party=<token>` from the URL only — never from a host page's
config message, because a host that could name a party token could read an accident that is not
theirs. In their document their own car carries role `insured`, which schema-wise means "the
reporter's vehicle", so all seven steps, the damage marker and every sentence in `describe.ts`
work unchanged. The differences are copy, selected by `reporter.party`: the header says "Add
your side", the policy field becomes "Your own insurer and policy number". The attestation is
word for word the same, because it is the same promise.

**Their draft is their own.** The party page keeps its draft in a slot of its own,
`claim-marker/draft/<INC-…>` (`draftName`, read from the URL before any config loads), so opening
a link never touches the report already on that phone — the other driver's own unsent claim, or
the inviting customer's, tapping their own link to check it. It seeds **once per incident**: a
reload or the bus home picks up a stored draft only when it is the other driver's for this
incident (`partyDraftFor`); anything else in that slot starts again from the seed.

**A link that cannot be opened says so.** Expired after its 72 hours, forged, or the server out
of reach: the page shows "this link has expired or cannot be opened — ask the other driver for
a new one" instead of a form that could never be sent. And a party token refused at send is
`Rejected`, with the same words, rather than queued: nobody can renew it, so retrying it for
ever would lose the report quietly, which is the one thing the outbox exists not to do.

**The invite is kept.** `{ incident, url, expiresAt }` lives in the draft beside
`incident.shared`, so the scene step after a reload, and the done page, show *that* code again;
nothing offers to mint a second incident the other driver never saw. The done page offers no
invite for a report still in the outbox — its reference is the page's own, which the server has
never heard of.

**The two accounts meet on the desk.** `GET /incidents/:id` hands the adjuster both, and
`src/claim/compare.ts` lays them side by side: where, when, where each car came to rest, which
way each was facing, the direction each came from, the point of impact, the panel each account
says was hit, who was in each car, the police, who was hurt, the conditions. Rows land in
*agree* or *differ* against named thresholds, and anything one account speaks to and the other
does not is listed separately rather than counted as a disagreement. The place and the time
are marked **seeded** when the other driver's answer is still exactly the one their page opened
with: "agree" there only means they left it. The columns are ordered by the **receipt's**
`party`, which the server sets from the token; the inbox shows the accounts of one incident as
one row, "2 accounts".

Matching the two accounts' vehicles is a **mirror**: the customer's car is `insured` in their
document and `other` in the other driver's. The pairing is confirmed by body and colour before
it is trusted, and an unconfirmable pairing leaves both cars unmatched rather than comparing
the wrong two.

**It never says who is right.** A difference is a difference; two people remember a two-second
event differently, which is the ordinary case and not a remarkable one. The words fraud, fault,
liability, blame and suspicious appear nowhere in `compare.ts`, which is a test — and so is the
fact that "reliable" contains *liab* and "default" contains *fault*.

**What a different backend needs.** `incident.shared` and `reporter.party` are in `claim/1`,
so an insurer running their own stack can link two accounts themselves from the documents
alone, whether or not they use the endpoints here. That is written down in
[docs/integration.md](integration.md).

## The replay as evidence (v9)

The diagram's still PNG says where the cars ended up. The playback says the order it happened
in — who was moving, who was already in the junction, which way each came from, and when they
met. That is the part of an account an adjuster most often has to ring up and ask about, and
the page already draws it; it only needed keeping.

**Recorded at send time** (`src/map/record.ts`). The cars are drawn into MapLibre's own canvas,
but the ID pills and the impact cross are DOM markers, which is why the PNG export has always
painted them by hand. The recorder shares that painting rather than copying it: a 960×540 2-D
canvas, and every animation frame is the map's canvas, the pills and the cross at their
*projected positions for the current poses*, a thin progress bar and a caption. It drives the
car layer through the same `poses` the on-screen playback uses — there is one animation, not
two — then `captureStream(30)` into `MediaRecorder`, one run of `durationOf(vehicles)` plus a
700 ms hold so the impact is on screen long enough to see.

The codec is the first the browser offers of VP9, VP8, plain WebM, then MP4: Chrome and Firefox
record WebM, Safari records only MP4, and whichever it is the server files it by its own type.

**Never at the report's expense.** Recording races an 8-second ceiling; losing the race, a
browser with no `MediaRecorder`, nothing to play, or a file over the 4 MB cap all send the
report without it, silently. The customer never sees an error about a video. It is not
persisted in the draft — like the PNGs it is made fresh at send time — and the server unpacks
it beside the diagram as `replay.webm` or `replay.mp4`, served with that type and listed in the
webhook's files.

**On the desk** the adjuster gets the recorded video under the live playback, with a
frame-by-frame step, because "was the red car already moving when the van pulled out" is
answered by stepping, not by watching. With two accounts of one accident, "Play both" drives
both sets of cars from one clock so the two versions move together on one map.

**What the smoke proves.** Not that a file came back, which a recorder of a black rectangle
also manages, but that the frame in the middle of the video is a real picture: it decodes the
attachment into a `<video>`, seeks to half way, draws it to a canvas and counts distinct colours
exactly as it does for the PNGs.

## Watch it: the cinematic replay (v10)

"Play it back" is a diagram in motion: flat, north-up, the cars sliding along their routes.
It is exact and it is dull, and an adjuster reading it has to work out for themselves which
car was where when. "Watch it" is the same playback with the camera let off the leash: it
holds the overhead for a moment, tilts to 55° behind the customer's own car looking the way it
set off, follows it, slows to a quarter speed into the impact and out of it, rings the impact
with a shockwave, holds, and comes back to the flat diagram exactly as the customer left it.
Nothing in the document changes. It is the same routes and the same `posesAt`; only the camera
and the clock are different.

**The map is never edited tilted.** `MapScene` is built as it always was — `pitch 0, maxPitch
0`, rotation disabled — and takes a `mode` prop that defaults to `'diagram'`, so every caller
that does not ask is unchanged. In `'cinematic'` mode, and only while `poses` is set, it raises
`maxPitch` to 60 on the live map instance, drives the camera with `jumpTo` every frame, and on
the last frame — or a Stop pressed mid-chase — jumps back to the view it captured at the first
frame, drops `maxPitch` to 0 and clears its decoration, *before* the markers return. So the
DOM-marker interaction, whose maths assumes a flat map, never meets a pitch; the desk's
read-only map (`interactive={false}`) gets the same treatment, which is why `maxPitch` is set at
playback start rather than at construction.

**One clock, held rather than derived.** `usePlayback` used to compute `t` from
`performance.now()` each frame. Now it keeps the playback's own time in a ref, in ms, and
advances it by the wall clock's delta times a `rate`; that is what makes `seek(t)` a one-line
assignment and slow motion a number. The pure parts are in `src/map/playback.ts`: `Timeline`
(`ms` from `durationOf`, and the impact as `impactT` and `impactMs`), `frameAt`, `seekTo`,
`advance`, the shot list and the camera. The record (`src/map/record.ts`) and the desk's "Play
both" (`Compare.tsx`) import `ease` and `HOLD_MS` from there too, so there is one curve and one
hold, not three copies.

**The impact time is the closest approach.** `impactTimeOf` samples sixty moments of the drive
and returns the earliest at which the nearest two vehicles are nearest. A car with no route
stands at its resting position, so one route into a parked car works the same; two cars that
drive to rest touching meet at `t = 1`; a T-bone whose routes cross before either stops meets
where they cross. Nothing else on the page needs to know this yet — the two-account replay and
the reconstruction scene will — which is why it lives on the `Timeline` rather than inside the
camera code.

**The shot list is pure and in order by construction.** `shots(vehicles, timeline)` returns
keyframes on the playback clock: overhead for 0.8 s; the chase (pitch 55°, zoom 20.5, bearing =
the customer's car's initial heading, centre 4 m behind its pose each frame) blended in over
0.9 s; the rate dropped to 0.25 from 0.6 s before the impact to 0.3 s after; the hold; then the
overhead blended back over 0.9 s. When the impact comes early — a short drive is
1.5 s, less than the overhead and the ease together want — both shrink in proportion to the
time there is before the slow-motion, the ease to no less than 250 ms (a cut is not an ease),
and the slow-motion keeps its full 0.9 s around the impact wherever the clock allows, so the
keyframes stay strictly in order — two on one tick is how the ease, or the slow-motion,
silently disappears — and the rate always drops to a quarter at the impact. `cameraAt` interpolates
between the running shot and the one before it — both evaluated at the *current* poses, so a
blend out of the chase starts from wherever the car is now, never from a stale frame.
`shotAt().rate` is what the hook multiplies its rate by, and what `MapScene` reads to light the
trails; the two never disagree because they read the same list at the same clock.

**The shockwave is decoration.** `CarLayer.setDecor(decor)` lets the scene hold extras besides
the cars — each an object standing at a `[lng, lat]` with one model unit being so many metres,
placed through the same `vehicleMatrix` as a body and wound the other way once, like a body,
or the map's mirrored projection would cull it. The ring is a flat unlit white annulus,
untone-mapped so it is white and not the tone mapper's grey, scaled from 0 to 8 m and faded
over 600 ms of *playback* time from the impact (so at a quarter speed it takes 2.4 s of wall
time, which is the point). During the same window the travel paths' white flow line widens from
3 px to 7 and its dashes advance every frame instead of every 70 ms — light trails. The ring
never appears in a PNG export, because exports are taken outside playback and playback ends
with `setDecor([])`.

**Reduced motion** (`prefers-reduced-motion: reduce`) turns "Watch it" into "Play it back":
the hook checks it at `start`, so no caller has to.

**What the smoke proves.** It presses "Watch it" on the diagram and polls the live map at
20 Hz until the markers are back: the pitch must have reached above 40°; the share of
near-white pixels in a box around the projected impact must have peaked well above its median
over the run (the ring, not a bright rooftop); the pitch and bearing must be exactly 0 after;
and every car marker's screen position must be within a pixel of where it was before. Then it
presses it again on the review's read-only map, which is the component the desk renders, and
checks the tilt and the return there too.

## The moment, lit as it was (v10)

The cinematic replay tilts the map and chases the car, and a tilted map lit by a fixed
studio light from the east-north-east, at noon, in any weather, looks like a diagram with a
camera on it. The record already says where the sun stood, what the weather was doing and
whether the street was lit — `incident.context`, looked up from the place and the time. So
the scene lights itself from those facts: the sun where it was, real shadows on the ground
that lengthen into the evening, a wet road and rain when it rained, snow, fog, headlights and a
warm pool under a street light after dark. Long evening shadows are what sell the time of day.

**One pure function, two scenes.** `lightingFor(context)` in `src/scene/lighting.ts` turns a
`SceneContext` into a `Lighting`: the sun as a unit vector in the map layer's frame (x east,
y south, z up — `[cos alt · sin az, −cos alt · cos az, sin alt]`), whether it is up under a
sky clear enough to cast a shadow, its intensity (the map's own 1.5 from 25° up, falling to a
quarter at the horizon, off once set, and dimmed by rain, snow, fog or overcast), its colour,
the hemisphere sky and ground colours and intensity in three buckets — day, orange below 10°,
blue below −6°, the same line `lightFrom` draws for "dark" — how much of the environment map
shows, and five booleans: `rain`, `snow`, `fog` (through `weatherOfCode`, the one table for WMO
codes), `night`, and `lit` (night on a road the record says is lit). `lightingFor(null)` is
`DEFAULT_LIGHTING`: exactly the fixed light the map has always had, and the file has no value
imports of three or maplibre, so `test/lighting.test.ts` runs in plain node. The car layer
(`CarLayer.setLighting`) and the damage studio (`Scene`'s `lighting` prop, through
`DamageMarker`) both read it — the studio's `Environment` intensity and its two directionals
take the same sun and weather, with the sun turned into the body's frame, so the marked-up car
on the review page is lit like the map above it — with a floor. That render is the evidence:
`attachments.damage` is exported from it at send time and the desk reads it, and a claim filed
at night must not ship a black car. `studioLight(l)` keeps the studio's key at no less than
0.45 of its own 1.1 and the environment at no less than 0.4 of its 0.9, whatever the record
says; the map has no floor, because the map is the moment. `MapScene` and `ReportDocument` take the
prop; the customer's page memoises it from the store, the desk from the receipt's document,
and every caller that does not ask — the desk's `Compare`, the damage step's marker — is
unchanged.

**Real shadows, inside MapLibre's context.** The layer had no ground for a shadow to land on
and faked one with a soft disc. Now a `ShadowMaterial` plane at 0.35 opacity lies under
everything, the directional light casts a 2048² PCF shadow map, and every real car's meshes
cast; the blob stays only for a ghost, and for whenever there is no sun to throw a real one.
Three things about doing this in a custom layer are easy to get wrong, and are in `CLAUDE.md`:
the scene is in mercator units, so the shadow camera's bounds, near and far, the light's
distance, the fog's reach and every lamp's throw are set in metres times
`metresToMercator(lat)` and refitted when the origin moves (`fit()`); the shadow pass renders
back faces by default and the kit's bodies are open shells with no floor, so from a high sun
the depth map held a sliver of door lining and no shadow at all until the car materials'
`shadowSide` was set to `DoubleSide`; and the shadow pass restores the viewport three believes
the canvas has — its size at creation — so `render()` sets three's viewport from the drawing
buffer before rendering, or a resized map draws the cars in the wrong corner. MapLibre restores
its own viewport after the layer (`setBaseState`); this is for three's main pass, which draws
straight after the shadow pass with no other reset in between.

**Everything at ground level is one group in a body's frame.** The shadow ground, the wet
road, the fog sheet, the street-light pool and the rain are built in the same y-up metres frame
as a car and placed at the incident by the same `vehicleMatrix`, so one unit is a metre there
too and the map's mirrored projection is answered once, by `reverseWinding`, exactly as a body
is. The wet road is a dark, near-mirror (`roughness 0.05`), translucent plane under the cars,
so the sky and the lamps reflect in it; the rain is six hundred short vertical lines in one
`LineSegments`, scattered through a box twice the fall height and slid down by up to one height
each frame, so the visible band is always full — snow is the same lines a quarter as long, white,
at a sixth of the rate; fog is `scene.fog` on the cars plus a white sheet at 30 % over the
ground, in the layer rather than the DOM, so the export and the recorder get it for free and the
DOM pills stay legible. After dark each real car has two `SpotLight` headlights at the corners
of its nose, always on — whether a car faces the camera is not worth a check — and a street-lit
road adds a warm additive pool and a warm `PointLight` over the incident. Those lights decay in
mercator units, where 1/d² clamps to its ceiling everywhere inside the throw and only the
distance cutoff shapes the pool: flat with a soft edge, which is what a headlight on wet tarmac
looks like anyway; the intensities are tuned to that ceiling and say so.

**All of it is decoration.** Nothing here moves a car, a heading, a mark or the impact, and
nothing reaches the document: `export()` captures the canvas, so the PNGs and the replay hold
the light as it was, and that is the whole of it. "Plain view" is one chip on the diagram step
and the review page, `plainView` in the persisted store — how the customer is looking, like
the language, never in `claim/1` — and while it is on every scene on that page is lit as it
always was.

**What the smoke proves.** The main walk presses "Plain view" the moment it reaches the
diagram: its pixel gates — the path's blue, the car's red, the shockwave's white — sample a
map that would otherwise be lit by the live record, the sun at eight that morning under that
day's weather, and a build gate must not depend on the season or on somebody else's answer.
The light as it was is proved on its own seeded pages instead — the same tiles, the same two
cars six metres either side of the impact, facing each other — under four lights. Rain after
dark: the open road ten metres south must read darker than in plain view (the tiles never
change, so the difference is the layer's), the ground ahead of A's nose brighter than behind
its tail, and the canvas the export captures a picture. The same night on a street the record
says is lit: six metres from the incident, inside the pool and outside every headlight, must
read brighter than the same spot unlit. A clear sun on the horizon: the ground between the
cars must read darker than plain — the shadow — while the open road reads the same, so it is
the shadow and not a veil; and with A's body hidden for a moment, the tiles under it read bare
there and darker in plain view, where the faked shadow is back. Then "Plain view" must bring
the road back, be in the draft, and still be pressed after a reload. The unit test pins the sun vector by quadrant and length,
the intensities at 60°, 25°, 12.5°, 2°, 0° and below, the three sky buckets by channel order,
which codes mean rain, snow and fog, and when the street counts as lit.

## Real damage on the car (v10)

A mark on the car used to be a pin: a numbered disc at the tap, the paint under it untouched.
The report said "dent, left front door" and the picture showed a perfect door with a badge on
it. Now the paint shows the damage: a dent is a dish in the bodywork, a scratch bares the metal,
a crack spreads across the glass, and a missing part is a hole into the dark. The same car, marked
the same way, in the studio, on the review page, on the desk and on the map.

**Not geometry.** The kit's bodies are a few thousand triangles, and pushing vertices into a
dent makes a pyramid. The precedent is the zone tint in `Car.tsx` — a world-space radial
falloff patched into the material with `onBeforeCompile` — and the damage is the same idea per
mark: `src/marker/damageUniforms.ts` packs the marks as flat typed arrays (twelve at most —
`MAX_MARKS`; the rest keep their pins), and `src/marker/damageShader.ts` patches every material
of one body instance to read them. The packing is pure and has no value import of three, so
`test/damageUniforms.test.ts` runs in plain node; the shader module is the only thing that
turns it into GPU state, and it composes over whatever `onBeforeCompile` a material already has,
which is how it stacks on the studio's tint without either knowing about the other.

**One frame for both scenes.** The marks are compared in the body's own frame — metres, nose
+Z, up +Y — carried from the vertex shader as `vCmBody = (transformed + offset) × PROPORTION`,
where `offset` is where the mesh sits in its body (a wheel at its arch; the kit's nodes carry
translations only). In the studio, world *is* that frame. On the map the car stands anywhere,
mirrored by `CAR_BASIS` and 1e-7 to the metre, and none of that reaches the shader: the same
uniforms draw the same damage wherever the car goes, with nothing to update when it moves. The
one place the frames meet is the dent's normal tilt, a direction in body metres that has to
become a view-space one — through `mat3(modelViewMatrix)`, a varying, and renormalised, because
through the map's matrix that direction comes out 1e-7 long.

**What each kind does.** A *dent* (bodywork: paint, trim, plastic) is a cosine dish scaled by the
mark's weight: the normal tilts toward the centre, the albedo darkens 15 % toward it, the
clearcoat is cut to a fifth so the reflection breaks, the roughness rises. And it is lit from
above whatever the scene does — the upper lip darkens and the lower brightens in the albedo
itself — because the studio's environment map is near-uniform at the angles a door reflects,
and a tilted normal alone under it barely showed. A *scratch* (bodywork) is three ragged
streaks of different lengths along the panel's own horizontal — across a hood or a roof, along
everything else — hashed for their edges and gaps, bare metal (grey, roughness 0.6, metallic) in
the streak and a darker groove beside it so it shows on light paint and dark. A *crack* (glass,
headlights, taillights) is Voronoi cells and a few spokes spreading from the point in the panel's
tangent plane, their edges emissive and rough, fading by the radius. A *missing* part is the
whole zone — its measured anchor and reach from `zones.ts`, the same data `probe-zones.ts`
proves, not the tap — painted an unlit cavity colour after tone mapping, darkening to a third
toward the centre with a torn rim. **Not a discard**: the kit's shells have no floor, so a
discarded hood seen from the map shows the road through the car. A missing *wheel* is its own
code on the wire (`KIND_MISSING_WHEEL`), taken by the wheel's materials and no other, so a
missing fender leaves the tyre beside it alone.

**Before/after, and the severity map.** `strength` blends every effect from none to full and
`heatmap` swaps the paint for a blue-to-red gradient of accumulated weight; both are
`MarkerStore` state, defaulting to full and off, never persisted and never in the document.
`DamageMarker` shows them as chips over its canvas (`tools`); the customer's damage step and
the desk have them, the customer's review page does not — that canvas is exported as
`attachments.damage` at send, and a slider left at zero would ship the car unmarked. On the
map the layer draws at full strength with no map, because a diagram is not a place to argue with.

**The pins.** Where the paint shows the damage, the customer's marker (`dots`) shrinks the pin
to a dot without its number; from the thirteenth mark on it keeps the numbered pin, since the
shader has stopped. The desk's and the review's pins stay numbered beside their numbered lists.

**The map clones everything.** `instanceBody` gave every car its own paint and shared the rest
of the template's materials; a uniform patched into a shared glass material would crack every
windscreen on the map. `CarLayer` now clones every material once per car (`ownMaterials`),
dresses it, fades it if it is a ghost's, and patches it; `CarPose.damages` carries the marks,
`posesOf` and `posesAt` both fill it, so a replay of a dented car is a dented car.

**What the smoke proves.** On the damage step it blends the dent away through the real slider
and reads a ring round the mark — lighter without the dent than with it — and diffs the frame
the export takes against the unmarked car's by more than the pin. It marks the left front door
missing at its own anchor and reads the cavity just below the dot: dark, and warmer than glass
or a tyre. On the review page the missing door's cavity pixels rise with the strength set
through the store — there is no slider there, which is also asserted — and on the desk, its API
answered from the document just sent, the same rise, with the slider and the severity map
present. The unit test pins the packing: a dent at its own point in the body's metres, a
missing part at its zone's anchor and reach, the wheel's own code, the cap at twelve.

## The reconstruction in your hands (v10)

The map is a diagram seen from above, and the marked-up car is one car alone in a studio. An
adjuster reading a collision wants the two together: the cars standing where they stopped, in
their own paint, with their own damage, and a way to walk round them. The reconstruction is
that — every vehicle on the diagram stood in the damage marker's studio where the map put it,
orbitable, and nothing else. It is a third tab on the desk, and a small version under the map
on the customer's review page, because it is one component.

**One placement, the map's.** `placeVehicles(vehicles, impact)` in `src/marker/place.ts` is
pure and gives each car `{ id, position, rotationY }` in the studio's frame — three's y-up,
metres, the impact at the origin, **east +x and north −z**. The offset is the map layer's own:
the `mercator` difference from the origin that `vehicleMatrix` translates by, divided by the
metre at the impact (`metresToMercator`), so a car stands exactly where the diagram drew it;
mercator runs (east, south) and so does the studio's (x, z). The heading is the same compass
bearing: the body's nose is +Z, three's rotation-y turns +Z to (sin r, 0, cos r), and the nose
must point at (sin h, 0, −cos h), so `rotationY = π − h`. The map needs `CAR_BASIS`, with its
determinant of −1, because mercator's (east, south, up) labelling is left-handed; the studio's
frame is right-handed like the body's, so here a plain rotation puts the car's left on its
left. `test/place.test.ts` pins two cars at known offsets, the four compass points, and — for
four cars at arbitrary offsets and headings — the offset, the nose and the car's left against
`vehicleMatrix` itself, so the two scenes cannot drift apart.

**The studio is shared, not copied.** `src/marker/Studio.tsx` is what `Scene.tsx` used to
build inline: the photographic environment, the key and fill lights (with the moment's
`lighting` from `lightingFor`, floored by `studioLight` as the marker's is), the reflector
floor, the grid and the contact shadows, with the cars under the same `Suspense` as the
environment. Two props differ between the scenes: `keyAt`, because the marker's body frame has
its nose north and the reconstruction has north at −z, so each turns the sun into its own
frame; and `reach`, how far out the floor, the grid's fade and the shadows must look right —
sixteen metres for one car, a little past the camera's distance here. The single-car marker keeps its
picking, its pins, its store and its camera rig untouched. Each car's materials are cloned and
patched by `patchInstance` in `damageShader.ts`, the loop `Car.tsx` had and now shares, so
Task 3's dents, scratches, cracks and cavities are on both cars, from the same packing.

**The origin and the framing come from where the cars came to rest.** The origin is the
impact; without one, the middle of the resting positions — never the poses', or a playback
would slide the floor along with the cars. The camera is placed once, from the south-east and
above, 2.2 times a radius that reaches the farthest resting car plus half a car (at least five
and a half metres), and may zoom out to twice that. A playback's cars drive in from beyond that frame and
meet in it, which is the point of the view; zooming out shows the approach.

**Read-only, and never exported.** Nothing in the scene has a pointer handler: `OrbitControls`
is the only input, and nothing reaches the store or the document. The canvas renders on demand
(`frameloop="demand"`) — a drag, a playback frame, a body arriving — and keeps no drawing
buffer, because nothing reads it back: it is not the review's export, not in `attachments`, not
in `claim/1`. Each car is a group named `car:<id>` in its body's own metres, nose +Z and left +X,
so anything that belongs to a car — a photo card pinned to a panel — can stand in that group.

**The desk's tab.** `ReportView` holds a tab — Report, Compare (only with two accounts),
Reconstruction (only when the diagram placed a vehicle) — defaulting to Compare and reading as
Report until there is a second account to compare, so a report without one opens as it always
did and one with one opens on the comparison, with no effect to reset between reports. The
reconstruction's own `usePlayback` drives it: "Play" runs the same `posesAt` on the same clock
as the map's playback; the scrubber is `seek(ms)` over the drive, and a scrub holds its frame
— the hook keeps `playing` true and stops its loop — so the view tracks that in its own `held`
state and offers Play again rather than a Stop with nothing to stop. At rest the scrubber sits
at the end, which is where the cars are. Under it, each car's paint swatch and name in the
desk's voice. The desk stays English (`lang="en"`).

**The review page's small version.** Under the map figure, 240 px tall, only on the
customer's own review (`edit`) and only when a vehicle has a position. It takes the map's
`play.poses`, so pressing Play on the map drives the cars here too. The wheel does not zoom it
(`zoom={false}`) and it takes no pointer below 640 px, so a wheel or a thumb scrolling the
review over it scrolls the page — the review page's other scenes are read-only for the same
reason.

**What the smoke proves.** On the desk (`integration-smoke.mjs`, the policyholder's report with
its red Camry and black SUV): the tab's screenshot has red paint round where the scene's DEV
probe says the red car stands and dark paint round the black one; two screenshots 800 ms apart
are identical (nothing moves on its own), and a mouse drag changes tens of thousands of pixels
and moves the red car hundreds on screen; "Play" takes both cars metres up their routes and
brings them back to rest to the centimetre; a scrub to the start holds them there, with Play
offered. On the review page (`smoke.mjs`, both languages): car A's paint where the probe says A
stands, and the map's Play moving A metres in the reconstruction and back. Screenshots, not
`toDataURL`, because the canvas keeps no buffer; movement in the scene's metres through the
probe, not on screen, because a car driving at the camera barely moves there.

## Photos pinned to the car (v10)

`Photo.shows` already tied a photograph to a panel, and the report put it beside the mark in the
list. On the car it was nowhere. Now every photograph that shows a panel stands beside that
panel in the studio as a small framed card with a thin leader line back to it — on the damage
step, on the review page's marked-up car (and so in the PNG sent with the report), on the
desk's, and on each car in the desk's reconstruction. Tapping a card turns the camera to the
panel and opens the photograph large.

**Where a card stands is pure.** `cardPlacement(body, zone)` in `src/marker/cards.ts` returns
`{ position, normal }` in the body's own metres — nose +Z, up +Y, the car's left +X. The zone's
anchor is in the kit's units, like everything `claim-marker/1` stores, so it goes through
`toWorld` first and the 0.6 m is a real 0.6 m on every body. The outward normal runs from the
middle of the body's footprint on the floor — the kit's origin, where it stands every body —
out through the anchor. Measured from there every normal leans upward: a wheel's or a bumper's
card rises beside it instead of sinking into the floor, a door's stands out at about the height
of its glass, the roof's above it. `test/cards.test.ts` pins one card to hand-computed metres,
the directions to the frame (the left door's card at +X, the nose's at +Z, the roof's up), and
for every zone of every body a unit normal, a card exactly 0.6 m from its anchor, never lower
than it and farther from the middle than the panel. Several photographs of one panel stack,
each a little down and to the right of the one before.

**A texture, not `Html`.** The card is a plane on a drei `Billboard` with the photograph drawn
into a canvas texture — cropped square, in a white frame with a grey edge so it reads against
the pale studio and against paint — because drei's `Html` is DOM laid over the canvas and would
be missing from the export. The texture is white until the image decodes, then asks for a frame
(`invalidate`), which is what the reconstruction's on-demand loop needs to show it at all. The
leader is a plain one-pixel `lineSegments`, not drei's `Line`: that is a fat-line shader to
compile in every canvas a card is in, for a line meant to be thin anyway. Each card's placement
is memoised, because the reconstruction re-renders on every frame of a playback.

**Tagging by dragging.** Beside the car, the damage step lists this vehicle's photographs. Each
thumbnail is `draggable` with the photo's place on the claim as `PHOTO_DRAG` data; the marker
listens on its canvas and takes only that type. The drop point is cast from the studio camera
against the body alone (the car's primitive is named `car`, so pins and cards never catch it),
the hit goes back to kit units with `toModel`, and `nearestZone` names the panel for the same
`tagPhoto` the photo-first suggestions use. While the drag is over the car the panel under it is
tinted, the same tint as a hover, and the turntable stops the moment a drag enters the car, as it
does at the first touch, so the panel under the pointer holds still. Under each thumbnail a select names the panel it shows — the
same `tagPhoto` for a keyboard or a phone, where HTML drag is not reliable. A tagged photograph
can be dropped again on another panel; nothing un-tags one. `shows` is still set only by
`tagPhoto`, still **absent** from the document when unset, and nothing else in `claim/1` moves.

**Tapping a card.** A card opens on a click that did not move (`e.delta ≤ 2`), not on the press
a pin uses: a modal opening under a drag would swallow the drag, and a drag that merely starts
on a card should turn the car. The press is still the card's, so the body behind it is not
picked. `store.face(zone)` sets `facing` and closes whatever the picker had open; the camera rig
eases to it through `cameraFor` at the current distance and gives up the moment the user drags.
The photograph opens in a native modal `<dialog>` (`PhotoLightbox`), which brings Escape, the
focus trap and the top layer with it, and takes `lang` as a prop because the desk renders it too.

**The panel the camera faces has its cards stand aside.** `cameraFor` puts the camera on the
azimuth through the point it faces, and a card stands on that same azimuth, 0.6 m out along the
panel's normal — so seen from where a tap takes the camera, a card covers its own panel: the
pin behind it is hidden by depth, the card takes the press meant for the pin, and tapping the pin
of a panel with a photo ended with the photo over the damage. The placement stays; the rule is
that **while the camera faces a panel, that panel's cards are not drawn and take no taps**.
`facing` in the marker store is `{ point, zone }` — what the camera was last turned to face — set
by a pin's selection (`select`, and `commit`, which selects the new mark) and by a card's tap
(`face`); a new object each time, so a second tap on the same pin or card after a turn aims
again, and it is also the camera rig's one trigger. It is cleared when the selection clears
(`select(null)`, `pick`, `remove`, `load`) and by the rig the moment the customer drags the
camera round — the same moment the rig gives up its goal — so the cards come back as soon as the
view is the customer's own again. `PhotoCards` takes the zone as `faced` and reads it in render:
the cards stay mounted, `visible={false}` with no handlers, so the photograph is not decoded
again when they return. After a card's tap the card stands aside too, which is right: the
lightbox is showing the photograph.

**A pin's release is the pin's.** A pin's press selects it and the camera starts turning on the
next frame, so a finger or a slow click comes up after the pin has moved out from under it — the
reviewer measured 27–49 px in a 100–150 ms hold, against a tap target of about 29. On the
customer's marker the body catches that release; on the desk's read-only copy nothing does, and a
click that hits nothing is r3f's `onPointerMissed`, which cleared the selection it had just made
and so brought the card back over the pin. `Scene` keeps a `pinPressed` ref: every press resets it
(`onPointerDownCapture` on the canvas's wrapper, which runs before r3f sees the press), a pin's
press sets it, and `onPointerMissed` leaves the selection alone when it is set. It is a ref written
in handlers, not state.

**The desk's copy can be turned; the review's cannot.** `ReportDocument`'s marked-up cars are
now `readOnly`: the body takes no tap and tints nothing, there is no picker or hint, and the
wheel scrolls the page instead of zooming. On the desk the wrapper takes pointer events, so an
adjuster can walk round the car, tap a pin to face it, and tap a card to open the photograph.
The customer's review copy keeps `pointer-events-none`: its canvas is the evidence exported at
send, and it goes as it is framed.

**The reconstruction** stands each car's cards inside that car's `car:<id>` group, which is in
the body's own metres, so the same `cardPlacement` puts them in the same place and they drive
in with the car during a playback. Nothing there can be tapped. The desk's tab shows them; the
review page's 240-px copy leaves them out. A card there is about fifteen pixels, and timed on
the smoke's software GL the damage-to-review step took the same eighteen seconds to show the
review either way, but with the card in that canvas the page stayed busy for about five
seconds more afterwards — on the page that records the replay at send.

**What the smoke proves.** On the damage step (both languages) the photograph of A is dragged
from its thumbnail onto the left front door where the camera faces it, and the draft says it
shows `left_front_door`; the frame `export()` takes (`toDataURL`) has no green before and
thousands of green pixels after, round where the DEV probe (`card(id)`) projects the card — the
smoke's photograph is green because nothing else in the studio is. The car is then turned away
by a drag from an empty corner, the card is clicked where it now is, and the camera's azimuth
(`azimuth()`) comes back to within 5° of the door while the dialog named "Left front door" shows
that photograph; Escape closes it. While the camera faces the door the card's green is gone from
the frame, and the next drag brings it back. Then the door's own pin is clicked where it stands:
it is selected, the camera turns to the door, the pin's violet dot is on the frame at its projected
point, and there is no green within 40 px of it. On the desk, a tap on the car opens no picker;
after `face(door)` and a turn off it, the card on the door opens the photograph; the door's pin,
held down for 150 ms from a turned view and let go off it, is still selected once the camera has
come round, with no green round it; and the Reconstruction tab's screenshot has the card's green by A.

## Tell us everything, once (v9)

A form asks forty questions one at a time. A person who has just been in a crash tells you what
happened in one breath: "this morning on 5th Avenue, in the rain, a black SUV pulled out and hit
my front, my passenger hurt her neck, the police came". With the assistant on, the first screen
offers exactly that — speak or type one account — and the rest of the flow starts already
filled in.

**It leans on the model harder than anything else in the page, so everything it produces is a
proposal and never an entry.** A fifth task on `claim-assist/1`, `intake`: the customer's words
go to the insurer's endpoint with the page's own enums (kinds, bodies, paint ids) and the
current minute, and a *draft* comes back — kind, time, a place as words, conditions, vehicles,
who was hurt, the police, other property. `parseIntake` builds its result from an allow-list,
never by spreading the answer: an unknown enum drops that field, a time after "now" is dropped,
six vehicles and twelve people at most, every string capped, garbage is an empty draft.

**Names, phone numbers, licences, plates and VINs are not part of the shape at all.** The
endpoint can send them — the assist smoke's stub does — and nothing comes out the other side:
the customer types identity themselves, on the steps where they can see what they are typing.

**"Here is what we understood"** is a row per proposal, each with its own tick, all ticked, every
label from `describe.ts` and the dictionaries: the kind by name, the time formatted, each
vehicle as the page would name it, "1 person hurt", "the police were called", the conditions as
the review page reads them. The few words of the model's that would land in the claim as
written — an injury, the property, a report number — are shown under their row, quoted, so
nothing lands unseen. A police answer is proposed only when the account said yes or no, and
people are added only to a claim that has none yet. "Use these"
fills through the store's existing actions under the **prefill rule** — only what is empty,
never what the customer already typed — and an unticked row changes nothing.

Three things are deliberately not the model's:

- **The statement is the customer's own words, verbatim.** `incident.description` becomes the
  transcript, never the model's summary: it is their statement, and it is what they sign.
- **The place is a search the customer finishes.** It lands in the Where step's search box as
  the words they used, and they pick the match. The model never supplies a coordinate — it
  cannot do spherical arithmetic, and a confident wrong pin is worse than an empty one.
- **The diagram is drawn from their words by the step that already does that.** When the draft
  had vehicles and a description, the scene step runs its existing `draw()` once, from a
  microtask so the effect never sets state synchronously.

A failing endpoint, an empty draft, or no assistant at all falls straight back to the ordinary
first step with one quiet line; the kind cards underneath always work. The dictation is the same
recogniser as the statement box (`src/app/speech.ts`).

**What is not proved here.** The scripts prove the page's half of the contract — the request,
the parsing, the proposals, the filling, the fallbacks — against a stub. Whether the model reads
a real account well is a question for a real key and `scripts/assist-server.mjs`, whose
`fill_the_report` tool inlines the enums so it cannot misspell one and whose prompt says to
extract only what was said.

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
watches the cinematic replay and reads the pixels while it runs, marks a damage, submits, and
checks the document that came out. `node scripts/shoot.mjs`
regenerates the README images from the real map.
