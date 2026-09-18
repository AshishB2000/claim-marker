/**
 * The customer's photographs, made small enough to keep. A phone photo is 3–8 MB; the draft
 * lives in localStorage with a ~5 MB budget and the document is POSTed as JSON, so each one is
 * downscaled to 1280 px on its long edge and re-encoded as a JPEG before it is stored —
 * a few hundred kB, plenty for an adjuster to see a dent, and twelve of them still fit.
 */

import { distance } from '../geo'
import { instantOf, type Incident } from './schema'
import type { PhotoExif } from './exif'

/** long edge, in pixels */
export const PHOTO_EDGE = 1280
const QUALITY = 0.72

export async function shrink(file: File): Promise<{ data: string; hash: string | null }> {
  // createImageBitmap honours the EXIF orientation, so a portrait phone shot stays upright
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const scale = Math.min(1, PHOTO_EDGE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('photos: no 2d context')
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    // the fingerprint comes off the same decoded image, while there is a canvas to hand
    return { data: canvas.toDataURL('image/jpeg', QUALITY), hash: dHash(bitmap) }
  } finally {
    bitmap.close()
  }
}

/** the fingerprint's grid: nine columns give eight horizontal comparisons, over eight rows */
const HASH_W = 9
const HASH_H = 8

/**
 * A difference hash: the picture squashed to 9×8 grey, then one bit per pair of side-by-side
 * pixels saying which was brighter — sixty-four bits, sixteen hex characters. Two photographs
 * of the same thing at different sizes, qualities or brightnesses come out within a few bits
 * of each other, which is the whole point: the claim server has no image decoder and cannot
 * compare pictures, only strings.
 *
 * Deliberately not a cryptographic hash, and deliberately not a claim about anything. It says
 * "these two are the same picture"; whether that matters is an adjuster's call.
 *
 * ponytail: computed in the page because the server has no dependencies, so a determined
 * sender can put any sixteen characters they like here. Upgrade path when an insurer adopts
 * this for real: hash server-side with an image library and ignore what the page sent.
 */
function dHash(bitmap: ImageBitmap): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = HASH_W
  canvas.height = HASH_H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(bitmap, 0, 0, HASH_W, HASH_H)
  let grey: Uint8ClampedArray
  try {
    grey = ctx.getImageData(0, 0, HASH_W, HASH_H).data
  } catch {
    // a canvas tainted by a cross-origin image cannot be read; no fingerprint, no harm
    return null
  }
  let bits = ''
  for (let y = 0; y < HASH_H; y++) {
    for (let x = 0; x < HASH_W - 1; x++) {
      const l = (y * HASH_W + x) * 4
      const r = l + 4
      const left = grey[l] * 0.299 + grey[l + 1] * 0.587 + grey[l + 2] * 0.114
      const right = grey[r] * 0.299 + grey[r + 1] * 0.587 + grey[r + 2] * 0.114
      bits += left > right ? '1' : '0'
    }
  }
  return (bits.match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2).toString(16).padStart(2, '0')).join('')
}

/**
 * How far a photograph's own metadata puts it from the incident the customer described — and
 * that is all that is kept. The raw position is read here, turned into a distance, and thrown
 * away: a picture out of the gallery can carry the customer's home, and a claim has no
 * business knowing it. See `Photo.minutesFromIncident` / `metresFromScene`.
 *
 * Zones, carefully. A photograph that recorded `OffsetTimeOriginal` and an incident whose zone
 * the weather lookup resolved are both real instants and simply subtract. When either is
 * missing, the one that exists is used for both — a camera with no offset wrote the same wall
 * clock the customer is typing into the form — and when neither exists both are read in the
 * same unnamed zone, which for two times a few hours apart is exactly right.
 */
export function photoDistances(
  exif: PhotoExif,
  incident: Pick<Incident, 'at' | 'utcOffset' | 'location'>,
): { minutesFromIncident?: number; metresFromScene?: number } {
  const out: { minutesFromIncident?: number; metresFromScene?: number } = {}
  if (exif.takenAt) {
    const shared = exif.utcOffset ?? incident.utcOffset ?? 0
    const shot = instantOf(exif.takenAt, exif.utcOffset ?? shared)
    const crash = instantOf(incident.at, incident.utcOffset ?? shared)
    if (shot !== null && crash !== null) out.minutesFromIncident = Math.round((shot - crash) / 60_000)
  }
  if (exif.at && incident.location) out.metresFromScene = Math.round(distance(exif.at, [incident.location.lng, incident.location.lat]))
  return out
}
