import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compare, HEADING_DEGREES, PLACE_METRES, REST_METRES, TIME_MINUTES } from '../src/claim/compare'
import { emptyClaim, newPerson, newVehicle, type Claim, type Incident } from '../src/claim/schema'
import { destination } from '../src/geo'
import { damage } from '../src/schema'

const HERE: [number, number] = [-73.9859, 40.7573]
const SEDAN_POS = HERE
const SUV_POS = destination(HERE, 90, 4)
const SEDAN_PATH = [destination(SEDAN_POS, 270, 30)]
const SUV_PATH = [destination(SUV_POS, 90, 30)]
const IMPACT = destination(HERE, 90, 2)

function freshIncident(): Incident {
  return {
    kind: 'collision',
    at: '2026-09-06T17:30',
    shared: 'INC-TEST0001',
    utcOffset: -240,
    location: { lng: HERE[0], lat: HERE[1], address: 'Times Square, New York' },
    context: null,
    surface: 'satellite',
    conditions: { weather: 'rain', road: 'wet', light: 'dark_lit' },
    description: '',
    language: 'en',
  }
}

/**
 * Two documents of one collision that agree on everything: the policyholder's account (vehicles
 * `a`/`b`) and the other driver's (vehicles `x`/`y`, deliberately different ids). Each writer's
 * own car carries `role: 'insured'` in their own document, so the sedan is `insured` for the
 * policyholder and `other` for the other driver, and the SUV the other way round — the mirror
 * `compare.ts` is meant to see through.
 */
function pair(): { a: Claim; b: Claim } {
  const a: Claim = {
    ...emptyClaim(),
    reporter: { name: '', phone: '', email: '', policy: '', policyholder: true, party: 'policyholder' },
    incident: freshIncident(),
    vehicles: [
      { ...newVehicle('a', 'insured', 'sedan', '#b91c1c'), position: SEDAN_POS, heading: 90, path: SEDAN_PATH, damages: [damage('front_bumper', [0, 0.34, 1.24], 'dent')] },
      { ...newVehicle('b', 'other', 'suv', '#1c1f26'), position: SUV_POS, heading: 270, path: SUV_PATH, damages: [damage('front_bumper', [0, 0.44, 1.33], 'dent')] },
    ],
    impact: IMPACT,
    police: { called: true, department: '', report: '', citations: '' },
    people: [{ ...newPerson('driver', 'a'), self: true, injured: false }],
  }

  const b: Claim = {
    ...emptyClaim(),
    reporter: { name: '', phone: '', email: '', policy: '', policyholder: null, party: 'other_party' },
    incident: freshIncident(),
    vehicles: [
      { ...newVehicle('x', 'insured', 'suv', '#1c1f26'), position: SUV_POS, heading: 270, path: SUV_PATH, damages: [damage('front_bumper', [0, 0.44, 1.33], 'dent')] },
      { ...newVehicle('y', 'other', 'sedan', '#b91c1c'), position: SEDAN_POS, heading: 90, path: SEDAN_PATH, damages: [damage('front_bumper', [0, 0.34, 1.24], 'dent')] },
    ],
    impact: IMPACT,
    police: { called: true, department: '', report: '', citations: '' },
    people: [{ ...newPerson('driver', 'x'), self: true, injured: false }],
  }

  return { a, b }
}

describe('two accounts that agree', () => {
  it('lands every row in agree, none in differ', () => {
    const { a, b } = pair()
    const result = compare(a, b)
    expect(result.unmatched).toEqual([])
    expect(result.differ).toEqual([])
    expect(result.agree.map((r) => r.key).sort()).toEqual(
      ['place', 'time', 'kind', 'rest:a', 'facing:a', 'from:a', 'rest:b', 'facing:b', 'from:b', 'impact', 'panel:a', 'panel:b', 'police', 'hurt', 'conditions'].sort(),
    )
  })
})

describe('matching the two accounts’ vehicles', () => {
  it('pairs by mirrored role and body/colour, not by id', () => {
    // b's vehicles are x/y, not a/b — the row keys below (a's own ids) only appear if the
    // matcher paired insured-with-other by what the vehicles are, not by shared ids
    const { a, b } = pair()
    const keys = [...compare(a, b).agree.map((r) => r.key)]
    expect(keys).toContain('rest:a')
    expect(keys).toContain('rest:b')
  })

  it('leaves a pairing that does not correspond in unmatched rather than forcing it', () => {
    const { a, b } = pair()
    // b's account of the sedan is actually a hatchback in a different colour — not the same car
    b.vehicles[1] = { ...newVehicle('y', 'other', 'hatchback', '#00ff00'), position: SEDAN_POS, heading: 90, path: SEDAN_PATH }
    const result = compare(a, b)
    const keys = [...result.agree, ...result.differ].map((r) => r.key)
    expect(keys).not.toContain('rest:a')
    expect(keys).toContain('rest:b') // the suv pair is untouched and still matches
    expect(result.unmatched).toHaveLength(2)
    expect(result.unmatched.some((m) => m.includes('appears only in the policyholder'))).toBe(true)
    expect(result.unmatched.some((m) => m.includes('appears only in the other driver'))).toBe(true)
  })
})

describe('place', () => {
  it(`agrees within ${PLACE_METRES} m and differs beyond it`, () => {
    const near = pair()
    const [lng, lat] = destination(HERE, 45, 5)
    near.b.incident.location = { lng, lat, address: '' }
    expect(compare(near.a, near.b).agree.map((r) => r.key)).toContain('place')

    const far = pair()
    const [lng2, lat2] = destination(HERE, 45, 40)
    far.b.incident.location = { lng: lng2, lat: lat2, address: '' }
    expect(compare(far.a, far.b).differ.map((r) => r.key)).toContain('place')
  })
})

describe('where a vehicle came to rest', () => {
  it(`agrees within ${REST_METRES} m and differs beyond it`, () => {
    const near = pair()
    near.b.vehicles[0].position = destination(SUV_POS, 45, 5)
    expect(compare(near.a, near.b).agree.map((r) => r.key)).toContain('rest:b')

    const far = pair()
    far.b.vehicles[0].position = destination(SUV_POS, 45, 40)
    expect(compare(far.a, far.b).differ.map((r) => r.key)).toContain('rest:b')
  })
})

describe('time', () => {
  it(`differs by an hour, with or without a UTC offset on one side`, () => {
    const withOffsets = pair()
    withOffsets.b.incident.at = '2026-09-06T18:30'
    expect(compare(withOffsets.a, withOffsets.b).differ.map((r) => r.key)).toContain('time')

    const oneUnzoned = pair()
    oneUnzoned.b.incident.at = '2026-09-06T18:30'
    oneUnzoned.b.incident.utcOffset = null
    expect(compare(oneUnzoned.a, oneUnzoned.b).differ.map((r) => r.key)).toContain('time')
  })

  it(`agrees within ${TIME_MINUTES} minutes`, () => {
    const { a, b } = pair()
    b.incident.at = '2026-09-06T17:35'
    expect(compare(a, b).agree.map((r) => r.key)).toContain('time')
  })
})

describe('which way a vehicle came from', () => {
  it(`differs beyond ${HEADING_DEGREES}° — one account north, the other south`, () => {
    const { a, b } = pair()
    // a's account: the suv's first leg arrives travelling north
    a.vehicles[1].path = [destination(SUV_POS, 180, 30)]
    // b's own account of that same car: its first leg arrives travelling south
    b.vehicles[0].path = [destination(SUV_POS, 0, 30)]
    const result = compare(a, b)
    const row = result.differ.find((r) => r.key === 'from:b')
    expect(row).toBeDefined()
    expect(row!.a).toContain('North')
    expect(row!.b).toContain('South')
  })

  it('is absent when either account drew no path', () => {
    const { a, b } = pair()
    a.vehicles[0].path = []
    const keys = [...compare(a, b).agree, ...compare(a, b).differ].map((r) => r.key)
    expect(keys).not.toContain('from:a')
  })
})

describe('panels marked on a matched vehicle', () => {
  it('differs when each account marks the opposite side of its own car', () => {
    const { a, b } = pair()
    a.vehicles[0].damages = [damage('left_front_door', [0.65, 0.5, 0.16], 'scratch')]
    b.vehicles[1].damages = [damage('right_front_door', [-0.65, 0.5, 0.16], 'scratch')]
    expect(compare(a, b).differ.map((r) => r.key)).toContain('panel:a')
  })
})

describe('police', () => {
  it('differs when only one side says the police were called', () => {
    const { a, b } = pair()
    b.police.called = false
    expect(compare(a, b).differ.map((r) => r.key)).toContain('police')
  })
})

describe('unmatched', () => {
  it('collects a vehicle with no partner and a question one side left blank', () => {
    const { a, b } = pair()
    a.vehicles.push({ ...newVehicle('c', 'other', 'truck', '#ffffff'), position: destination(HERE, 200, 50) })
    b.incident.location = null
    const result = compare(a, b)
    expect(result.unmatched).toContain('Where it happened was not given by the other driver.')
    expect(result.unmatched.some((m) => m.includes('appears only in the policyholder'))).toBe(true)
  })
})

describe('the module never accuses anyone', () => {
  it('never uses the words fraud, fault, liability, blame or suspicious', () => {
    const src = readFileSync(new URL('../src/claim/compare.ts', import.meta.url), 'utf8').toLowerCase()
    for (const word of ['fraud', 'fault', 'liab', 'blame', 'suspicio']) {
      expect(src).not.toContain(word)
    }
  })
})
