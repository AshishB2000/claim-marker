/**
 * Stamp a JPEG with the EXIF a phone would have written: DateTimeOriginal, OffsetTimeOriginal
 * and a GPS position.
 *
 * Only `scripts/smoke.mjs` uses it, and only so the walk can prove the other direction — that
 * `src/claim/exif.ts` reads a real photograph's metadata, that the page offers it as a way in,
 * and that the position is turned into a distance and **never written into the document**. The
 * time is stamped at run time rather than baked into a committed fixture, so the smoke can say
 * "taken at the moment of the incident" and assert an exact zero instead of a drifting number.
 *
 * Little-endian TIFF, the layout `src/claim/exif.ts` walks. No dependencies.
 */

const ASCII = 2
const LONG = 4
const RATIONAL = 5

/** degrees as EXIF writes them: three rationals, degrees / minutes / hundredths of a second */
function dms(deg) {
  const abs = Math.abs(deg)
  const d = Math.floor(abs)
  const m = Math.floor((abs - d) * 60)
  const s = Math.round((abs - d - m / 60) * 3600 * 100)
  return [
    [d, 1],
    [m, 1],
    [s, 100],
  ]
}

/**
 * The TIFF block: header, IFD0 pointing at the Exif and GPS sub-IFDs, then the data the
 * entries are too big to hold inline. Offsets are counted from the header, so the layout is
 * computed before anything is written.
 */
function tiff({ takenAt, offset, lng, lat }) {
  // "2026:09:17 20:33:00\0" — EXIF's own date shape, always exactly 20 bytes
  const date = `${takenAt.slice(0, 10).replace(/-/g, ':')} ${takenAt.slice(11, 16)}:00\0`
  const off = `${offset}\0`

  const IFD0 = 8
  const EXIF_IFD = IFD0 + 2 + 2 * 12 + 4
  const GPS_IFD = EXIF_IFD + 2 + 2 * 12 + 4
  let at = GPS_IFD + 2 + 4 * 12 + 4
  const dateAt = at
  at += date.length + (date.length % 2)
  const offAt = at
  at += off.length + (off.length % 2)
  const latAt = at
  at += 24
  const lngAt = at
  const total = at + 24

  const buf = Buffer.alloc(total)
  buf.write('II', 0, 'latin1')
  buf.writeUInt16LE(42, 2)
  buf.writeUInt32LE(IFD0, 4)

  const entry = (p, tag, type, count, value) => {
    buf.writeUInt16LE(tag, p)
    buf.writeUInt16LE(type, p + 2)
    buf.writeUInt32LE(count, p + 4)
    if (typeof value === 'number') buf.writeUInt32LE(value, p + 8)
    else buf.write(value, p + 8, 'latin1')
    return p + 12
  }

  buf.writeUInt16LE(2, IFD0)
  let p = entry(IFD0 + 2, 0x8769, LONG, 1, EXIF_IFD)
  entry(p, 0x8825, LONG, 1, GPS_IFD)

  buf.writeUInt16LE(2, EXIF_IFD)
  p = entry(EXIF_IFD + 2, 0x9003, ASCII, date.length, dateAt)
  entry(p, 0x9011, ASCII, off.length, offAt)

  buf.writeUInt16LE(4, GPS_IFD)
  p = entry(GPS_IFD + 2, 0x0001, ASCII, 2, `${lat >= 0 ? 'N' : 'S'}\0`)
  p = entry(p, 0x0002, RATIONAL, 3, latAt)
  p = entry(p, 0x0003, ASCII, 2, `${lng >= 0 ? 'E' : 'W'}\0`)
  entry(p, 0x0004, RATIONAL, 3, lngAt)

  buf.write(date, dateAt, 'latin1')
  buf.write(off, offAt, 'latin1')
  for (const [i, [n, d]] of dms(lat).entries()) {
    buf.writeUInt32LE(n, latAt + i * 8)
    buf.writeUInt32LE(d, latAt + i * 8 + 4)
  }
  for (const [i, [n, d]] of dms(lng).entries()) {
    buf.writeUInt32LE(n, lngAt + i * 8)
    buf.writeUInt32LE(d, lngAt + i * 8 + 4)
  }
  return buf
}

/** the same JPEG with an Exif APP1 spliced in right after the SOI marker */
export function stampExif(jpeg, { takenAt, offset = '+00:00', lng, lat }) {
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff({ takenAt, offset, lng, lat })])
  const header = Buffer.alloc(4)
  header.writeUInt16BE(0xffe1, 0)
  header.writeUInt16BE(body.length + 2, 2)
  return Buffer.concat([jpeg.subarray(0, 2), header, body, jpeg.subarray(2)])
}
