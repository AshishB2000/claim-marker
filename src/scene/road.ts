/**
 * The road the accident happened on, from OpenStreetMap via Overpass: its name, class, lanes,
 * direction, posted limit, whether it is lit, what junction it is, and what controls the
 * junction — plus the ways themselves as GeoJSON so the diagram can draw them, and the
 * building footprints a little further out so the cinematic replay has a city to fly through.
 *
 * `parseRoad` is pure (no network) so it can be unit-tested against literal Overpass fixtures;
 * `fetchRoad` is the only impure function, and it never throws — a bad response is exactly as
 * useful to a claim as no response, so every failure just resolves to `null`.
 */
import type { FeatureCollection, LineString, Polygon } from 'geojson'
import { bearing, distance, normalizeBearing, toRad, type LngLat } from '../geo'
import type { Junction, SceneRoad } from '../claim/schema'
import { withDeadline } from './timeout'

/**
 * A build-time provider setting, like the tile and geocoder URLs — not a runtime `config` one.
 *
 * The Kumi Systems mirror rather than `overpass-api.de`: the main instance answers 406 Not
 * Acceptable to every request from some networks — `/api/status` included, so it is the
 * instance refusing the client, not the query — and rate-limits the rest hard. Kumi is a
 * long-standing public mirror of the same database, answers `Access-Control-Allow-Origin: *`,
 * and needs no key. An insurer running their own instance points `VITE_ROADS_URL` at it.
 */
const OVERPASS_URL: string = import.meta.env.VITE_ROADS_URL ?? 'https://overpass.kumi.systems/api/interpreter'

/** metres around the incident that the Overpass query asks for */
export const ROAD_RADIUS = 60

/**
 * metres around the incident the same query asks for buildings in. Wider than the road,
 * because a tilted camera 4 m behind a car sees a street's worth of frontage, not a junction.
 */
export const BUILDING_RADIUS = 150

/** a storey's height in metres, and what a building with nothing to say about its own is drawn at */
const LEVEL_METRES = 3.2
const DEFAULT_HEIGHT = 8

/** metres from a way's centre line for the car to count as standing on it */
export const ALIGN_METRES = 3
/** degrees a car may already be off the road's line and still be "nearly lined up with it" */
export const ALIGN_DEGREES = 30

/** metres a way or a control node must be within to count as *at* the junction, not just nearby */
const JUNCTION_RADIUS = 25

const CACHE_PREFIX = 'claim-marker/road/'

export type RoadResult = {
  road: SceneRoad
  ways: FeatureCollection<LineString, { name: string; class: string; lanes: number | null }>
  /** the buildings around the incident, to extrude; empty where nobody has mapped any */
  buildings: BuildingCollection
}

export type BuildingCollection = FeatureCollection<Polygon, { height: number }>

type Tags = Record<string, string>
type OverpassNode = { type: 'node'; id: number; lat?: number; lon?: number; tags?: Tags }
type OverpassWay = { type: 'way'; id: number; nodes?: number[]; tags?: Tags }

/**
 * `highway` values that are not "the road" for a diagram: foot and cycle infrastructure and
 * steps. `service` stays in on purpose — a driveway or an access lane is still a road a car can
 * be on — except a `parking_aisle`, which is a lane between parked cars, not a way anyone drives
 * to get somewhere.
 */
const NOT_A_ROAD = new Set(['footway', 'path', 'cycleway', 'steps', 'pedestrian'])

const CONTROLS = new Set(['traffic_signals', 'stop', 'give_way', 'crossing'])

function isRoad(tags: Tags): boolean {
  const highway = tags.highway
  if (!highway || NOT_A_ROAD.has(highway)) return false
  if (highway === 'service' && tags.service === 'parking_aisle') return false
  return true
}

function laneCount(raw: string | undefined): number | null {
  const n = parseInt(raw ?? '', 10)
  return n >= 1 && n <= 12 ? n : null
}

/**
 * `at` projected to local east/north metres around `origin`, using the map's own spherical
 * `distance`/`bearing` rather than a proper geodesic projection. Over the tens of metres a
 * junction spans, the sphere and the tangent plane agree to well under a centimetre, so this
 * is a flat-earth approximation in every sense except the one that matters here.
 */
function toLocal(origin: LngLat, at: LngLat): [number, number] {
  const d = distance(origin, at)
  const rad = toRad(bearing(origin, at))
  return [d * Math.sin(rad), d * Math.cos(rad)]
}

/**
 * Perpendicular distance in metres from `at` to the nearest segment of `coords`, plus the
 * true (spherical) bearing of that segment — used both to pick the nearest road and, for the
 * two-arm case, to tell a junction from a road that is simply split into two OSM ways.
 */
function wayDistance(at: LngLat, coords: LngLat[]): { dist: number; segBearing: number } {
  let dist = Infinity
  let segBearing = 0
  for (let i = 0; i < coords.length - 1; i++) {
    const [ax, ay] = toLocal(at, coords[i])
    const [bx, by] = toLocal(at, coords[i + 1])
    const dx = bx - ax
    const dy = by - ay
    const lenSq = dx * dx + dy * dy
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, (-ax * dx - ay * dy) / lenSq))
    const d = Math.hypot(ax + t * dx, ay + t * dy)
    if (d < dist) {
      dist = d
      segBearing = bearing(coords[i], coords[i + 1])
    }
  }
  return { dist, segBearing }
}

type KeptWay = { tags: Tags; coords: LngLat[]; dist: number; segBearing: number }

/** the smallest circular difference between two bearings, 0–180° */
function bearingGap(a: number, b: number): number {
  const raw = normalizeBearing(a - b)
  return raw > 180 ? 360 - raw : raw
}

function classifyJunction(nearest: KeptWay, kept: KeptWay[]): Junction {
  const isRoundabout = (w: KeptWay) => w.tags.junction === 'roundabout' || w.tags.highway === 'mini_roundabout'
  const nearby = kept.filter((w) => w.dist <= JUNCTION_RADIUS)
  if (isRoundabout(nearest) || nearby.some(isRoundabout)) return 'roundabout'
  if (nearby.length <= 1) return 'none'
  if (nearby.length === 2) {
    const gap = bearingGap(nearby[0].segBearing, nearby[1].segBearing)
    const sameRoadContinuing = gap <= 30 || gap >= 150
    return sameRoadContinuing ? 'none' : 'T'
  }
  if (nearby.length === 3) return 'T'
  return 'cross'
}

function collectControls(at: LngLat, nodes: OverpassNode[]): string[] {
  const found = new Set<string>()
  for (const n of nodes) {
    const value = n.tags?.highway
    if (value && CONTROLS.has(value) && n.lat !== undefined && n.lon !== undefined) {
      if (distance(at, [n.lon, n.lat]) <= JUNCTION_RADIUS) found.add(value)
    }
  }
  return [...found].sort()
}

function elementsOf(json: unknown): unknown[] | null {
  if (!json || typeof json !== 'object') return null
  const elements = (json as { elements?: unknown }).elements
  return Array.isArray(elements) ? elements : null
}

/**
 * Turns an Overpass `out body; >; out skel qt;` response into the road at `at`, or `null` when
 * nothing usable came back. Pure — no network, so it is what the tests exercise directly.
 */
export function parseRoad(json: unknown, at: LngLat): RoadResult | null {
  const elements = elementsOf(json)
  if (!elements) return null

  const nodePos = new Map<number, LngLat>()
  const nodes: OverpassNode[] = []
  for (const el of elements) {
    if (el && typeof el === 'object' && (el as { type?: unknown }).type === 'node') {
      const n = el as OverpassNode
      nodes.push(n)
      if (n.lat !== undefined && n.lon !== undefined) nodePos.set(n.id, [n.lon, n.lat])
    }
  }

  const kept: KeptWay[] = []
  for (const el of elements) {
    if (!(el && typeof el === 'object' && (el as { type?: unknown }).type === 'way')) continue
    const w = el as OverpassWay
    const tags = w.tags ?? {}
    if (!isRoad(tags)) continue
    const coords: LngLat[] = []
    for (const id of w.nodes ?? []) {
      const pos = nodePos.get(id)
      if (!pos) break
      coords.push(pos)
    }
    if (coords.length < 2 || coords.length !== (w.nodes ?? []).length) continue
    kept.push({ tags, coords, ...wayDistance(at, coords) })
  }
  if (kept.length === 0) return null

  const nearest = kept.reduce((a, b) => (b.dist < a.dist ? b : a))
  const road: SceneRoad = {
    name: nearest.tags.name ?? '',
    class: nearest.tags.highway,
    lanes: laneCount(nearest.tags.lanes),
    oneway: ['yes', 'true', '1', '-1'].includes((nearest.tags.oneway ?? '').trim()),
    maxspeed: (nearest.tags.maxspeed ?? '').trim(),
    lit: nearest.tags.lit === 'yes' ? true : nearest.tags.lit === 'no' ? false : null,
    junction: classifyJunction(nearest, kept),
    controls: collectControls(at, nodes),
  }

  const ways: RoadResult['ways'] = {
    type: 'FeatureCollection',
    features: kept.map((w) => ({
      type: 'Feature',
      properties: { name: w.tags.name ?? '', class: w.tags.highway, lanes: laneCount(w.tags.lanes) },
      geometry: { type: 'LineString', coordinates: w.coords },
    })),
  }

  // buildings ride along with the road because they come out of the same answer; a place with
  // no road in it has no result at all to hang them on, which is the same as having none
  return { road, ways, buildings: parseBuildings(json) }
}

/**
 * Roofs a car drives under — a fuel station's canopy, a carport, a parking or garage structure.
 * These are where accidents happen, and a solid block drawn over the cars would hide them.
 */
const COVERED = new Set(['roof', 'carport', 'parking', 'garage', 'garages'])

/**
 * How tall to draw a building. `height` is metres by OSM convention and may carry a unit
 * ("12 m"), which `parseFloat` drops; failing that `building:levels` at 3.2 m a storey; failing
 * both, a default low enough that a mis-tagged corner shop never becomes a tower. Absurd values
 * — a negative height, a thousand storeys — are treated as no answer, not as geometry.
 */
function buildingHeight(tags: Tags): number {
  const metres = parseFloat(tags.height ?? '')
  if (metres > 0 && metres < 1000) return Math.round(metres * 10) / 10
  const levels = parseFloat(tags['building:levels'] ?? '')
  if (levels > 0 && levels < 200) return Math.round(levels * LEVEL_METRES * 10) / 10
  return DEFAULT_HEIGHT
}

/**
 * The building footprints in an Overpass answer, as polygons carrying the height to extrude
 * them to. Pure, and separate from `parseRoad` so a fixture can be held against it directly.
 *
 * Only closed ways: an open `building` way is either a mapping error or one wall of a
 * multipolygon whose other parts are not in the answer, and half a building drawn as a solid
 * is worse than no building. Relations are not asked for at all.
 */
export function parseBuildings(json: unknown): BuildingCollection {
  const elements = elementsOf(json)
  const features: BuildingCollection['features'] = []
  if (!elements) return { type: 'FeatureCollection', features }

  const nodePos = new Map<number, LngLat>()
  for (const el of elements) {
    if (el && typeof el === 'object' && (el as { type?: unknown }).type === 'node') {
      const n = el as OverpassNode
      if (n.lat !== undefined && n.lon !== undefined) nodePos.set(n.id, [n.lon, n.lat])
    }
  }

  for (const el of elements) {
    if (!(el && typeof el === 'object' && (el as { type?: unknown }).type === 'way')) continue
    const w = el as OverpassWay
    const tags = w.tags ?? {}
    if (!tags.building || tags.building === 'no' || COVERED.has(tags.building)) continue
    const ids = w.nodes ?? []
    const ring: LngLat[] = []
    for (const id of ids) {
      const pos = nodePos.get(id)
      if (!pos) break
      ring.push(pos)
    }
    if (ring.length !== ids.length || ring.length < 4) continue
    const [firstLng, firstLat] = ring[0]
    const [lastLng, lastLat] = ring[ring.length - 1]
    if (firstLng !== lastLng || firstLat !== lastLat) continue
    features.push({
      type: 'Feature',
      properties: { height: buildingHeight(tags) },
      geometry: { type: 'Polygon', coordinates: [ring] },
    })
  }
  return { type: 'FeatureCollection', features }
}

/** the Overpass QL text, so a test can assert it and a reader can paste it in to see what came back */
export function roadQuery(at: LngLat): string {
  const [lng, lat] = at
  const around = `(around:${ROAD_RADIUS},${lat},${lng})`
  const block = `(around:${BUILDING_RADIUS},${lat},${lng})`
  return (
    `[out:json][timeout:10];` +
    `(way[highway]${around};node[highway~"^(traffic_signals|stop|give_way|crossing)$"]${around};way[building]${block};);` +
    `out body; >; out skel qt;`
  )
}

/**
 * The compass bearing of the nearest way's line under `position` — but only offered when the
 * car is already close to that line and already roughly pointing along it, so a car mid-turn
 * or one that is actually off the road gets no suggestion. "Along it" ignores direction: a car
 * facing either way down a two-way street is lined up, so the segment's bearing and its
 * reciprocal are both checked and the nearer of the two to `heading` is what is returned.
 * Reuses `wayDistance`, the same point-to-segment maths `parseRoad` uses to find the nearest
 * way, so there is one definition of "distance to a road" in this file, not two.
 */
export function alignToRoad(ways: FeatureCollection<LineString> | null, position: LngLat, heading: number): number | null {
  if (!ways) return null
  let nearest: { dist: number; segBearing: number } | null = null
  for (const f of ways.features) {
    const { dist, segBearing } = wayDistance(position, f.geometry.coordinates as LngLat[])
    if (!nearest || dist < nearest.dist) nearest = { dist, segBearing }
  }
  if (!nearest || nearest.dist > ALIGN_METRES) return null
  const reciprocal = normalizeBearing(nearest.segBearing + 180)
  const forwardGap = bearingGap(heading, nearest.segBearing)
  const backGap = bearingGap(heading, reciprocal)
  if (Math.min(forwardGap, backGap) > ALIGN_DEGREES) return null
  return forwardGap <= backGap ? nearest.segBearing : reciprocal
}

function cacheKey(at: LngLat): string {
  return `${CACHE_PREFIX}${at[1].toFixed(4)},${at[0].toFixed(4)}`
}

/**
 * The road at `at`, cached in `sessionStorage` per rough location (4 decimals, ~11 m) since the
 * incident point does not move once set. Never throws: a network failure, a non-2xx, a
 * malformed body or an abort are all exactly as useful as no answer, so they all resolve `null`.
 */
export async function fetchRoad(at: LngLat, signal?: AbortSignal): Promise<RoadResult | null> {
  const key = cacheKey(at)
  try {
    const stored = sessionStorage.getItem(key)
    if (stored) return JSON.parse(stored) as RoadResult
  } catch {
    // storage is a convenience, not a requirement
  }
  try {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(roadQuery(at))}`,
      signal: withDeadline(signal),
    })
    if (!res.ok) return null
    const result = parseRoad(await res.json(), at)
    if (result) {
      try {
        sessionStorage.setItem(key, JSON.stringify(result))
      } catch {
        // ignore a full or disabled store
      }
    }
    return result
  } catch {
    return null
  }
}
