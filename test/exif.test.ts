import { describe, expect, it } from 'vitest'
import { readExif } from '../src/claim/exif'

// A tiny hand-rolled TIFF/JPEG writer, the mirror image of the reader under test. It only
// speaks the handful of field shapes exif.ts actually reads (ASCII, an inline LONG for the two
// IFD pointers, and RATIONAL arrays for GPS coordinates) — enough to build every fixture below,
// not a general-purpose encoder.

type Field = { tag: number; type: 2 | 4 | 5; ascii?: string; long?: number; rationals?: [number, number][] }

function u16Bytes(le: boolean, v: number): number[] {
  const b = [v & 0xff, (v >> 8) & 0xff]
  return le ? b : b.reverse()
}
function u32Bytes(le: boolean, v: number): number[] {
  const b = [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]
  return le ? b : b.reverse()
}
function asciiBytes(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0)).concat(0)
}
function rationalBytes(le: boolean, [num, den]: [number, number]): number[] {
  return [...u32Bytes(le, num), ...u32Bytes(le, den)]
}

/** One IFD: a count, `fields.length` 12-byte entries, a 4-byte "next IFD" (always 0), then the
 *  out-of-line bytes for whichever fields didn't fit in their own 4-byte slot. `at` is this
 *  IFD's own absolute offset from the TIFF header, needed to compute those out-of-line offsets. */
function buildIfd(le: boolean, at: number, fields: Field[]): number[] {
  const fixedSize = 2 + fields.length * 12 + 4
  let dataOffset = at + fixedSize
  const entryBytes: number[] = []
  const dataBytes: number[] = []
  for (const f of fields) {
    const value = f.type === 2 ? asciiBytes(f.ascii ?? '') : f.type === 4 ? u32Bytes(le, f.long ?? 0) : (f.rationals ?? []).flatMap((r) => rationalBytes(le, r))
    const count = f.type === 2 ? value.length : f.type === 4 ? 1 : (f.rationals ?? []).length
    let slot: number[]
    if (value.length <= 4) {
      slot = [...value, ...Array(4 - value.length).fill(0)]
    } else {
      slot = u32Bytes(le, dataOffset)
      dataBytes.push(...value)
      dataOffset += value.length
    }
    entryBytes.push(...u16Bytes(le, f.tag), ...u16Bytes(le, f.type), ...u32Bytes(le, count), ...slot)
  }
  return [...u16Bytes(le, fields.length), ...entryBytes, ...u32Bytes(le, 0), ...dataBytes]
}

type GpsSpec = { lat: [number, number][]; latRef: 'N' | 'S'; lng: [number, number][]; lngRef: 'E' | 'W' }

/** Lays out header + IFD0 + (optional) Exif sub-IFD + (optional) GPS sub-IFD back to back, IFD0's
 *  two pointer tags filled in with wherever the sub-IFDs actually landed. `gpsPointerOverride`
 *  stands in for a corrupt file: a GPSInfoIFDPointer aimed past the end of the buffer. */
function buildTiff(
  le: boolean,
  opts: { dateTimeOriginal?: string; offsetTimeOriginal?: string; gps?: GpsSpec; gpsPointerOverride?: number } = {},
): number[] {
  const header = [...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16Bytes(le, 42), ...u32Bytes(le, 8)]

  const exifFields: Field[] = []
  if (opts.dateTimeOriginal !== undefined) exifFields.push({ tag: 0x9003, type: 2, ascii: opts.dateTimeOriginal })
  if (opts.offsetTimeOriginal !== undefined) exifFields.push({ tag: 0x9011, type: 2, ascii: opts.offsetTimeOriginal })

  const gpsFields: Field[] = opts.gps
    ? [
        { tag: 0x0001, type: 2, ascii: opts.gps.latRef },
        { tag: 0x0002, type: 5, rationals: opts.gps.lat },
        { tag: 0x0003, type: 2, ascii: opts.gps.lngRef },
        { tag: 0x0004, type: 5, rationals: opts.gps.lng },
      ]
    : []

  const ifd0Fields: Field[] = []

  // IFD0 holds only the two pointer tags, both inline LONGs, so its own size is fixed once we
  // know which pointers exist — that lets us place the sub-IFDs right after it in one pass.
  const pointerCount = (exifFields.length > 0 ? 1 : 0) + (gpsFields.length > 0 || opts.gpsPointerOverride !== undefined ? 1 : 0)
  const ifd0Size = 2 + pointerCount * 12 + 4
  let cursor = 8 + ifd0Size

  let exifBytes: number[] = []
  let exifAt = -1
  if (exifFields.length > 0) {
    exifAt = cursor
    exifBytes = buildIfd(le, exifAt, exifFields)
    cursor += exifBytes.length
  }

  let gpsBytes: number[] = []
  let gpsAt = -1
  if (gpsFields.length > 0) {
    gpsAt = cursor
    gpsBytes = buildIfd(le, gpsAt, gpsFields)
    cursor += gpsBytes.length
  }

  if (exifAt >= 0) ifd0Fields.push({ tag: 0x8769, type: 4, long: exifAt })
  if (opts.gpsPointerOverride !== undefined) ifd0Fields.push({ tag: 0x8825, type: 4, long: opts.gpsPointerOverride })
  else if (gpsAt >= 0) ifd0Fields.push({ tag: 0x8825, type: 4, long: gpsAt })

  const ifd0Bytes = buildIfd(le, 8, ifd0Fields)
  return [...header, ...ifd0Bytes, ...exifBytes, ...gpsBytes]
}

/** Wraps a TIFF block (or an arbitrary APP1 payload) as one APP1 segment. */
function app1(payload: number[]): number[] {
  const length = payload.length + 2 // the length field counts itself, not the marker
  return [0xff, 0xe1, ...u16Bytes(false, length), ...payload]
}

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00] // "Exif\0\0"

/** SOI, the given APP1 segments in order, then SOS — real scan bytes never matter to the reader. */
function jpeg(app1s: number[][]): ArrayBuffer {
  const bytes = [0xff, 0xd8, ...app1s.flat(), 0xff, 0xda, 0x00, 0x00, 0xff, 0xd9]
  return new Uint8Array(bytes).buffer
}

function exifJpeg(tiff: number[]): ArrayBuffer {
  return jpeg([app1([...EXIF_HEADER, ...tiff])])
}

const DATE = '2023:04:15 12:30:00'

describe('readExif', () => {
  it('reads date, offset and GPS, little-endian', () => {
    // 40°N 105°W-ish, chosen with non-trivial minutes/seconds so a sign or scaling bug would show
    const gps: GpsSpec = {
      latRef: 'N',
      lat: [
        [40, 1],
        [26, 1],
        [46, 1],
      ],
      lngRef: 'W',
      lng: [
        [105, 1],
        [15, 1],
        [3, 1],
      ],
    }
    const buf = exifJpeg(buildTiff(true, { dateTimeOriginal: DATE, offsetTimeOriginal: '+05:30', gps }))
    const result = readExif(buf)
    expect(result.takenAt).toBe('2023-04-15T12:30')
    expect(result.utcOffset).toBe(330)
    expect(result.at).not.toBeNull()
    expect(result.at![1]).toBeCloseTo(40 + 26 / 60 + 46 / 3600, 6)
    expect(result.at![0]).toBeCloseTo(-(105 + 15 / 60 + 3 / 3600), 6)
  })

  it('a southern/western position comes out negative', () => {
    const gps: GpsSpec = {
      latRef: 'S',
      lat: [
        [33, 1],
        [52, 1],
        [4, 1],
      ],
      lngRef: 'W',
      lng: [
        [151, 1],
        [12, 1],
        [36, 1],
      ],
    }
    const buf = exifJpeg(buildTiff(true, { gps }))
    const { at } = readExif(buf)
    expect(at).not.toBeNull()
    expect(at![1]).toBeLessThan(0)
    expect(at![0]).toBeLessThan(0)
  })

  it('reads the same content big-endian — the endianness regression', () => {
    const gps: GpsSpec = {
      latRef: 'N',
      lat: [
        [40, 1],
        [26, 1],
        [46, 1],
      ],
      lngRef: 'W',
      lng: [
        [105, 1],
        [15, 1],
        [3, 1],
      ],
    }
    const le = exifJpeg(buildTiff(true, { dateTimeOriginal: DATE, offsetTimeOriginal: '-08:00', gps }))
    const be = exifJpeg(buildTiff(false, { dateTimeOriginal: DATE, offsetTimeOriginal: '-08:00', gps }))
    expect(readExif(be)).toEqual(readExif(le))
    expect(readExif(be).utcOffset).toBe(-480)
  })

  it('date with no GPS', () => {
    const buf = exifJpeg(buildTiff(true, { dateTimeOriginal: DATE }))
    const result = readExif(buf)
    expect(result.takenAt).toBe('2023-04-15T12:30')
    expect(result.utcOffset).toBeNull()
    expect(result.at).toBeNull()
  })

  it('GPS with no date', () => {
    const gps: GpsSpec = {
      latRef: 'N',
      lat: [
        [10, 1],
        [0, 1],
        [0, 1],
      ],
      lngRef: 'E',
      lng: [
        [20, 1],
        [0, 1],
        [0, 1],
      ],
    }
    const buf = exifJpeg(buildTiff(true, { gps }))
    const result = readExif(buf)
    expect(result.takenAt).toBeNull()
    expect(result.at).toEqual([20, 10])
  })

  it.each([
    ['+05:30', 330],
    ['-08:00', -480],
    ['Z', 0],
  ])('OffsetTimeOriginal %s → %i minutes', (offset, minutes) => {
    const buf = exifJpeg(buildTiff(true, { dateTimeOriginal: DATE, offsetTimeOriginal: offset }))
    expect(readExif(buf).utcOffset).toBe(minutes)
  })

  it('a zero-denominator GPS rational means no position at all', () => {
    const gps: GpsSpec = {
      latRef: 'N',
      lat: [
        [10, 0],
        [0, 1],
        [0, 1],
      ],
      lngRef: 'E',
      lng: [
        [20, 1],
        [0, 1],
        [0, 1],
      ],
    }
    const buf = exifJpeg(buildTiff(true, { gps }))
    expect(readExif(buf).at).toBeNull()
  })

  it('a latitude that converts to 95° is out of range', () => {
    const gps: GpsSpec = {
      latRef: 'N',
      lat: [
        [95, 1],
        [0, 1],
        [0, 1],
      ],
      lngRef: 'E',
      lng: [
        [20, 1],
        [0, 1],
        [0, 1],
      ],
    }
    const buf = exifJpeg(buildTiff(true, { gps }))
    expect(readExif(buf).at).toBeNull()
  })

  it('a truncated buffer returns all nulls, no throw', () => {
    const full = exifJpeg(buildTiff(true, { dateTimeOriginal: DATE }))
    const truncated = full.slice(0, Math.floor(full.byteLength / 2))
    expect(() => readExif(truncated)).not.toThrow()
    expect(readExif(truncated)).toEqual({ takenAt: null, utcOffset: null, at: null })
  })

  it('an empty buffer returns all nulls, no throw', () => {
    expect(readExif(new ArrayBuffer(0))).toEqual({ takenAt: null, utcOffset: null, at: null })
  })

  it('a PNG-like buffer returns all nulls, no throw', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).buffer
    expect(readExif(png)).toEqual({ takenAt: null, utcOffset: null, at: null })
  })

  it('a JPEG with no APP1 at all returns all nulls', () => {
    const buf = jpeg([]) // just SOI, SOS, EOI
    expect(readExif(buf)).toEqual({ takenAt: null, utcOffset: null, at: null })
  })

  it('an XMP APP1 is skipped and a later real Exif APP1 is still found', () => {
    const xmpPayload = [...'http://ns.adobe.com/xap/1.0/\0'].map((c) => c.charCodeAt(0))
    const buf = jpeg([app1(xmpPayload), app1([...EXIF_HEADER, ...buildTiff(true, { dateTimeOriginal: DATE })])])
    expect(readExif(buf).takenAt).toBe('2023-04-15T12:30')
  })

  it('a malformed GPS pointer past the end of the buffer does not throw', () => {
    const buf = exifJpeg(buildTiff(true, { dateTimeOriginal: DATE, gpsPointerOverride: 0xfffff }))
    let result
    expect(() => (result = readExif(buf))).not.toThrow()
    expect(result).toEqual({ takenAt: '2023-04-15T12:30', utcOffset: null, at: null })
  })
})
