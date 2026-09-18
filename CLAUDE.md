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
npm run dev            # vite, http://localhost:5173 (the claims desk is /adjuster.html)
npm run lint           # oxlint — must be silent, warnings included (react-compiler-style rules are on)
npm test               # vitest, 575 tests across 35 files
npm run build          # tsc -b, the static site (two pages) into dist/, and dist/lib/claim.js for the server
npm run server         # the whole product on 8788: the page, the desk and the API; needs a build
```

`npm run server` serves `dist/` as well as the API, so http://localhost:8788 is the customer's
page, `/adjuster.html` the desk, `/claims` the API and — with `DEMO=1` — `/demo/` the demo
insurer portal, on one origin with no CORS. `docker
compose up --build` is the same thing in a container. Docker is **not installed on this
machine**: the image cannot be built or verified here, only the server itself.

`node scripts/integration-smoke.mjs` needs `npm run dev` running and one build done: it
starts its own claim server, webhook receiver and host page and proves sessions, the embed,
prefill, the offline outbox, the server, the rate limit, the served page's CSP, the webhook
signature, the desk, retention, the reuse signals (the same photograph and VIN under two
customers), **both drivers** (the scene step's QR invite, a second browser as the other driver
seeing nothing of the first report, their account filed once, both side by side on the desk),
the replay unpacked as a video file, and the demo portal (a second, shorter walk against the
**built** page the claim server serves). Run it for anything touching `src/config.ts`,
`src/app/submit.ts`, `src/claim/prefill.ts`, `public/embed.js`, `server/` or `src/adjuster/`.

Two end-to-end scripts need `npm run dev` running in another shell and reach the internet
(map tiles, the geocoder):

```bash
node scripts/smoke.mjs     # the whole flow: search, vehicles, drag a car and its heading, damage, send
node scripts/shoot.mjs     # regenerates docs/*.png and asserts the attachments aren't blank frames
```

`node scripts/assist-smoke.mjs` starts its own stub endpoint and its own dev server on **ports
it finds free** (several of these scripts run side by side on this machine), so it needs no API
key: it covers this page's half of the assistant contract, all five tasks, walks the damage
step twice — at 1280, where the layout must be the one it always was, and at 390, photo-first,
through the **live camera** (Chromium's fake device; it wraps `getUserMedia` and fails if a track
is still running after the sheet closes) — and walks "just tell us what happened" against a
stub that sends names, plates and VINs it must drop.

`node scripts/record-demo.mjs` is a one-off: it starts its own `DEMO=1` server, walks the demo
portal and writes `docs/demo.gif` (needs ffmpeg; without it, a `.webm`). Run it when that
journey changes.

`node scripts/live-check.mjs <url>` checks a **deployed** instance from outside with plain
`fetch` — no browser — using the `API_KEY` and `DESK_TOKEN` it was deployed with: the page and
its CSP, what must not be served, a session, a report filed and deduped, the desk. `fly.toml`
and `render.yaml` describe that deployment; neither has been run, and Docker is not installed
here, so both are unverified. Run the live check against a local server in production mode
(`NODE_ENV=production`, `SESSION_SECRET`, `API_KEY`, `DESK_TOKEN`, `CLAIM_DIR`) for anything
touching `server/`.

`node scripts/offline-smoke.mjs` needs only a build: it serves `dist/` with `vite preview` on
a free port, waits for the shell to land, then **kills the preview process** and goes offline
before reloading. Killing the server matters — emulated offline alone still lets a service
worker's own fetches reach localhost, so a page quietly served by a live server would pass a
test that proves nothing. Run it for anything touching `public/sw.js`, the offline plugin in
`vite.config.ts`, `src/app/offline.ts` or what the build emits. The model's own
judgement is not covered by anything — that needs a key and `scripts/assist-server.mjs`.

`scripts/smoke.mjs` answers Overpass from `scripts/fixtures/overpass-times-square.json` (a real
recorded answer — every public Overpass mirror throttles by IP and hangs rather than erroring,
and a build gate must not depend on somebody else's spare capacity) and stamps
`scripts/fixtures/scene.jpg` with fresh EXIF at run time through `scripts/exif-write.mjs`, so a
photograph can fill the place and the time with an exact zero to assert. The weather stays live.

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

**Reports do not live for ever** (`RETAIN_DAYS`, `server/retention.mjs`). `expired(receivedAt,
days, now)` is pure and tested; `sweep()` in the server deletes the folder and its
`by-client/<ref>` entry at startup and every six hours. Unset keeps everything — that is still
the default for an insurer's own deployment. A public instance that keeps strangers'
photographs for ever is a liability.

**The demo portal is the insurer's site, not ours** (`server/demo/`, `DEMO=1`, served at
`/demo/`). Plain HTML and one script — the point is that the page embeds into another stack —
with the sign-in cards rendered into `index.html` at startup from `customers.mjs`. `/demo/login`
mints through the same `createSession` as `POST /sessions`, with a fresh `demo-<who>-<random>`
id per sign-in. Three rules it must keep: a demo receipt is tagged `demo: true` and swept after
a day whatever `RETAIN_DAYS` says; a demo visitor's session reads only the reports filed under
its own id (`deskScope`), while `DESK_TOKEN` reads them all; and the production guard is
untouched by `DEMO`. Never put `DEMO=1` on an instance taking real claims — anyone may mint a
session there. Config from the page's *own* origin is always trusted (`originAllowed`), which is
how the portal's same-origin iframe is configured at all.

**The scene fills itself in from the place and the time** (`src/scene/`). `weather.ts`
(Open-Meteo: the archive past five days, the forecast endpoint with `past_days` otherwise,
`timezone=auto` so the hourly stamps are local and the hour matches `at` by string),
`sun.ts` (the NOAA approximation, no dependency) and `road.ts` (Overpass inside 60 m, the Kumi Systems mirror because `overpass-api.de` answers
406 to whole networks; also
returns the ways as GeoJSON for the diagram to draw). All three are pure apart from one
`fetch` each, all three resolve `null` on any failure, and nothing on the page depends on
any of them. `incident.utcOffset` is what makes `at` an instant — `instantOf(at, utcOffset)`
— and is filled by the weather lookup, which resolves the zone anyway. `incident.context`
is what the record said; `incident.conditions` stays the customer's answer, and
`autoConditions` is `autoDamage`'s bargain for the three selects (`auto` follows the place
and the time, `user` is final). "Still looking it up" is **derived** from `contextKey`
against `sceneKey(incident)` — never a `setState` in the effect. `contextKey` and
`roadWays` are not persisted on purpose. The roads layer draws on `satellite` and `streets`
only; `alignToRoad` turns a dropped car to the road's line and **never moves it**.

**A photograph's EXIF is read before `shrink` destroys it, and only distances are kept.**
`src/claim/exif.ts` (pure, no dependency, both TIFF byte orders, never throws) runs on the
original bytes in `addPhotos`; `photoDistances` in `photos.ts` turns what it found into
`Photo.minutesFromIncident` / `metresFromScene`. **The raw position never reaches the
document** — a gallery photo can carry the customer's home — and lives only in the store's
in-memory `photoExif`, which also lets the distances follow a moved pin. The Where step
offers "start from a photo you took" as a third way in; iOS strips location from picked
photos, so it is offered and never relied on. `CameraGuide.tsx` opens the live camera from
the guided tiles when `getUserMedia` exists, samples 160-px greyscale frames through
`photoQuality.ts` every 300 ms, and its hints are **hints, never gates** — the shutter is
always enabled, and every exit path stops the tracks.

**Plausibility and reuse signals are the desk's, and only the desk's.**
`src/claim/plausibility.ts` is pure geometry over a finished document (panel vs impact, a
route arriving backwards, marks out of reach of the impact, overlapping bodies, a rear-end
whose panels disagree, the story against `incident.context`, a photograph's own time and
distance). `server/signals.mjs` is the server's side: three append-only JSONL indexes under
`CLAIM_DIR/index/` for photo hashes, VINs and plates, compared **before** the new report is
recorded, pruned by the retention sweep. Neither ever reaches the customer —
`test/desk-only.test.ts` fails if anything but `src/adjuster/Desk.tsx` imports
`plausibility.ts` — nothing in either blocks a report, and the words fraud, fault, liability,
blame and suspicious appear in neither, which is also a test. `Photo.hash` is a dHash
computed in the page (`ponytail:` — the server has no image decoder; a forged hash is the
stated ceiling).

**Two accounts of one accident are linked by `incident.shared` and `reporter.party`.**
The customer invites the other driver with a QR code (`src/app/Invite.tsx`, the one runtime
dependency `qrcode-generator`); `POST /incidents` mints a 72-hour party token
(`PARTY_TTL` — `MAX_TTL` stays a day, `sign` takes an explicit cap). The other driver's page
is **this page**, opened with `?party=<token>` **read from the URL only**, and it starts from
`src/claim/seed.ts` — where, when, the ground, the shapes and colours of the cars, and
nothing else; `test/seed.test.ts` fails on any trace of the first report. In their document
their own car keeps role `insured` (schema-wise "the reporter's vehicle"), so every step and
every sentence works unchanged; the copy differences are keyed off `reporter.party`.
`src/claim/compare.ts` pairs the two accounts' vehicles by **mirrored role**, confirmed by
body and colour, and never says who is right. Four rules that are easy to undo: the party page
keeps its draft in its own slot, `claim-marker/draft/<INC-…>` (`draftName`, from the URL at
import), so a link never overwrites or re-sides the report already on that phone; a party link
whose seed will not load shows `LinkGone`, not a form, and a refused party token is `Rejected`
at send, never queued; the invite `{incident, url, expiresAt}` is kept in the draft beside
`shared` and shown again, never re-minted; and the desk orders and voices the two accounts by
the **receipt's** `party` (set by the server from the token), never the document's.

**The replay is recorded at send time and never holds a report up** (`src/map/record.ts`,
`MapSceneHandle.record()`). It shares the PNG export's hand-painting of the DOM-only pills and
impact cross, drives the cars through the same `poses` as the on-screen playback, picks VP9 →
VP8 → WebM → MP4 by `isTypeSupported`, and races an 8-second ceiling in `Review.tsx`; any
failure sends without it. `attachments.replay` is capped by `isReplay` (4 MB of data URL) and
not persisted in the draft. The smoke decodes it and counts colours on the **middle frame**,
because a valid video of a black rectangle is the failure that matters.

**The map tilts only inside a cinematic playback, and never with a marker in reach.**
`MapScene` is still built `pitch 0, maxPitch 0`; `mode="cinematic"` raises `maxPitch` on the
live instance at the first playback frame and drops it to 0 — after jumping back to the view
it captured — on the last, or on a Stop, before the markers return. The DOM-marker maths
assumes a flat map; keep it that way. The playback clock is the hook's own (`usePlayback`
holds it in a ref and advances it by wall delta × `rate`), not `performance.now()`; `seek`
and slow motion depend on that. `seek(ms)` is a moment on that clock — past the drive, into
the hold, where the shockwave is — and it holds the frame loop there, which is how the smoke
proves the ring without racing it: it drives `window.__play` (DEV only, from the diagram step,
like `__map`) and diffs one settled frame of a shot against the same shot once the ring has
gone, rather than sampling for a peak a loaded machine's frame rate decides. The pure parts —
`Timeline`, `impactTimeOf` (closest approach, sixty samples), `shots`, `cameraAt`, `ringAt` —
live in `src/map/playback.ts`,
which must stay free of value imports of maplibre or three so `test/playback.test.ts` runs
in plain node. `ease` and `HOLD_MS` have one home there; `record.ts` and `Compare.tsx` import
them. The shockwave goes through `CarLayer.setDecor()` — placed by `vehicleMatrix`, wound
once through `reverseWinding` — and is cleared at the end of playback, so no export ever
holds it. The playback rate is `rate` in code, never "speed": the words fault, liability,
blame, speed and cost stay out of anything the customer or the desk reads.

**The scene is lit from the record, and the light is decoration** (`src/scene/lighting.ts`).
`lightingFor(incident.context)` — pure, no value imports of three or maplibre, so
`test/lighting.test.ts` runs in plain node — gives one `Lighting` both scenes read: the sun as
a unit vector in the map layer's frame (x east, y south, z up), its intensity and colour, the
hemisphere colours (orange below 10°, blue below −6°), how much environment shows, and
`rain`/`snow`/`fog`/`night`/`lit`; `lightingFor(null)` is `DEFAULT_LIGHTING`, the fixed light
the map always had. `CarLayer.setLighting`, `MapScene`'s and `DamageMarker`'s `lighting` prop
and `ReportDocument`'s carry it; the customer's page memoises it from the store (`plainView`
makes it null everywhere on that page — store state, never `claim/1`), the desk from the
receipt's document; a caller that passes nothing is unchanged. Nothing in it moves a car, a
mark or the impact. Real shadows inside a MapLibre custom layer, three things that look wrong
and are not: **everything sized in scene units is in mercator units** — the shadow camera's
bounds, near and far, the sun's distance, the fog's reach, every lamp's `distance` — set as
metres × `metresToMercator(lat)` and refitted in `fit()` when the origin moves; **the car
materials' `shadowSide` is `DoubleSide`** — three's shadow pass draws back faces, the kit's
bodies are open shells with no floor, and from a high sun the depth map held a sliver of door
lining and no shadow at all; and **`render()` sets three's viewport from the drawing buffer**
before rendering — the shadow pass restores the viewport three believes the canvas has, its
size at creation, and MapLibre's own `setBaseState` restores the map's only after the layer.
The ground planes, the rain and the pool are built in a body's y-up metres frame and placed by
`vehicleMatrix` like a car, wound once through `reverseWinding`; the lamps decay in mercator
units, where 1/d² clamps to its ceiling and only the cutoff shapes the pool (`ponytail:` in the
layer). The blob stays only for a ghost, or when there is no sun to throw a real shadow.

**Settings are runtime, through `src/config.ts`.** Read `config.submitUrl`, `config.brand`,
`config.assistUrl`, `config.token`, `config.prefill` — never `import.meta.env.VITE_SUBMIT_URL`
and friends directly; those are only the defaults `config` starts from. `main.tsx` awaits
`loadConfig()` before rendering, so anything evaluated at module import time (a `const` from
env) is stale by definition: `assistOn` is a function for that reason. Config from a host page
is a trust boundary — `applyConfig` and `parsePrefill` drop what they do not understand, and
`VITE_ALLOWED_HOSTS` limits who may send it. Events to the host go through `tell()`.

**The server serves the page, and injects its settings into it.** `server/claim-server.mjs`
reads both built HTML files once at startup and inserts `window.CLAIM_MARKER` before
`</head>`, so `VITE_*` are build-time defaults and one image serves any insurer. Two things
in the CSP look removable and are not: `worker-src 'self' blob:` (MapLibre's worker is a
file, three's are blobs) and **`data:` in connect-src** — the Kenney bodies carry their
texture as a data URI and three fetches it, so without it every car loads untextured with a
console full of CSP violations. Serving refuses anything resolving outside `dist/`, any
directory, and `/lib/` (that is the parser the server itself imports). With
`NODE_ENV=production` it exits unless a claim token or session secret, `DESK_TOKEN`, and a
`CLAIM_ORIGIN` that is not `*` are all set.

**Session tokens are `server/session.mjs`, not a JWT.**
`base64url({sub,policy,exp}).base64url(hmac-sha256)`, minted by `POST /sessions` for the
insurer's backend and carried by the page, so a report is filed against a customer rather
than arriving anonymous. Deliberately not a JWT: an algorithm named inside the token is how
`alg: none` happens. `tsconfig.app.json` has `allowJs` so `test/session.test.ts` can import
the `.mjs`.

**Submit never loses a report.** `submitClaim` retries, then queues into IndexedDB
(`src/claim/outbox.ts`) and resolves `queued`; the done page says so; `flushOutbox` drains on
load and `online`. A refusal is `Rejected` and is the only error the customer sees.

**`ReportDocument` is the one rendering of a `claim/1` document**, used by the review step
(with edit links) and the claims desk (read-only). The server validates with the same parser
the page uses, via `dist/lib/claim.js`; do not hand-write validation in `server/`.

**The AI never runs in the page.** `VITE_ASSIST_URL` points at an endpoint the insurer runs and
that holds the key (`scripts/assist-server.mjs` is a reference one); unset, no AI exists in the
page. Five tasks: `diagram`, `describe`, `check` (the report back as questions, on the review
step) `damage` (photographs back as marked panels, on the damage step) and `intake` (one spoken or
typed account back as a *proposed* draft of the first steps, on the kind step — ticked row by
row, filled under the prefill rule, the statement kept as the customer's own words verbatim,
the place handed to the Where step's search as words, never a coordinate; `parseIntake` is an
allow-list and carries no names, phones, licences, plates or VINs whatever the endpoint sends). Positions on that
wire are metres east/north of the incident, not `[lng, lat]`, because a model cannot do
spherical arithmetic. Treat every answer as untrusted input: `parseScene` drops anything
malformed or naming a vehicle the customer did not enter, and `applyScene` is a no-op when
nothing usable comes back — an earlier version re-ran the impact anyway and moved the cars.

**Three rules the assistant may not break.** The second look never blocks sending — nothing in
that card touches `canSend`. `CheckRequest` carries the shape of the accident and nothing that
names anyone: no reporter, names, phones, licences, plates, VINs, insurers or attachments (the
assist smoke walks every key of the request and fails on any of them). And `parseSuggestions`
always uses the **zone's own anchor** as the point, never anything the endpoint sent, because a
mark that misses the panel it names makes the marked-up car a lie. Nothing anywhere mentions
fault, liability, speed or cost.

**The damage step is photo-first only on a phone with the assistant on.**
`photoFirst = assistOn() && narrow` (`useNarrow()`, `matchMedia('(max-width: 640px)')`, read
through `useSyncExternalStore`): guided camera tiles, then the panels read off the photographs,
then the car. Assistant off, or wider than 640px, and the step is **unchanged** — same DOM, and
the assist smoke fails at 1280 if a tile appears or the photos are read without the button. The
step's three parts live in `src/app/steps/damage/` (`Capture`, `Suggestions`, `MarkerPanel`) and
`Damage.tsx` only picks the order. The photo-first suggestions read themselves: an effect keyed
on the vehicle and its photographs, debounced 1.2 s, aborted on change, with the loading state
*derived* — never a `setState` inside the effect. `Photo.shows` (a zone id, additive to
`claim/1`, kept only when `of` is a vehicle and the zone is on that body, **absent** otherwise so
old documents stay byte-identical) is set by `tagPhoto` when a suggestion is added, and
`ReportDocument` puts those thumbnails beside the mark.

**The customer's page has two languages; everything else has one** (`src/i18n/`). No library:
flat keys, `{name}` placeholders, `translate(lang, key, vars)` pure in `index.ts` so
`describe.ts` and the server's parser can use it, `useT()` for components. `es` is typed
`Record<Key, string>`, so a key added in English and forgotten in Spanish fails `tsc`. Messages
live in `areas/*.ts` (`vocab` is the shared label tables — look kinds, panels, paints, bodies,
severities and roles up by id there rather than using the English tables in `schema.ts` and
`zones.ts`, which are the desk's words and the parser's). **No literal customer-facing English
in a step.** Not translated on purpose: `claim/1`'s enum values, `UNKNOWN_DRIVER` (data —
display it through `displayName`), `src/adjuster/`, `server/`, `embed.js`.

**A component the desk also renders takes `lang` as a prop, never `useLang()`** —
`ReportDocument`, `MapScene`, `DamageMarker`. The desk and a customer's draft share an origin
and a localStorage; without the prop an adjuster inherits whatever language the last claimant
chose. The default is English, so the desk gets it by saying nothing.

**Spanish is not English with the words swapped.** The year goes last ("Toyota Camry 2022"),
"de el" contracts to "del", and people and cars are gendered where a claim form cannot know
the gender — hence the neutral constructions in `describe.ts` ("quien conducía"), "el otro
vehículo (…)" for the other party, and "de color rojo" so one phrasing fits every body. Use
`vehicleOf()`; `whose` and `vehicleName` do not sit side by side in Spanish. The Spanish fraud
notice (`fraudNoticeFor`) is a plain-language translation, **not legal text**.

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

**Those sentences have two voices** — three on the desk. `describe.ts` takes a `Voice`,
defaulting to `'customer'` everywhere, so the steps and the review are second person as they
were; `ReportDocument voice="desk"` — which only `src/adjuster/` passes — turns "your Camry" into
"the policyholder's Camry" and "You, driving" into "The policyholder, driving", and
`voice="desk-other"` reads the other driver's own account from their side: "the other driver's
Ford", "The other driver, driving". Pick it with `deskVoice(receipt.party)`. `gaps()` has no
voice on purpose: it only runs on the customer's own review page.

**"From public records" is the record alone.** `lookedUpLines(ctx)` takes no conditions: the
customer's selects sit beside it in the document and must never be shown under that heading.

**Schemas are versioned and frozen.** `claim/1` embeds the `claim-marker/1` damage shape. Both
guarantee `export → load → export` is byte-identical, which is why coordinates round on the way
in. Adding a field is fine; changing or removing one means a new schema version. `parseClaim`
throws on structural nonsense but drops individual bad vehicles.

**drei `<Html>` paints over the marker's canvas** regardless of 3D depth; anything that must
appear above it has to be `<Html>` too with a higher `zIndexRange`.

**Lint enforces React-compiler rules:** no writing refs during render (write them in an effect),
no components defined inside components, effects list every dependency (capture mount-time
props in `useState` when a thing is built once), no non-component exports from component files.

**The offline shell is hand-written** (`public/sw.js`, a plugin in `vite.config.ts`,
`src/app/offline.ts`). Three things in it look arbitrary and are not: no `skipWaiting` (an
open page may still want a lazy chunk from the build it was served by), precached entries
matched **by path** and not by the request (a reload marks its subresources `cache: 'reload'`
and `Cache.match` then answers nothing at all, which is a blank page offline), and opaque
responses never stored (~7 MB of quota each, and unreadable). The build patches the two
**declarations** in `sw.js` by name, not the bare `__PRECACHE__` / `__VERSION__` tokens —
those also appear in that file's own doc comment, and replacing the first occurrence there
ships a worker that does nothing.

**Service workers do not register in the desktop app's browser pane** — `vite preview` fails
there too, so it is the pane, not the page. `scripts/offline-smoke.mjs` in headless Chromium
is the only proof that counts.

**A blank canvas in a screenshot is usually not a bug.** three.js skips objects whose shaders
are still linking; under headless or software GL the lit materials take seconds. The scripts
poll for a rendered frame (`settled()`); do the same before trusting any capture, and use
`scripts/pixel.mjs` to check.

**The marker's CSS is injected, scoped under `.cm-`** (`src/style.ts`), a leftover of the widget
era that still suits it. The app itself is Tailwind (`src/app.css`).

## Layout

```
src/app/          the seven steps, the shell, the shared ReportDocument, submit
src/app/steps/damage/   the damage step's three parts: the camera, the suggestions, the marker
src/adjuster/     the claims desk (adjuster.html), the insurer's side
src/claim/        the claim/1 document, the persisted store, prefill, the outbox, a photo's own EXIF
src/config.ts     runtime configuration and the host-page channel
public/sw.js      the offline shell; its precache list is patched in by vite.config.ts
src/map/          MapLibre scene, the three.js car layer, the transform maths, styles
src/scene/        what the place and the time say for themselves: the weather, the sun, the road
src/vehicles/     model loading + paint re-authoring, body previews, the paint palette
src/marker/       the 3D damage marker
src/assist/       the optional assistant: the wire contract and its parsers, the metric frame, the client
src/zones.ts models.ts schema.ts geo.ts geocode.ts   shared
server/           the reference claim server, its session tokens, retention and reuse signals (no dependencies)
server/demo/      the demo insurer portal at /demo/ with DEMO=1: plain HTML, no build step
fly.toml render.yaml .env.example   the public deployment, unverified — no account, no Docker here
Dockerfile docker-compose.yml   the same thing as one image, page included
public/embed.js   the host-side script that mounts the page in an iframe
docs/claim-1.schema.json   the published JSON Schema, tested against the parser
```

## Before saying it works

Run `npm run lint`, `npm test`, `npm run build`, and — for anything touching the map, the
marker, the steps or the document — `node scripts/smoke.mjs`; for anything touching config,
submit, the embed, the server or the desk, `node scripts/integration-smoke.mjs`; for anything
touching the assistant, `node scripts/assist-smoke.mjs`; for anything touching the service
worker or what the build emits, `node scripts/offline-smoke.mjs`. Paste the real output. A
screenshot that looks right is not evidence the export path works; `scripts/shoot.mjs` reads
the pixels back.

## Out of bounds

`~/Projects/car-sim` and `~/Projects/car-parts-site` are read-only reference. Never modify
them. Do not push unless asked, and never on weekdays 08:00–18:00 local time: a global
PreToolUse hook (`~/.claude/hooks/block-push-workhours.sh`) denies pushes in that window.
