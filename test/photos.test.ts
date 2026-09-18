/**
 * What a photograph says about itself, and what the claim keeps of it.
 *
 * `test/exif.test.ts` proves the reader against bytes assembled by hand. This proves it
 * against a **real JPEG from a real encoder**, stamped by `scripts/exif-write.mjs` — the same
 * pair the browser smoke uses — because a reader that only ever sees its own test's output is
 * agreeing with itself.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { readExif } from '../src/claim/exif'
import { photoDistances } from '../src/claim/photos'
// a plain .mjs helper shared with the smoke script; allowJs types it from its JSDoc
import { stampExif } from '../scripts/exif-write.mjs'

const blank = readFileSync(new URL('../scripts/fixtures/scene.jpg', import.meta.url))
const stamped = (over: Record<string, unknown> = {}) =>
  (stampExif(blank, { takenAt: '2026-09-06T17:30', offset: '-04:00', lng: -73.9859, lat: 40.7573, ...over }) as Buffer).buffer.slice(0) as ArrayBuffer

const incident = { at: '2026-09-06T17:30', utcOffset: -240, location: { lng: -73.9859, lat: 40.7573, address: 'Times Square' } }

describe('a real JPEG, stamped and read back', () => {
  it('carries the time, the zone and the position through a real encoder', () => {
    const exif = readExif(stamped())
    expect(exif.takenAt).toBe('2026-09-06T17:30')
    expect(exif.utcOffset).toBe(-240)
    expect(exif.at![0]).toBeCloseTo(-73.9859, 4)
    expect(exif.at![1]).toBeCloseTo(40.7573, 4)
  })

  it('reads a southern, eastern position with the right signs', () => {
    const exif = readExif(stamped({ lng: 151.2093, lat: -33.8688 }))
    expect(exif.at![0]).toBeCloseTo(151.2093, 4)
    expect(exif.at![1]).toBeCloseTo(-33.8688, 4)
  })

  it('finds nothing in the same JPEG unstamped, and does not throw', () => {
    const exif = readExif(blank.buffer.slice(0) as ArrayBuffer)
    expect(exif).toEqual({ takenAt: null, utcOffset: null, at: null })
  })
})

describe('how far a photograph was from the claim', () => {
  it('is zero when it was taken at the scene at the stated minute', () => {
    expect(photoDistances(readExif(stamped()), incident)).toEqual({ minutesFromIncident: 0, metresFromScene: 0 })
  })

  it('counts minutes before the incident as negative', () => {
    expect(photoDistances(readExif(stamped({ takenAt: '2026-09-06T16:00' })), incident).minutesFromIncident).toBe(-90)
  })

  it('measures metres, and never hands back a coordinate', () => {
    // a block north: Photon would call it a different address, the claim only says how far
    const out = photoDistances(readExif(stamped({ lat: 40.7600 })), incident)
    expect(out.metresFromScene).toBeGreaterThan(250)
    expect(out.metresFromScene).toBeLessThan(330)
    expect(Object.keys(out).sort()).toEqual(['metresFromScene', 'minutesFromIncident'])
  })

  it('reads both clocks in the same zone when neither the photo nor the claim names one', () => {
    const exif = { takenAt: '2026-09-06T18:00', utcOffset: null, at: null }
    expect(photoDistances(exif, { ...incident, utcOffset: null }).minutesFromIncident).toBe(30)
  })

  it("takes the claim's zone for a photograph that did not record one", () => {
    const exif = { takenAt: '2026-09-06T18:00', utcOffset: null, at: null }
    expect(photoDistances(exif, incident).minutesFromIncident).toBe(30)
  })

  it('subtracts real instants when the photograph and the claim are in different zones', () => {
    // the camera says 23:30 in London; the crash was 17:30 in New York — the same minute
    const exif = { takenAt: '2026-09-06T22:30', utcOffset: 60, at: null }
    expect(photoDistances(exif, incident).minutesFromIncident).toBe(0)
  })

  it('says nothing at all about a photograph that knew nothing', () => {
    expect(photoDistances({ takenAt: null, utcOffset: null, at: null }, incident)).toEqual({})
  })

  it('has no distance to a claim with no place', () => {
    const out = photoDistances(readExif(stamped()), { ...incident, location: null })
    expect(out.metresFromScene).toBeUndefined()
    expect(out.minutesFromIncident).toBe(0)
  })
})
