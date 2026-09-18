/**
 * Noticing when something in a new report has already been seen: the same photograph, the
 * same VIN, the same plate, or a great many reports from one customer. For the adjuster only.
 *
 * This file only states facts — "this photograph also appears on report INS-2026-X" — never
 * what they mean. Two reports can share a photograph because someone resent it, because a
 * shop photographed the same dent for two policies, or for worse reasons; deciding which is
 * this file's business, and it is the adjuster's.
 *
 * Storage is three append-only files under `CLAIM_DIR/index/`: `photos.jsonl`, `vins.jsonl`,
 * `plates.jsonl`, one JSON object per line — `{ key, reference, customer, at, incident? }`. `key`
 * is the photograph's perceptual hash or the uppercased VIN/plate; `customer` is the customer id
 * from the session, or null; `incident` is there when the report was filed against one. A line
 * that will not parse is skipped, never fatal — a claim must be filed even when the index is
 * broken.
 *
 * `signalsFor` reads the indexes as they stood *before* this report — call it before `record`,
 * not after, or a report would find its own entries and signal against itself.
 *
 * ponytail: the photograph's hash is computed in the page at downscale time, because this
 * server has no image decoder and no dependencies — a sender who wants to can put any sixteen
 * hex characters on a photograph. It still catches the case that matters most, the same
 * picture sent twice, which is overwhelmingly a mistake or a duplicate submission. Upgrade
 * path when an insurer adopts this for real: hash server-side with an image library and
 * ignore what the page sent.
 *
 * ponytail: every POST /claims reads all three index files whole and scans them line by line,
 * so filing a report costs more with every report kept; and `frequent_reporter` only counts
 * reports that carried a photo hash, a VIN or a plate, because the indexes are all it reads.
 * Fine for a demo and a pilot. Upgrade path: a real store (SQLite, or the claims system's own
 * database) indexed on key and on customer, with the per-customer count kept beside the report.
 *
 * No dependencies: node's own fs, path and crypto.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** how many bits two 64-bit dHashes may differ by and still be the same photograph */
export const HASH_DISTANCE = 6
/** reports from one customer inside this window are worth an adjuster's notice */
export const FREQUENT_DAYS = 90
export const FREQUENT_COUNT = 3

const DAY = 86_400_000
const FILES = { photos: 'photos.jsonl', vins: 'vins.jsonl', plates: 'plates.jsonl' }
const isHash = (v) => typeof v === 'string' && /^[0-9a-f]{16}$/i.test(v)

/** bits that differ between two 16-hex-character dHashes; null when either is not one */
export function hamming(a, b) {
  if (!isHash(a) || !isHash(b)) return null
  let diff = BigInt(`0x${a}`) ^ BigInt(`0x${b}`)
  let bits = 0
  while (diff) {
    diff &= diff - 1n
    bits++
  }
  return bits
}

/**
 * The lines a report contributes to each index — ready to append, not yet written. `doc` is a
 * parsed `claim/1` document; `receipt` is what the server filed it under (`reference`,
 * `customer`, `receivedAt`, and `incident` when it has one). Vehicles with no VIN or plate, and photos with no computed hash
 * (the page could not read the canvas, or this is a document from before hashing existed),
 * contribute nothing to that index.
 */
export function entriesOf(doc, receipt) {
  const reference = receipt?.reference
  const customer = receipt?.customer?.id ?? null
  const at = receipt?.receivedAt
  const incident = receipt?.incident ?? null
  const line = (key) => ({ key, reference, customer, at, ...(incident ? { incident } : {}) })
  const photos = Array.isArray(doc?.attachments?.photos) ? doc.attachments.photos : []
  const vehicles = Array.isArray(doc?.vehicles) ? doc.vehicles : []
  return {
    photos: photos.filter((p) => isHash(p?.hash)).map((p) => line(p.hash.toLowerCase())),
    vins: vehicles.map((v) => (typeof v?.vin === 'string' ? v.vin.trim() : '')).filter(Boolean).map((vin) => line(vin.toUpperCase())),
    plates: vehicles.map((v) => (typeof v?.plate === 'string' ? v.plate.trim() : '')).filter(Boolean).map((plate) => line(plate.toUpperCase())),
  }
}

/** one JSON line, or null when it does not parse into something with a key and a reference */
function parseLine(raw) {
  try {
    const v = JSON.parse(raw)
    return v && typeof v.key === 'string' && typeof v.reference === 'string' ? v : null
  } catch {
    return null
  }
}

/** every valid line in one index file; a missing directory or file reads as empty, never throws */
async function readIndex(dir, name) {
  let text
  try {
    text = await readFile(join(dir, 'index', FILES[name]), 'utf8')
  } catch {
    return []
  }
  return text
    .split('\n')
    .map((raw) => (raw.trim() ? parseLine(raw) : null))
    .filter((v) => v !== null)
}

/** append a report's entries; creates CLAIM_DIR/index/ as needed */
export async function record(dir, doc, receipt) {
  const entries = entriesOf(doc, receipt)
  if (!entries.photos.length && !entries.vins.length && !entries.plates.length) return
  await mkdir(join(dir, 'index'), { recursive: true })
  for (const name of Object.keys(FILES)) {
    if (!entries[name].length) continue
    const text = entries[name].map((e) => JSON.stringify(e)).join('\n') + '\n'
    await writeFile(join(dir, 'index', FILES[name]), text, { flag: 'a' })
  }
}

/** true only when both are known and equal; a null on either side is its own unknown, never a match */
const sameCustomer = (a, b) => a !== null && a === b

/**
 * What an adjuster should know about this report, given everything filed before it. Reads the
 * indexes as they stood before this report was recorded (see the module comment) and never
 * matches the report against its own entries. Plates and VINs are also not matched against the
 * other account of the same accident: both drivers enter both plates, and that is the point,
 * not a signal. **Photographs still are.** Two drivers standing in the same road take different
 * pictures; the same picture on both accounts means one person filed both sides, which is the
 * one thing a linked pair must not hide. `linked` is the references already filed under the
 * report's incident, whose lines may predate the link (a report sent first and attached to an
 * invite afterwards).
 */
export async function signalsFor(dir, doc, receipt, linked = []) {
  const own = entriesOf(doc, receipt)
  const signals = []
  const seen = new Set()
  const add = (signal) => {
    const k = `${signal.code}|${signal.with}`
    if (seen.has(k)) return
    seen.add(k)
    signals.push(signal)
  }
  const incident = receipt?.incident ?? null
  const related = new Set(linked)
  const notMine = (e) => e.reference !== receipt?.reference
  const unrelated = (e) => notMine(e) && !(incident && e.incident === incident) && !related.has(e.reference)
  const prior = {}
  // photographs against every other report, the twin account included; plates and VINs not
  for (const name of Object.keys(FILES)) prior[name] = (await readIndex(dir, name)).filter(name === 'photos' ? notMine : unrelated)

  for (const mine of own.photos) {
    for (const other of prior.photos) {
      const distance = hamming(mine.key, other.key)
      if (distance !== null && distance <= HASH_DISTANCE) {
        add({ code: 'photo_seen_before', with: other.reference, detail: `${distance} bit${distance === 1 ? '' : 's'} apart` })
      }
    }
  }

  for (const [name, code] of [
    ['vins', 'vin_seen_before'],
    ['plates', 'plate_seen_before'],
  ]) {
    for (const mine of own[name]) {
      for (const other of prior[name]) {
        if (other.key === mine.key && !sameCustomer(mine.customer, other.customer)) {
          add({ code, with: other.reference, detail: mine.key })
        }
      }
    }
  }

  const customer = receipt?.customer?.id ?? null
  if (customer) {
    const since = Date.parse(receipt.receivedAt) - FREQUENT_DAYS * DAY
    const refs = new Set()
    for (const e of Object.values(prior).flat()) {
      if (e.customer !== customer) continue
      const at = Date.parse(e.at)
      if (Number.isFinite(at) && at >= since) refs.add(e.reference)
    }
    const count = refs.size + 1 // this report, about to be filed, counts too
    if (count >= FREQUENT_COUNT) {
      add({ code: 'frequent_reporter', with: null, detail: `${count} reports in the last ${FREQUENT_DAYS} days` })
    }
  }

  return signals
}

/**
 * Drop every index line naming a reference that is no longer on disk — called after a sweep,
 * with the references still filed, so the index does not grow forever with reports that no
 * longer exist. A missing index file is left alone; rewriting also drops any line that could
 * not be parsed, so what remains is always valid JSONL.
 */
export async function prune(dir, keep) {
  for (const name of Object.keys(FILES)) {
    const file = join(dir, 'index', FILES[name])
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch {
      continue
    }
    const kept = text
      .split('\n')
      .map((raw) => (raw.trim() ? parseLine(raw) : null))
      .filter((v) => v !== null && keep.has(v.reference))
    await writeFile(file, kept.map((e) => JSON.stringify(e)).join('\n') + (kept.length ? '\n' : ''))
  }
}
