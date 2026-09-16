import { describe, expect, it } from 'vitest'
import { fromFrame, toFrame } from '../src/assist/frame'
import { MAX_CHECKS, MAX_PATH, MAX_SUGGESTIONS, RANGE, parseChecks, parseScene, parseSuggestions } from '../src/assist/schema'
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
