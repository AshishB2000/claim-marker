import type { V3 } from '../zones'

/** the marker orbits this point — roughly the middle of the body */
export const ORBIT_TARGET: V3 = [0, 0.62, 0]

const DEG = Math.PI / 180
/** a beltline hit is seen from just above eye level, the roof from well above */
const ELEVATION_LOW = 20 * DEG
const ELEVATION_HIGH = 60 * DEG
/** body heights across the three kits: sills at ~0.15, roofs at 1.30 */
const Y_LOW = 0.4
const Y_HIGH = 1.25

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/**
 * Where the camera should sit to look straight at a damage point.
 *
 * The camera goes on the ray from the orbit target out through the point's horizontal
 * direction, at the current orbit distance so the zoom level is kept, and lifted to an
 * elevation that rises with the point's height: a door is seen from the side, a roof from
 * above. Near the centre line — the roof, the middle of the hood — the horizontal direction
 * is unstable, so it blends towards `fallback`, which is where the camera already is.
 */
export function cameraFor(point: V3, distance: number, target: V3 = ORBIT_TARGET, fallback: [number, number] = [1, 1]): V3 {
  const dx = point[0] - target[0]
  const dz = point[2] - target[2]
  const h = Math.hypot(dx, dz)
  const w = clamp01(h / 0.6)

  const fl = Math.hypot(fallback[0], fallback[1]) || 1
  let ux = (h > 0 ? (dx / h) * w : 0) + (fallback[0] / fl) * (1 - w)
  let uz = (h > 0 ? (dz / h) * w : 0) + (fallback[1] / fl) * (1 - w)
  const ul = Math.hypot(ux, uz) || 1
  ux /= ul
  uz /= ul

  const t = clamp01((point[1] - Y_LOW) / (Y_HIGH - Y_LOW))
  const el = ELEVATION_LOW + (ELEVATION_HIGH - ELEVATION_LOW) * t
  const flat = Math.cos(el) * distance

  return [target[0] + ux * flat, target[1] + Math.sin(el) * distance, target[2] + uz * flat]
}
