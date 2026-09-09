/**
 * Geography on a sphere, in the units a map wants: positions are `[lng, lat]`, bearings are
 * degrees clockwise from north, distances are metres. Spherical formulas throughout — over
 * the few hundred metres an accident covers the difference from an ellipsoid is millimetres.
 */
export type LngLat = [number, number]

/** MapLibre's own earth radius, so distances here agree with the map's */
export const EARTH_RADIUS = 6371008.8

export const toRad = (deg: number) => (deg * Math.PI) / 180
export const toDeg = (rad: number) => (rad * 180) / Math.PI

export const normalizeBearing = (deg: number) => ((deg % 360) + 360) % 360

/** six decimals is about a decimetre, plenty for where a car stopped, and keeps round trips stable */
export const round6 = (n: number) => Math.round(n * 1e6) / 1e6
export const roundLngLat = ([lng, lat]: LngLat): LngLat => [round6(lng), round6(lat)]

/** initial bearing from `a` towards `b`, 0–360 */
export function bearing(a: LngLat, b: LngLat): number {
  const φ1 = toRad(a[1])
  const φ2 = toRad(b[1])
  const Δλ = toRad(b[0] - a[0])
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return normalizeBearing(toDeg(Math.atan2(y, x)))
}

/** the point `metres` away from `origin` along `bearingDeg` */
export function destination(origin: LngLat, bearingDeg: number, metres: number): LngLat {
  const δ = metres / EARTH_RADIUS
  const θ = toRad(bearingDeg)
  const φ1 = toRad(origin[1])
  const λ1 = toRad(origin[0])
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ))
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2))
  return [normalizeLng(toDeg(λ2)), toDeg(φ2)]
}

/** great-circle distance in metres */
export function distance(a: LngLat, b: LngLat): number {
  const φ1 = toRad(a[1])
  const φ2 = toRad(b[1])
  const Δφ = φ2 - φ1
  const Δλ = toRad(b[0] - a[0])
  const h = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(h))
}

const normalizeLng = (lng: number) => ((((lng + 180) % 360) + 360) % 360) - 180
