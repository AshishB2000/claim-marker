import { describe, expect, it } from 'vitest'
import { newVehicle, type ClaimVehicle } from '../src/claim/schema'
import { destination, type LngLat } from '../src/geo'
import { MIME_CANDIDATES, captionBaseline, damageCount, fitContain, hasReplay, pickMimeType, progressBarRect } from '../src/map/record'

const here: LngLat = [-73.9859, 40.7573]
const car = (id: string, path: LngLat[], position: LngLat | null): ClaimVehicle => ({ ...newVehicle(id, 'insured', 'sedan', '#b91c1c'), path, position, heading: 0 })

describe('pickMimeType', () => {
  it('takes the first candidate the browser supports', () => {
    expect(pickMimeType((t) => t === 'video/webm;codecs=vp8' || t === 'video/mp4')).toBe('video/webm;codecs=vp8')
  })

  it('prefers vp9 over everything else', () => {
    expect(pickMimeType(() => true)).toBe('video/webm;codecs=vp9')
  })

  it('falls back to mp4 last, for Safari — the only browser that records it and not webm', () => {
    expect(MIME_CANDIDATES.at(-1)).toBe('video/mp4')
    expect(pickMimeType((t) => t === 'video/mp4')).toBe('video/mp4')
  })

  it('is null when nothing on the list is supported', () => {
    expect(pickMimeType(() => false)).toBeNull()
  })
})

describe('hasReplay', () => {
  it('is false with no vehicles at all', () => {
    expect(hasReplay([])).toBe(false)
  })

  it('is false when a vehicle is on the map but never moved', () => {
    expect(hasReplay([car('a', [], here)])).toBe(false)
  })

  it('is false for a vehicle not yet placed, even with a drawn path', () => {
    expect(hasReplay([car('a', [destination(here, 90, 10)], null)])).toBe(false)
  })

  it('is true as soon as one vehicle has a route with some length', () => {
    const moved = car('a', [destination(here, 180, 20)], here)
    expect(hasReplay([car('b', [], here), moved])).toBe(true)
  })
})

describe('fitContain', () => {
  it('fills the destination exactly when the aspect ratio already matches', () => {
    expect(fitContain(960, 540, 960, 540)).toEqual({ x: 0, y: 0, width: 960, height: 540 })
  })

  it('letterboxes top and bottom for a source wider than the destination', () => {
    const r = fitContain(1000, 250, 960, 540)
    expect(r.width).toBeCloseTo(960, 5)
    expect(r.height).toBeCloseTo(240, 5)
    expect(r.x).toBeCloseTo(0, 5)
    expect(r.y).toBeCloseTo((540 - 240) / 2, 5)
  })

  it('pillarboxes left and right for a source narrower than the destination', () => {
    const r = fitContain(200, 400, 960, 540)
    expect(r.height).toBeCloseTo(540, 5)
    expect(r.width).toBeCloseTo(270, 5)
    expect(r.y).toBeCloseTo(0, 5)
    expect(r.x).toBeCloseTo((960 - 270) / 2, 5)
  })

  it('is a zero rect rather than dividing by zero for a degenerate source', () => {
    expect(fitContain(0, 0, 960, 540)).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})

describe('progressBarRect', () => {
  it('starts empty', () => {
    expect(progressBarRect(0, 960, 540).width).toBe(0)
  })

  it('is full width at the end', () => {
    expect(progressBarRect(1, 960, 540).width).toBe(960)
  })

  it('is proportional in between', () => {
    expect(progressBarRect(0.25, 960, 540).width).toBeCloseTo(240, 5)
  })

  it('clamps outside 0–1', () => {
    expect(progressBarRect(-1, 960, 540).width).toBe(0)
    expect(progressBarRect(2, 960, 540).width).toBe(960)
  })

  it('sits along the very bottom', () => {
    const r = progressBarRect(0.5, 960, 540)
    expect(r.y + r.height).toBe(540)
  })
})

describe('captionBaseline', () => {
  it('sits above the progress bar, not on top of it', () => {
    const bar = progressBarRect(1, 960, 540)
    expect(captionBaseline(540)).toBeLessThan(bar.y)
  })
})

describe('damageCount', () => {
  it('is singular for one', () => {
    expect(damageCount(1, 'en')).toBe('1 damage')
  })

  it('is plural otherwise, and reads in Spanish too', () => {
    expect(damageCount(3, 'en')).toBe('3 damages')
    expect(damageCount(3, 'es')).toBe('3 daños')
  })
})
