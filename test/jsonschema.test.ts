import { describe, expect, it } from 'vitest'
import Ajv from 'ajv/dist/2020'
import { readFileSync } from 'node:fs'
import { damage, SEVERITIES } from '../src/schema'
import { KINDS, LANGUAGES, LIGHT, ROAD, SURFACES, WEATHER, emptyClaim, newPerson, newVehicle, parseClaim, toDocument } from '../src/claim/schema'
import { BODY_ORDER } from '../src/vehicles/bodies'

const schema = JSON.parse(readFileSync(new URL('../docs/claim-1.schema.json', import.meta.url), 'utf8'))
const ajv = new Ajv({ allErrors: true, strict: true })
ajv.addFormat('date-time', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/)
const validate = ajv.compile(schema)

const png = 'data:image/png;base64,iVBORw0KGgo='
const jpg = 'data:image/jpeg;base64,/9j/4AAQ'

const full = () =>
  toDocument({
    ...emptyClaim(),
    reference: 'CM-7F3K2Q',
    submittedAt: '2026-09-07T22:14:03.000Z',
    reporter: { name: 'Ashish B', phone: '555 0100', email: 'me@example.com', policy: 'pol-9', policyholder: true },
    incident: {
      kind: 'collision',
      at: '2026-09-06T17:30',
      utcOffset: -240,
      location: { lng: -73.9859, lat: 40.7573, address: 'Times Square' },
      context: {
        weather: { code: 61, label: 'Light rain', tempC: 11.4, precipMm: 0.3, windKph: 12.6 },
        sun: { altitude: 8.42, azimuth: 271.3 },
        road: { name: '5th Avenue', class: 'primary', lanes: 2, oneway: true, maxspeed: '25 mph', lit: true, junction: 'cross', controls: ['crossing', 'traffic_signals'] },
        source: 'open-meteo+osm',
        fetchedAt: '2026-09-07T22:10:00.000Z',
      },
      surface: 'satellite',
      conditions: { weather: 'rain', road: 'wet', light: 'dark_lit' },
      description: 'The van pulled out across me.',
      language: 'en',
    },
    vehicles: [
      { ...newVehicle('a', 'insured', 'sedan', '#b91c1c'), make: 'Honda', model: 'Civic', year: 2019, position: [-73.98592, 40.75731], heading: 12, path: [[-73.98601, 40.75712]], damages: [damage('front_bumper', [0.18, 0.32, 1.24], 'dent')] },
      { ...newVehicle('b', 'other', 'van', '#e9ebee'), insurer: 'Acme Mutual', policy: 'AM-77', position: [-73.98575, 40.75738], heading: 262 },
    ],
    people: [
      { ...newPerson('driver', 'b'), name: 'Dana Q', phone: '555 0199' },
      { ...newPerson('passenger', 'a'), name: 'Sam Lee', injured: true, injury: 'Whiplash' },
      { ...newPerson('witness'), name: 'Wit Ness' },
    ],
    impact: [-73.98588, 40.75736],
    police: { called: true, department: 'NYPD', report: '2026-0042', citations: '' },
    property: { description: 'A pole', owner: 'The city' },
    attestation: { agreed: true, name: 'Ashish B', at: '2026-09-07T22:14:03.000Z' },
    attachments: { scene: png, damage: { a: png }, photos: [{ data: jpg, of: 'a', caption: 'Front bumper', shows: 'front_bumper' }, { data: jpg, of: null, caption: 'The junction' }] },
  })

describe('the published JSON Schema for claim/1', () => {
  it('accepts what the page sends', () => {
    expect(validate(full()), JSON.stringify(validate.errors)).toBe(true)
    expect(validate(toDocument(emptyClaim())), JSON.stringify(validate.errors)).toBe(true)
  })

  it('carries the panel a photo shows', () => {
    const d = full()
    expect(d.attachments.photos[0].shows).toBe('front_bumper')
    expect(validate({ ...d, attachments: { ...d.attachments, photos: [{ ...d.attachments.photos[0], shows: 7 }] } })).toBe(false)
  })

  it('accepts what the parser accepts, after the round trip', () => {
    const { value } = parseClaim(JSON.parse(JSON.stringify(full())))
    expect(validate(value), JSON.stringify(validate.errors)).toBe(true)
  })

  it('rejects the wrong schema name, a bad kind, a bad colour and a heading out of range', () => {
    expect(validate({ ...full(), schema: 'claim/2' })).toBe(false)
    const d = full()
    expect(validate({ ...d, incident: { ...d.incident, kind: 'meteor' } })).toBe(false)
    expect(validate({ ...d, vehicles: [{ ...d.vehicles[0], color: 'red' }] })).toBe(false)
    expect(validate({ ...d, vehicles: [{ ...d.vehicles[0], heading: 360 }] })).toBe(false)
    expect(validate({ ...d, attachments: { ...d.attachments, scene: 'data:text/plain;base64,QUJD' } })).toBe(false)
  })

  it('accepts a report written in Spanish', () => {
    const d = full()
    expect(validate({ ...d, incident: { ...d.incident, language: 'es' } }), JSON.stringify(validate.errors)).toBe(true)
    expect(validate({ ...d, incident: { ...d.incident, language: 'fr' } })).toBe(false)
  })

  it('lists the same values the code does', () => {
    const p = schema.properties
    expect(p.incident.properties.language.enum).toEqual([...LANGUAGES])
    expect(p.incident.properties.kind.enum).toEqual([...KINDS])
    expect(p.incident.properties.surface.enum).toEqual([...SURFACES])
    expect(p.incident.properties.conditions.properties.weather.enum).toEqual(['', ...WEATHER])
    expect(p.incident.properties.conditions.properties.road.enum).toEqual(['', ...ROAD])
    expect(p.incident.properties.conditions.properties.light.enum).toEqual(['', ...LIGHT])
    expect(schema.$defs.vehicle.properties.body.enum).toEqual([...BODY_ORDER])
    expect(schema.$defs.damage.properties.severity.enum).toEqual([...SEVERITIES])
  })
})
