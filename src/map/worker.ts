/**
 * Where MapLibre's worker comes from. Import this before creating a map.
 *
 * maplibre-gl 6 starts its worker from a module file beside its own bundle —
 * `new Worker(new URL('./maplibre-gl-worker.mjs', import.meta.url))` — and Vite serves the
 * bundle from somewhere else: in dev a pre-bundled copy in .vite/deps/, in production a
 * hashed chunk in assets/. Neither has the worker file next to it, so the URL is a 404, the
 * worker never answers, and everything that needs it waits for ever with no error: GeoJSON
 * sources never render (the travel paths and arrowheads were invisible for three commits),
 * vector tiles never decode (which is what made a vector street map look "still loading"),
 * and `isStyleLoaded()` stays false for the life of the map.
 *
 * `?worker&url` has Vite bundle the worker itself — with the shared module it imports — and
 * hand back a URL that is right in both dev and the build.
 */
import { setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

setWorkerUrl(workerUrl)
