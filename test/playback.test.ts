import { describe, expect, it } from 'vitest'
import { newVehicle, type ClaimVehicle } from '../src/claim/schema'
import { destination, distance, type LngLat } from '../src/geo'
import { MAX_MS, MIN_MS, SPEED, along, durationOf, lengthOf, lerpAngle, posesAt } from '../src/map/playback'

const here: LngLat = [-73.9859, 40.7573]
const car = (id: string, path: LngLat[], position: LngLat | null, heading: number): ClaimVehicle => ({
  ...newVehicle(id, 'insured', 'sedan', '#b91c1c'),
  path,
  position,
  heading,
})

describe('playback', () => {
  // drove 40 m north in two legs and came to rest facing east
  const start = destination(here, 180, 40)
  const mid = destination(here, 180, 10)
  const a = car('a', [start, mid], here, 90)

  it('measures the route', () => {
    expect(lengthOf([start, mid, here])).toBeCloseTo(40, 1)
    expect(lengthOf([here])).toBe(0)
  })

  it('starts at the start of the path, heading along it', () => {
    const [p] = posesAt([a], 0)
    expect(distance(p.position, start)).toBeLessThan(0.01)
    expect(p.heading).toBeCloseTo(0, 0)
  })

  it('is halfway along at t = 0.5, still following the road', () => {
    const [p] = posesAt([a], 0.5)
    expect(distance(p.position, start)).toBeCloseTo(20, 0)
    expect(p.heading).toBeCloseTo(0, 0)
  })

  it('ends where the car came to rest, facing the way it rests', () => {
    const [p] = posesAt([a], 1)
    expect(distance(p.position, here)).toBeLessThan(0.01)
    expect(p.heading).toBe(90)
  })

  it('a car with no path stands still, and one not on the map is left out', () => {
    const b = car('b', [], here, 270)
    for (const t of [0, 0.5, 1]) {
      const [p] = posesAt([b], t)
      expect(p.position).toEqual(here)
      expect(p.heading).toBe(270)
    }
    expect(posesAt([car('c', [], null, 0)], 0.5)).toEqual([])
  })

  it('past the end of the route is the end of the route', () => {
    const { position, bearing } = along([start, here], 1000)
    expect(position).toEqual(here)
    expect(bearing).toBeCloseTo(0, 0)
  })

  it('the longest route sets the clock, within limits', () => {
    expect(durationOf([a])).toBe(MAX_MS)
    expect(durationOf([car('s', [destination(here, 0, 3)], here, 0)])).toBe(MIN_MS)
    expect(durationOf([car('m', [destination(here, 0, 24)], here, 0), car('n', [], here, 0)])).toBeCloseTo((24 / SPEED) * 1000, -1)
  })

  it('turns the short way round', () => {
    expect(lerpAngle(0, 90, 0.5)).toBe(45)
    expect(lerpAngle(350, 10, 0.5)).toBe(0)
    expect(lerpAngle(10, 350, 0.5)).toBe(0)
    expect(lerpAngle(90, 90, 0.3)).toBe(90)
  })
})
