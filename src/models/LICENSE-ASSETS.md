# Asset licences

The source code in this repository is MIT licensed (see `LICENSE`). The bundled 3D assets
are listed here under their own terms.

## Vehicle model

**`sedan.glb`**, **`suv.glb`**, **`truck.glb`**, **`hatchback.glb`** (the kit's
`hatchback-sports.glb`), **`coupe.glb`** (`sedan-sports.glb`), **`van.glb`** and
**`box_truck.glb`** (`delivery.glb`) — from Kenney's
[Car Kit](https://kenney.nl/assets/car-kit) (version 3.1), created and distributed by
[Kenney](https://kenney.nl).

Licensed **[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)** —
public domain. Free for personal, educational and commercial use. Attribution is not
required; it is given here anyway, and Kenney asks that you consider
[donating](https://kenney.nl/donate).

**Change made:** taken from the kit's `Models/GLB format/` with their textures inlined. Kenney
ships the GLBs referencing `Textures/colormap.png` as an external file, which cannot be resolved
once a bundler hashes the asset, so `scripts/embed-texture.mjs` rewrote that reference as a base64
data URI in each (sedan 172→189 KB, suv 208→224 KB, truck 176→193 KB, hatchback 198→214 KB,
coupe 178→194 KB, van 176→192 KB, box_truck 240→257 KB). Geometry, materials and UVs are untouched.

CC0 places no conditions on modification or redistribution; the change is recorded here so the
provenance stays clear.

All seven share the same units and frame, and most share one node layout — a `body` mesh plus
four wheel meshes — which is what makes adding a further body a matter of data rather than
code. Two carry an extra mesh: the coupe has a `spoiler` parented to `body`, and the box truck
has a top-level `door` (its roll-up rear shutter) and uses the kit's larger truck wheels.

## No third-party trademarks

The vehicles are generic low-poly bodies. Nothing here depicts, is derived from, or is
endorsed by any real manufacturer.

## Lighting and textures

`public/hdr/studio_small_09.hdr` is from [Poly Haven](https://polyhaven.com/a/studio_small_09),
**CC0** (public domain, no attribution required; credited anyway), the 1K version.

`public/tex/flake_normal.png` and `public/tex/tread_normal.png` are procedurally generated
normal maps (a metallic-flake pattern and a tyre tread), originally made for `car-sim`; no
third-party rights apply.
