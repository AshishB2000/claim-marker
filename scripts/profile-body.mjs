/**
 * Print the measurements a vehicle's zone anchors are placed against, so the numbers in
 * src/zones.ts have a provenance instead of being eyeballed. Run this when adding a body.
 *
 *   node scripts/profile-body.mjs src/models/suv.glb
 */
import { readFileSync } from 'node:fs'

const file = process.argv[2]
if (!file) {
  console.error('usage: node scripts/profile-body.mjs <model.glb>')
  process.exit(1)
}

const glb = readFileSync(file)
const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString())
const binOffset = 20 + glb.readUInt32LE(12) + 8

const positions = (node) => {
  const acc = json.accessors[json.meshes[node.mesh].primitives[0].attributes.POSITION]
  const view = json.bufferViews[acc.bufferView]
  const start = binOffset + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0)
  const t = node.translation ?? [0, 0, 0]
  const out = []
  for (let i = 0; i < acc.count; i++) {
    const o = start + i * 12
    out.push([glb.readFloatLE(o) + t[0], glb.readFloatLE(o + 4) + t[1], glb.readFloatLE(o + 8) + t[2]])
  }
  return out
}

const body = json.nodes.find((n) => n.name === 'body')
if (!body) throw new Error('no node named "body"')
const V = positions(body)
const range = (vs, i) => [Math.min(...vs.map((v) => v[i])), Math.max(...vs.map((v) => v[i]))]
const fmt = (n) => n.toFixed(2).padStart(6)

console.log(`\n${file} — ${V.length} body vertices`)
console.log(`  x ${range(V, 0).map(fmt).join(' ..')}   y ${range(V, 1).map(fmt).join(' ..')}   z ${range(V, 2).map(fmt).join(' ..')}`)

console.log('\n  wheels (world centres):')
for (const n of json.nodes.filter((n) => n.name.startsWith('wheel'))) {
  const [x, y, z] = n.translation ?? [0, 0, 0]
  console.log(`    ${n.name.padEnd(20)} x ${fmt(x)}  y ${fmt(y)}  z ${fmt(z)}`)
}

console.log('\n  z-profile (roofline and half-width per slice) — the long low end is the hood:')
console.log('    z-range        maxY  halfW    n')
for (let z = Math.floor(range(V, 2)[0] * 10) / 10; z < range(V, 2)[1]; z += 0.15) {
  const slice = V.filter((v) => v[2] >= z && v[2] < z + 0.15)
  if (!slice.length) continue
  const maxY = Math.max(...slice.map((v) => v[1]))
  const halfW = Math.max(...slice.map((v) => Math.abs(v[0])))
  console.log(`   ${fmt(z)}..${fmt(z + 0.15)} ${fmt(maxY)} ${fmt(halfW)} ${String(slice.length).padStart(4)}`)
}

const cabin = V.filter((v) => v[1] > Math.max(...V.map((p) => p[1])) - 0.36)
console.log(`\n  cabin (top 0.36 of the body): z ${range(cabin, 2).map(fmt).join(' ..')}  roof y ${fmt(range(cabin, 1)[1])}`)

const halfWidth = range(V, 0)[1]
const mirrors = V.filter((v) => Math.abs(v[0]) > halfWidth - 0.08 && v[1] > 0.55)
if (mirrors.length) {
  console.log(`  mirrors (|x| > ${fmt(halfWidth - 0.08)}): ${mirrors.length} verts  y ${range(mirrors, 1).map(fmt).join(' ..')}  z ${range(mirrors, 2).map(fmt).join(' ..')}`)
} else {
  console.log('  mirrors: none found')
}

const side = V.filter((v) => v[0] > halfWidth - 0.15)
console.log(`  side skin beltline: y up to ${fmt(range(side, 1)[1])}\n`)
