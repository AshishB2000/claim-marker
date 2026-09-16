<h1 align="center">claim-marker</h1>

<p align="center">
  The page a customer lands on after tapping <b>“Tell us what happened”</b> on their insurer's site.<br>
  A real map of where it happened, the cars they choose standing on it in 3D, the damage marked on their own car.
</p>

<p align="center">
  <img src="docs/scene.png" alt="Two cars on satellite imagery of the junction, with the route one took and the point where they met" width="100%">
</p>

<p align="center">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-20232a?logo=react&logoColor=61dafb">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6-3178c6?logo=typescript&logoColor=white">
  <img alt="MapLibre GL" src="https://img.shields.io/badge/MapLibre-GL-396cb2?logo=maplibre&logoColor=white">
  <img alt="three.js" src="https://img.shields.io/badge/three.js-r185-000000?logo=threedotjs&logoColor=white">
  <img alt="No API keys" src="https://img.shields.io/badge/API_keys-none-2ea44f">
  <img alt="MIT" src="https://img.shields.io/badge/licence-MIT-blue">
</p>

---

## Seven steps, one screen each

| step | what the customer does |
| --- | --- |
| **1 · What happened** | picks one of eight kinds of incident; the kind decides which questions follow |
| **2 · Where and when** | searches, uses their location, or taps the map; the pin drags to the exact spot |
| **3 · The vehicles** | make, model and year from the vehicle database, a photo of the real car, or just the VIN |
| **4 · People and injuries** | drivers, passengers, who was hurt, the police, witnesses |
| **5 · Show us** | drags each car along the route it took on satellite imagery; the impact and the hit panels work themselves out; plays it back |
| **6 · The damage** | taps the 3D car, says how bad, adds photos, says whether it still drives |
| **7 · Review and send** | reads the report as the insurer will, fills the gaps it points out, signs |

| | |
| --- | --- |
| <img src="docs/kind.png" alt="What happened: eight kinds of incident" width="100%"> | <img src="docs/vehicles.png" alt="The vehicles: a photograph of the real make and model" width="100%"> |
| <img src="docs/people.png" alt="People and injuries" width="100%"> | <img src="docs/damage.png" alt="The damage: a numbered pin on the customer's car" width="100%"> |

## What makes it different

- **The map is the form.** Dragging a car *is* the input: it moves, draws its path behind it and turns to face the way it went. Two cars touch and the point of impact appears; each car's hit panel is marked before the damage step is reached.
- **Real cars.** Seven body shapes in thirteen paints, stretched to true dimensions, standing on the map as a three.js layer inside MapLibre. Pick a make and model and the card shows a photograph of that car.
- **Play it back.** The cars drive their routes and arrive together at the moment of impact, on the diagram and again on the review page.
- **Built for the roadside.** Phone first. Type the VIN from the insurance card and the car fills itself in. Say what happened instead of typing it. Photos straight from the camera. Progress kept on the device until it is sent. No account.
- **Places a map cannot see.** A garage or a covered car park is drawn on a parking lot or a blank sheet instead of a roof.
- **AI is optional and never in the page.** With an endpoint set, a sentence in the customer's words draws the diagram, and the diagram can write the statement. The key stays on the insurer's server, the answer is treated as untrusted input, and nothing it writes touches fault.

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

Works out of the box with **no keys**: Esri for streets and satellite, Photon for addresses, the NHTSA vehicle database for makes, models and VINs, Wikimedia Commons for the photo of the car.

## Configuration

Everything is optional, set as `VITE_*` variables in `.env`:

| variable | what |
| --- | --- |
| `VITE_SUBMIT_URL` | where the finished document is `POST`ed. Unset, the page behaves as if it had sent it. |
| `VITE_BRAND` | the insurer's name under the page title |
| `VITE_FRAUD_NOTICE` | the state-mandated fraud notice above the signature |
| `VITE_ASSIST_URL` | an endpoint speaking `claim-assist/1`; `scripts/assist-server.mjs` is a working one. Unset, no AI exists in the page. |
| `VITE_MAP_TILES_STREETS` · `VITE_MAP_TILES_SATELLITE` | raster tile URL templates for your own map provider |
| `VITE_GEOCODER_URL` | a Photon-compatible geocoder for production volume |
| `VITE_VEHICLE_PHOTO_URL` | a licensed car-image provider, templated on `{make}` `{model}` `{year}` `{color}` |

The page also dispatches `claim:submitted` on `window` with the document as `detail`, for a host page that would rather listen than receive a POST.

## What the insurer receives

One JSON document, `claim/1`: the incident, every vehicle with its damage, the people, the police, the attestation, and as attachments the diagram and the marked-up car as PNGs and the customer's photographs as JPEGs.

```jsonc
{
  "schema": "claim/1",
  "reference": "CM-7F3K2Q",
  "incident":  { "kind": "collision", "location": { "lng": -73.9859, "lat": 40.7573, "address": "…" }, "description": "…" },
  "vehicles":  [{ "id": "a", "role": "insured", "make": "Honda", "model": "Civic", "year": 2019, "vin": "…",
                  "position": [-73.98592, 40.75731], "heading": 12, "path": [ … ],
                  "damages": [{ "zone": "front_bumper", "severity": "dent", "point": [0.18, 0.32, 1.24] }] }],
  "people":    [{ "role": "passenger", "vehicle": "a", "name": "Sam Lee", "injured": true, "injury": "…" }],
  "impact":    [-73.98588, 40.75736],
  "attachments": { "scene": "data:image/png;base64,…", "damage": { "a": "…" }, "photos": [ … ] }
}
```

Positions are `[lng, lat]`, headings compass bearings, and `export → load → export` is byte-identical. The full shape and every design decision behind it are in [docs/spec-app.md](docs/spec-app.md).

## Development

```bash
npm run lint             # oxlint, must be silent
npm test                 # vitest, ~220 tests
node scripts/smoke.mjs   # the whole flow in a headless browser, dev server running
node scripts/shoot.mjs   # regenerate the screenshots above
```

## Credits and licence

Source is **MIT** ([LICENSE](LICENSE)). The 3D bodies are Kenney's [Car Kit](https://kenney.nl/assets/car-kit), **CC0**, re-authored at load time so the paint takes the customer's colour ([src/models/LICENSE-ASSETS.md](src/models/LICENSE-ASSETS.md)). Map tiles are Esri's and carry [their terms](https://www.esri.com/en-us/legal/terms/full-master-agreement); addresses are [Photon](https://photon.komoot.io) by komoot; car photographs are Wikimedia Commons, each credited on the card. Nothing here depicts or is endorsed by any real manufacturer or insurer.
