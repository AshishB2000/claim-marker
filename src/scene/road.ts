/**
 * The road the accident happened on, from OpenStreetMap via Overpass: its name, class, lanes,
 * direction, posted limit, whether it is lit, what junction it is, and what controls the
 * junction — plus the ways themselves as GeoJSON so the diagram can draw them.
 *
 * `parseRoad` is pure (no network) so it can be unit-tested against literal Overpass fixtures;
 * `fetchRoad` is the only impure function, and it never throws — a bad response is exactly as
 * useful to a claim as no response, so every failure just resolves to `null`.
 */
import type { FeatureCollection, LineString } from 'geojson'
import { bearing, distance, normalizeBearing, toRad, type LngLat } from '../geo'
import type { Junction, SceneRoad } from '../claim/schema'

/** a build-time provider setting, like the tile and geocoder URLs — not a runtime `config` one */
const OVERPASS_URL: string = import.meta.env.VITE_ROADS_URL ?? 'https://overpass-api.de/api/interpreter'

/** metres around the incident that the Overpass query asks for */
export const ROAD_RADIUS = 60

/** metres a way or a control node must be within to count as *at* the junction, not just nearby */
const JUNCTION_RADIUS = 25

const CACHE_PREFIX = 'claim-marker/road/'

export type RoadResult = {
  road: SceneRoad
  ways: FeatureCollection<LineString, { name: string; class: string; lanes: number | null }>
}

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

  return { road, ways }
}

/** the Overpass QL text, so a test can assert it and a reader can paste it in to see what came back */
export function roadQuery(at: LngLat): string {
  const [lng, lat] = at
  const around = `(around:${ROAD_RADIUS},${lat},${lng})`
  return (
    `[out:json][timeout:10];` +
    `(way[highway]${around};node[highway~"^(traffic_signals|stop|give_way|crossing)$"]${around};);` +
    `out body; >; out skel qt;`
  )
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
      signal,
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
