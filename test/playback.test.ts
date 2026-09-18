import { describe, expect, it } from 'vitest'
import { newVehicle, type ClaimVehicle } from '../src/claim/schema'
import { bearing, destination, distance, type LngLat } from '../src/geo'
import {
  BEHIND_M,
  BLEND_MS,
  CHASE_PITCH,
  CHASE_ZOOM,
  ESTABLISH_MS,
  HOLD_MS,
  MAX_MS,
  MIN_MS,
  RING_M,
  SLOW_AFTER_MS,
  SLOW_BEFORE_MS,
  SLOW_RATE,
  SPEED,
  advance,
  along,
  cameraAt,
  durationOf,
  ease,
  endOf,
  frameAt,
  impactTimeOf,
  lengthOf,
  lerpAngle,
  posesAt,
  ringAt,
  seekTo,
  shotAt,
  shots,
  timelineOf,
  type Camera,
} from '../src/map/playback'

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

// head-on: A drives 40 m north to rest at `here`; B drives 40 m south to rest 5 m north of it, nose to nose
const headOn: ClaimVehicle[] = [car('a', [destination(here, 180, 40)], here, 0), { ...car('b', [destination(here, 0, 45)], destination(here, 0, 5), 180), role: 'other' }]
// T-bone: A drives 40 m north to rest at `here`; B crosses it from 20 m west to 20 m east, so they were closest before either came to rest
const tBone: ClaimVehicle[] = [car('a', [destination(here, 180, 40)], here, 0), { ...car('b', [destination(here, 270, 20)], destination(here, 90, 20), 90), role: 'other' }]
/** how far apart the two cars are at this moment of the drive */
const gap = (vehicles: ClaimVehicle[], t: number) => {
  const [a, b] = posesAt(vehicles, ease(t))
  return distance(a.position, b.position)
}

describe('the timeline', () => {
  it('a head-on meets at the end: the cars arrive together', () => {
    const tl = timelineOf(headOn)
    expect(tl.ms).toBe(durationOf(headOn))
    expect(tl.impactT).toBe(1)
    expect(tl.impactMs).toBe(tl.ms)
  })

  it('a T-bone meets where the routes cross, before either comes to rest', () => {
    const { impactT, impactMs, ms } = timelineOf(tBone)
    expect(impactT).toBeGreaterThan(0.3)
    expect(impactT).toBeLessThan(0.9)
    expect(impactMs).toBeCloseTo(impactT * ms, 6)
    for (let i = 0; i < 60; i++) expect(gap(tBone, impactT)).toBeLessThanOrEqual(gap(tBone, i / 59) + 1e-9)
    expect(gap(tBone, impactT)).toBeLessThan(gap(tBone, 1))
  })

  it('one route into a parked car meets at the parked car; nothing to drive, or nobody to meet, is the end', () => {
    expect(impactTimeOf([car('a', [destination(here, 180, 40)], here, 0), car('b', [], destination(here, 0, 5), 180)])).toBe(1)
    expect(impactTimeOf([car('a', [], here, 0), car('b', [], destination(here, 0, 5), 180)])).toBe(1)
    expect(impactTimeOf([car('a', [destination(here, 180, 40)], here, 0)])).toBe(1)
    expect(impactTimeOf([])).toBe(1)
  })
})

describe('the clock', () => {
  const start = destination(here, 180, 40)
  const a = car('a', [start], here, 0)
  const tl = timelineOf([a])

  it('seeks to a fraction of the drive, clamped, and the frame is that moment', () => {
    expect(seekTo(0.5, tl)).toBe(tl.ms / 2)
    expect(seekTo(-1, tl)).toBe(0)
    expect(seekTo(2, tl)).toBe(tl.ms)
    const half = frameAt([a], tl, seekTo(0.5, tl))
    expect(half.t).toBe(0.5)
    expect(half.poses).toEqual(posesAt([a], ease(0.5)))
    expect(distance(half.poses[0].position, start)).toBeCloseTo(20, 0)
  })

  it('past the end of the drive is the end, held', () => {
    const held = frameAt([a], tl, tl.ms + 500)
    expect(held.t).toBe(1)
    expect(distance(held.poses[0].position, here)).toBeLessThan(0.01)
  })

  it('advances at the rate, never past the end and never backwards', () => {
    expect(advance(100, 16, 1, 1000)).toBe(116)
    expect(advance(100, 16, SLOW_RATE, 1000)).toBe(104)
    expect(advance(990, 16, 1, 1000)).toBe(1000)
    expect(advance(100, -16, 1, 1000)).toBe(100)
  })
})

describe('the shot list', () => {
  const tl = timelineOf(headOn)
  const list = shots(headOn, tl)
  const inOrder = (l: ReturnType<typeof shots>) => {
    for (let i = 1; i < l.length; i++) expect(l[i].at).toBeGreaterThanOrEqual(l[i - 1].at)
  }

  it('keyframes in order: overhead, the chase, slow into the impact and out, held, back overhead', () => {
    inOrder(list)
    expect(list[0]).toEqual({ at: 0, blend: 0, rate: 1, chase: null })
    // the customer's own car, looked at the way it set off: north, up its route
    expect(list[1]).toMatchObject({ at: ESTABLISH_MS, blend: BLEND_MS, rate: 1, chase: { follow: 'a', pitch: CHASE_PITCH, zoom: CHASE_ZOOM } })
    expect(list[1].chase!.bearing).toBeCloseTo(0, 6)
    expect(list[2].at).toBe(tl.impactMs - SLOW_BEFORE_MS)
    expect(list[2].rate).toBe(SLOW_RATE)
    expect(list[3].at).toBe(tl.impactMs + SLOW_AFTER_MS)
    expect(list[3].rate).toBe(1)
    expect(list[4]).toEqual({ at: tl.ms + HOLD_MS, blend: BLEND_MS, rate: 1, chase: null })
    expect(endOf(list)).toBe(tl.ms + HOLD_MS + BLEND_MS)
  })

  it('an impact early in a short drive never puts the slow-motion before the chase has eased in', () => {
    const early = shots(tBone, { ms: MIN_MS, impactT: 0.2, impactMs: 300 })
    inOrder(early)
    expect(early[2].at).toBe(ESTABLISH_MS + BLEND_MS)
    expect(early[2].at).toBeGreaterThanOrEqual(early[1].at + early[1].blend)
    expect(early[3].at).toBeGreaterThanOrEqual(early[2].at)
    // the ease survives: the camera is still home when the chase begins, and only mid-way half-way through
    const home: Camera = { center: here, zoom: 19.9, pitch: 0, bearing: 0 }
    const tl = { ms: MIN_MS, impactT: 0.2, impactMs: 300 }
    const at = (ms: number) => cameraAt(early, ms, frameAt(tBone, tl, ms).poses, home)
    expect(at(early[1].at)).toEqual(home)
    expect(at(early[1].at + BLEND_MS / 2).pitch).toBeLessThan(CHASE_PITCH)
    expect(shotAt(early, early[1].at).rate).toBe(1)
  })

  it('the shot running now is the last to have begun', () => {
    expect(shotAt(list, 0)).toBe(list[0])
    expect(shotAt(list, ESTABLISH_MS)).toBe(list[1])
    expect(shotAt(list, tl.impactMs)).toBe(list[2])
    expect(shotAt(list, tl.impactMs + SLOW_AFTER_MS)).toBe(list[3])
    expect(shotAt(list, 1e9)).toBe(list[4])
  })

  it('the camera: the diagram, then behind the car and tilted, then the diagram again', () => {
    const home: Camera = { center: here, zoom: 19.9, pitch: 0, bearing: 0 }
    const at = (ms: number) => cameraAt(list, ms, frameAt(headOn, tl, ms).poses, home)
    expect(at(0)).toEqual(home)
    expect(at(ESTABLISH_MS)).toEqual(home)
    const mid = at(ESTABLISH_MS + BLEND_MS / 2)
    expect(mid.pitch).toBeGreaterThan(0)
    expect(mid.pitch).toBeLessThan(CHASE_PITCH)
    const chase = at(ESTABLISH_MS + BLEND_MS)
    expect(chase.pitch).toBe(CHASE_PITCH)
    expect(chase.zoom).toBe(CHASE_ZOOM)
    expect(chase.bearing).toBeCloseTo(0, 6)
    const car0 = frameAt(headOn, tl, ESTABLISH_MS + BLEND_MS).poses[0]
    expect(distance(chase.center, car0.position)).toBeCloseTo(BEHIND_M, 1)
    expect(bearing(chase.center, car0.position)).toBeCloseTo(0, 0)
    expect(at(tl.ms + HOLD_MS)).toMatchObject({ pitch: CHASE_PITCH })
    expect(at(endOf(list))).toEqual(home)
  })

  it('the shockwave rings the impact, growing to 8 m and fading over 600 ms', () => {
    expect(ringAt(tl, tl.impactMs - 1)).toBeNull()
    expect(ringAt(tl, tl.impactMs)).toEqual({ metres: 0, opacity: 1 })
    expect(ringAt(tl, tl.impactMs + 300)).toEqual({ metres: RING_M / 2, opacity: 0.5 })
    expect(ringAt(tl, tl.impactMs + 601)).toBeNull()
  })
})
