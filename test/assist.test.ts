import { describe, expect, it } from 'vitest'
import { fromFrame, toFrame } from '../src/assist/frame'
import { MAX_PATH, RANGE, parseScene } from '../src/assist/schema'
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
