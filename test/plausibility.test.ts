import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BACKWARDS_DEGREES,
  OVERLAP_METRES,
  PHOTO_EARLY_MINUTES,
  PHOTO_FAR_METRES,
  SAME_DIRECTION_DEGREES,
  SUN_BELOW_HORIZON_DEGREES,
  findings,
} from '../src/claim/plausibility'
import { damage } from '../src/schema'
import { emptyClaim, newVehicle, toDocument, type Claim, type SceneContext } from '../src/claim/schema'
import { destination, type LngLat } from '../src/geo'
import { REACH } from '../src/claim/suggest'
import { SIZE } from '../src/vehicles/bodies'
import { zoneById } from '../src/zones'

const at: LngLat = [-73.9859, 40.7573]

/** a fresh claim with both default vehicles cleared to nothing placed, nothing marked */
function bare(): Claim {
  const c = emptyClaim()
  c.vehicles = [{ ...newVehicle('a', 'insured', 'sedan', '#b9bec6'), position: null }, { ...newVehicle('b', 'other', 'suv', '#1c1f26'), position: null }]
  return c
}

const codesOf = (claim: Claim, code: string) => findings(claim).filter((f) => f.code === code)

describe('findings on an untouched claim', () => {
  it('is empty and does not throw', () => {
    expect(findings(bare())).toEqual([])
  })

  it('is empty for toDocument(emptyClaim())', () => {
    expect(findings(toDocument(emptyClaim()))).toEqual([])
  })
})

describe('panel_vs_impact', () => {
  it('fires when every mark is on the opposite side from the impact', () => {
    const c = bare()
    c.vehicles[0].position = at
    c.vehicles[0].heading = 0
    c.vehicles[0].damages = [damage('rear_bumper', zoneById('sedan', 'rear_bumper')!.anchor, 'dent')]
    c.impact = destination(at, 0, 3) // dead ahead: the front took the hit
    const found = codesOf(c, 'panel_vs_impact')
    expect(found).toHaveLength(1)
    expect(found[0].level).toBe('look')
    expect(found[0].evidence).toMatch(/front/)
  })

  it('does not fire when the mark and the impact are on the same side', () => {
    const c = bare()
    c.vehicles[0].position = at
    c.vehicles[0].heading = 0
    c.vehicles[0].damages = [damage('front_bumper', zoneById('sedan', 'front_bumper')!.anchor, 'dent')]
    c.impact = destination(at, 0, 3)
    expect(codesOf(c, 'panel_vs_impact')).toHaveLength(0)
  })
})

describe('arrived_backwards', () => {
  it('fires when the route arrives from one way but the car rests facing back the way it came', () => {
    const c = bare()
    c.vehicles[0].position = at
    c.vehicles[0].heading = 0 // resting facing north
    c.vehicles[0].path = [destination(at, 0, 20)] // approached from a point due north, so travelling south
    const found = codesOf(c, 'arrived_backwards')
    expect(found).toHaveLength(1)
    expect(found[0].evidence).toMatch(/difference 180/)
  })

  it('does not fire when the resting heading matches the way it arrived', () => {
    const c = bare()
    c.vehicles[0].position = at
    c.vehicles[0].heading = 180 // resting facing the way it was travelling
    c.vehicles[0].path = [destination(at, 0, 20)]
    expect(codesOf(c, 'arrived_backwards')).toHaveLength(0)
  })

  it('the threshold is exported', () => {
    expect(BACKWARDS_DEGREES).toBe(120)
  })
})

describe('damage_without_reach', () => {
  it('fires when a marked vehicle stands further than its own reach from the impact', () => {
    const c = bare()
    const impact = at
    c.impact = impact
    c.vehicles[0].position = destination(impact, 0, SIZE.sedan.length / 2 + REACH + 5)
    c.vehicles[0].heading = 180
    c.vehicles[0].damages = [damage('front_bumper', zoneById('sedan', 'front_bumper')!.anchor, 'dent')]
    const found = codesOf(c, 'damage_without_reach')
    expect(found).toHaveLength(1)
    expect(found[0].level).toBe('look')
  })

  it('does not fire when the marked vehicle is within reach of the impact', () => {
    const c = bare()
    const impact = at
    c.impact = impact
    c.vehicles[0].position = destination(impact, 0, 1)
    c.vehicles[0].heading = 180
    c.vehicles[0].damages = [damage('front_bumper', zoneById('sedan', 'front_bumper')!.anchor, 'dent')]
    expect(codesOf(c, 'damage_without_reach')).toHaveLength(0)
  })
})

describe('bodies_overlap', () => {
  it('fires when two vehicles are drawn standing inside one another', () => {
    const c = bare()
    c.vehicles[0].position = at
    c.vehicles[0].heading = 0
    c.vehicles[1].position = destination(at, 90, 2)
    c.vehicles[1].heading = 90
    const found = codesOf(c, 'bodies_overlap')
    expect(found).toHaveLength(1)
    expect(found[0].text).toMatch(/overlapping by/)
  })

  it('does not fire when the two vehicles are drawn apart', () => {
    const c = bare()
    c.vehicles[0].position = at
    c.vehicles[0].heading = 0
    c.vehicles[1].position = destination(at, 90, 20)
    c.vehicles[1].heading = 90
    expect(codesOf(c, 'bodies_overlap')).toHaveLength(0)
  })

  it('the threshold is exported', () => {
    expect(OVERLAP_METRES).toBe(1)
  })
})

describe('rear_end_vs_panels', () => {
  it('fires when the leading vehicle in a rear-end is marked only at its own front', () => {
    const c = bare()
    c.vehicles[0].position = at // the leading vehicle
    c.vehicles[0].heading = 0
    c.vehicles[0].damages = [damage('front_bumper', zoneById('sedan', 'front_bumper')!.anchor, 'dent')]
    c.vehicles[1].position = destination(at, 180, 5) // behind it, same heading
    c.vehicles[1].heading = 0
    const found = codesOf(c, 'rear_end_vs_panels')
    expect(found).toHaveLength(1)
    expect(found[0].text).toMatch(/marked only at its front/)
  })

  it('does not fire when the leading vehicle is marked at its rear, as a rear-end would', () => {
    const c = bare()
    c.vehicles[0].position = at
    c.vehicles[0].heading = 0
    c.vehicles[0].damages = [damage('rear_bumper', zoneById('sedan', 'rear_bumper')!.anchor, 'dent')]
    c.vehicles[1].position = destination(at, 180, 5)
    c.vehicles[1].heading = 0
    expect(codesOf(c, 'rear_end_vs_panels')).toHaveLength(0)
  })

  it('the threshold is exported', () => {
    expect(SAME_DIRECTION_DEGREES).toBe(30)
  })
})

describe('story_vs_record', () => {
  const context: SceneContext = {
    weather: { code: 61, label: 'Light rain', tempC: 8, precipMm: 1.4, windKph: 10 },
    sun: { altitude: -10, azimuth: 90 },
    road: null,
    source: 'test',
    fetchedAt: '',
  }

  it('fires once per disagreement between the customer and the record', () => {
    const c = bare()
    c.incident.context = context
    c.incident.conditions = { weather: 'clear', road: 'dry', light: 'daylight' }
    const found = codesOf(c, 'story_vs_record')
    expect(found).toHaveLength(3)
    expect(found.every((f) => f.level === 'note')).toBe(true)
  })

  it('does not fire when the customer agrees with the record', () => {
    const c = bare()
    c.incident.context = context
    c.incident.conditions = { weather: 'rain', road: 'wet', light: 'dark_unlit' }
    expect(codesOf(c, 'story_vs_record')).toHaveLength(0)
  })

  it('the threshold is exported', () => {
    expect(SUN_BELOW_HORIZON_DEGREES).toBe(-6)
  })
})

describe('photo_before_incident', () => {
  it('fires for a photo timestamped well before the stated time', () => {
    const c = bare()
    c.attachments.photos = [{ data: 'data:image/jpeg;base64,x', of: null, caption: '', minutesFromIncident: -45 }]
    const found = codesOf(c, 'photo_before_incident')
    expect(found).toHaveLength(1)
    expect(found[0].level).toBe('look')
    expect(found[0].text).toContain('45 minutes before')
  })

  it('does not fire for a photo taken only a little early', () => {
    const c = bare()
    c.attachments.photos = [{ data: 'data:image/jpeg;base64,x', of: null, caption: '', minutesFromIncident: -5 }]
    expect(codesOf(c, 'photo_before_incident')).toHaveLength(0)
  })

  it('the threshold is exported', () => {
    expect(PHOTO_EARLY_MINUTES).toBe(-10)
  })
})

describe('photo_far_from_scene', () => {
  it('fires for a photo whose metadata puts it well away from the scene', () => {
    const c = bare()
    c.attachments.photos = [{ data: 'data:image/jpeg;base64,x', of: null, caption: '', metresFromScene: 600 }]
    const found = codesOf(c, 'photo_far_from_scene')
    expect(found).toHaveLength(1)
    expect(found[0].level).toBe('note')
  })

  it('does not fire for a photo close to the scene', () => {
    const c = bare()
    c.attachments.photos = [{ data: 'data:image/jpeg;base64,x', of: null, caption: '', metresFromScene: 100 }]
    expect(codesOf(c, 'photo_far_from_scene')).toHaveLength(0)
  })

  it('the threshold is exported', () => {
    expect(PHOTO_FAR_METRES).toBe(500)
  })
})

describe('look findings sort before note findings', () => {
  it('a look and a note together come back look-first', () => {
    const c = bare()
    c.attachments.photos = [
      { data: 'data:image/jpeg;base64,x', of: null, caption: '', minutesFromIncident: -45 },
      { data: 'data:image/jpeg;base64,x', of: null, caption: '', metresFromScene: 600 },
    ]
    const found = findings(c)
    expect(found.map((f) => f.level)).toEqual(['look', 'note'])
  })
})

describe('a plain, consistent rear-end collision', () => {
  it('yields no findings at all', () => {
    const c = bare()
    // the leading vehicle, travelling north, coming to rest facing north
    c.vehicles[0].position = at
    c.vehicles[0].heading = 0
    c.vehicles[0].path = [destination(at, 180, 20)]
    c.vehicles[0].damages = [damage('rear_bumper', zoneById('sedan', 'rear_bumper')!.anchor, 'dent')]
    // the trailing vehicle, also travelling north, 4.5 m behind
    const behindPos = destination(at, 180, 4.5)
    c.vehicles[1].position = behindPos
    c.vehicles[1].heading = 0
    c.vehicles[1].path = [destination(behindPos, 180, 20)]
    c.vehicles[1].damages = [damage('front_bumper', zoneById('suv', 'front_bumper')!.anchor, 'dent')]
    // the impact, between the two
    c.impact = destination(at, 180, 2.25)
    expect(findings(c)).toEqual([])
  })
})

describe('the module never accuses anyone', () => {
  it('never uses the words fraud, fault, liability, blame or suspicious', () => {
    const src = readFileSync(new URL('../src/claim/plausibility.ts', import.meta.url), 'utf8').toLowerCase()
    for (const word of ['fraud', 'fault', 'liab', 'blame', 'suspicio']) {
      expect(src).not.toContain(word)
    }
  })
})
