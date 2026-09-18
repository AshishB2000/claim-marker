import { describe, expect, it } from 'vitest'
import { fromFrame, toFrame } from '../src/assist/frame'
import { MAX_CHECKS, MAX_PATH, MAX_SUGGESTIONS, RANGE, parseChecks, parseIntake, parseScene, parseSuggestions } from '../src/assist/schema'
import { zoneById, zonesOf } from '../src/zones'
import { bearing, destination, distance, type LngLat } from '../src/geo'

const here: LngLat = [-73.9859, 40.7573]

describe('the metric frame', () => {
  it('is metres east and north of the incident', () => {
    expect(toFrame(here, destination(here, 0, 10))).toEqual([0, 10])
    expect(toFrame(here, destination(here, 90, 25))).toEqual([25, 0])
    expect(toFrame(here, destination(here, 180, 7))).toEqual([0, -7])
    expect(toFrame(here, destination(here, 270, 7))).toEqual([-7, 0])
    expect(toFrame(here, here)).toEqual([0, 0])
  })

  it('round-trips both ways to the centimetre it rounds to', () => {
    for (const p of [
      [12, -34],
      [-180, 199],
      [0.5, 0.5],
      [0, 0],
    ] as [number, number][]) {
      expect(toFrame(here, fromFrame(here, p))).toEqual(p)
    }
    const somewhere = destination(destination(here, 42, 63), 300, 18)
    const back = fromFrame(here, toFrame(here, somewhere))
    expect(distance(somewhere, back)).toBeLessThan(0.02)
  })

  it('agrees with the bearing a map would take', () => {
    const p = fromFrame(here, [30, 30])
    expect(bearing(here, p)).toBeCloseTo(45, 1)
    expect(distance(here, p)).toBeCloseTo(Math.hypot(30, 30), 1)
  })
})

describe('a scene coming back over the wire', () => {
  const ids = ['a', 'b']
  const good = { id: 'a', at: [3, -4], heading: 91.6, from: [[0, -20]] }

  it('keeps a well-formed scene, rounding the heading the way the claim does', () => {
    const s = parseScene({ vehicles: [good], impact: [1, 1], note: ' hit at the junction ' }, ids)
    expect(s.vehicles).toEqual([{ id: 'a', at: [3, -4], heading: 92, from: [[0, -20]] }])
    expect(s.impact).toEqual([1, 1])
    expect(s.note).toBe('hit at the junction')
  })

  it('drops a vehicle the customer never listed, and one listed twice', () => {
    expect(parseScene({ vehicles: [{ ...good, id: 'z' }] }, ids).vehicles).toEqual([])
    expect(parseScene({ vehicles: [good, { ...good, at: [9, 9] }] }, ids).vehicles).toHaveLength(1)
  })

  it('drops nonsense rather than trusting it', () => {
    const bad = [
      { ...good, at: [3] },
      { ...good, at: ['3', 4] },
      { ...good, at: [RANGE + 1, 0] },
      { ...good, heading: 'north' },
      { ...good, heading: Infinity },
      { id: 'a' },
      null,
    ]
    for (const v of bad) expect(parseScene({ vehicles: [v] }, ids).vehicles, JSON.stringify(v)).toEqual([])
    expect(parseScene({ vehicles: [good], impact: [0, RANGE + 5] }, ids).impact).toBeNull()
    expect(parseScene({ vehicles: [good], impact: 'the junction' }, ids).impact).toBeNull()
  })

  it('keeps the good points of a route and caps its length', () => {
    const from = [[0, 0], ['x', 1], [1, 1], [RANGE + 2, 0]]
    expect(parseScene({ vehicles: [{ ...good, from }] }, ids).vehicles[0].from).toEqual([[0, 0], [1, 1]])
    const long = Array.from({ length: 30 }, (_, i) => [i, i])
    expect(parseScene({ vehicles: [{ ...good, from: long }] }, ids).vehicles[0].from).toHaveLength(MAX_PATH)
    expect(parseScene({ vehicles: [{ ...good, from: 'north' }] }, ids).vehicles[0].from).toEqual([])
  })

  it('survives an answer with nothing usable in it, and throws only on the wrong shape', () => {
    expect(parseScene({}, ids)).toEqual({ vehicles: [], impact: null, note: '' })
    expect(() => parseScene(null, ids)).toThrow(TypeError)
    expect(() => parseScene('a scene', ids)).toThrow(TypeError)
  })
})

describe('the questions a second look comes back with', () => {
  it('keeps short text, drops anything that is not text, and caps at five', () => {
    expect(parseChecks([{ text: 'Were the police called?', step: 'people' }])).toEqual([{ text: 'Were the police called?', step: 'people' }])
    expect(parseChecks([{ text: '  spaces  ' }])).toEqual([{ text: 'spaces' }])
    expect(parseChecks([{ text: '' }, { text: '   ' }, { text: 42 }, { step: 'people' }, null, 'a string'])).toEqual([])
    expect(parseChecks(Array.from({ length: 9 }, (_, i) => ({ text: `question ${i}` })))).toHaveLength(MAX_CHECKS)
  })

  it('keeps a question whose step this page does not have, without the link', () => {
    expect(parseChecks([{ text: 'Add a photo', step: 'photos' }])).toEqual([{ text: 'Add a photo' }])
    expect(parseChecks([{ text: 'Add a photo', step: 7 }])).toEqual([{ text: 'Add a photo' }])
  })

  it('cuts an essay down and drops the same question asked twice', () => {
    const long = parseChecks([{ text: 'x'.repeat(400) }])
    expect(long[0].text).toHaveLength(200)
    expect(parseChecks([{ text: 'Were the police called?' }, { text: 'were the POLICE called?', step: 'people' }])).toHaveLength(1)
  })

  it('is empty for anything that is not a list of questions', () => {
    for (const bad of [null, undefined, 42, 'checks', {}, { checks: [] }]) expect(parseChecks(bad)).toEqual([])
  })
})

describe('damage read off the photographs', () => {
  it('lands each mark on that zone’s own anchor, not on anything the answer sent', () => {
    const marks = parseSuggestions([{ zone: 'front_bumper', severity: 'dent', note: 'crumpled', point: [99, 99, 99] }], 'sedan')
    expect(marks).toHaveLength(1)
    expect(marks[0].zone).toBe('front_bumper')
    expect(marks[0].severity).toBe('dent')
    expect(marks[0].note).toBe('crumpled')
    expect(marks[0].point).toEqual(zoneById('sedan', 'front_bumper')!.anchor)
  })

  it('drops a panel this body does not have, and a severity that is not one of the four', () => {
    // a pickup has no rear doors, and "totalled" is not a severity
    expect(parseSuggestions([{ zone: 'rear_door', severity: 'dent' }], 'truck')).toEqual([])
    expect(parseSuggestions([{ zone: 'left_rear_door', severity: 'dent' }], 'sedan')).toHaveLength(1)
    expect(parseSuggestions([{ zone: 'hood', severity: 'totalled' }], 'sedan')).toEqual([])
    expect(parseSuggestions([{ zone: 'nonsense', severity: 'dent' }], 'sedan')).toEqual([])
  })

  it('marks each panel once, caps the run, and cuts a long note', () => {
    expect(parseSuggestions([{ zone: 'hood', severity: 'dent' }, { zone: 'hood', severity: 'crack' }], 'sedan')).toHaveLength(1)
    const every = zonesOf('sedan').map((z) => ({ zone: z.id, severity: 'scratch' }))
    expect(parseSuggestions(every, 'sedan')).toHaveLength(MAX_SUGGESTIONS)
    expect(parseSuggestions([{ zone: 'hood', severity: 'dent', note: 'y'.repeat(300) }], 'sedan')[0].note).toHaveLength(120)
  })

  it('is empty for anything that is not a list of marks', () => {
    for (const bad of [null, undefined, 42, 'damages', {}]) expect(parseSuggestions(bad, 'sedan')).toEqual([])
  })
})

describe('intake', () => {
  const now = '2024-06-01T12:00'
  const colours = ['red', 'blue']

  const full = {
    kind: 'collision',
    when: '2024-06-01T11:30',
    place: 'Main St and 3rd Ave',
    conditions: { weather: 'rain', road: 'wet', light: 'dusk' },
    vehicles: [
      { role: 'insured', make: 'Toyota', model: 'Camry', year: 2022, color: 'red', body: 'sedan' },
      { role: 'other', make: 'Ford', model: 'F-150', year: 2019, color: 'blue', body: 'truck' },
    ],
    people: [
      { role: 'driver', vehicle: 'insured', injured: false },
      { role: 'passenger', vehicle: 'other', injured: true, injury: 'bruised arm' },
    ],
    police: { called: true, report: 'RPT-4821' },
    property: 'a mailbox on the corner',
    description: 'Two cars collided at the intersection during rain.',
  }

  it('round-trips a full, well-formed draft', () => {
    expect(parseIntake(full, now, colours)).toEqual(full)
  })

  it('drops an unknown kind, keeping the rest of the draft', () => {
    const draft = parseIntake({ ...full, kind: 'meteor-strike' }, now, colours)
    expect(draft.kind).toBeUndefined()
    expect(draft.place).toBe('Main St and 3rd Ave')
  })

  it('drops an unknown weather, road or light, keeping the others', () => {
    expect(parseIntake({ conditions: { weather: 'tornado', road: 'wet', light: 'dusk' } }, now).conditions).toEqual({ road: 'wet', light: 'dusk' })
    expect(parseIntake({ conditions: { weather: 'rain', road: 'lava', light: 'dusk' } }, now).conditions).toEqual({ weather: 'rain', light: 'dusk' })
    expect(parseIntake({ conditions: { weather: 'rain', road: 'wet', light: 'blackout' } }, now).conditions).toEqual({ weather: 'rain', road: 'wet' })
    expect(parseIntake({ conditions: { weather: 'tornado' } }, now).conditions).toBeUndefined()
  })

  it('drops a vehicle with no valid role, and an unknown body from one that has a role', () => {
    expect(parseIntake({ vehicles: [{ make: 'Toyota' }, { role: 'martian', make: 'Toyota' }] }, now).vehicles).toBeUndefined()
    const draft = parseIntake({ vehicles: [{ role: 'insured', body: 'spaceship', make: 'Toyota' }] }, now)
    expect(draft.vehicles).toEqual([{ role: 'insured', make: 'Toyota' }])
  })

  it('drops a person with no valid role, and an unknown vehicle role from one that has a role', () => {
    expect(parseIntake({ people: [{ injured: false }, { role: 'ghost', injured: false }] }, now).people).toBeUndefined()
    const draft = parseIntake({ people: [{ role: 'driver', vehicle: 'nonexistent', injured: false }] }, now)
    expect(draft.people).toEqual([{ role: 'driver', injured: false }])
  })

  it('a vehicle with an unknown colour loses only its colour', () => {
    const draft = parseIntake({ vehicles: [{ role: 'insured', make: 'Toyota', color: 'chartreuse' }] }, now, colours)
    expect(draft.vehicles).toEqual([{ role: 'insured', make: 'Toyota' }])
  })

  it('drops a when in the future, keeps one equal to now', () => {
    expect(parseIntake({ when: '2024-06-01T12:01' }, now).when).toBeUndefined()
    expect(parseIntake({ when: '2024-06-01T12:00' }, now).when).toBe('2024-06-01T12:00')
    expect(parseIntake({ when: '2024-05-31T23:59' }, now).when).toBe('2024-05-31T23:59')
  })

  it('drops a malformed when', () => {
    for (const bad of ['2024-06-01', '06/01/2024 12:00', 'this morning', 12345, null, true])
      expect(parseIntake({ when: bad }, now).when, JSON.stringify(bad)).toBeUndefined()
  })

  it('proposes nothing about the police unless the account said whether they were called', () => {
    for (const bad of [{}, { report: '123' }, { called: 'yes' }, { called: null }])
      expect(parseIntake({ police: bad }, now).police, JSON.stringify(bad)).toBeUndefined()
    expect(parseIntake({ police: { called: false } }, now).police).toEqual({ called: false })
    expect(parseIntake({ police: { called: true, report: 'RPT-9' } }, now).police).toEqual({ called: true, report: 'RPT-9' })
  })

  it('caps vehicles at six', () => {
    const vehicles = Array.from({ length: 9 }, (_, i) => ({ role: i % 2 ? 'other' : 'insured', make: `Make${i}` }))
    expect(parseIntake({ vehicles }, now).vehicles).toHaveLength(6)
  })

  it('caps people at twelve', () => {
    const people = Array.from({ length: 20 }, () => ({ role: 'witness', injured: false }))
    expect(parseIntake({ people }, now).people).toHaveLength(12)
  })

  it('caps an over-long description', () => {
    expect(parseIntake({ description: 'x'.repeat(2000) }, now).description).toHaveLength(1000)
  })

  it('keeps identity fields out of the draft, at every level', () => {
    const poison = {
      name: 'Alex',
      phone: '555-0100',
      licence: 'X1',
      plate: 'ABC123',
      vin: '1HGCM82633A123456',
      email: 'alex@example.com',
      kind: 'collision',
      conditions: { weather: 'rain', name: 'Alex' },
      vehicles: [
        { role: 'insured', make: 'Toyota', name: 'Alex', phone: '555-0100', licence: 'X1', plate: 'ABC123', vin: '1HGCM82633A123456', email: 'alex@example.com' },
      ],
      people: [{ role: 'driver', injured: false, name: 'Alex', phone: '555-0100', licence: 'X1', plate: 'ABC123', vin: '1HGCM82633A123456', email: 'alex@example.com' }],
      police: { called: true, name: 'Officer Alex', phone: '555-0100' },
    }
    const draft = parseIntake(poison, now, colours)
    const forbidden = ['name', 'phone', 'licence', 'plate', 'vin', 'email']
    const keys: string[] = []
    const walk = (v: unknown) => {
      if (Array.isArray(v)) {
        for (const e of v) walk(e)
      } else if (v && typeof v === 'object') {
        for (const [k, sub] of Object.entries(v)) {
          keys.push(k)
          walk(sub)
        }
      }
    }
    walk(draft)
    for (const key of forbidden) expect(keys, JSON.stringify(draft)).not.toContain(key)
  })

  it('is an empty draft for anything that is not a draft-shaped object', () => {
    for (const bad of [null, 'nonsense', [], { draft: 5 }]) expect(parseIntake(bad, now)).toEqual({})
  })

  it('drops empty strings rather than keeping them', () => {
    expect(parseIntake({ place: '   ', description: '', property: '  ' }, now)).toEqual({})
  })
})
