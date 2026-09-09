import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { CAR_BASIS, eyeFrom, mercator, metresToMercator, vehicleMatrix } from '../src/map/transform'
import type { LngLat } from '../src/geo'

const AT: LngLat = [-73.9859, 40.7573]

/** where a model-space direction ends up on the map, relative to the vehicle's origin */
function mapped(m: THREE.Matrix4, dir: [number, number, number]) {
  const origin = new THREE.Vector3(0, 0, 0).applyMatrix4(m)
  return new THREE.Vector3(...dir).applyMatrix4(m).sub(origin)
}

describe('vehicleMatrix', () => {
  it('puts the origin at the mercator coordinate of the position, relative to the floating origin', () => {
    const ORIGIN: LngLat = [-73.9861, 40.7571]
    const o = new THREE.Vector3().applyMatrix4(vehicleMatrix(AT, 0, 1, ORIGIN))
    const m = mercator(AT)
    const f = mercator(ORIGIN)
    expect(o.x).toBeCloseTo(m.x - f.x, 15)
    expect(o.y).toBeCloseTo(m.y - f.y, 15)
    expect(o.z).toBeCloseTo(0, 15)
    // and with itself as origin it sits at zero, which is what keeps float32 honest
    expect(new THREE.Vector3().applyMatrix4(vehicleMatrix(AT, 0, 1)).length()).toBe(0)
  })

  it('heading 0 points the nose north, which is −y on a mercator map', () => {
    const nose = mapped(vehicleMatrix(AT, 0, 1), [0, 0, 1])
    expect(nose.y).toBeLessThan(0)
    expect(Math.abs(nose.x)).toBeLessThan(1e-12)
    expect(Math.abs(nose.z)).toBeLessThan(1e-12)
  })

  it('heading 90 points the nose east, 180 south, 270 west', () => {
    expect(mapped(vehicleMatrix(AT, 90, 1), [0, 0, 1]).x).toBeGreaterThan(0)
    expect(mapped(vehicleMatrix(AT, 180, 1), [0, 0, 1]).y).toBeGreaterThan(0)
    expect(mapped(vehicleMatrix(AT, 270, 1), [0, 0, 1]).x).toBeLessThan(0)
  })

  it('keeps the model upright: +Y goes to +z', () => {
    const up = mapped(vehicleMatrix(AT, 37, 1), [0, 1, 0])
    expect(up.z).toBeGreaterThan(0)
    expect(Math.abs(up.x)).toBeLessThan(1e-12)
    expect(Math.abs(up.y)).toBeLessThan(1e-12)
  })

  it('facing north, the car’s left (+X) is west and it is not mirrored', () => {
    const left = mapped(vehicleMatrix(AT, 0, 1), [1, 0, 0])
    expect(left.x).toBeLessThan(0)
    // physically a rotation: nose × left has the same sense as +Z × +X = +Y (up)
    const nose = mapped(vehicleMatrix(AT, 0, 1), [0, 0, 1])
    const up = mapped(vehicleMatrix(AT, 0, 1), [0, 1, 0])
    // in the map's left-handed (east, south, up) labelling a physical rotation shows as det −1
    expect(CAR_BASIS.determinant()).toBeCloseTo(-1, 12)
    // and the three images are still mutually perpendicular
    expect(nose.dot(left)).toBeCloseTo(0, 18)
    expect(nose.dot(up)).toBeCloseTo(0, 18)
  })

  it('one model unit is `scale` metres at that latitude', () => {
    const nose = mapped(vehicleMatrix(AT, 0, 1.5), [0, 0, 1])
    expect(nose.length() / (metresToMercator(AT[1]) * 1.5)).toBeCloseTo(1, 8)
  })

  it('mercator matches the reference values for a known point', () => {
    // MapLibre's MercatorCoordinate.fromLngLat([0, 0]) is (0.5, 0.5)
    expect(mercator([0, 0])).toEqual({ x: 0.5, y: 0.5 })
    // computed independently from the same Web Mercator definition
    const { x, y } = mercator(AT)
    expect(x).toBeCloseTo(0.2944836111, 9)
    expect(y).toBeCloseTo(0.3758176659, 9)
  })
})

describe('eyeFrom', () => {
  it('recovers a three.js camera position from its projection × view matrix', () => {
    const cam = new THREE.PerspectiveCamera(40, 1.6, 0.5, 400)
    cam.position.set(3, 4, 5)
    cam.lookAt(0, 0.5, 0)
    cam.updateMatrixWorld(true)
    const pv = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
    const eye = eyeFrom(pv)
    expect(eye.x).toBeCloseTo(3, 9)
    expect(eye.y).toBeCloseTo(4, 9)
    expect(eye.z).toBeCloseTo(5, 9)
  })

  it('is exact enough at map scale, where the eye is a few 1e-5 from the cars', () => {
    const cam = new THREE.PerspectiveCamera(40, 1.6, 1e-8, 1e-3)
    cam.position.set(0.2944837, 0.3758176, 3e-5)
    cam.lookAt(0.2944836, 0.3758170, 0)
    cam.updateMatrixWorld(true)
    const pv = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
    const eye = eyeFrom(pv)
    expect(eye.distanceTo(cam.position)).toBeLessThan(1e-12)
  })
})
