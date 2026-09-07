/** Sample pixels out of a PNG, for checking a render without eyeballing a downscaled image.
 *
 *   node scripts/pixel.mjs shot.png 883,550 384,896 384,512
 */
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

const [, , file, ...coords] = process.argv
const png = readFileSync(file)

let p = 8
let width = 0
let height = 0
let colorType = 0
const idat = []
while (p < png.length) {
  const len = png.readUInt32BE(p)
  const type = png.subarray(p + 4, p + 8).toString()
  const data = png.subarray(p + 8, p + 8 + len)
  if (type === 'IHDR') {
    width = data.readUInt32BE(0)
    height = data.readUInt32BE(4)
    colorType = data[9]
  }
  if (type === 'IDAT') idat.push(data)
  p += 12 + len
}

const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]
if (!bpp) throw new Error(`unsupported colour type ${colorType}`)

const raw = inflateSync(Buffer.concat(idat))
const stride = width * bpp
const img = Buffer.alloc(height * stride)
let pos = 0
for (let y = 0; y < height; y++) {
  const filter = raw[pos++]
  const line = raw.subarray(pos, pos + stride)
  pos += stride
  for (let x = 0; x < stride; x++) {
    const a = x >= bpp ? img[y * stride + x - bpp] : 0
    const b = y > 0 ? img[(y - 1) * stride + x] : 0
    const c = x >= bpp && y > 0 ? img[(y - 1) * stride + x - bpp] : 0
    let v = line[x]
    if (filter === 1) v += a
    else if (filter === 2) v += b
    else if (filter === 3) v += (a + b) >> 1
    else if (filter === 4) {
      const pp = a + b - c
      const pa = Math.abs(pp - a)
      const pb = Math.abs(pp - b)
      const pc = Math.abs(pp - c)
      v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
    }
    img[y * stride + x] = v & 255
  }
}

console.log(`${file} — ${width}x${height}, colour type ${colorType}`)
for (const coord of coords) {
  const [x, y] = coord.split(',').map(Number)
  const i = y * stride + x * bpp
  const hex = [img[i], img[i + 1], img[i + 2]].map((n) => n.toString(16).padStart(2, '0')).join('')
  console.log(`  (${x}, ${y}) = rgb(${img[i]}, ${img[i + 1]}, ${img[i + 2]})  #${hex}`)
}
