import { describe, expect, it } from 'vitest'
import { SCHEMA, damage, emptyValue, parse, type ClaimValue } from '../src/schema'
import { createMarkerStore } from '../src/marker/store'

const sample = (): ClaimValue => ({
  schema: SCHEMA,
  vehicle: 'sedan',
  damages: [
    damage('front_bumper', [0.12, 0.34, 1.24], 'dent', 'scuffed on a bollard'),
    damage('left_front_door', [-0.65, 0.5, 0.16], 'scratch'),
    damage('right_taillight', [0.45, 0.6, -1.25], 'crack'),
  ],
})

describe('schema round-trip', () => {
  it('export → load → export is identical', () => {
    const store = createMarkerStore(sample())
    const first = store.getState().value()

    store.getState().load(parse(first).value)
    const second = store.getState().value()

    expect(second).toEqual(first)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it('survives a trip through JSON text', () => {
    const first = sample()
    const { value } = parse(JSON.parse(JSON.stringify(first)))
    expect(JSON.stringify(value)).toBe(JSON.stringify(first))
  })

  it('normalises coordinate precision so the round trip is stable', () => {
    const noisy = { ...emptyValue(), damages: [{ zone: 'roof', point: [0.1 + 0.2, 1.3, -0.2], severity: 'dent', note: '' }] }
    const once = parse(noisy).value
    const twice = parse(once).value
    expect(once.damages[0].point[0]).toBe(0.3)
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
  })

  it('defaults a missing note to an empty string', () => {
    const { value } = parse({ schema: SCHEMA, vehicle: 'sedan', damages: [{ zone: 'hood', point: [0, 1, 0], severity: 'dent' }] })
    expect(value.damages[0].note).toBe('')
  })
})

describe('parse rejects bad input', () => {
  it.each([
    ['not an object', 42],
    ['null', null],
    ['wrong schema', { schema: 'claim-marker/2', vehicle: 'sedan', damages: [] }],
    ['missing schema', { vehicle: 'sedan', damages: [] }],
    ['unknown vehicle', { schema: SCHEMA, vehicle: 'spaceship', damages: [] }],
    ['damages not an array', { schema: SCHEMA, vehicle: 'sedan', damages: {} }],
  ])('throws on %s', (_label, input) => {
    expect(() => parse(input)).toThrow()
  })

  it('drops individual malformed damages instead of losing the good ones', () => {
    const { value, rejected } = parse({
      schema: SCHEMA,
      vehicle: 'sedan',
      damages: [
        { zone: 'hood', point: [0, 0.76, 0.78], severity: 'dent', note: '' },
        { zone: 'nose_cone', point: [0, 0, 0], severity: 'dent', note: '' },
        { zone: 'roof', point: [0, 1.3], severity: 'dent', note: '' },
        { zone: 'roof', point: [0, 1.3, -0.2], severity: 'obliterated', note: '' },
        { zone: 'roof', point: [0, Infinity, -0.2], severity: 'dent', note: '' },
        null,
      ],
    })
    expect(value.damages).toHaveLength(1)
    expect(value.damages[0].zone).toBe('hood')
    expect(rejected).toBe(5)
  })

  it('treats an absent damages list as empty', () => {
    expect(parse({ schema: SCHEMA, vehicle: 'sedan' }).value.damages).toEqual([])
  })
})
