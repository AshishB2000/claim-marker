# claim-marker

Two embeddable widgets for a first-notice-of-loss form: a 3D vehicle damage marker and an
accident scenario builder. Ships as an npm package (ESM + types) with React and vanilla
entry points. No backend, no accounts, no AI.

Design decisions and their reasoning live in [docs/spec.md](docs/spec.md) and
[docs/spec-scenario.md](docs/spec-scenario.md). Read the relevant one before changing
behaviour it describes.

## Commands

```bash
npm run dev            # vite, http://localhost:5173
npm run lint           # oxlint — must be silent, warnings included
npm test               # vitest, 86 tests across 3 files
npm run build          # tsc -b, lib build, then .d.ts emit
```

Two end-to-end scripts need `npm run dev` running in another shell:

```bash
node scripts/smoke.mjs     # both vanilla mounts, damage write-back, drag, all 4 layouts
node scripts/shoot.mjs     # regenerates docs/*.png and asserts exports aren't blank frames
```

Helpers: `scripts/profile-body.mjs <glb>` prints the measurements zone anchors are placed
against; `scripts/embed-texture.mjs` inlines a Kenney texture; `scripts/pixel.mjs` samples
pixels out of a PNG so a render can be checked numerically instead of by eye.

## Sandbox

**Playwright and `gh` only work with `dangerouslyDisableSandbox: true`.** Both fail in ways
that look like real errors but are not:

- Chromium dies with `bootstrap_check_in ... Permission denied (1100)` — the sandbox blocks
  Mach port rendezvous.
- `gh` reports `token in default is invalid` and `x509: OSStatus -26276` — the sandbox blocks
  keychain access and the cert trust copy.

`npm install` needs it too (npm's cache lives outside the writable allowlist). Everything
else runs sandboxed normally.

## Conventions that are easy to get wrong

**Coordinate frame.** Nose at +Z, up +Y, the car's right at +X and left at −X — left/right as
seen from the driver's seat, the insurance convention. **Kenney's own node names disagree**
(`wheel-front-left` sits at +X), so ignore the names and trust coordinates. Ground positions
in the scenario are `[x, z]` in metres; `heading` is Y-rotation in radians.

**Zone anchors are measured, not eyeballed.** Every anchor in `src/zones.ts` comes from
`scripts/profile-body.mjs` output. A test asserts no zone's own anchor classifies as a
neighbour's — if that fails, the anchors are wrong, not the test.

**Schemas are versioned and frozen.** `claim-marker/1` and `claim-scenario/1` both guarantee
`export → load → export` is byte-identical, which is why coordinates round on the way in.
Adding a field is fine; changing or removing one means a new schema version, not an edit.
`parse` throws on structural nonsense but drops individual bad entries so one malformed
damage cannot lose the other twenty.

**drei `<Html>` paints over the canvas.** Any label or badge using it wins over all WebGL
geometry regardless of 3D depth. When something must appear above a `<Html>` element, it has
to be `<Html>` too with a higher `zIndexRange` — raising it in the 3D scene will not work.

**Drags track the pointer from `window`**, not r3f's `pointer`, which stops updating when the
cursor leaves the canvas and would freeze a drag under an overlay panel. Each drag intersects
a plane at the height of the handle being held, not `y = 0`.

**Widget CSS is injected, scoped under `.cm-`** (`src/style.ts`). The widgets cannot require
the host app to run Tailwind; Tailwind is for the demo page only.

## Layout

```
src/schema.ts zones.ts style.ts models.ts   shared by both widgets
src/marker/                                  damage marker
src/scenario/                                scenario builder
demo/                                        demo page, not shipped
```

## Before saying it works

Run `npm run lint`, `npm test`, `npm run build`, and — for anything touching rendering,
dragging or the demo — `node scripts/smoke.mjs`. Paste the real output. A screenshot that
looks right is not evidence the export path works; `scripts/shoot.mjs` reads the pixels back.

## Out of bounds

`~/Projects/car-sim` and `~/Projects/car-parts-site` are read-only reference. Never modify
them. Do not push unless asked.
