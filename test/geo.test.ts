import { describe, expect, it } from 'vitest'
import { bearing, destination, distance, normalizeBearing, roundLngLat, type LngLat } from '../src/geo'

const TIMES_SQUARE: LngLat = [-73.9859, 40.7573]

/** signed difference between two bearings, so 359.9999 and 0 count as equal */
const turn = (a: number, b: number) => ((a - b + 540) % 360) - 180

describe('destination and bearing agree', () => {
  it.each([0, 45, 90, 135, 180, 225, 270, 315])('bearing %i° round-trips through destination', (b) => {
    const there = destination(TIMES_SQUARE, b, 25)
    expect(turn(bearing(TIMES_SQUARE, there), b)).toBeCloseTo(0, 3)
    expect(distance(TIMES_SQUARE, there)).toBeCloseTo(25, 4)
  })

  it('north is up: a point due north has a larger latitude and the same longitude', () => {
    const [lng, lat] = destination(TIMES_SQUARE, 0, 10)
    expect(lat).toBeGreaterThan(TIMES_SQUARE[1])
    expect(lng).toBeCloseTo(TIMES_SQUARE[0], 9)
  })

  it('east increases longitude', () => {
    expect(destination(TIMES_SQUARE, 90, 10)[0]).toBeGreaterThan(TIMES_SQUARE[0])
  })

  it('survives the antimeridian', () => {
    const [lng] = destination([179.9999, 0], 90, 50)
    expect(lng).toBeLessThan(-179.9)
  })
})

describe('bearings and rounding', () => {
  it('normalises bearings into 0–360', () => {
    expect(normalizeBearing(-90)).toBe(270)
    expect(normalizeBearing(720)).toBe(0)
    expect(normalizeBearing(359.5)).toBe(359.5)
  })

  it('rounds coordinates to six decimals so export → load → export is stable', () => {
    const once = roundLngLat([0.1 + 0.2, 40.75730001])
    expect(once).toEqual([0.3, 40.7573])
    expect(roundLngLat(once)).toEqual(once)
  })
})
