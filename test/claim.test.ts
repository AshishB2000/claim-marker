import { describe, expect, it } from 'vitest'
import { damage } from '../src/schema'
import { CLAIM_SCHEMA, MAX_PHOTOS, emptyClaim, makeReference, newPerson, newVehicle, nowLocal, parseClaim, toDocument, type Claim } from '../src/claim/schema'

const sample = (): Claim => ({
  ...emptyClaim(),
  incident: {
    kind: 'collision',
    at: '2026-09-06T17:30',
    location: { lng: -73.9859, lat: 40.7573, address: 'Times Square, New York' },
    surface: 'satellite',
    conditions: { weather: 'rain', road: 'wet', light: 'dark_lit' },
    description: 'He turned across me',
  },
  vehicles: [
    {
      ...newVehicle('a', 'insured', 'sedan', '#b91c1c'),
      make: 'Honda',
      model: 'Civic',
      year: 2019,
      position: [-73.98592, 40.75731],
      heading: 12,
      path: [[-73.98601, 40.75712]],
      damages: [damage('front_bumper', [0.18, 0.32, 1.24], 'dent')],
    },
    { ...newVehicle('b', 'other', 'suv', '#1c1f26'), position: [-73.98575, 40.75738], heading: 262, path: [] },
  ],
  impact: [-73.98588, 40.75736],
})

describe('claim round-trip', () => {
  it('export → load → export is byte-identical', () => {
    const first = toDocument(sample())
    const second = toDocument(parseClaim(JSON.parse(JSON.stringify(first))).value)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it('normalises precision, case and whitespace once', () => {
    const noisy = sample()
    noisy.vehicles[0].position = [0.1 + 0.2, 40.7573000004]
    noisy.vehicles[0].heading = -47.6
    noisy.vehicles[0].color = '#B91C1C'
    noisy.vehicles[0].plate = ' ab12 cde '
    const once = toDocument(noisy)
    expect(once.vehicles[0].position).toEqual([0.3, 40.7573])
    expect(once.vehicles[0].heading).toBe(312)
    expect(once.vehicles[0].color).toBe('#b91c1c')
    expect(once.vehicles[0].plate).toBe('AB12 CDE')
    expect(JSON.stringify(toDocument(once))).toBe(JSON.stringify(once))
  })

  it('keeps a plausible model year and drops nonsense', () => {
    const c = sample()
    expect(toDocument(c).vehicles[0].year).toBe(2019)
    c.vehicles[0].year = 2019.5
    expect(toDocument(c).vehicles[0].year).toBeNull()
    c.vehicles[0].year = 1850
    expect(toDocument(c).vehicles[0].year).toBeNull()
    const { value } = parseClaim({ schema: CLAIM_SCHEMA, vehicles: [{ id: 'a', role: 'insured', body: 'sedan', color: '#ffffff', year: 2021 }] })
    expect(value.vehicles[0].year).toBe(2021)
    expect(parseClaim({ schema: CLAIM_SCHEMA, vehicles: [{ id: 'a', role: 'insured', body: 'sedan', color: '#ffffff', year: '2021' }] }).value.vehicles[0].year).toBeNull()
  })

  it('keeps the ground the diagram was drawn on, and defaults an unknown one to the satellite map', () => {
    const c = sample()
    c.incident.surface = 'lot'
    expect(parseClaim(toDocument(c)).value.incident.surface).toBe('lot')
    const raw = JSON.parse(JSON.stringify(toDocument(c)))
    raw.incident.surface = 'moon'
    expect(parseClaim(raw).value.incident.surface).toBe('satellite')
    delete raw.incident.surface
    expect(parseClaim(raw).value.incident.surface).toBe('satellite')
  })

  it('round-trips the whole report: people, police, property, photos, the reporter and the attestation', () => {
    const c: Claim = {
      ...sample(),
      reporter: { name: ' Ashish B ', phone: '555 0100', email: 'ME@Example.com ', policy: 'pol-9', policyholder: true },
      people: [
        { ...newPerson('driver', 'a'), self: true },
        { ...newPerson('driver', 'b'), name: 'Dana Q', phone: '555 0199', licence: 'd1234 ', injured: true, injury: 'Sore neck, went to A&E' },
        { ...newPerson('passenger', 'a'), name: 'Sam' },
        { ...newPerson('pedestrian'), name: 'Jo', injured: true, injury: 'Grazed knee' },
        { ...newPerson('witness'), name: 'Wit Ness', phone: '555 0111' },
      ],
      police: { called: true, department: 'NYPD Midtown South', report: ' 2026-0042 ', citations: 'None' },
      property: { description: 'Traffic light pole', owner: 'City of New York' },
      attestation: { agreed: true, name: 'Ashish B', at: '2026-09-06T18:00:00.000Z' },
    }
    c.vehicles[0] = { ...c.vehicles[0], plate: 'abc 123', plateState: 'ny', vin: ' 1hgcm82633a004352 ', condition: { drivable: false, airbags: true, towed: true, location: "Mike's Towing" } }
    c.vehicles[1] = { ...c.vehicles[1], insurer: 'Acme Mutual', policy: 'am-77', owner: 'Dana Q' }
    c.attachments.photos = [{ data: 'data:image/jpeg;base64,/9j/4AAQ', of: 'a', caption: ' front bumper ' }]
    const first = toDocument(c)
    expect(JSON.stringify(toDocument(parseClaim(JSON.parse(JSON.stringify(first))).value))).toBe(JSON.stringify(first))
    expect(first.reporter).toEqual({ name: 'Ashish B', phone: '555 0100', email: 'me@example.com', policy: 'POL-9', policyholder: true })
    expect(first.vehicles[0].vin).toBe('1HGCM82633A004352')
    expect(first.vehicles[0].plateState).toBe('NY')
    expect(first.vehicles[0].condition).toEqual({ drivable: false, airbags: true, towed: true, location: "Mike's Towing" })
    expect(first.people[1].licence).toBe('D1234')
    expect(first.police.report).toBe('2026-0042')
    expect(first.attachments.photos[0].caption).toBe('front bumper')
    expect(first.incident.conditions).toEqual({ weather: 'rain', road: 'wet', light: 'dark_lit' })
  })

  it('a driver or passenger belongs to a vehicle that exists, and a vehicle has one driver', () => {
    const c = sample()
    c.people = [
      { ...newPerson('driver', 'a'), name: 'First' },
      { ...newPerson('driver', 'a'), name: 'Second' },
      { ...newPerson('passenger', 'zz'), name: 'Nobody' },
      { ...newPerson('driver', 'zz'), name: 'Ghost' },
      { ...newPerson('witness', 'zz'), name: 'Saw it' },
    ]
    const doc = toDocument(c)
    expect(doc.people.map((p) => p.name)).toEqual(['First', 'Saw it'])
    // the witness was in no vehicle, whatever the record said
    expect(doc.people[1].vehicle).toBeNull()
  })

  it('keeps only real photographs, of vehicles that exist, up to the cap', () => {
    const c = sample()
    c.attachments.photos = [
      { data: 'data:image/jpeg;base64,AAAA', of: 'a', caption: 'ok' },
      { data: 'data:image/png;base64,AAAA', of: 'zz', caption: 'of nobody' },
      { data: 'https://example.com/x.jpg', of: null, caption: 'a link, not a photo' },
      { data: 'data:text/html;base64,PHNjcmlwdD4=', of: null, caption: 'not an image at all' },
    ]
    const doc = toDocument(c)
    expect(doc.attachments.photos.map((p) => p.caption)).toEqual(['ok', 'of nobody'])
    expect(doc.attachments.photos[1].of).toBeNull()
    c.attachments.photos = Array.from({ length: MAX_PHOTOS + 5 }, (_, i) => ({ data: 'data:image/jpeg;base64,AAAA', of: null, caption: String(i) }))
    expect(toDocument(c).attachments.photos).toHaveLength(MAX_PHOTOS)
  })

  it('defaults the kind and the conditions, and rejects values off the lists', () => {
    const raw = JSON.parse(JSON.stringify(toDocument(sample())))
    raw.incident.kind = 'asteroid'
    raw.incident.conditions = { weather: 'plasma', road: 'wet', light: 7 }
    raw.police = { called: 'yes', report: 42 }
    raw.attestation = { agreed: 'true', name: 5, at: 12 }
    const { value } = parseClaim(raw)
    expect(value.incident.kind).toBe('collision')
    expect(value.incident.conditions).toEqual({ weather: '', road: 'wet', light: '' })
    expect(value.police).toEqual({ called: null, department: '', report: '', citations: '' })
    expect(value.attestation).toEqual({ agreed: false, name: '', at: null })
  })

  it('keeps the v1 damage shape untouched inside a vehicle', () => {
    const { value } = parseClaim(toDocument(sample()))
    expect(value.vehicles[0].damages[0]).toEqual({ zone: 'front_bumper', point: [0.18, 0.32, 1.24], severity: 'dent', note: '' })
  })
})

describe('parseClaim rejects bad input', () => {
  it.each([
    ['not an object', 7],
    ['null', null],
    ['wrong schema', { schema: 'claim/2' }],
    ['the marker schema', { schema: 'claim-marker/1', vehicle: 'sedan', damages: [] }],
    ['vehicles not an array', { schema: CLAIM_SCHEMA, vehicles: {} }],
  ])('throws on %s', (_label, input) => {
    expect(() => parseClaim(input)).toThrow()
  })

  it('drops individual malformed vehicles instead of losing the good ones', () => {
    const { value, rejected } = parseClaim({
      schema: CLAIM_SCHEMA,
      vehicles: [
        { id: 'a', role: 'insured', body: 'sedan', color: '#ffffff', position: [1, 2], heading: 0, path: [] },
        { id: 'b', role: 'other', body: 'spaceship', color: '#ffffff' },
        { id: 'c', role: 'other', body: 'suv', color: 'red' },
        { id: 'd', role: 'other', body: 'suv', color: '#000000', position: [500, 2] },
        { id: 'e', role: 'other', body: 'suv', color: '#000000', path: [[1, 2], [3]] },
        null,
      ],
    })
    expect(value.vehicles.map((v) => v.id)).toEqual(['a'])
    expect(rejected).toBe(5)
  })

  it('validates a damage against its own vehicle body', () => {
    const { value } = parseClaim({
      schema: CLAIM_SCHEMA,
      vehicles: [
        {
          id: 'a',
          role: 'insured',
          body: 'truck',
          color: '#000000',
          damages: [
            { zone: 'right_rear_door', point: [0.65, 0.5, -0.3], severity: 'dent', note: '' },
            { zone: 'hood', point: [0, 0.72, 1.1], severity: 'scratch', note: '' },
          ],
        },
      ],
    })
    expect(value.vehicles[0].damages.map((d) => d.zone)).toEqual(['hood'])
  })

  it('defaults what is missing rather than throwing', () => {
    const { value } = parseClaim({ schema: CLAIM_SCHEMA })
    expect(value.vehicles).toEqual([])
    expect(value.incident.location).toBeNull()
    expect(value.impact).toBeNull()
    expect(value.attachments).toEqual({ scene: null, damage: {}, photos: [] })
    expect(value.people).toEqual([])
    expect(value.incident.kind).toBe('collision')
  })

  it('keeps only PNG attachments that belong to a vehicle in the document', () => {
    const { value } = parseClaim({
      schema: CLAIM_SCHEMA,
      vehicles: [{ id: 'a', role: 'insured', body: 'sedan', color: '#ffffff' }],
      attachments: { scene: 'data:image/png;base64,AAAA', damage: { a: 'data:image/png;base64,BBBB', zz: 'data:image/png;base64,CCCC', b: 'not a png' } },
    })
    expect(value.attachments.scene).toBe('data:image/png;base64,AAAA')
    expect(Object.keys(value.attachments.damage)).toEqual(['a'])
  })
})

describe('helpers', () => {
  it('nowLocal is the local minute in datetime-local shape', () => {
    const at = nowLocal(new Date(2026, 8, 6, 17, 30, 45))
    expect(at).toBe('2026-09-06T17:30')
  })

  it('references are nine characters from an unambiguous alphabet', () => {
    const ref = makeReference(() => 0.999)
    expect(ref).toMatch(/^CM-[A-HJ-NP-Z2-9]{6}$/)
    expect(makeReference(() => 0)).toBe('CM-AAAAAA')
  })
})
