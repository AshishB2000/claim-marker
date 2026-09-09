/**
 * Playing the scenario back: every vehicle drives its route — the path it was dragged along,
 * ending where it came to rest — and they all arrive together, at the moment of impact.
 * Pure functions over the claim; the frame loop lives in `usePlayback`.
 */
import { bearing, destination, distance, type LngLat } from '../geo'
import type { ClaimVehicle } from '../claim/schema'
import type { CarPose } from './carLayer'

/** about 20 km/h: a diagram's pace, not the road's */
export const SPEED = 6
export const MIN_MS = 1500
export const MAX_MS = 6000

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/** the route in travel order, or null for a vehicle not yet on the map */
export const routeOf = (v: ClaimVehicle): LngLat[] | null => (v.position ? [...v.path, v.position] : null)

export function lengthOf(points: LngLat[]): number {
  let m = 0
  for (let i = 1; i < points.length; i++) m += distance(points[i - 1], points[i])
  return m
}

/** the point `metres` along the route and the way it is heading there; null bearing for a route with no length */
export function along(points: LngLat[], metres: number): { position: LngLat; bearing: number | null } {
  let left = Math.max(0, metres)
  let last: number | null = null
  for (let i = 1; i < points.length; i++) {
    const seg = distance(points[i - 1], points[i])
    if (seg === 0) continue
    last = bearing(points[i - 1], points[i])
    if (left <= seg) return { position: destination(points[i - 1], last, left), bearing: last }
    left -= seg
  }
  return { position: points[points.length - 1], bearing: last }
}

/** the longest route sets the clock, within limits a person will sit through */
export function durationOf(vehicles: ClaimVehicle[]): number {
  const longest = Math.max(0, ...vehicles.map((v) => (routeOf(v) ? lengthOf(routeOf(v)!) : 0)))
  return Math.min(MAX_MS, Math.max(MIN_MS, (longest / SPEED) * 1000))
}

/** the shortest turn from `a` to `b`, `t` of the way round */
export function lerpAngle(a: number, b: number, t: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180
  return (((a + d * t) % 360) + 360) % 360
}

/** where every vehicle is `t` (0–1) of the way through the playback */
export function posesAt(vehicles: ClaimVehicle[], t: number): CarPose[] {
  const out: CarPose[] = []
  for (const v of vehicles) {
    const route = routeOf(v)
    if (!route) continue
    const { position, bearing: b } = along(route, lengthOf(route) * clamp01(t))
    // the nose follows the road, then settles to how the car came to rest over the last stretch
    const heading = b === null ? v.heading : lerpAngle(b, v.heading, clamp01((t - 0.8) / 0.2))
    out.push({ id: v.id, body: v.body, color: v.color, position, heading })
  }
  return out
}
