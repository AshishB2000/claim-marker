/**
 * Between the map's `[lng, lat]` and the metric frame the assistant works in: metres east
 * and north of the incident. Exact inverses of each other, which a test pins.
 */
import { bearing, destination, distance, toDeg, toRad, type LngLat } from '../geo'
import type { Metres } from './schema'

/** a centimetre is far finer than a diagram needs and keeps the JSON small; `+ 0` so a
    hair west of the incident is 0 and not -0 */
const round = (n: number) => Math.round(n * 100) / 100 + 0

export function toFrame(center: LngLat, at: LngLat): Metres {
  const d = distance(center, at)
  const b = toRad(bearing(center, at))
  return [round(d * Math.sin(b)), round(d * Math.cos(b))]
}

export function fromFrame(center: LngLat, [east, north]: Metres): LngLat {
  if (east === 0 && north === 0) return center
  return destination(center, toDeg(Math.atan2(east, north)), Math.hypot(east, north))
}
