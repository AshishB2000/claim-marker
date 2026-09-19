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
  MIN_BLEND_MS,
  MIN_ESTABLISH_MS,
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
  impactPlaceOf,
  sharedTimeline,
  ease,
  endOf,
  frameAt,
  impactTimeOf,
  lengthOf,
  lerpAngle,
  posesAt,
  ringAt,
  shotAt,
  shots,
  timelineOf,
  wallMsOf,
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

  it('a moment on the clock is that frame of the drive', () => {
    const half = frameAt([a], tl, tl.ms / 2)
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

  it('an early impact shrinks the overhead and the ease to fit, and the slow-motion still covers the impact', () => {
    const home: Camera = { center: here, zoom: 19.9, pitch: 0, bearing: 0 }
    // impactMs is never past the drive, so the short clock takes only the moments that fit on it
    const sweep = [
      { ms: MIN_MS, impacts: [300, 800, 1400] },
      { ms: MAX_MS, impacts: [300, 800, 1400, 3000] },
    ]
    for (const { ms, impacts } of sweep) {
      for (const impactMs of impacts) {
        const tl = { ms, impactT: impactMs / ms, impactMs }
        const list = shots(tBone, tl)
        const why = `ms ${ms}, impact at ${impactMs}`
        // strictly increasing: never a tie for shotAt to break
        for (let i = 1; i < list.length; i++) expect(list[i].at, why).toBeGreaterThan(list[i - 1].at)
        // the rate drops to a quarter at the impact
        expect(shotAt(list, impactMs).rate, why).toBe(SLOW_RATE)
        // the window is the full width, or as much as the clock allows: from the earliest the
        // shortest overhead and ease can be done, to SLOW_AFTER_MS past the impact
        const earliest = MIN_ESTABLISH_MS + MIN_BLEND_MS
        expect(list[3].at - list[2].at, why).toBe(Math.min(SLOW_BEFORE_MS + SLOW_AFTER_MS, impactMs - earliest + SLOW_AFTER_MS))
        // the ease survives: at least MIN_BLEND_MS, done before the slow-motion, from home
        const [, chase] = list
        expect(chase.blend, why).toBeGreaterThanOrEqual(MIN_BLEND_MS)
        expect(chase.at, why).toBeGreaterThanOrEqual(MIN_ESTABLISH_MS)
        expect(chase.at + chase.blend, why).toBeLessThanOrEqual(list[2].at)
        const at = (t: number) => cameraAt(list, t, frameAt(tBone, tl, t).poses, home)
        expect(at(chase.at), why).toEqual(home)
        const mid = at(chase.at + chase.blend / 2)
        expect(mid.pitch, why).toBeGreaterThan(0)
        expect(mid.pitch, why).toBeLessThan(CHASE_PITCH)
        expect(shotAt(list, chase.at).rate, why).toBe(1)
      }
    }
    // with room to spare the constants are used as they are
    const roomy = shots(tBone, { ms: MAX_MS, impactT: 0.5, impactMs: 3000 })
    expect(roomy[1]).toMatchObject({ at: ESTABLISH_MS, blend: BLEND_MS })
    expect(roomy[2].at).toBe(3000 - SLOW_BEFORE_MS)
    // an impact in the first 300 ms is the start of the drive: the window still runs, in order
    const atStart = shots(tBone, { ms: MIN_MS, impactT: 0, impactMs: 0 })
    for (let i = 1; i < atStart.length; i++) expect(atStart[i].at).toBeGreaterThan(atStart[i - 1].at)
    expect(atStart[3].at - atStart[2].at).toBe(SLOW_AFTER_MS)
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

// ── two accounts of one accident, on one clock ───────────────────────
// The desk plays the policyholder's diagram and the other driver's over the same milliseconds.
// Each side drives its own routes over its own duration — `headOn` meets at the end of a 40 m
// drive, `shortDrive` at the end of a 12 m one — so the two impacts fall at different moments
// of the shared clock, which is the whole point of showing them together.
const shortDrive: ClaimVehicle[] = [
  car('a', [destination(here, 180, 12)], here, 0),
  { ...car('b', [destination(here, 0, 17)], destination(here, 0, 5), 180), role: 'other' },
]

describe('two accounts on one clock', () => {
  it('scrub in lockstep: one moment moves both sets, each along its own route', () => {
    const mine = timelineOf(headOn)
    const theirs = timelineOf(shortDrive)
    let lastMine = 0
    let lastTheirs = 0
    for (const ms of [0, 400, 800, 1200, 2000, 4000, 8000]) {
      const a = frameAt(headOn, mine, ms)
      const b = frameAt(shortDrive, theirs, ms)
      // both sets are somewhere at every moment, and neither ever goes backwards
      expect(a.poses).toHaveLength(2)
      expect(b.poses).toHaveLength(2)
      expect(a.t).toBeGreaterThanOrEqual(lastMine)
      expect(b.t).toBeGreaterThanOrEqual(lastTheirs)
      lastMine = a.t
      lastTheirs = b.t
    }
    // a moment into the drive, both have moved off their starting positions
    const moved = (vehicles: ClaimVehicle[], tl: ReturnType<typeof timelineOf>) =>
      distance(frameAt(vehicles, tl, 900).poses[0].position, posesAt(vehicles, 0)[0].position)
    expect(moved(headOn, mine)).toBeGreaterThan(0.5)
    expect(moved(shortDrive, theirs)).toBeGreaterThan(0.5)
    // the shorter drive holds its last pose while the longer one is still going
    const held = frameAt(shortDrive, theirs, theirs.ms + 1000).poses
    expect(distance(held[0].position, posesAt(shortDrive, 1)[0].position)).toBeLessThan(0.01)
    expect(frameAt(headOn, mine, theirs.ms + 1000).t).toBeLessThan(1)
  })

  it('the two impact ticks are ordered on that clock, and neither is past its own drive', () => {
    const mine = timelineOf(headOn)
    const theirs = timelineOf(shortDrive)
    expect(theirs.impactMs).toBeLessThan(mine.impactMs)
    expect(theirs.impactMs).toBeLessThanOrEqual(theirs.ms)
    expect(mine.impactMs).toBeLessThanOrEqual(mine.ms)
    // and the gap between them is what the desk's headline reports, in seconds
    expect((mine.impactMs - theirs.impactMs) / 1000).toBeCloseTo((durationOf(headOn) - durationOf(shortDrive)) / 1000, 6)
  })

  it('the chase follows the vehicle it is given, whichever account it belongs to', () => {
    const both = [...headOn, ...shortDrive.map((v) => ({ ...v, id: `other:${v.id}` }))]
    const tl = timelineOf(headOn)
    expect(shots(both, tl)[1].chase!.follow).toBe('a')
    expect(shots(both, tl, 'other:a')[1].chase!.follow).toBe('other:a')
    // an id nobody has falls back to the reporter's own car rather than losing the chase
    expect(shots(both, tl, 'nobody')[1].chase!.follow).toBe('a')
    // and the camera reads that pose out of the combined list
    const home: Camera = { center: here, zoom: 19.9, pitch: 0, bearing: 0 }
    const at = ESTABLISH_MS + BLEND_MS
    const poses = [...frameAt(headOn, tl, at).poses, ...frameAt(shortDrive, timelineOf(shortDrive), at).poses.map((p) => ({ ...p, id: `other:${p.id}` }))]
    const theirs = cameraAt(shots(both, tl, 'other:a'), at, poses, home)
    const mine = cameraAt(shots(both, tl), at, poses, home)
    expect(distance(theirs.center, mine.center)).toBeGreaterThan(1)
    expect(distance(theirs.center, poses.find((p) => p.id === 'other:a')!.position)).toBeCloseTo(BEHIND_M, 1)
  })

  it("the chase lasts until the longer drive is over, and slows into the first account's impact", () => {
    // the policyholder's drive is the short one; the other driver's is still going after it ends
    const mine = timelineOf(shortDrive)
    const theirs = timelineOf(headOn)
    const shared = sharedTimeline(mine, theirs)
    expect(shared.ms).toBe(theirs.ms)
    expect(shared.impactMs).toBe(mine.impactMs)
    expect(sharedTimeline(mine, null)).toBe(mine)
    const list = shots(shortDrive, shared)
    // still behind the car at the other account's impact, and back overhead only after both drives and the hold
    expect(shotAt(list, theirs.impactMs).chase).not.toBeNull()
    expect(list[list.length - 1].at).toBe(theirs.ms + HOLD_MS)
    expect(shotAt(list, mine.impactMs).rate).toBe(SLOW_RATE)
  })

  it('an account that never placed the cross still has a place: where its two cars meet', () => {
    const tl = timelineOf(headOn)
    const place = impactPlaceOf(headOn, tl.impactT)!
    const [a, b] = posesAt(headOn, ease(tl.impactT))
    expect(distance(place, a.position)).toBeCloseTo(distance(place, b.position), 1)
    expect(distance(place, here)).toBeLessThan(5)
    expect(impactPlaceOf([], 1)).toBeNull()
    expect(impactPlaceOf([car('a', [], here, 0)], 1)).toEqual(here)
  })

  it('a cinematic run costs more wall time than clock, because the slow-motion is a quarter rate', () => {
    const tl = timelineOf(headOn)
    const list = shots(headOn, tl)
    const end = tl.ms + HOLD_MS
    const wall = wallMsOf(list, end)
    expect(wall).toBeGreaterThan(end)
    // exactly the slow-motion window, which costs four seconds for every one of the clock
    const slow = list[3].at - list[2].at
    expect(wall).toBeCloseTo(end - slow + slow / SLOW_RATE, 6)
    // nothing past the end is counted, and a run of no length costs nothing
    expect(wallMsOf(list, 0)).toBe(0)
  })
})
