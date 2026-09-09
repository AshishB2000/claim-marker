/**
 * The customer's photographs, made small enough to keep. A phone photo is 3–8 MB; the draft
 * lives in localStorage with a ~5 MB budget and the document is POSTed as JSON, so each one is
 * downscaled to 1280 px on its long edge and re-encoded as a JPEG before it is stored —
 * a few hundred kB, plenty for an adjuster to see a dent, and twelve of them still fit.
 */

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
