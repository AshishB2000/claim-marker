/**
 * Where a vehicle's model matrix comes from when the vehicle is drawn inside MapLibre.
 *
 * MapLibre hands a custom layer one projection matrix per frame that maps its world
 * coordinates — Web Mercator scaled to [0, 1], x east, y south, z up in the same units — to
 * clip space. A three.js scene rendered with that as the camera's projection matrix and no
 * view transform puts anything positioned in those units exactly on the map.
 *
 * The body models are Y-up with the nose at +Z and the car's left at +X (see zones.ts), a
 * right-handed frame. `CAR_BASIS` carries it into the map's frame with nose north, left
 * west, up up. That matrix has determinant −1 in the map's coordinates because the map's
 * (east, south, up) labelling is itself left-handed: physically it is a plain rotation, and
 * combined with the map's own projection the triangle winding comes out right, so nothing
 * needs a mirrored scale.
 */
import * as THREE from 'three'
import { EARTH_RADIUS, toRad, type LngLat } from '../geo'

const CIRCUMFERENCE = 2 * Math.PI * EARTH_RADIUS

/** MapLibre's MercatorCoordinate.fromLngLat, without importing MapLibre into a unit test */
export function mercator([lng, lat]: LngLat): { x: number; y: number } {
  return {
    x: (180 + lng) / 360,
    y: (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360,
  }
}

/** how many mercator units one metre is at this latitude — MapLibre's meterInMercatorCoordinateUnits */
export const metresToMercator = (lat: number) => 1 / (CIRCUMFERENCE * Math.cos(toRad(lat)))

const inv = new THREE.Matrix4()
const h = new THREE.Vector4()

/**
 * Where the eye is, read back from a perspective projection matrix. The eye is the one
 * point every perspective matrix sends to w = 0 along −z, so it is the pre-image of
 * (0, 0, −1, 0). three.js lights in view space and takes the eye to be the view-space origin;
 * with the map's projection used as the camera matrix and nothing else, that origin sits on
 * the ground among the cars, every roof is seen at a grazing angle, and Fresnel turns the
 * paint white. Placing the three camera here, and folding the same offset back into the
 * projection, keeps the clip result identical and makes view-dependent shading right.
 */
export function eyeFrom(projection: THREE.Matrix4, target = new THREE.Vector3()): THREE.Vector3 {
  inv.copy(projection).invert()
  h.set(0, 0, -1, 0).applyMatrix4(inv)
  if (Math.abs(h.w) < 1e-30) return target.set(0, 0, 0)
  target.set(h.x / h.w, h.y / h.w, h.z / h.w)
  return target
}

/** model (left, up, nose) → map (west, up, north) */
export const CAR_BASIS = new THREE.Matrix4().set(-1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1)

const S = new THREE.Matrix4()
const R = new THREE.Matrix4()

/**
 * The full model matrix for a body standing at `at`, nose pointing along `headingDeg`
 * (compass bearing, clockwise from north), with the model scaled by `scale` metres per unit.
 *
 * `origin` is the floating origin: positions are expressed relative to it and the layer
 * folds the same offset into the projection. Absolute mercator coordinates are ~0.3 with a
 * metre at 1e-7, which a float32 vertex shader cannot hold — cars would jitter by half a
 * metre at street zoom. Relative to a point a few metres away everything stays tiny.
 */
export function vehicleMatrix(at: LngLat, headingDeg: number, scale: number, origin: LngLat = at, target = new THREE.Matrix4()): THREE.Matrix4 {
  const m = mercator(at)
  const o = mercator(origin)
  const x = m.x - o.x
  const y = m.y - o.y
  const s = metresToMercator(at[1]) * scale
  // Ry(+θ) turns the nose from +Z towards +X, which is the car's left; a compass bearing
  // turns it clockwise, towards its right, hence the sign
  return target.makeTranslation(x, y, 0).multiply(S.makeScale(s, s, s)).multiply(CAR_BASIS).multiply(R.makeRotationY(-toRad(headingDeg)))
}
