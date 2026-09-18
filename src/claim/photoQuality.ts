/**
 * Is this camera frame worth keeping? The live camera sheet on the damage step samples the
 * video a few times a second, downscales it to about 160 px on the long edge in greyscale, and
 * asks this module for a hint — "hold still", "too dark" — to show over the viewfinder.
 *
 * These are hints, never gates: the shutter always works, and a blurry photo of real damage
 * beats no photo at all. Nothing here blocks or delays capture; it only suggests a better shot
 * before the customer taps the button, and says nothing when there is nothing useful to say.
 *
 * Pure and synchronous — no DOM, no canvas. The caller does the drawing (video frame → canvas →
 * ImageData → toGrey) and hands this module plain pixel arrays, so it can run in a test with no
 * browser at all.
 */

/**
 * The Laplacian needs a full 3×3 neighbourhood, so the outermost ring of pixels — which has no
 * neighbour on one side — is skipped rather than clamped or wrapped; clamping would manufacture
 * fake edges along the border and wrapping would compare opposite sides of the frame.
 */
const BORDER = 1

/** a sample at or below this is crushed black */
const BLACK = 8
/** a sample at or above this is blown white */
const WHITE = 247

/** the variance of a 3×3 Laplacian over the frame: high means edges, low means blur */
export function sharpness(gray: Uint8ClampedArray | Uint8Array, width: number, height: number): number {
  let sum = 0
  let sumSq = 0
  let count = 0
  for (let y = BORDER; y < height - BORDER; y++) {
    for (let x = BORDER; x < width - BORDER; x++) {
      const i = y * width + x
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width]
      sum += lap
      sumSq += lap * lap
      count++
    }
  }
  if (count === 0) return 0
  const mean = sum / count
  return sumSq / count - mean * mean
}

/** fraction of the frame whose Laplacian magnitude is above `EDGE_RESPONSE` — how "textured" it is */
function edgeFraction(gray: Uint8ClampedArray | Uint8Array, width: number, height: number): number {
  let edges = 0
  let count = 0
  for (let y = BORDER; y < height - BORDER; y++) {
    for (let x = BORDER; x < width - BORDER; x++) {
      const i = y * width + x
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width]
      // a Laplacian response is signed (a dark speck on a light ground reads negative), so an
      // edge is where the magnitude is large, not the raw value
      if (Math.abs(lap) > EDGE_RESPONSE) edges++
      count++
    }
  }
  return count === 0 ? 0 : edges / count
}

/** mean luma 0–255, and how much of the frame is crushed to black or blown to white */
export function exposure(gray: Uint8ClampedArray | Uint8Array): { mean: number; clippedBlack: number; clippedWhite: number } {
  const n = gray.length
  if (n === 0) return { mean: 0, clippedBlack: 0, clippedWhite: 0 }
  let sum = 0
  let black = 0
  let white = 0
  for (let i = 0; i < n; i++) {
    const v = gray[i]
    sum += v
    if (v <= BLACK) black++
    if (v >= WHITE) white++
  }
  return { mean: sum / n, clippedBlack: black / n, clippedWhite: white / n }
}

/** what to tell the customer, or null when the shot is fine */
export type Hint = 'hold_still' | 'too_dark' | 'too_bright' | 'step_back'

// Thresholds are named and exported so a reader can tune them and a test can assert against
// them rather than against copied magic numbers.

/** below this mean luma, call it too dark */
export const DARK_MEAN = 45
/** above this fraction crushed to black, call it too dark even if the mean is not that low */
export const DARK_CLIPPED = 0.5
/** above this mean luma, call it too bright */
export const BRIGHT_MEAN = 215
/** above this fraction blown to white, call it too bright even if the mean is not that high */
export const BRIGHT_CLIPPED = 0.35
/** below this, `sharpness` calls the frame blurred */
export const BLUR_SHARPNESS = 120
/** a Laplacian response with a magnitude over this counts as an edge, for `edgeFraction` */
export const EDGE_RESPONSE = 25
/** fewer edge pixels than this fraction and the frame is almost featureless */
export const FLAT_EDGE_FRACTION = 0.02

/** what to tell the customer, or null when the shot is fine */
export function hintFor(gray: Uint8ClampedArray | Uint8Array, width: number, height: number): Hint | null {
  // exposure first: a black frame is trivially unsharp, and "turn on the flash" is the useful
  // thing to say, not "hold still" for a photo that could never be sharp
  const { mean, clippedBlack, clippedWhite } = exposure(gray)
  if (mean < DARK_MEAN || clippedBlack > DARK_CLIPPED) return 'too_dark'
  if (mean > BRIGHT_MEAN || clippedWhite > BRIGHT_CLIPPED) return 'too_bright'
  if (sharpness(gray, width, height) < BLUR_SHARPNESS) return 'hold_still'
  // sharp and well exposed, but a flat wall or a blank panel filling the frame is also "sharp"
  // by variance alone — it just has almost no edges anywhere in it
  if (edgeFraction(gray, width, height) < FLAT_EDGE_FRACTION) return 'step_back'
  return null
}

/** turn RGBA pixels (a canvas `ImageData.data`) into one luma byte per pixel */
export function toGrey(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length / 4)
  for (let i = 0; i < out.length; i++) {
    const o = i * 4
    // BT.601 luma
    out[i] = Math.round(0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2])
  }
  return out
}
