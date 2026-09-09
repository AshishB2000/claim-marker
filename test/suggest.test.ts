import { describe, expect, it } from 'vitest'
import { hitZone, suggestDamage } from '../src/claim/suggest'
import { destination, type LngLat } from '../src/geo'
import { SIZE } from '../src/vehicles/bodies'
import { VEHICLE_IDS, zoneById } from '../src/zones'

const at: LngLat = [-73.9859, 40.7573]
const sedan = (heading: number) => ({ body: 'sedan' as const, position: at, heading })

describe('the panel that took the hit', () => {
  it('head-on is the front bumper, from behind the rear bumper', () => {
    expect(hitZone(sedan(0), destination(at, 0, 3))?.id).toBe('front_bumper')
    expect(hitZone(sedan(0), destination(at, 180, 3))?.id).toBe('rear_bumper')
  })

  it('a hit within 25° of head-on or rear-end is the bumper, not the light beside it', () => {
    expect(hitZone(sedan(0), destination(at, 15, 3))?.id).toBe('front_bumper')
    expect(hitZone(sedan(0), destination(at, 345, 3))?.id).toBe('front_bumper')
    expect(hitZone(sedan(0), destination(at, 195, 3))?.id).toBe('rear_bumper')
    expect(hitZone(sedan(0), destination(at, 165, 3))?.id).toBe('rear_bumper')
  })

  it('follows the heading: the front is wherever the nose points', () => {
    expect(hitZone(sedan(90), destination(at, 90, 3))?.id).toBe('front_bumper')
    expect(hitZone(sedan(225), destination(at, 45, 3))?.id).toBe('rear_bumper')
  })

  it("a side hit lands on that side — the driver's right, not the map's", () => {
    // facing north, a hit from the east is on the right-hand side
    expect(hitZone(sedan(0), destination(at, 90, 1.5))?.id).toMatch(/^right_/)
    expect(hitZone(sedan(0), destination(at, 270, 1.5))?.id).toMatch(/^left_/)
    // facing south, the same easterly hit is on the left
    expect(hitZone(sedan(180), destination(at, 90, 1.5))?.id).toMatch(/^left_/)
  })

  it('a corner hit lands on the corner, and never on glass, the roof or a mirror', () => {
    expect(hitZone(sedan(0), destination(at, 35, 3))?.id).toMatch(/^right_(headlight|front_fender)$/)
    for (const b of [0, 45, 90, 135, 180, 225, 270, 315]) {
      expect(hitZone(sedan(0), destination(at, b, 2))?.id).not.toMatch(/roof|window|windshield|mirror/)
    }
  })

  it("too far away is nobody's hit, and a car off the map has none", () => {
    expect(hitZone(sedan(0), destination(at, 0, 10))).toBeNull()
    expect(hitZone({ ...sedan(0), position: null }, at)).toBeNull()
  })

  it('the suggestion is a dent on that zone, at its anchor', () => {
    const d = suggestDamage(sedan(0), destination(at, 0, 3))
    expect(d).toMatchObject({ zone: 'front_bumper', severity: 'dent', note: '' })
    expect(d?.point).toEqual(zoneById('sedan', 'front_bumper')?.anchor)
  })

  it('a head-on hit is the front bumper on every body', () => {
    for (const body of VEHICLE_IDS) {
      expect(hitZone({ body, position: at, heading: 0 }, destination(at, 0, SIZE[body].length / 2 + 0.5))?.id, body).toBe('front_bumper')
    }
  })
})
