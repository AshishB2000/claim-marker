/**
 * What a photograph knows about itself, read from the original bytes before `shrink()` in
 * `photos.ts` re-encodes it through a canvas and throws every byte of this away. A phone photo
 * that can say where and when it was taken is worth a great deal to a claim, so this has to run
 * first, on the `File` the input element handed back, not on the JPEG the canvas produces.
 *
 * Hand-written rather than a dependency: a JPEG/EXIF reader is a few hundred lines of segment
 * and TIFF-tag walking over a `DataView`, and we only ever want four fields out of it.
 *
 * The two things that make a reader like this silently wrong: reading the TIFF byte order once
 * and forgetting it applies to every multi-byte number that follows (so `le` is threaded through
 * every helper below, never assumed), and letting a corrupt or truncated file throw partway —
 * every offset is bounds-checked against the buffer before it is dereferenced, and `readExif`
 * itself is one big try/catch as a last line of defence, so a bad photo just comes back with
 * fewer facts rather than breaking the upload.
 */

import type { LngLat } from '../geo'

/** what a photograph can say for itself */
export type PhotoExif = {
  /** DateTimeOriginal as a local `YYYY-MM-DDTHH:mm` string, the same shape `incident.at` holds; null when absent or unparseable */
  takenAt: string | null
  /** minutes east of UTC from OffsetTimeOriginal, when the camera recorded one; null otherwise */
  utcOffset: number | null
  /** where the shutter fired, [lng, lat]; null when there is no GPS IFD or it is incomplete */
  at: LngLat | null
}

const NULL_EXIF: PhotoExif = { takenAt: null, utcOffset: null, at: null }

// Byte length of one TIFF field value, by its type code. RATIONAL (5) is two LONGs — 8 bytes —
// which is also why it can never be the inline 4-byte case below. Anything not listed here
// (SHORT/LONG arrays aside) is treated as 1 byte per count, which is right for ASCII and UNDEFINED
// and merely conservative for the couple of numeric types this file never reads.
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }

function u8(view: DataView, off: number): number | null {
  return off >= 0 && off + 1 <= view.byteLength ? view.getUint8(off) : null
}
function u16(view: DataView, off: number, le: boolean): number | null {
  return off >= 0 && off + 2 <= view.byteLength ? view.getUint16(off, le) : null
}
function u32(view: DataView, off: number, le: boolean): number | null {
  return off >= 0 && off + 4 <= view.byteLength ? view.getUint32(off, le) : null
}

/** one IFD entry, resolved to where its value bytes actually live (inline or elsewhere in the file) */
type Entry = { count: number; valueOffset: number }

/**
 * Find `tag` among an IFD's entries. An IFD is a count, then that many fixed 12-byte entries
 * (tag, type, count, then either the value itself or an offset to it) — no terminator to stop
 * early on, so every tag lookup is a linear scan of the whole thing.
 */
function findEntry(view: DataView, ifdOffset: number, tiffStart: number, le: boolean, tag: number): Entry | null {
  const entryCount = u16(view, ifdOffset, le)
  if (entryCount === null) return null
  for (let i = 0; i < entryCount; i++) {
    const entryOff = ifdOffset + 2 + i * 12
    if (entryOff + 12 > view.byteLength) return null
    if (u16(view, entryOff, le) !== tag) continue
    const type = u16(view, entryOff + 2, le)
    const count = u32(view, entryOff + 4, le)
    if (type === null || count === null) return null
    const size = (TYPE_SIZE[type] ?? 1) * count
    // 4 bytes or fewer sit in the entry's own value slot; longer values are elsewhere in the
    // file, at an offset counted from the start of the TIFF header, not from the entry.
    const valueOffset = size <= 4 ? entryOff + 8 : tiffStart + (u32(view, entryOff + 8, le) ?? -tiffStart - 1)
    return { count, valueOffset }
  }
  return null
}

/** the raw 4-byte value of an inline entry — used for IFD pointers, whose value *is* an offset */
function readU32Value(view: DataView, entry: Entry, le: boolean): number | null {
  return u32(view, entry.valueOffset, le)
}

function readAscii(view: DataView, entry: Entry): string | null {
  const start = entry.valueOffset
  if (start < 0 || start + entry.count > view.byteLength) return null
  const chars: string[] = []
  for (let i = 0; i < entry.count; i++) {
    const byte = view.getUint8(start + i)
    if (byte === 0) break
    chars.push(String.fromCharCode(byte))
  }
  return chars.join('')
}

function readRational(view: DataView, off: number, le: boolean): number | null {
  const num = u32(view, off, le)
  const den = u32(view, off + 4, le)
  if (num === null || den === null || den === 0) return null
  return num / den
}

/** GPSLatitude/GPSLongitude are three RATIONALs — degrees, minutes, seconds — back to back */
function readDms(view: DataView, entry: Entry, le: boolean): number | null {
  if (entry.count !== 3) return null
  const deg = readRational(view, entry.valueOffset, le)
  const min = readRational(view, entry.valueOffset + 8, le)
  const sec = readRational(view, entry.valueOffset + 16, le)
  if (deg === null || min === null || sec === null) return null
  return deg + min / 60 + sec / 3600
}

/** "YYYY:MM:DD HH:MM:SS" → "YYYY-MM-DDTHH:mm", the shape `incident.at` already holds */
function parseDateTimeOriginal(s: string): string | null {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s)
  if (!m) return null
  const [, y, mo, d, h, mi] = m
  return `${y}-${mo}-${d}T${h}:${mi}`
}

/** "+05:30" / "-08:00" / "Z" → minutes east of UTC */
function parseUtcOffset(s: string): number | null {
  if (s === 'Z') return 0
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(s)
  if (!m) return null
  const [, sign, h, mi] = m
  const minutes = Number(h) * 60 + Number(mi)
  return sign === '-' ? -minutes : minutes
}

function readLat(view: DataView, gpsIfd: number, tiffStart: number, le: boolean): number | null {
  const refEntry = findEntry(view, gpsIfd, tiffStart, le, 0x0001) // GPSLatitudeRef, "N" or "S"
  const valEntry = findEntry(view, gpsIfd, tiffStart, le, 0x0002) // GPSLatitude
  if (!refEntry || !valEntry) return null
  const ref = readAscii(view, refEntry)
  const dms = readDms(view, valEntry, le)
  if (dms === null || (ref !== 'N' && ref !== 'S')) return null
  const lat = ref === 'S' ? -dms : dms
  return Math.abs(lat) <= 90 ? lat : null
}

function readLng(view: DataView, gpsIfd: number, tiffStart: number, le: boolean): number | null {
  const refEntry = findEntry(view, gpsIfd, tiffStart, le, 0x0003) // GPSLongitudeRef, "E" or "W"
  const valEntry = findEntry(view, gpsIfd, tiffStart, le, 0x0004) // GPSLongitude
  if (!refEntry || !valEntry) return null
  const ref = readAscii(view, refEntry)
  const dms = readDms(view, valEntry, le)
  if (dms === null || (ref !== 'E' && ref !== 'W')) return null
  const lng = ref === 'W' ? -dms : dms
  return Math.abs(lng) <= 180 ? lng : null
}

/** IFD0's ExifIFDPointer / GPSInfoIFDPointer entries hold an offset, counted from `tiffStart`, to another IFD */
function readSubIfd(view: DataView, ifd0: number, tiffStart: number, le: boolean, tag: number): number | null {
  const entry = findEntry(view, ifd0, tiffStart, le, tag)
  if (!entry) return null
  const rel = readU32Value(view, entry, le)
  return rel === null ? null : tiffStart + rel
}

/** `tiffStart` is the absolute offset, in `view`, of the TIFF header ("II"/"MM" and what follows) */
function parseTiff(view: DataView, tiffStart: number): PhotoExif {
  if (tiffStart + 8 > view.byteLength) return NULL_EXIF
  const b0 = u8(view, tiffStart)
  const b1 = u8(view, tiffStart + 1)
  let le: boolean
  if (b0 === 0x49 && b1 === 0x49) le = true // "II", Intel, little-endian
  else if (b0 === 0x4d && b1 === 0x4d) le = false // "MM", Motorola, big-endian
  else return NULL_EXIF
  if (u16(view, tiffStart + 2, le) !== 42) return NULL_EXIF
  const ifd0Rel = u32(view, tiffStart + 4, le)
  if (ifd0Rel === null) return NULL_EXIF
  const ifd0 = tiffStart + ifd0Rel

  let takenAt: string | null = null
  let utcOffset: number | null = null
  const exifIfd = readSubIfd(view, ifd0, tiffStart, le, 0x8769) // ExifIFDPointer
  if (exifIfd !== null) {
    const dtEntry = findEntry(view, exifIfd, tiffStart, le, 0x9003) // DateTimeOriginal
    const dtStr = dtEntry && readAscii(view, dtEntry)
    if (dtStr) takenAt = parseDateTimeOriginal(dtStr)
    const offEntry = findEntry(view, exifIfd, tiffStart, le, 0x9011) // OffsetTimeOriginal
    const offStr = offEntry && readAscii(view, offEntry)
    if (offStr) utcOffset = parseUtcOffset(offStr)
  }

  let at: LngLat | null = null
  const gpsIfd = readSubIfd(view, ifd0, tiffStart, le, 0x8825) // GPSInfoIFDPointer
  if (gpsIfd !== null) {
    const lat = readLat(view, gpsIfd, tiffStart, le)
    const lng = readLng(view, gpsIfd, tiffStart, le)
    if (lat !== null && lng !== null) at = [lng, lat]
  }

  return { takenAt, utcOffset, at }
}

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00] // "Exif\0\0"

function hasExifHeader(view: DataView, off: number): boolean {
  return EXIF_HEADER.every((byte, i) => u8(view, off + i) === byte)
}

/**
 * Walk JPEG segments from SOI looking for the APP1 that carries Exif. An insurer's endpoint or
 * a browser's own re-encode can put other things in APP1 (XMP is the common one, tagged by a
 * different string in the same slot) — those are skipped, not treated as "no Exif here", because
 * a real Exif APP1 can still follow. SOS ends the segment run: everything after it is
 * entropy-coded scan data, not more markers, and reading past it as if it were would eventually
 * hit two bytes that happen to look like a marker and misparse.
 */
export function readExif(buffer: ArrayBuffer): PhotoExif {
  try {
    const view = new DataView(buffer)
    if (u8(view, 0) !== 0xff || u8(view, 1) !== 0xd8) return NULL_EXIF // not a JPEG (no SOI)

    let offset = 2
    while (offset + 4 <= view.byteLength) {
      if (u8(view, offset) !== 0xff) break
      const marker = u8(view, offset + 1)
      if (marker === 0xda) break // SOS: scan data follows, no more segments to read
      const length = u16(view, offset + 2, false) // segment length is always big-endian, unlike anything inside a TIFF block
      if (length === null || length < 2) break
      const payloadStart = offset + 4
      if (marker === 0xe1 && hasExifHeader(view, payloadStart)) {
        return parseTiff(view, payloadStart + EXIF_HEADER.length)
      }
      offset += 2 + length
    }
    return NULL_EXIF
  } catch {
    return NULL_EXIF
  }
}
