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

export async function shrink(file: File): Promise<string> {
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
    return canvas.toDataURL('image/jpeg', QUALITY)
  } finally {
    bitmap.close()
  }
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
