import { describe, expect, it } from 'vitest'
import { VEHICLE_IDS, ZONE_IDS, nearestZone, zonesOf, type V3, type Vehicle } from '../src/zones'

describe('zone data', () => {
  it('covers seven bodies', () => {
    expect(VEHICLE_IDS).toEqual(['sedan', 'suv', 'truck', 'hatchback', 'coupe', 'van', 'box_truck'])
  })

  it.each([
    ['sedan', 25],
    ['suv', 25],
    // single cab: no rear doors, and the rear flank is a bed side
    ['truck', 23],
    // two-door bodies without wing mirrors: one door a side, no rear doors, no mirrors
    ['hatchback', 21],
    ['coupe', 21],
    // panel van: one door a side and a blank cargo side behind it — no rear door or quarter panel
    ['van', 23],
    // cab plus box: cargo side, cargo roof and a roll-up cargo door; the cab's rear window
    // faces the box and cannot be tapped, so there is none
    ['box_truck', 23],
  ] as [Vehicle, number][])('%s has %i zones, all distinct', (vehicle, count) => {
    const ids = zonesOf(vehicle).map((z) => z.id)
    expect(ids).toHaveLength(count)
    expect(new Set(ids).size).toBe(count)
  })

  it('gives the pickup a bed side and no rear doors', () => {
    const ids = zonesOf('truck').map((z) => z.id)
    expect(ids).toContain('left_bed_side')
    expect(ids.filter((id) => id.includes('rear_door'))).toEqual([])
  })

  it('gives the van and box truck a cargo side and neither rear doors nor quarter panels', () => {
    for (const vehicle of ['van', 'box_truck'] as const) {
      const ids = zonesOf(vehicle).map((z) => z.id)
      expect(ids).toContain('left_cargo_side')
      expect(ids.filter((id) => id.includes('rear_door') || id.includes('quarter'))).toEqual([])
    }
  })

  it('gives the two-door bodies one door a side and no mirrors', () => {
    for (const vehicle of ['hatchback', 'coupe'] as const) {
      const ids = zonesOf(vehicle).map((z) => z.id)
      expect(ids).toContain('left_front_door')
      expect(ids.filter((id) => id.includes('rear_door') || id.includes('mirror'))).toEqual([])
    }
  })

  it('exposes the union of every body’s zones', () => {
    expect(ZONE_IDS).toContain('left_bed_side')
    expect(ZONE_IDS).toContain('left_rear_door')
    expect(ZONE_IDS).toContain('left_cargo_side')
    expect(ZONE_IDS).toContain('cargo_door')
    expect(new Set(ZONE_IDS).size).toBe(ZONE_IDS.length)
  })
})

describe('handedness', () => {
  // nose at +Z, up +Y, right-handed: the driver's left is +X. Every body, every pair.
  it.each(VEHICLE_IDS)('%s: left_* anchors are at +X and right_* at −X', (vehicle) => {
    for (const z of zonesOf(vehicle)) {
      if (z.id.startsWith('left_')) expect(z.anchor[0], z.id).toBeGreaterThan(0)
      if (z.id.startsWith('right_')) expect(z.anchor[0], z.id).toBeLessThan(0)
    }
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
  ['sedan', [0.45, 0.57, 1.21], 'left_headlight'],
  ['sedan', [-0.45, 0.57, 1.21], 'right_headlight'],
  ['sedan', [0.73, 0.76, 0.37], 'left_mirror'],
  ['sedan', [0.65, 0.48, 0.15], 'left_front_door'],
  ['sedan', [0.65, 0.48, -0.3], 'left_rear_door'],
  ['sedan', [-0.65, 0.55, -0.9], 'right_rear_quarter_panel'],
  ['sedan', [0.58, 0.3, 0.66], 'left_front_wheel'],

  ['suv', [0, 0.44, 1.33], 'front_bumper'],
  ['suv', [0, 0.8, 1.05], 'hood'],
  ['suv', [0, 1.3, -0.4], 'roof'],
  // the boxy tailgate stacks these three almost vertically at the same z
  ['suv', [0, 1.14, -1.18], 'rear_window'],
  ['suv', [0, 0.76, -1.24], 'trunk'],
  ['suv', [0, 0.36, -1.26], 'rear_bumper'],
  ['suv', [0.65, 0.6, 0.26], 'left_front_door'],
  ['suv', [0.65, 0.6, -0.26], 'left_rear_door'],
  ['suv', [0.48, 0.95, -1.2], 'left_taillight'],
  ['suv', [-0.42, 0.3, 0.76], 'right_front_wheel'],

  ['truck', [0, 0.36, 1.44], 'front_bumper'],
  ['truck', [0, 0.72, 1.1], 'hood'],
  ['truck', [0, 1.3, 0.16], 'roof'],
  ['truck', [0, 1.04, -0.14], 'rear_window'],
  ['truck', [0, 0.66, -1.46], 'trunk'],
  ['truck', [0.65, 0.62, -0.8], 'left_bed_side'],
  ['truck', [-0.65, 0.62, -0.8], 'right_bed_side'],
  ['truck', [0.65, 0.52, 0.2], 'left_front_door'],
  ['truck', [0.42, 0.3, 0.86], 'left_front_wheel'],

  ['hatchback', [0, 0.45, 1.29], 'front_bumper'],
  ['hatchback', [0, 0.7, 0.95], 'hood'],
  ['hatchback', [0, 0.89, 0.45], 'windshield'],
  ['hatchback', [0, 1.1, -0.3], 'roof'],
  // the dark pane at the top of the hatch, level with the roof
  ['hatchback', [0, 1.1, -0.84], 'rear_window'],
  ['hatchback', [0, 0.87, -1.17], 'trunk'],
  ['hatchback', [0, 0.45, -1.31], 'rear_bumper'],
  ['hatchback', [0.48, 0.55, 1.3], 'left_headlight'],
  ['hatchback', [0.55, 0.65, 0], 'left_front_door'],
  ['hatchback', [0.5, 0.86, -0.85], 'left_rear_quarter_panel'],
  ['hatchback', [0.48, 0.86, -1.2], 'left_taillight'],
  ['hatchback', [-0.42, 0.3, -0.81], 'right_rear_wheel'],

  ['coupe', [0, 0.4, 1.15], 'front_bumper'],
  ['coupe', [0, 0.76, 0.85], 'hood'],
  // the headlights sit on top of the nose, not on its face
  ['coupe', [0.42, 0.65, 1.08], 'left_headlight'],
  ['coupe', [0, 0.92, 0.4], 'windshield'],
  ['coupe', [0, 1.1, -0.2], 'roof'],
  ['coupe', [0, 0.95, -0.7], 'rear_window'],
  // the spoiler is a separate mesh on the trunk lid and counts as trunk
  ['coupe', [0, 0.9, -1.1], 'trunk'],
  ['coupe', [0.48, 0.65, -1.15], 'left_taillight'],
  ['coupe', [0.55, 0.6, -0.03], 'left_front_door'],
  ['coupe', [0.55, 0.78, -0.7], 'left_rear_quarter_panel'],

  ['van', [0, 0.45, 1.25], 'front_bumper'],
  ['van', [0, 0.75, 1.02], 'hood'],
  ['van', [0, 1.02, 0.76], 'windshield'],
  ['van', [0, 1.35, -0.3], 'roof'],
  ['van', [0, 1.06, -1.25], 'rear_window'],
  ['van', [0, 0.72, -1.35], 'trunk'],
  ['van', [0.42, 0.65, -1.35], 'left_taillight'],
  ['van', [0.55, 0.65, 0.42], 'left_front_door'],
  ['van', [0.72, 0.8, 0.57], 'left_mirror'],
  // the blank flank behind the door
  ['van', [0.55, 0.9, -0.6], 'left_cargo_side'],
  ['van', [-0.55, 0.75, -1.0], 'right_cargo_side'],

  ['box_truck', [0, 0.45, 1.49], 'front_bumper'],
  ['box_truck', [0, 0.75, 1.3], 'hood'],
  ['box_truck', [0, 1.02, 1.01], 'windshield'],
  ['box_truck', [0, 1.4, 0.6], 'roof'],
  ['box_truck', [0, 1.6, -0.6], 'cargo_roof'],
  ['box_truck', [0, 1.6, -1.2], 'cargo_roof'],
  // the roll-up shutter is its own mesh, set into a painted frame
  ['box_truck', [0, 1.0, -1.55], 'cargo_door'],
  ['box_truck', [0.3, 0.9, -1.52], 'cargo_door'],
  ['box_truck', [0, 0.36, -1.62], 'rear_bumper'],
  ['box_truck', [0.55, 0.45, -1.6], 'left_taillight'],
  ['box_truck', [0.42, 0.65, 1.5], 'left_headlight'],
  ['box_truck', [0.55, 0.65, 0.65], 'left_front_door'],
  ['box_truck', [0.72, 0.8, 0.82], 'left_mirror'],
  ['box_truck', [0.65, 1.05, -0.6], 'left_cargo_side'],
  ['box_truck', [-0.65, 1.3, -1.0], 'right_cargo_side'],
  ['box_truck', [0.42, 0.3, 1.01], 'left_front_wheel'],
]

describe('classification of realistic taps', () => {
  it.each(HITS)('%s %j → %s', (vehicle, point, expected) => {
    expect(nearestZone(vehicle, point).id).toBe(expected)
  })

  it('mirrors left and right across x', () => {
    for (const [vehicle, [x, y, z], expected] of HITS) {
      if (x === 0) continue
      expect(nearestZone(vehicle, [-x, y, z]).id).toBe(
        expected.startsWith('right_') ? expected.replace('right_', 'left_') : expected.replace('left_', 'right_'),
      )
    }
  })
})
