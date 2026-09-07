# Asset licences

The source code in this repository is MIT licensed (see `LICENSE`). The bundled 3D assets
are listed here under their own terms.

## Vehicle model

**`sedan.glb`**, **`suv.glb`** and **`truck.glb`** — from Kenney's
[Car Kit](https://kenney.nl/assets/car-kit) (version 3.1), created and distributed by
[Kenney](https://kenney.nl).

Licensed **[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)** —
public domain. Free for personal, educational and commercial use. Attribution is not
required; it is given here anyway, and Kenney asks that you consider
[donating](https://kenney.nl/donate).

**Change made:** taken from the kit's `Models/GLB format/` with their textures inlined. Kenney
ships the GLBs referencing `Textures/colormap.png` as an external file, which cannot be resolved
once a bundler hashes the asset, so `scripts/embed-texture.mjs` rewrote that reference as a base64
data URI in each (sedan 172→189 KB, suv 208→224 KB, truck 176→193 KB). Geometry, materials and UVs
are untouched.

CC0 places no conditions on modification or redistribution; the change is recorded here so the
provenance stays clear.

All three share an identical node layout (`body` plus four wheels) and the same units, which is
what makes adding a further body a matter of data rather than code.

## No third-party trademarks

The vehicle is a generic low-poly sedan. Nothing here depicts, is derived from, or is
endorsed by any real manufacturer.
