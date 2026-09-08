/**
 * Check zone anchors against the mesh they classify. `profile-body.mjs` gives the
 * measurements you place anchors from; this reports what those anchors actually do —
 * it samples every triangle of a body and asks nearestZone() which zone each surface
 * point lands in.
 *
 * A zone with no samples is unreachable: it exists in the data and can never be picked,
 * which the unit tests cannot catch because they only check each anchor against itself.
 *
 *   node scripts/probe-zones.ts            # every vehicle
 *   node scripts/probe-zones.ts van        # one
 *
 * Exits non-zero if any zone is unreachable, so it works as a check as well as a report.
 */
import { readFileSync } from 'node:fs'
import { MODELS } from '../src/models.ts'
import { VEHICLE_IDS, nearestZone, zonesOf, type V3, type Vehicle } from '../src/zones.ts'

/** barycentric grid, fixed so runs are reproducible — 28 samples per triangle */
const BARY: [number, number, number][] = []
const K = 6
for (let i = 0; i <= K; i++) {
  for (let j = 0; j <= K - i; j++) BARY.push([i / K, j / K, (K - i - j) / K])
}

function triangles(file: string): V3[][] {
  const glb = readFileSync(file)
  const jsonLength = glb.readUInt32LE(12)
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString())
  const binOffset = 20 + jsonLength + 8

  const read = (accessorIndex: number) => {
    const acc = json.accessors[accessorIndex]
    const view = json.bufferViews[acc.bufferView]
    return { acc, start: binOffset + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0) }
  }

  const out: V3[][] = []
  for (const node of json.nodes) {
    if (node.mesh === undefined) continue
    const prim = json.meshes[node.mesh].primitives[0]
    const t = node.translation ?? [0, 0, 0]

    const { acc: pAcc, start: pStart } = read(prim.attributes.POSITION)
    const verts: V3[] = []
    for (let i = 0; i < pAcc.count; i++) {
      const o = pStart + i * 12
      verts.push([glb.readFloatLE(o) + t[0], glb.readFloatLE(o + 4) + t[1], glb.readFloatLE(o + 8) + t[2]])
    }

    if (prim.indices === undefined) {
      for (let i = 0; i + 2 < verts.length; i += 3) out.push([verts[i], verts[i + 1], verts[i + 2]])
      continue
    }
    const { acc: iAcc, start: iStart } = read(prim.indices)
    // 5123 = UNSIGNED_SHORT, 5125 = UNSIGNED_INT
    const wide = iAcc.componentType === 5125
    const idx = (n: number) =>
      wide ? glb.readUInt32LE(iStart + n * 4) : glb.readUInt16LE(iStart + n * 2)
    for (let i = 0; i + 2 < iAcc.count; i += 3) {
      out.push([verts[idx(i)], verts[idx(i + 1)], verts[idx(i + 2)]])
    }
  }
  return out
}

const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

function probe(vehicle: Vehicle): number {
  const tris = triangles(new URL(MODELS[vehicle]).pathname)
  const zones = zonesOf(vehicle)

  const hits = new Map<string, { n: number; sum: V3; nearest: number }>()
  for (const z of zones) hits.set(z.id, { n: 0, sum: [0, 0, 0], nearest: Infinity })

  let samples = 0
  for (const [a, b, c] of tris) {
    for (const [u, v, w] of BARY) {
      const p: V3 = [
        a[0] * u + b[0] * v + c[0] * w,
        a[1] * u + b[1] * v + c[1] * w,
        a[2] * u + b[2] * v + c[2] * w,
      ]
      const zone = nearestZone(vehicle, p)
      const h = hits.get(zone.id)!
      h.n++
      h.sum[0] += p[0]
      h.sum[1] += p[1]
      h.sum[2] += p[2]
      samples++
      // how close the anchor sits to real bodywork, whichever zone the point landed in
      for (const z of zones) {
        const e = hits.get(z.id)!
        const d = dist(z.anchor, p)
        if (d < e.nearest) e.nearest = d
      }
    }
  }

  console.log(`\n== ${vehicle} — ${tris.length} tris, ${samples} samples`)
  const unreachable: string[] = []
  for (const z of zones) {
    const h = hits.get(z.id)!
    if (h.n === 0) {
      unreachable.push(z.id)
      console.log(`  ${z.id.padEnd(26)}    0 (  0.0%)  UNREACHABLE  anchor-to-surface ${h.nearest.toFixed(3)}`)
      continue
    }
    const c = h.sum.map((s) => (s / h.n).toFixed(2)).join(',')
    const pct = ((h.n / samples) * 100).toFixed(1).padStart(5)
    console.log(
      `  ${z.id.padEnd(26)} ${String(h.n).padStart(5)} (${pct}%)  centroid ${c}  anchor-to-surface ${h.nearest.toFixed(3)}`,
    )
  }
  if (unreachable.length) console.log(`  !! unreachable: ${unreachable.join(', ')}`)
  return unreachable.length
}

const requested = process.argv.slice(2)
const list = (requested.length ? requested : VEHICLE_IDS) as Vehicle[]
for (const v of list) {
  if (!VEHICLE_IDS.includes(v)) {
    console.error(`unknown vehicle "${v}" — known: ${VEHICLE_IDS.join(', ')}`)
    process.exit(1)
  }
}

let bad = 0
for (const v of list) bad += probe(v)
console.log(bad ? `\nFAIL — ${bad} unreachable zone(s)` : '\nok — every zone claims surface')
process.exit(bad ? 1 : 0)
