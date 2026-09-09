/**
 * What the diagram is drawn on. Two are the real place from above and need no key, so the
 * page works out of the box (an insurer with a keyed provider changes two env variables);
 * two are drawn, for the places a map cannot show: a covered car park, a garage, a driveway
 * under trees. All four are MapLibre styles, so the cars, paths and markers are the same on
 * every one and the review page and the export need nothing special.
 *
 * Both maps are raster, and both are Esri. Two other providers were tried and rejected
 * against live tiles: OpenFreeMap's vector planet answers 200 with an empty body for every
 * tile worldwide, so the style painted its background colour and nothing else — a blank
 * cream page with an attribution bar; CARTO's free raster tiles now come back stamped
 * "API KEY REQUIRED" across the image. Raster is one request per tile with no client-side
 * styling to go wrong, which is what a claims form wants.
 */
import type { StyleSpecification } from 'maplibre-gl'
import type { Feature } from 'geojson'
import { destination, type LngLat } from '../geo'
import type { Surface } from '../claim/schema'

export type MapStyle = Surface

export const SURFACE_LABEL: Record<Surface, string> = {
  satellite: 'Satellite',
  streets: 'Street map',
  lot: 'Parking lot',
  paper: 'Blank sheet',
}

const STREET_TILES: string =
  import.meta.env.VITE_MAP_TILES_STREETS ??
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'

const IMAGERY: string =
  import.meta.env.VITE_MAP_TILES_SATELLITE ??
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

/** Esri World Street Map: named roads and buildings, legible at street zoom, keyless */
export const STREETS: StyleSpecification = {
  version: 8,
  sources: {
    streets: {
      type: 'raster',
      tiles: [STREET_TILES],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Esri, HERE, Garmin, © OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'streets', type: 'raster', source: 'streets' }],
}

/** Esri World Imagery, overscaled past 19 where it stops */
export const SATELLITE: StyleSpecification = {
  version: 8,
  sources: {
    imagery: {
      type: 'raster',
      tiles: [IMAGERY],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    },
  },
  layers: [{ id: 'imagery', type: 'raster', source: 'imagery' }],
}

// ── drawn grounds ────────────────────────────────────────────────────
// Everything is laid out in metres east (x) and north (y) of the incident, so the sheet is
// centred on it and the cars spawn onto it. GeoJSON lines rather than a tiled pattern: they
// stay in metres at every zoom.

/** a straight line from one metre offset to another, as a feature */
function line(center: LngLat, from: [number, number], to: [number, number], properties: Record<string, unknown> = {}): Feature {
  const at = ([x, y]: [number, number]) => destination(destination(center, 90, x), 0, y)
  return { type: 'Feature', properties, geometry: { type: 'LineString', coordinates: [at(from), at(to)] } }
}

/** how far the drawn ground extends from the incident, in metres; well past the minimum zoom's view */
export const SHEET = 200

/** blank sheet: squared paper, a line every 5 m and a heavier one every 25 m */
export function paperLines(center: LngLat): Feature[] {
  const lines: Feature[] = []
  for (let n = -SHEET; n <= SHEET; n += 5) {
    const major = n % 25 === 0
    lines.push(line(center, [n, -SHEET], [n, SHEET], { major }))
    lines.push(line(center, [-SHEET, n], [SHEET, n], { major }))
  }
  return lines
}

/** a standard bay and aisle: 2.7 m wide bays, 5.5 m deep, 7 m aisles between double rows */
export const BAY = { width: 2.7, depth: 5.5, aisle: 7 }

/**
 * Parking lot: rows of bays back to back, an aisle between each pair of rows, running
 * east–west with the incident in the middle of an aisle so the cars start on tarmac.
 */
export function lotLines(center: LngLat): Feature[] {
  const lines: Feature[] = []
  const period = BAY.aisle + 2 * BAY.depth
  const half = Math.floor((SHEET - BAY.aisle / 2) / period)
  const width = Math.floor(SHEET / BAY.width) * BAY.width
  for (let k = -half; k <= half; k++) {
    // each double row: near edge, the line where the two rows meet, far edge
    const near = k * period + BAY.aisle / 2
    for (const y of [near, near + BAY.depth, near + 2 * BAY.depth]) lines.push(line(center, [-width, y], [width, y]))
    for (let x = -width; x <= width; x += BAY.width) lines.push(line(center, [x, near], [x, near + 2 * BAY.depth]))
  }
  return lines
}

function drawn(ground: string, ink: string, lines: Feature[], width: unknown): StyleSpecification {
  return {
    version: 8,
    sources: { sheet: { type: 'geojson', data: { type: 'FeatureCollection', features: lines } } },
    layers: [
      { id: 'ground', type: 'background', paint: { 'background-color': ground } },
      { id: 'sheet', type: 'line', source: 'sheet', paint: { 'line-color': ink, 'line-width': width as number, 'line-opacity': 0.9 } },
    ],
  }
}

export const paperStyle = (center: LngLat) => drawn('#eef2f7', '#c9d2df', paperLines(center), ['case', ['get', 'major'], 1.4, 0.7])
export const lotStyle = (center: LngLat) => drawn('#4b5361', '#e8ebef', lotLines(center), 2)

export function styleFor(style: MapStyle, center: LngLat): StyleSpecification {
  switch (style) {
    case 'satellite':
      return SATELLITE
    case 'streets':
      return STREETS
    case 'lot':
      return lotStyle(center)
    case 'paper':
      return paperStyle(center)
  }
}
