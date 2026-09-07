/**
 * Kenney's GLBs reference `Textures/colormap.png` as an external URI. A widget that ships
 * one hashed asset through a bundler cannot resolve a sibling path, so the texture is
 * inlined as a data URI and the model becomes self-contained.
 *
 * Run once per model added; the result is committed.
 *
 *   node scripts/embed-texture.mjs <in.glb> <texture.png> <out.glb>
 */
import { readFileSync, writeFileSync } from 'node:fs'

const [, , inGlb, inPng, outGlb] = process.argv
if (!inGlb || !inPng || !outGlb) {
  console.error('usage: node scripts/embed-texture.mjs <in.glb> <texture.png> <out.glb>')
  process.exit(1)
}

const glb = readFileSync(inGlb)
if (glb.readUInt32LE(0) !== 0x46546c67) throw new Error(`${inGlb} is not a GLB`)

const jsonLen = glb.readUInt32LE(12)
const json = JSON.parse(glb.subarray(20, 20 + jsonLen).toString())
const bin = glb.subarray(20 + jsonLen + 8) // past the BIN chunk header

const dataUri = `data:image/png;base64,${readFileSync(inPng).toString('base64')}`
let embedded = 0
for (const image of json.images ?? []) {
  if (image.uri && !image.uri.startsWith('data:')) {
    image.uri = dataUri
    embedded++
  }
}
if (!embedded) throw new Error('no external image URI found — already embedded?')

const pad = (buf, to, fill) => {
  const extra = (to - (buf.length % to)) % to
  return extra ? Buffer.concat([buf, Buffer.alloc(extra, fill)]) : buf
}
const jsonChunk = pad(Buffer.from(JSON.stringify(json)), 4, 0x20) // spaces
const binChunk = pad(bin, 4, 0)

const chunk = (data, type) => {
  const head = Buffer.alloc(8)
  head.writeUInt32LE(data.length, 0)
  head.writeUInt32LE(type, 4)
  return Buffer.concat([head, data])
}
const body = Buffer.concat([chunk(jsonChunk, 0x4e4f534a), chunk(binChunk, 0x004e4942)])
const header = Buffer.alloc(12)
header.writeUInt32LE(0x46546c67, 0)
header.writeUInt32LE(2, 4)
header.writeUInt32LE(12 + body.length, 8)

writeFileSync(outGlb, Buffer.concat([header, body]))
console.log(`embedded ${embedded} texture(s): ${glb.length} → ${12 + body.length} bytes`)
