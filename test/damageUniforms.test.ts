import { describe, expect, it } from 'vitest'
import { KIND, MAX_MARKS, RADIUS_M, WEIGHT, damageUniforms } from '../src/marker/damageUniforms'
import { damage } from '../src/schema'
import { radiusToWorld, toWorld } from '../src/vehicles/bodies'
import { zoneById } from '../src/zones'

const dent = damage('hood', [0.1, 0.76, 0.8], 'dent')

describe('damageUniforms', () => {
  it('packs nothing for no marks', () => {
    const u = damageUniforms([], 'sedan')
    expect(u.count).toBe(0)
    expect(u.points).toHaveLength(MAX_MARKS * 3)
    expect(u.radii).toHaveLength(MAX_MARKS)
    expect(u.severities).toHaveLength(MAX_MARKS)
    expect(u.kinds).toHaveLength(MAX_MARKS)
    expect(Array.from(u.points).every((n) => n === 0)).toBe(true)
  })

  it('puts a dent at its own point, in the body’s metres, with the dent’s reach and weight', () => {
    const u = damageUniforms([dent], 'sedan')
    expect(u.count).toBe(1)
    const [x, y, z] = toWorld('sedan', dent.point)
    expect(Array.from(u.points.slice(0, 3))).toEqual([x, y, z].map((n) => Math.fround(n)))
    expect(u.radii[0]).toBeCloseTo(RADIUS_M.dent)
    expect(u.severities[0]).toBeCloseTo(WEIGHT.dent)
    expect(u.kinds[0]).toBe(KIND.dent)
  })

  it('maps every kind in claim-marker/1 to its own code', () => {
    expect(KIND).toEqual({ scratch: 0, dent: 1, crack: 2, missing: 3 })
    const u = damageUniforms(
      [damage('hood', [0, 0.76, 0.78], 'scratch'), dent, damage('windshield', [0, 1.06, 0.26], 'crack'), damage('trunk', [0, 0.7, -1.02], 'missing')],
      'sedan',
    )
    expect(Array.from(u.kinds.slice(0, 4))).toEqual([0, 1, 2, 3])
  })

  it('hides a missing part by its zone, not by where the tap landed', () => {
    // the tap is on the door’s edge; the hole is the whole door, centred on its anchor
    const door = zoneById('sedan', 'left_front_door')!
    const u = damageUniforms([damage('left_front_door', [0.65, 0.9, 0.4], 'missing')], 'sedan')
    expect(Array.from(u.points.slice(0, 3))).toEqual(toWorld('sedan', door.anchor).map((n) => Math.fround(n)))
    expect(u.radii[0]).toBeCloseTo(radiusToWorld('sedan', door.radius))
    expect(u.severities[0]).toBe(WEIGHT.missing)
  })

  it('keeps the first twelve marks and leaves the rest to their pins', () => {
    const many = Array.from({ length: 15 }, (_, i) => damage('hood', [i / 100, 0.76, 0.8], 'dent'))
    const u = damageUniforms(many, 'sedan')
    expect(u.count).toBe(MAX_MARKS)
    expect(u.points).toHaveLength(MAX_MARKS * 3)
    // the twelfth is the last one packed, the thirteenth is nowhere in the arrays
    expect(u.points[(MAX_MARKS - 1) * 3]).toBeCloseTo(toWorld('sedan', many[MAX_MARKS - 1].point)[0], 5)
    expect(Array.from(u.points)).not.toContain(Math.fround(toWorld('sedan', many[MAX_MARKS].point)[0]))
  })

  it('weights a missing part above a crack above a dent above a scratch', () => {
    expect(WEIGHT.scratch).toBeLessThan(WEIGHT.dent)
    expect(WEIGHT.dent).toBeLessThan(WEIGHT.crack)
    expect(WEIGHT.crack).toBeLessThan(WEIGHT.missing)
    expect(WEIGHT.missing).toBe(1)
  })
})
