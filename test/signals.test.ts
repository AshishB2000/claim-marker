import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FREQUENT_COUNT, FREQUENT_DAYS, entriesOf, hamming, prune, record, signalsFor } from '../server/signals.mjs'

const AT = '2026-09-01T00:00:00.000Z'
const docWithPhoto = (hash: string | null) => ({ attachments: { photos: [{ hash }] }, vehicles: [] })
const docWithVehicle = (vin: string, plate = '') => ({ attachments: { photos: [] }, vehicles: [{ vin, plate }] })

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'signals-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('hamming', () => {
  it('is zero for identical hashes', () => {
    expect(hamming('0123456789abcdef', '0123456789abcdef')).toBe(0)
  })

  it('counts a single flipped bit', () => {
    expect(hamming('0000000000000000', '0000000000000001')).toBe(1)
  })

  it('counts every bit when nothing is shared', () => {
    expect(hamming('0000000000000000', 'ffffffffffffffff')).toBe(64)
  })

  it('is null unless both sides are sixteen hex characters', () => {
    expect(hamming('0000000000000000', 'short')).toBeNull()
    expect(hamming('0000000000000000', null)).toBeNull()
    expect(hamming(42, '0000000000000000')).toBeNull()
    expect(hamming('gggggggggggggggg', '0000000000000000')).toBeNull() // not hex
    expect(hamming('0000000000000000', '00000000000000000')).toBeNull() // wrong length
  })
})

describe('entriesOf', () => {
  const receipt = { reference: 'INS-2026-AAA', customer: { id: 'cust-1' }, receivedAt: AT }

  it('pulls the photo hashes, the VINs and the plates out of a document and skips the empty ones', () => {
    const doc = {
      attachments: {
        photos: [
          { hash: 'AbCd000000000000' }, // valid, mixed case — kept lowercase
          { hash: '' },
          { hash: null },
          {}, // no hash field at all
          { hash: 'not-a-hash-at-all' },
        ],
      },
      vehicles: [
        { vin: '1hgcm82633a004352', plate: ' abc123 ' },
        { vin: '   ', plate: '' }, // whitespace-only: empty
        { vin: '', plate: 'xyz999' },
      ],
    }
    const entries = entriesOf(doc, receipt)
    expect(entries.photos).toEqual([{ key: 'abcd000000000000', reference: 'INS-2026-AAA', customer: 'cust-1', at: AT }])
    expect(entries.vins).toEqual([{ key: '1HGCM82633A004352', reference: 'INS-2026-AAA', customer: 'cust-1', at: AT }])
    expect(entries.plates).toEqual([
      { key: 'ABC123', reference: 'INS-2026-AAA', customer: 'cust-1', at: AT },
      { key: 'XYZ999', reference: 'INS-2026-AAA', customer: 'cust-1', at: AT },
    ])
  })

  it('records no customer when the report was filed with none', () => {
    const entries = entriesOf(docWithVehicle('VIN1'), { reference: 'INS-2026-BBB', customer: null, receivedAt: AT })
    expect(entries.vins[0].customer).toBeNull()
  })
})

describe('a photograph seen before', () => {
  const REF_A = 'INS-2026-AAA'
  const REF_B = 'INS-2026-BBB'

  it('signals against another report, never against its own', async () => {
    const receiptA = { reference: REF_A, customer: { id: 'cust-1' }, receivedAt: AT }
    const docA = docWithPhoto('0000000000000000')
    await record(dir, docA, receiptA)

    // re-checking the very report just filed must never signal against itself
    expect(await signalsFor(dir, docA, receiptA)).toEqual([])

    const receiptB = { reference: REF_B, customer: { id: 'cust-2' }, receivedAt: AT }
    const nearHash = docWithPhoto('0000000000000001') // one bit off, within HASH_DISTANCE
    expect(await signalsFor(dir, nearHash, receiptB)).toEqual([{ code: 'photo_seen_before', with: REF_A, detail: '1 bit apart' }])
  })

  it('does not signal a photograph too different to be the same picture', async () => {
    await record(dir, docWithPhoto('0000000000000000'), { reference: REF_A, customer: { id: 'cust-1' }, receivedAt: AT })
    const farHash = docWithPhoto('ffffffffffffffff')
    expect(await signalsFor(dir, farHash, { reference: REF_B, customer: { id: 'cust-2' }, receivedAt: AT })).toEqual([])
  })
})

describe('a VIN or plate seen before', () => {
  const REF_A = 'INS-2026-AAA'
  const REF_B = 'INS-2026-BBB'
  const REF_C = 'INS-2026-CCC'

  it('does not signal the same customer reporting the same car twice', async () => {
    const cust1 = { id: 'cust-1' }
    await record(dir, docWithVehicle('1HGCM82633A004352'), { reference: REF_A, customer: cust1, receivedAt: AT })
    const again = await signalsFor(dir, docWithVehicle('1HGCM82633A004352'), { reference: REF_B, customer: cust1, receivedAt: AT })
    expect(again).toEqual([])
  })

  it('signals the same VIN under a different customer', async () => {
    await record(dir, docWithVehicle('1HGCM82633A004352'), { reference: REF_A, customer: { id: 'cust-1' }, receivedAt: AT })
    const doc = docWithVehicle('1hgcm82633a004352') // same VIN, different case
    const signals = await signalsFor(dir, doc, { reference: REF_C, customer: { id: 'cust-2' }, receivedAt: AT })
    expect(signals).toEqual([{ code: 'vin_seen_before', with: REF_A, detail: '1HGCM82633A004352' }])
  })

  it('never treats one unknown customer as the same as another', async () => {
    await record(dir, docWithVehicle('', 'ABC123'), { reference: REF_A, customer: null, receivedAt: AT })
    const signals = await signalsFor(dir, docWithVehicle('', 'ABC123'), { reference: REF_B, customer: null, receivedAt: AT })
    expect(signals).toEqual([{ code: 'plate_seen_before', with: REF_A, detail: 'ABC123' }])
  })
})

describe('two accounts of one accident', () => {
  const INC = 'INC-AAAAAA'
  const mine = { reference: 'INS-2026-MINE', customer: { id: 'alice' }, receivedAt: AT }
  const theirs = { reference: 'INS-2026-THEIRS', customer: null, receivedAt: AT }

  it('records the incident on each index line, and nothing when there is none', () => {
    expect(entriesOf(docWithVehicle('', 'ABC123'), { ...mine, incident: INC }).plates[0].incident).toBe(INC)
    expect(entriesOf(docWithVehicle('', 'ABC123'), mine).plates[0]).not.toHaveProperty('incident')
  })

  it('do not flag each other, though both carry the same plate and VIN', async () => {
    await record(dir, docWithVehicle('1HGCM82633A004352', 'ABC123'), { ...mine, incident: INC })
    expect(await signalsFor(dir, docWithVehicle('1HGCM82633A004352', 'ABC123'), { ...theirs, incident: INC })).toEqual([])
  })

  it('do not flag a report attached to the incident after it was indexed', async () => {
    // sent first, with no incident on its lines; the invite named it afterwards
    await record(dir, docWithVehicle('', 'ABC123'), mine)
    expect(await signalsFor(dir, docWithVehicle('', 'ABC123'), { ...theirs, incident: INC }, [mine.reference])).toEqual([])
  })

  it('still flag the same photograph on the twin account — one person filing both sides', async () => {
    const HASH = 'f0e1d2c3b4a59687'
    await record(dir, docWithPhoto(HASH), { ...mine, incident: INC })
    expect(await signalsFor(dir, docWithPhoto(HASH), { ...theirs, incident: INC }, [mine.reference])).toEqual([
      { code: 'photo_seen_before', with: mine.reference, detail: '0 bits apart' },
    ])
  })

  it('still flag the same plate from another incident', async () => {
    await record(dir, docWithVehicle('', 'ABC123'), { ...mine, incident: 'INC-BBBBBB' })
    expect(await signalsFor(dir, docWithVehicle('', 'ABC123'), { ...theirs, incident: INC })).toEqual([
      { code: 'plate_seen_before', with: mine.reference, detail: 'ABC123' },
    ])
  })
})

describe('frequent_reporter', () => {
  const cust = { id: 'cust-9' }
  const NOW = Date.parse('2026-09-17T00:00:00.000Z')
  const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString()
  const now = new Date(NOW).toISOString()

  it('fires at the threshold and not a report before it', async () => {
    await record(dir, docWithVehicle('', 'PLATE-1'), { reference: 'INS-2026-P1', customer: cust, receivedAt: daysAgo(10) })

    // one prior report plus this one is two — below FREQUENT_COUNT
    const early = await signalsFor(dir, docWithVehicle('', 'PLATE-2'), { reference: 'INS-2026-P2', customer: cust, receivedAt: now })
    expect(early.some((s) => s.code === 'frequent_reporter')).toBe(false)

    await record(dir, docWithVehicle('', 'PLATE-2'), { reference: 'INS-2026-P2', customer: cust, receivedAt: daysAgo(5) })

    // two prior reports plus this one is three — the threshold
    const atThreshold = await signalsFor(dir, docWithVehicle('', 'PLATE-3'), { reference: 'INS-2026-P3', customer: cust, receivedAt: now })
    expect(atThreshold.find((s) => s.code === 'frequent_reporter')).toEqual({
      code: 'frequent_reporter',
      with: null,
      detail: `${FREQUENT_COUNT} reports in the last ${FREQUENT_DAYS} days`,
    })
  })

  it('ignores reports older than the window', async () => {
    await record(dir, docWithVehicle('', 'PLATE-OLD-1'), { reference: 'INS-2026-O1', customer: cust, receivedAt: daysAgo(FREQUENT_DAYS + 10) })
    await record(dir, docWithVehicle('', 'PLATE-OLD-2'), { reference: 'INS-2026-O2', customer: cust, receivedAt: daysAgo(FREQUENT_DAYS + 5) })
    const signals = await signalsFor(dir, docWithVehicle('', 'PLATE-OLD-3'), { reference: 'INS-2026-O3', customer: cust, receivedAt: now })
    expect(signals.some((s) => s.code === 'frequent_reporter')).toBe(false)
  })
})

describe('prune', () => {
  it('removes the lines for references that are gone and keeps the rest as valid JSONL', async () => {
    await record(dir, docWithVehicle('VIN-KEEP', 'PLATE-KEEP'), { reference: 'INS-2026-KEEP', customer: { id: 'cust-1' }, receivedAt: AT })
    await record(dir, docWithVehicle('VIN-DROP', 'PLATE-DROP'), { reference: 'INS-2026-DROP', customer: { id: 'cust-2' }, receivedAt: AT })

    await prune(dir, new Set(['INS-2026-KEEP']))

    for (const name of ['vins.jsonl', 'plates.jsonl']) {
      const text = await readFile(join(dir, 'index', name), 'utf8')
      const lines = text.split('\n').filter(Boolean)
      const parsed = lines.map((raw) => JSON.parse(raw)) // throws if any line is not valid JSON
      expect(parsed).toHaveLength(1)
      expect(parsed[0].reference).toBe('INS-2026-KEEP')
    }
  })

  it('drops a line that will not parse, without disturbing the rest', async () => {
    await record(dir, docWithVehicle('VIN-KEEP'), { reference: 'INS-2026-KEEP', customer: { id: 'cust-1' }, receivedAt: AT })
    await writeFile(join(dir, 'index', 'vins.jsonl'), 'not json at all\n', { flag: 'a' })

    await prune(dir, new Set(['INS-2026-KEEP']))

    const lines = (await readFile(join(dir, 'index', 'vins.jsonl'), 'utf8')).split('\n').filter(Boolean)
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]).reference).toBe('INS-2026-KEEP')
  })

  it('does nothing, and does not throw, when the index does not exist', async () => {
    await expect(prune(dir, new Set(['INS-2026-KEEP']))).resolves.toBeUndefined()
  })
})

describe('a broken index never stops a report being checked', () => {
  it('signals nothing when index/ does not exist at all', async () => {
    const signals = await signalsFor(dir, docWithPhoto('0000000000000000'), { reference: 'INS-2026-X', customer: { id: 'c' }, receivedAt: AT })
    expect(signals).toEqual([])
  })

  it('signals nothing when a file cannot be read', async () => {
    // a directory where a plain file is expected makes a plain read fail
    await mkdir(join(dir, 'index', 'photos.jsonl'), { recursive: true })
    const signals = await signalsFor(dir, docWithPhoto('0000000000000000'), { reference: 'INS-2026-X', customer: { id: 'c' }, receivedAt: AT })
    expect(signals).toEqual([])
  })

  it('skips a malformed line rather than throwing, and still reads the good ones', async () => {
    await mkdir(join(dir, 'index'), { recursive: true })
    const good = JSON.stringify({ key: '0000000000000000', reference: 'INS-2026-OLD', customer: 'cust-1', at: AT })
    await writeFile(join(dir, 'index', 'photos.jsonl'), `not json\n${good}\n`)

    const signals = await signalsFor(dir, docWithPhoto('0000000000000000'), { reference: 'INS-2026-NEW', customer: { id: 'cust-2' }, receivedAt: AT })
    expect(signals).toEqual([{ code: 'photo_seen_before', with: 'INS-2026-OLD', detail: '0 bits apart' }])
  })
})
