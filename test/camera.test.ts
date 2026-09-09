import { describe, expect, it } from 'vitest'
import { ORBIT_TARGET, cameraFor } from '../src/marker/camera'
import { zoneById } from '../src/zones'

const dist = ([x, y, z]: number[], [tx, ty, tz]: number[]) => Math.hypot(x - tx, y - ty, z - tz)
const anchor = (id: string) => zoneById('sedan', id)!.anchor

describe('cameraFor', () => {
  it('keeps the orbit distance, so a fly-to never changes the zoom', () => {
    for (const id of ['left_front_door', 'roof', 'front_bumper', 'right_taillight']) {
      expect(dist(cameraFor(anchor(id), 4.2), ORBIT_TARGET)).toBeCloseTo(4.2, 6)
    }
  })

  it('looks at a door from that side of the car: the left door is at +X', () => {
    const left = cameraFor(anchor('left_front_door'), 4)
    const right = cameraFor(anchor('right_front_door'), 4)
    expect(left[0]).toBeGreaterThan(2)
    expect(right[0]).toBeLessThan(-2)
  })

  it('looks at the bumpers end-on', () => {
    expect(cameraFor(anchor('front_bumper'), 4)[2]).toBeGreaterThan(2)
    expect(cameraFor(anchor('rear_bumper'), 4)[2]).toBeLessThan(-2)
  })

  it('rises for the roof and stays low for the sills, without going overhead', () => {
    // the angle the camera looks down from, measured at the point it orbits
    const elevation = (at: number[]) => (Math.asin((at[1] - ORBIT_TARGET[1]) / 4) * 180) / Math.PI
    const roof = elevation(cameraFor(anchor('roof'), 4))
    const wheel = elevation(cameraFor(anchor('left_front_wheel'), 4))
    expect(roof).toBeGreaterThan(wheel)
    expect(wheel).toBeGreaterThan(10)
    // still a three-quarter view: swinging overhead for a roof damage loses the whole car
    expect(roof).toBeLessThan(45)
  })

  it('stays where the camera already is when the point sits on the centre line', () => {
    // the roof anchor is 0.2 m off centre: too close to pick a side from, so keep the fallback's
    const fromFrontRight = cameraFor(anchor('roof'), 4, ORBIT_TARGET, [1, 1])
    const fromRearLeft = cameraFor(anchor('roof'), 4, ORBIT_TARGET, [-1, -1])
    expect(fromFrontRight[0]).toBeGreaterThan(0)
    expect(fromRearLeft[0]).toBeLessThan(0)
  })

  it('is finite for a point exactly on the target', () => {
    const at = cameraFor(ORBIT_TARGET, 4)
    expect(at.every(Number.isFinite)).toBe(true)
    expect(dist(at, ORBIT_TARGET)).toBeCloseTo(4, 6)
  })
})
