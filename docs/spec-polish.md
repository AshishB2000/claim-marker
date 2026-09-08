# claim-marker — presentation pass (v3)

The two widgets work. This pass makes them look like a product: a dark theme, the feedback a
3D tool is expected to give (what am I pointing at, which pin is which), and a demo page that
shows the widgets inside a claim flow rather than beside a JSON dump.

Nothing here changes either schema. `claim-marker/1` and `claim-scenario/1` are untouched and
the round-trip tests stay as they are.

## Theme

Both widgets take `theme?: 'light' | 'dark'`, default `light`. A claims portal comes in both,
and a widget that only looks right on white is a widget the dark portal cannot use.

The injected CSS becomes a set of custom properties on `.cm-root` (`--cm-bg`, `--cm-panel`,
`--cm-text`, `--cm-muted`, `--cm-line`, `--cm-accent`) with the dark values on
`.cm-root.cm-dark`. The canvas clear colour and the scenario's ground read the same choice
through a `THEME` table in `src/theme.ts`, because a `<color attach="background">` cannot read
CSS. Host apps that want a third look override the properties; that is the whole theming API.

## Damage marker

**Hover label.** Moving over the body already tints the zone; now it also names it. A small
`<Html>` chip at the zone's anchor reads "Right front door". It disappears while a picker is open
so the two never overlap.

**Numbered pins.** Each pin carries its index, so the list beside the widget and the pins on the
car can be matched by eye. The digit is a `CanvasTexture` drawn at mount, cached per digit — not
drei `<Text>`, which loads a font from a CDN, and not `<Html>`, which would not appear in the
exported PNG.

**Fly-to.** Tapping a pin eases the camera round to face it. `cameraFor(point)` is a pure function:
the camera sits on the ray from the car's centre through the damage point, pushed out to the
current orbit distance and lifted to a fixed elevation, so a roof damage is seen from above and a
door from the side. `CameraRig` damps camera and target towards it each frame and gives up the
moment the user grabs the controls, so it never fights a drag. The function has a unit test; the
rig is verified in the smoke script.

**Idle turntable.** Auto-rotate until the first pointer down on the widget, then never again for
that instance. A showcase touch that costs one boolean.

**Floor.** A faint drei `<Grid>` under the car, fading with distance. It reads as a measuring
surface and gives the dark theme something to stand on.

## Scenario builder

**Direction of travel.** Path lines are dashed and the dash offset advances each frame, so the
line visibly flows towards the vehicle. This is a visual cue on a static path, not playback:
no timing enters the document, and [spec-scenario.md](spec-scenario.md)'s decision against
animation stands.

**Ground.** The same `<Grid>` under the layouts, and theme-aware ground and asphalt colours. The
asphalt is re-measured with `scripts/pixel.mjs` for both themes, since v2 found the lighting
washed it out.

**Note.** The document has a `note` and the store has `setNote`, but nothing rendered a field.
The demo edits it through the controlled `value` / `onChange` pair, which also gives the demo
a genuine controlled-mode example. The widget itself does not grow a text field: the host's
form is the right place for free text.

That exposed a wart in controlled mode: every keystroke re-sends the whole document, and
`load` used to clear the selection and close the damage overlay each time. It now keeps both
when the vehicle they refer to is still in the document, so typing beside the diagram no
longer deselects the car in it.

## Demo

Rebuilt as a first-notice-of-loss step, dark by default with a light toggle that drives the
widgets' `theme` prop. The stage is the widget; beside it a claim summary (vehicle cards, damage
rows numbered to match the pins, impact, note), a body picker for the marker so all three models
are one click away, a syntax-coloured schema view with copy, and a snapshot of the PNG `export()`
would return — the export path shown, not described.

Tailwind, demo only, as before. Button names and the `<pre>` the scripts read are kept, so
`smoke.mjs` and `shoot.mjs` still drive it.

## Deliberately not built

Animated playback (see v2) · a `select(index)` on the marker handle · per-zone meshes · a
2D silhouette summary · custom element.

## Verification

`npm run lint`, `npm test` (plus `cameraFor`), `npm run build`, `node scripts/smoke.mjs` (now
also: both roots get `.cm-dark`, hovering names a zone, committing a damage centres it), and
`node scripts/shoot.mjs` regenerating the README images in the dark theme.

**Screenshots wait for a frame, not a timer.** three.js links shader programs in parallel and
skips any object whose program is not ready, and under headless software GL the lit materials
take several seconds to come up. A fixed 4 s wait was capturing frames with nothing on them
but the unlit path lines — which looked exactly like a broken Suspense boundary and cost an
hour. Both scripts now poll the canvas for at least fifty distinct colours before they read it.
