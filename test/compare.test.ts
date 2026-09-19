import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compare, impactApart, HEADING_DEGREES, PLACE_METRES, REST_METRES, TIME_MINUTES } from '../src/claim/compare'
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
    people: [
      { ...newPerson('driver', 'a'), self: true, injured: false },
      { ...newPerson('driver', 'b'), name: 'Dana Q', injured: false },
    ],
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
    people: [
      { ...newPerson('driver', 'x'), self: true, injured: false },
      { ...newPerson('driver', 'y'), name: 'Sam Lee', injured: false },
    ],
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
      ['place', 'time', 'kind', 'rest:a', 'facing:a', 'from:a', 'rest:b', 'facing:b', 'from:b', 'impact', 'panel:a', 'panel:b', 'occupants:a', 'occupants:b', 'police', 'hurt', 'conditions'].sort(),
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

describe('who was in each vehicle', () => {
  it('reads each account from its own side: the reporter is themself, not "the policyholder" twice', () => {
    const { a, b } = pair()
    const rows = compare(a, b).agree
    const sedan = rows.find((r) => r.key === 'occupants:a')!
    expect(sedan.label).toBe('Who was in red sedan')
    expect(sedan.a).toBe('Driver: The policyholder')
    expect(sedan.b).toBe('Driver: Sam Lee')
    const suv = rows.find((r) => r.key === 'occupants:b')!
    expect(suv.a).toBe('Driver: Dana Q')
    expect(suv.b).toBe('Driver: The other driver')
  })

  it('differs when one account puts more people in the car', () => {
    const { a, b } = pair()
    b.people.push(newPerson('passenger', 'y'), newPerson('passenger', 'y'))
    const row = compare(a, b).differ.find((r) => r.key === 'occupants:a')
    expect(row?.b).toBe('Driver: Sam Lee, 2 passengers')
  })

  it('is left unmatched when only one account lists anyone in it', () => {
    const { a, b } = pair()
    b.people = b.people.filter((p) => p.vehicle !== 'y')
    const result = compare(a, b)
    expect([...result.agree, ...result.differ].map((r) => r.key)).not.toContain('occupants:a')
    expect(result.unmatched).toContain('Who was in red sedan was not given by the other driver.')
  })
})

describe('what the other driver was seeded with', () => {
  it('marks the place and the time as seeded when the other driver left them as given', () => {
    const { a, b } = pair()
    const rows = compare(a, b).agree
    expect(rows.find((r) => r.key === 'place')?.seeded).toBe(true)
    expect(rows.find((r) => r.key === 'time')?.seeded).toBe(true)
    // nothing else is ever seeded
    expect(rows.filter((r) => r.seeded).map((r) => r.key).sort()).toEqual(['place', 'time'])
  })

  it('does not once they changed it, even to something that still agrees', () => {
    const { a, b } = pair()
    const [lng, lat] = destination(HERE, 45, 5)
    b.incident.location = { lng, lat, address: 'Times Square, New York' }
    b.incident.at = '2026-09-06T17:35'
    const rows = compare(a, b).agree
    expect(rows.find((r) => r.key === 'place')?.seeded).toBeUndefined()
    expect(rows.find((r) => r.key === 'time')?.seeded).toBeUndefined()
  })

  it('does not between two accounts from the same side, where nothing was seeded', () => {
    const { a } = pair()
    const rows = compare(a, structuredClone(a)).agree
    expect(rows.some((r) => r.seeded)).toBe(false)
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

/**
 * The headline above the table: the one number a row cannot hold, because it belongs to neither
 * account. Metres between the two points of impact, seconds between the two moments the two
 * diagrams reach it when both are played from the same start.
 */
describe('how far apart the two accounts put the impact', () => {
  it('is metres and seconds when both accounts have a cross and a route', () => {
    const { a, b } = pair()
    expect(impactApart(a, b)).toBe("The two accounts' impacts are 0 m and 0.0 s apart.")
    // the other driver remembers it 8 m away, and their cars drove half as far to get there
    const moved: Claim = {
      ...b,
      impact: destination(IMPACT, 90, 8),
      vehicles: b.vehicles.map((v) => ({ ...v, path: [destination(v.position!, v.heading, 15)] })),
    }
    const said = impactApart(a, moved)
    expect(said).toMatch(/^The two accounts' impacts are 8 m and \d+\.\d s apart\.$/)
    const seconds = Number(said.match(/and ([\d.]+) s/)![1])
    expect(seconds).toBeGreaterThan(0)
  })

  it('falls back to where that account\'s own cars meet when it never placed the cross', () => {
    const { a, b } = pair()
    const noCross: Claim = { ...b, impact: null }
    expect(impactApart(a, noCross)).toMatch(/^The two accounts' impacts are \d+ m and [\d.]+ s apart\.$/)
  })

  it('says so rather than inventing a moment when an account has nothing driving', () => {
    const { a, b } = pair()
    const parked: Claim = { ...b, vehicles: b.vehicles.map((v) => ({ ...v, path: [] })) }
    expect(impactApart(a, parked)).toBe("The two accounts' impacts are 0 m apart; the other driver's account has no route to time it from.")
    const neither: Claim = { ...a, vehicles: a.vehicles.map((v) => ({ ...v, path: [] })) }
    expect(impactApart(neither, parked)).toBe(
      "The two accounts' impacts are 0 m apart; the policyholder's account and the other driver's account have no route to time it from.",
    )
  })

  it('says so rather than measuring to nowhere when an account puts nothing on the map', () => {
    const { a, b } = pair()
    const nowhere: Claim = { ...b, impact: null, vehicles: [] }
    expect(impactApart(a, nowhere)).toBe("The other driver's account does not put the impact anywhere on a map.")
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
