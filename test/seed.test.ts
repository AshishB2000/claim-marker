/**
 * The line the other driver's page starts behind.
 *
 * They are a stranger who scanned a QR code in the road. They need the few facts both accounts
 * must share and they must get nothing else — so this walks a seed built from a *complete*
 * report and fails on any trace of it.
 */
import { describe, expect, it } from 'vitest'
import { damage } from '../src/schema'
import { emptyClaim, newPerson, newVehicle, toDocument, type Claim } from '../src/claim/schema'
import { MAX_SEED_VEHICLES, parseSeed, seedOf } from '../src/claim/seed'

const full = (): Claim =>
  toDocument({
    ...emptyClaim(),
    reference: 'CM-7F3K2Q',
    reporter: { name: 'Ashish B', phone: '555 0100', email: 'me@example.com', policy: 'POL-9', policyholder: true, party: 'policyholder' },
    incident: {
      ...emptyClaim().incident,
      at: '2026-09-06T17:30',
      utcOffset: -240,
      location: { lng: -73.9859, lat: 40.7573, address: 'Times Square' },
      surface: 'streets',
      description: 'The van pulled out across me.',
    },
    vehicles: [
      { ...newVehicle('a', 'insured', 'sedan', '#b91c1c'), make: 'Honda', model: 'Civic', plate: 'ABC 123', vin: '1HGCM82633A004352', damages: [damage('front_bumper', [0.18, 0.32, 1.24], 'dent')] },
      { ...newVehicle('b', 'other', 'van', '#e9ebee'), make: 'Ford', model: 'Transit', plate: 'XYZ 789', vin: '2FMDK3GC4BBA00001', insurer: 'Acme Mutual' },
    ],
    people: [{ ...newPerson('driver', 'b'), name: 'Dana Q', phone: '555 0199', licence: 'D1234' }],
    attachments: { scene: null, damage: {}, photos: [{ data: 'data:image/jpeg;base64,AAAA', of: 'a', caption: 'the bumper' }] },
  })

describe('what the other driver is given', () => {
  const claim = full()
  // the customer's own car: on the other driver's page it is the *other* vehicle
  const own = claim.vehicles.find((v) => v.role === 'insured')!
  const seed = seedOf(claim.incident, [{ body: own.body, color: own.color, make: own.make, model: own.model }])
  const text = JSON.stringify(seed)

  it('is where, when, the ground and the shapes of the cars — and those keys only', () => {
    expect(Object.keys(seed).sort()).toEqual(['at', 'location', 'surface', 'utcOffset', 'vehicles'])
    expect(seed.vehicles.every((v) => Object.keys(v).sort().join() === 'body,color,make,model')).toBe(true)
  })

  it('carries nothing that names anybody or anything', () => {
    for (const secret of ['Ashish B', '555 0100', 'me@example.com', 'POL-9', 'CM-7F3K2Q', 'Dana Q', 'D1234', 'ABC 123', 'XYZ 789', '1HGCM82633A004352', 'Acme Mutual', 'pulled out', 'base64']) {
      expect(text, `the seed leaks "${secret}"`).not.toContain(secret)
    }
    expect(text).not.toMatch(/front_bumper|damages|photos|people|reporter|reference/)
  })

  it('does carry what both accounts have to agree on', () => {
    expect(seed.at).toBe('2026-09-06T17:30')
    expect(seed.utcOffset).toBe(-240)
    expect(seed.surface).toBe('streets')
    expect(seed.location).toEqual({ lng: -73.9859, lat: 40.7573, address: 'Times Square' })
    // the customer's car, as shape, colour, make and model — never its plate or VIN — and
    // not the other driver's own car, which is theirs to describe
    expect(seed.vehicles).toEqual([{ body: 'sedan', color: '#b91c1c', make: 'Honda', model: 'Civic' }])
  })
})

describe('reading a seed back', () => {
  const good = { at: '2026-09-06T17:30', utcOffset: -240, surface: 'lot', location: { lng: -73.9859, lat: 40.7573, address: 'Times Square' }, vehicles: [{ body: 'suv', color: '#1C1F26', make: ' Ford ', model: 'Transit' }] }

  it('takes a well-formed one', () => {
    const seed = parseSeed(good)!
    expect(seed.surface).toBe('lot')
    expect(seed.vehicles[0]).toEqual({ body: 'suv', color: '#1c1f26', make: 'Ford', model: 'Transit' })
  })

  it('refuses one with no time, because two accounts with no shared moment are two accidents', () => {
    expect(parseSeed({ ...good, at: 'yesterday' })).toBeNull()
    expect(parseSeed({})).toBeNull()
    expect(parseSeed(null)).toBeNull()
    expect(parseSeed('nonsense')).toBeNull()
  })

  it('drops a vehicle it does not understand, and everything it was not asked for', () => {
    const seed = parseSeed({
      ...good,
      vehicles: [{ body: 'spaceship', color: '#000000' }, { body: 'suv', color: 'red' }, { body: 'suv', color: '#111111', plate: 'ABC 123', vin: 'X', damages: [1] }],
    })!
    expect(seed.vehicles).toEqual([{ body: 'suv', color: '#111111', make: '', model: '' }])
    expect(JSON.stringify(seed)).not.toMatch(/plate|vin|damages|ABC/)
  })

  it('caps the list, the names and an offset no zone has', () => {
    const many = Array.from({ length: 12 }, () => ({ body: 'sedan', color: '#111111', make: 'x'.repeat(200) }))
    const seed = parseSeed({ ...good, vehicles: many, utcOffset: 5000 })!
    expect(seed.vehicles).toHaveLength(MAX_SEED_VEHICLES)
    expect(seed.vehicles[0].make.length).toBe(60)
    expect(seed.utcOffset).toBeNull()
  })

  it('takes a seed with no place: an accident in a car park still has a time', () => {
    expect(parseSeed({ ...good, location: null })!.location).toBeNull()
    expect(parseSeed({ ...good, location: { lng: 999, lat: 0 } })!.location).toBeNull()
  })
})
