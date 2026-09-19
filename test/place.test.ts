import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { destination, type LngLat } from '../src/geo'
import { metresToMercator, vehicleMatrix } from '../src/map/transform'
import { placeVehicles } from '../src/marker/place'

const IMPACT: LngLat = [-73.9859, 40.7573]
const UP = new THREE.Vector3(0, 1, 0)

/** where a model-space direction points once the car is stood in the studio: three's rotation-y */
const turned = (rotationY: number, dir: [number, number, number]) => new THREE.Vector3(...dir).applyAxisAngle(UP, rotationY)

/** the same direction on the map, through the map layer's own matrix, as (east, south) and unit length */
function onMap(at: LngLat, heading: number, dir: [number, number, number]) {
  const m = vehicleMatrix(at, heading, 1, IMPACT)
  const o = new THREE.Vector3().applyMatrix4(m)
  const v = new THREE.Vector3(...dir).applyMatrix4(m).sub(o)
  return new THREE.Vector2(v.x, v.y).normalize()
}

describe('placeVehicles', () => {
  it('stands two cars at their offsets from the impact in metres: east is +x, north is −z, on the floor', () => {
    const a = destination(IMPACT, 90, 6) // six metres east
    const b = destination(IMPACT, 0, 4) // four metres north
    const [pa, pb] = placeVehicles(
      [
        { id: 'a', position: a, heading: 270 },
        { id: 'b', position: b, heading: 180 },
      ],
      IMPACT,
    )
    expect(pa.id).toBe('a')
    expect(pa.position[0]).toBeCloseTo(6, 2)
    expect(pa.position[1]).toBe(0)
    expect(pa.position[2]).toBeCloseTo(0, 2)
    expect(pb.id).toBe('b')
    expect(pb.position[0]).toBeCloseTo(0, 2)
    expect(pb.position[2]).toBeCloseTo(-4, 2)
  })

  it('puts a car on the impact at the origin, and a diagonal offset at its east and south components', () => {
    const sw = destination(IMPACT, 225, 10)
    const [at, off] = placeVehicles(
      [
        { id: 'a', position: IMPACT, heading: 0 },
        { id: 'b', position: sw, heading: 0 },
      ],
      IMPACT,
    )
    expect(at.position).toEqual([0, 0, 0])
    const r = 10 / Math.SQRT2
    expect(off.position[0]).toBeCloseTo(-r, 1) // west
    expect(off.position[2]).toBeCloseTo(r, 1) // south
  })

  it('turns the nose the way a compass bearing does: north faces −z, east +x, south +z, west −x', () => {
    const nose = (heading: number) => turned(placeVehicles([{ id: 'a', position: IMPACT, heading }], IMPACT)[0].rotationY, [0, 0, 1])
    const close = (v: THREE.Vector3, x: number, z: number) => {
      expect(v.x).toBeCloseTo(x, 9)
      expect(v.y).toBeCloseTo(0, 9)
      expect(v.z).toBeCloseTo(z, 9)
    }
    close(nose(0), 0, -1)
    close(nose(90), 1, 0)
    close(nose(180), 0, 1)
    close(nose(270), -1, 0)
  })

  it("agrees with the map layer's own matrix: the same offset, the nose and the car's left the same way round", () => {
    const cars = [
      { id: 'a', position: destination(IMPACT, 30, 7), heading: 0 },
      { id: 'b', position: destination(IMPACT, 200, 12), heading: 45 },
      { id: 'c', position: destination(IMPACT, 290, 3), heading: 137 },
      { id: 'd', position: destination(IMPACT, 110, 20), heading: 333 },
    ]
    const s = metresToMercator(IMPACT[1])
    for (const [i, p] of placeVehicles(cars, IMPACT).entries()) {
      const car = cars[i]
      // the map's translation, back in metres: mercator runs (east, south), the studio (x, z)
      const t = new THREE.Vector3().applyMatrix4(vehicleMatrix(car.position, car.heading, 1, IMPACT))
      expect(p.position[0]).toBeCloseTo(t.x / s, 6)
      expect(p.position[2]).toBeCloseTo(t.y / s, 6)
      // the nose (+Z) and the car's left (+X) — together they pin the handedness, not just the bearing
      for (const dir of [
        [0, 0, 1],
        [1, 0, 0],
      ] as [number, number, number][]) {
        const map = onMap(car.position, car.heading, dir)
        const studio = turned(p.rotationY, dir)
        expect(studio.x).toBeCloseTo(map.x, 9)
        expect(studio.z).toBeCloseTo(map.y, 9)
      }
    }
  })
})
