import { describe, expect, it } from 'vitest'
import {
  BLUR_SHARPNESS,
  BRIGHT_MEAN,
  DARK_MEAN,
  exposure,
  hintFor,
  sharpness,
  toGrey,
} from '../src/claim/photoQuality'

function checkerboard(width: number, height: number, low = 0, high = 255): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out[y * width + x] = (x + y) % 2 === 0 ? high : low
  return out
}

function uniform(width: number, height: number, value: number): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height).fill(value)
}

// a plain 3×3 box blur, averaging each pixel with whichever neighbours are in bounds
function blur3(gray: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(gray.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0
      let n = 0
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy
          const xx = x + dx
          if (yy >= 0 && yy < height && xx >= 0 && xx < width) {
            sum += gray[yy * width + xx]
            n++
          }
        }
      out[y * width + x] = Math.round(sum / n)
    }
  }
  return out
}

describe('sharpness', () => {
  it('is far higher for a sharp checkerboard than the same image blurred', () => {
    const board = checkerboard(20, 20)
    const blurred = blur3(board, 20, 20)
    expect(sharpness(board, 20, 20)).toBeGreaterThan(sharpness(blurred, 20, 20) * 5)
  })

  it('is near zero for a uniform field', () => {
    expect(sharpness(uniform(10, 10, 128), 10, 10)).toBeLessThan(1)
  })

  it('does not throw or produce NaN on a 1x1 frame', () => {
    const s = sharpness(uniform(1, 1, 100), 1, 1)
    expect(Number.isNaN(s)).toBe(false)
  })

  it('does not throw or produce NaN on a 2x2 frame', () => {
    const s = sharpness(uniform(2, 2, 100), 2, 2)
    expect(Number.isNaN(s)).toBe(false)
  })
})

describe('exposure', () => {
  it('reads an all-black frame as mean 0, fully clipped black', () => {
    const e = exposure(uniform(10, 10, 0))
    expect(e.mean).toBe(0)
    expect(e.clippedBlack).toBe(1)
    expect(e.clippedWhite).toBe(0)
  })

  it('reads an all-white frame as mean 255, fully clipped white', () => {
    const e = exposure(uniform(10, 10, 255))
    expect(e.mean).toBe(255)
    expect(e.clippedWhite).toBe(1)
    expect(e.clippedBlack).toBe(0)
  })

  it('reads a mid-grey frame as unclipped', () => {
    const e = exposure(uniform(10, 10, 128))
    expect(e.mean).toBeCloseTo(128)
    expect(e.clippedBlack).toBe(0)
    expect(e.clippedWhite).toBe(0)
  })
})

describe('toGrey', () => {
  function rgba(r: number, g: number, b: number): Uint8ClampedArray {
    return new Uint8ClampedArray([r, g, b, 255])
  }

  it('applies BT.601 luma to red, green, blue and white', () => {
    expect(toGrey(rgba(255, 0, 0))[0]).toBe(Math.round(0.299 * 255))
    expect(toGrey(rgba(0, 255, 0))[0]).toBe(Math.round(0.587 * 255))
    expect(toGrey(rgba(0, 0, 255))[0]).toBe(Math.round(0.114 * 255))
    expect(toGrey(rgba(255, 255, 255))[0]).toBe(255)
  })
})

describe('hintFor', () => {
  const WIDTH = 20
  const HEIGHT = 20

  it('calls a dark frame too_dark', () => {
    expect(hintFor(uniform(WIDTH, HEIGHT, DARK_MEAN - 10), WIDTH, HEIGHT)).toBe('too_dark')
  })

  it('calls a blown-out frame too_bright', () => {
    expect(hintFor(uniform(WIDTH, HEIGHT, BRIGHT_MEAN + 10), WIDTH, HEIGHT)).toBe('too_bright')
  })

  it('calls a blurred but well-exposed frame hold_still', () => {
    let blurred = checkerboard(WIDTH, HEIGHT)
    for (let i = 0; i < 3; i++) blurred = blur3(blurred, WIDTH, HEIGHT)
    const e = exposure(blurred)
    expect(e.mean).toBeGreaterThan(DARK_MEAN)
    expect(e.mean).toBeLessThan(BRIGHT_MEAN)
    expect(sharpness(blurred, WIDTH, HEIGHT)).toBeLessThan(BLUR_SHARPNESS)
    expect(hintFor(blurred, WIDTH, HEIGHT)).toBe('hold_still')
  })

  it('calls a flat but correctly exposed field step_back', () => {
    const frame = uniform(WIDTH, HEIGHT, 128)
    // one bright speck, away from the border, is enough to be "sharp" by variance without
    // making the frame anything but almost featureless
    frame[10 * WIDTH + 10] = 255
    expect(sharpness(frame, WIDTH, HEIGHT)).toBeGreaterThanOrEqual(BLUR_SHARPNESS)
    expect(hintFor(frame, WIDTH, HEIGHT)).toBe('step_back')
  })

  it('calls a sharp, well-exposed, detailed frame fine', () => {
    // a full-contrast checkerboard is too extreme to be "well exposed" (half the frame reads
    // as clipped white); a milder alternation is still maximally high-frequency without clipping
    const frame = checkerboard(WIDTH, HEIGHT, 100, 160)
    expect(hintFor(frame, WIDTH, HEIGHT)).toBe(null)
  })

  it('reports too_dark, not hold_still, for a frame that is both dark and blurred', () => {
    // uniform is both dark (mean well under DARK_MEAN) and unsharp (variance zero) — too_dark
    // must win because exposure is checked before blur
    expect(hintFor(uniform(WIDTH, HEIGHT, DARK_MEAN - 20), WIDTH, HEIGHT)).toBe('too_dark')
  })

  it('does not throw on a 1x1 or 2x2 frame', () => {
    expect(() => hintFor(uniform(1, 1, 128), 1, 1)).not.toThrow()
    expect(() => hintFor(uniform(2, 2, 128), 2, 2)).not.toThrow()
  })
})
