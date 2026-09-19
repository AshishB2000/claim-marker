/**
 * What the desk's map is given. All of it is the part of the map that can be wrong without
 * anyone noticing on screen: a report quietly missing from the map, a date range that keeps a
 * report a day too long, a view that loses its points at the antimeridian.
 */
import { describe, expect, it } from 'vitest'
import { inBounds, inRange, inView, pins, placeOf, rangeStart, type Placed } from '../src/adjuster/pins'

const receipt = (reference: string, summary: Partial<Placed['summary']> = {}, extra: Partial<Placed> = {}): Placed => ({
  reference,
  status: 'new',
  receivedAt: '2026-09-07T10:00:00.000Z',
  summary: { lng: -73.9859, lat: 40.7573, hurt: 0, drivable: true, ...summary },
  ...extra,
})

describe('the receipts as points', () => {
  it('carries what the layers paint by', () => {
    const { features } = pins([receipt('INS-1', { hurt: 2, drivable: false }, { status: 'reviewing', signals: [{}, {}] })])
    expect(features).toHaveLength(1)
    expect(features[0].geometry.coordinates).toEqual([-73.9859, 40.7573])
    expect(features[0].properties).toEqual({ reference: 'INS-1', status: 'reviewing', hurt: 2, notDrivable: true, signals: 2 })
  })

  it('leaves out a report with no place — an old receipt, or one that never said where', () => {
    expect(pins([receipt('INS-1', { lng: null, lat: null })]).features).toHaveLength(0)
    expect(pins([{ reference: 'INS-2', status: 'new', receivedAt: '2026-09-07T10:00:00.000Z', summary: {} }]).features).toHaveLength(0)
    expect(placeOf(receipt('INS-3', { lng: Number.NaN }))).toBeNull()
    // and 0, 0 is a place like any other
    expect(placeOf(receipt('INS-4', { lng: 0, lat: 0 }))).toEqual([0, 0])
  })

  it('says a report is not drivable only when the receipt says so, never when it does not say', () => {
    expect(pins([receipt('INS-1', { drivable: null })]).features[0].properties!.notDrivable).toBe(false)
    expect(pins([receipt('INS-2', { drivable: false })]).features[0].properties!.notDrivable).toBe(true)
  })
})

describe('how far back the desk is looking', () => {
  const now = new Date('2026-09-07T10:00:00')

  it('takes today from midnight, not from twenty-four hours ago', () => {
    expect(rangeStart('today', now)).toEqual(new Date('2026-09-07T00:00:00'))
    expect(inRange(new Date('2026-09-07T00:30:00').toISOString(), 'today', now)).toBe(true)
    expect(inRange(new Date('2026-09-06T23:30:00').toISOString(), 'today', now)).toBe(false)
  })

  it('counts seven and thirty days back from now', () => {
    expect(inRange(new Date('2026-09-01T10:00:00').toISOString(), 'week', now)).toBe(true)
    expect(inRange(new Date('2026-08-30T09:00:00').toISOString(), 'week', now)).toBe(false)
    expect(inRange(new Date('2026-08-30T09:00:00').toISOString(), 'month', now)).toBe(true)
    expect(inRange(new Date('2026-07-01T09:00:00').toISOString(), 'month', now)).toBe(false)
  })

  it('keeps everything when no range is chosen, and drops a date it cannot read', () => {
    expect(rangeStart('all', now)).toBeNull()
    expect(inRange('2000-01-01T00:00:00.000Z', 'all', now)).toBe(true)
    expect(inRange('not a date', 'week', now)).toBe(false)
  })
})

describe('what the view holds', () => {
  const nyc: [number, number] = [-73.9859, 40.7573]
  const view: [number, number, number, number] = [-74.1, 40.6, -73.8, 40.9]

  it('keeps a point inside and drops one outside', () => {
    expect(inBounds(nyc, view)).toBe(true)
    expect(inBounds([-0.1276, 51.5072], view)).toBe(false)
    // the edges are in the view
    expect(inBounds([-74.1, 40.6], view)).toBe(true)
  })

  it('reads a view across the antimeridian as MapLibre gives it, unwrapped past 180', () => {
    const pacific: [number, number, number, number] = [150, -20, 200, 20]
    expect(inBounds([179, 0], pacific)).toBe(true)
    expect(inBounds([-170, 0], pacific)).toBe(true)
    expect(inBounds([100, 0], pacific)).toBe(false)
    expect(inBounds([-170, 30], pacific)).toBe(false)
  })

  it('leaves a report with no place off the map rather than in every view', () => {
    expect(inView(receipt('INS-1'), view)).toBe(true)
    expect(inView(receipt('INS-2', { lng: null, lat: null }), view)).toBe(false)
  })
})
