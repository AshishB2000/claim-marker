import { describe, expect, it } from 'vitest'
import { KIND, KIND_MISSING_WHEEL, MAX_MARKS, RADIUS_M, WEIGHT, damageUniforms, renders } from '../src/marker/damageUniforms'
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

  it('tells a missing wheel apart from a missing panel, so only the wheel takes it', () => {
    const u = damageUniforms([damage('left_front_wheel', [0.42, 0.3, 0.66], 'missing'), damage('left_front_fender', [0.65, 0.58, 0.92], 'missing')], 'sedan')
    expect(Array.from(u.kinds.slice(0, 2))).toEqual([KIND_MISSING_WHEEL, KIND.missing])
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

describe('renders — whether the paint shows the mark, so its pin may shrink to a dot', () => {
  const on = (zone: Parameters<typeof damage>[0], severity: Parameters<typeof damage>[2]) => renders(damage(zone, [0, 0.5, 0], severity), 'sedan')

  it('draws a dent and a scratch on bodywork', () => {
    expect(on('left_front_door', 'dent')).toBe(true)
    expect(on('hood', 'scratch')).toBe(true)
    expect(on('front_bumper', 'dent')).toBe(true)
    expect(on('left_mirror', 'scratch')).toBe(true)
  })

  it('draws a crack on glass and on a lamp', () => {
    expect(on('windshield', 'crack')).toBe(true)
    expect(on('rear_window', 'crack')).toBe(true)
    expect(on('left_headlight', 'crack')).toBe(true)
    expect(on('right_taillight', 'crack')).toBe(true)
  })

  it('does not draw a crack on a bumper, a fender or a door — the pin keeps its number', () => {
    expect(on('front_bumper', 'crack')).toBe(false)
    expect(on('left_front_fender', 'crack')).toBe(false)
    expect(on('right_rear_door', 'crack')).toBe(false)
  })

  it('does not draw a scratch or a dent on a windshield or a lamp — the pin keeps its number', () => {
    expect(on('windshield', 'scratch')).toBe(false)
    expect(on('windshield', 'dent')).toBe(false)
    expect(on('left_headlight', 'scratch')).toBe(false)
    expect(on('left_taillight', 'dent')).toBe(false)
  })

  it('draws a missing part on every surface, and nothing else on a wheel', () => {
    expect(on('left_front_door', 'missing')).toBe(true)
    expect(on('windshield', 'missing')).toBe(true)
    expect(on('left_front_wheel', 'missing')).toBe(true)
    expect(on('left_front_wheel', 'dent')).toBe(false)
    expect(on('left_front_wheel', 'scratch')).toBe(false)
    expect(on('left_front_wheel', 'crack')).toBe(false)
  })

  it('draws nothing for a zone the body does not have', () => {
    expect(renders(damage('left_rear_door', [0, 0.5, 0], 'dent'), 'truck')).toBe(false)
  })
})
