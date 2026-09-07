# claim-marker — spec (v1)

An embeddable 3D vehicle damage marker for first-notice-of-loss forms. The user taps
where the damage is, picks a severity, and the widget emits structured JSON plus a PNG.
It replaces the clip-art "click the car outline" step. v1 is only the damage marker:
no scenario builder, no accounts, no backend, no AI.

## Stack

Vite · TypeScript · React 19 · @react-three/fiber · @react-three/drei · three · zustand ·
Tailwind 4 (demo page only) · oxlint · vitest. Patterns follow `car-sim`.

## The car

Kenney [Car Kit](https://kenney.nl/assets/car-kit) `sedan.glb`, **CC0** — 172 KB, five
nodes (`body` + four wheels), one shared `colormap` material. `suv.glb` and `truck.glb`
have an identical node layout and units, so adding them later is data, not code.

No BMW model: trademark plus CC BY attribution obligations do not belong in a widget that
ships inside someone else's form. See `LICENSE-ASSETS.md`.

**Frame.** Nose at +Z, up +Y. Car's right = +X, left = −X (driver side, LHD), matching
the insurance convention of left/right as seen from the driver's seat. Kenney's own node
names are viewer-relative and disagree with this — `wheel-front-left` sits at +X — so the
names are ignored and coordinates are authoritative.

Nose confirmed at +Z by rendering both ends head-on: +Z shows amber headlights, −Z shows dark
red taillights. Three other signals agree (the longer low section — the hood, 1.04 vs 0.71 —
is at +Z, Kenney's front wheels are at +Z, and the SUV's rear overhang is the longer one).

## Damage zones

25 zones in `src/zones.ts`, each a named anchor point plus a tint radius.

- Shared: `front_bumper`, `hood`, `windshield`, `roof`, `rear_window`, `trunk`, `rear_bumper`
- Per side (`left_` / `right_`): `front_fender`, `front_door`, `rear_door`,
  `quarter_panel`, `mirror`, `front_wheel`, `rear_wheel`, `headlight`, `taillight`

A click raycasts the body and wheel meshes; the zone is the **nearest anchor to the hit
point**. Per-zone meshes are out of scope for v1.

The kit sedan does have wing mirrors — a vertex sample finds them at |x|>0.68, y 0.70–0.80,
z 0.32–0.42 — so the mirror zones have real geometry to be clicked on and no stubs are needed.

## Severity

Fixed four: `scratch`, `dent`, `crack`, `missing`. A small picker appears after a tap.
Optional free-text note per damage. Tapping an existing marker reopens the picker with a
delete — without that, a mis-tap is permanent.

## Output

```json
{ "schema": "claim-marker/1", "vehicle": "sedan", "damages": [
    { "zone": "front_bumper", "point": [0, 0.5, 1.2], "severity": "dent", "note": "" } ] }
```

`export()` returns `{ json, png }` — the JSON above and a PNG data URL of the current view
with markers visible (`preserveDrawingBuffer` on the canvas). `load(json)` restores state,
so an adjuster can reopen what the customer marked. Export → load → export is identical,
and that round-trip is a test.

## Embedding

One build, two entry points:

1. React — `<DamageMarker vehicle="sedan" value={...} onChange={...} />`
2. Vanilla — `mount(el, { vehicle, value, onChange })` → `{ export, load, destroy }`

`dist/` is ESM plus types, ~72 kB gzipped with the model inlined as a data URI — Vite's lib
mode always inlines assets, and here that is the wanted behaviour: one self-contained file and
no "remember to copy the .glb" step. `modelUrl` overrides it for CDN hosting.

Externals must match subpaths, not just bare names: `react-dom` alone leaves `react-dom/client`
bundled, which silently added ~700 kB before it was caught.

No custom-element wrapper.

## Decisions taken here

**Zone tint.** The body is a single mesh, so the tint is a radial falloff around the anchor
injected via `onBeforeCompile`, with one radius per zone. It hugs the panel; a decal sphere
would float.

**Per-instance store.** `createMarkerStore()` passed to the scene as a prop. A module-level
zustand store would leak state between two widgets on one page, and r3f's `<Canvas>` is a
separate reconciler root that React context does not cross.

**Injected CSS, not Tailwind.** The widget cannot require the host app to run Tailwind, so
its own UI ships ~40 lines of CSS injected once under a `.cm-` scope. Tailwind is for the
demo page only.

**No network at runtime.** Lighting is `<Lightformer>`s inside `<Environment>` rather than
a drei preset, because presets fetch an HDRI from a CDN — unacceptable inside someone's
claims form. Local lights plus `ContactShadows` on a neutral ground.

**Types from `tsc`.** `emitDeclarationOnly` into `dist/`, no dts plugin. Externals are
everything in `dependencies` and `peerDependencies` (react, react-dom, three), so consumers
get no duplicate three.js.

**PNG is the current view as-is** — literally what the user is looking at.

**The .glb is modified.** Kenney's GLBs reference `Textures/colormap.png` as an external URI,
which cannot resolve once a bundler hashes the asset, so the texture is inlined as a data URI
by `scripts/embed-texture.mjs` (172 KB → 189 KB) and the model ships self-contained.

## Deliberately not built

IIFE/CDN bundle (add when someone wants a `<script>` tag) · custom element · SUV and pickup
· multi-vehicle picker · photo upload · i18n · mobile-specific UI beyond working taps.

## Verification

`npm run lint`, `npm test` (zone classification, schema round-trip), `npm run build`, and a
screenshot of the demo page with two damages marked. Licence MIT; assets CC0 with
attribution in `LICENSE-ASSETS.md`.
