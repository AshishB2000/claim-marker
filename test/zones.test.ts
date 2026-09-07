import { describe, expect, it } from 'vitest'
import { VEHICLE_IDS, ZONE_IDS, nearestZone, zonesOf, type V3, type Vehicle } from '../src/zones'

describe('zone data', () => {
  it('covers three bodies', () => {
    expect(VEHICLE_IDS).toEqual(['sedan', 'suv', 'truck'])
  })

  it.each([
    ['sedan', 25],
    ['suv', 25],
    // single cab: no rear doors, and the rear flank is a bed side
    ['truck', 23],
  ] as [Vehicle, number][])('%s has %i zones, all distinct', (vehicle, count) => {
    const ids = zonesOf(vehicle).map((z) => z.id)
    expect(ids).toHaveLength(count)
    expect(new Set(ids).size).toBe(count)
  })

  it('gives the pickup a bed side and no rear doors', () => {
    const ids = zonesOf('truck').map((z) => z.id)
    expect(ids).toContain('right_bed_side')
    expect(ids.filter((id) => id.includes('rear_door'))).toEqual([])
  })

  it('exposes the union of every body’s zones', () => {
    expect(ZONE_IDS).toContain('right_bed_side')
    expect(ZONE_IDS).toContain('right_rear_door')
    expect(new Set(ZONE_IDS).size).toBe(ZONE_IDS.length)
  })
})

describe.each(VEHICLE_IDS)('nearestZone(%s)', (vehicle) => {
  it('classifies every anchor as its own zone', () => {
    for (const zone of zonesOf(vehicle)) {
      expect(nearestZone(vehicle, zone.anchor).id, `${zone.id} is shadowed`).toBe(zone.id)
    }
  })

  // The check above only catches exact duplicates — an anchor is always at distance 0 from
  // itself. This is the one that catches an anchor placed so close to a neighbour that it is
  // unreachable in practice.
  it('keeps every pair of anchors at least 15 cm apart', () => {
    const zones = zonesOf(vehicle)
    const tooClose: string[] = []
    for (let i = 0; i < zones.length; i++) {
      for (let j = i + 1; j < zones.length; j++) {
        const d = Math.hypot(...(zones[i].anchor.map((v, k) => v - zones[j].anchor[k]) as V3))
        if (d < 0.15) tooClose.push(`${zones[i].id} ↔ ${zones[j].id} = ${d.toFixed(3)}m`)
      }
    }
    expect(tooClose).toEqual([])
  })

  it('always returns a zone, even far off the body', () => {
    expect(nearestZone(vehicle, [50, 50, 50]).id).toBeTruthy()
  })
})

// realistic taps, measured against each body's profile (scripts/profile-body.mjs)
const HITS: [Vehicle, V3, string][] = [
  ['sedan', [0, 0.3, 1.25], 'front_bumper'],
  ['sedan', [0, 0.76, 0.8], 'hood'],
  ['sedan', [0, 1.05, 0.27], 'windshield'],
  ['sedan', [0, 1.3, -0.1], 'roof'],
  ['sedan', [0, 1.05, -0.66], 'rear_window'],
  ['sedan', [0, 0.7, -1.05], 'trunk'],
  ['sedan', [0, 0.33, -1.29], 'rear_bumper'],
  ['sedan', [0.45, 0.57, 1.21], 'right_headlight'],
  ['sedan', [-0.45, 0.57, 1.21], 'left_headlight'],
  ['sedan', [0.73, 0.76, 0.37], 'right_mirror'],
  ['sedan', [0.65, 0.48, 0.15], 'right_front_door'],
  ['sedan', [0.65, 0.48, -0.3], 'right_rear_door'],
  ['sedan', [-0.65, 0.55, -0.9], 'left_rear_quarter_panel'],
  ['sedan', [0.58, 0.3, 0.66], 'right_front_wheel'],

  ['suv', [0, 0.44, 1.33], 'front_bumper'],
  ['suv', [0, 0.8, 1.05], 'hood'],
  ['suv', [0, 1.3, -0.4], 'roof'],
  // the boxy tailgate stacks these three almost vertically at the same z
  ['suv', [0, 1.14, -1.18], 'rear_window'],
  ['suv', [0, 0.76, -1.24], 'trunk'],
  ['suv', [0, 0.36, -1.26], 'rear_bumper'],
  ['suv', [0.65, 0.6, 0.26], 'right_front_door'],
  ['suv', [0.65, 0.6, -0.26], 'right_rear_door'],
  ['suv', [0.48, 0.95, -1.2], 'right_taillight'],
  ['suv', [-0.42, 0.3, 0.76], 'left_front_wheel'],

  ['truck', [0, 0.36, 1.44], 'front_bumper'],
  ['truck', [0, 0.72, 1.1], 'hood'],
  ['truck', [0, 1.3, 0.16], 'roof'],
  ['truck', [0, 1.04, -0.14], 'rear_window'],
  ['truck', [0, 0.66, -1.46], 'trunk'],
  ['truck', [0.65, 0.62, -0.8], 'right_bed_side'],
  ['truck', [-0.65, 0.62, -0.8], 'left_bed_side'],
  ['truck', [0.65, 0.52, 0.2], 'right_front_door'],
  ['truck', [0.42, 0.3, 0.86], 'right_front_wheel'],
]

describe('classification of realistic taps', () => {
  it.each(HITS)('%s %j → %s', (vehicle, point, expected) => {
    expect(nearestZone(vehicle, point).id).toBe(expected)
  })

  it('mirrors left and right across x', () => {
    for (const [vehicle, [x, y, z], expected] of HITS) {
      if (x === 0) continue
      expect(nearestZone(vehicle, [-x, y, z]).id).toBe(
        expected.startsWith('left_') ? expected.replace('left_', 'right_') : expected.replace('right_', 'left_'),
      )
    }
  })
})
