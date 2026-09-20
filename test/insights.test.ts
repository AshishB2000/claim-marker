/**
 * What the desk says about its whole inbox. All of it is arithmetic nobody would notice going
 * wrong on screen: a day bucket off by one, an accident counted twice because two people
 * reported it, an hour read off a string, a median that quietly includes a wall clock half a
 * day out.
 */
import { describe, expect, it } from 'vitest'
import { focusLabel, inFocus, insightsOf, lagLabel, type Counted } from '../src/adjuster/insights'
import { inboxRows } from '../src/adjuster/inbox'

const NOW = new Date('2026-09-19T11:00:00')

const receipt = (receivedAt: string, summary: Partial<Counted['summary']> = {}): Counted => ({
  receivedAt,
  summary: { kind: 'collision', at: '2026-09-19T08:30', ...summary },
})

describe('the inbox counted as a whole', () => {
  it('counts nothing out of nothing, and says so without dividing by zero', () => {
    const none = insightsOf([], NOW)
    expect(none.total).toBe(0)
    expect(none.days).toHaveLength(30)
    expect(none.days.every((d) => d.n === 0)).toBe(true)
    expect(none.hours).toEqual(Array.from({ length: 24 }, () => 0))
    expect(none.kinds).toEqual([])
    expect(none.medianLag).toBeNull()
  })

  it('buckets arrivals into the desk’s own days, thirty of them, oldest first', () => {
    const of = insightsOf([receipt('2026-09-19T09:00:00'), receipt('2026-09-19T23:30:00'), receipt('2026-08-21T12:00:00')], NOW)
    expect(of.days[29].day).toBe('2026-09-19')
    expect(of.days[0].day).toBe('2026-08-21')
    // both of today's, whatever hour they landed at, and the one on the oldest day still in range
    expect(of.days[29].n).toBe(2)
    expect(of.days[0].n).toBe(1)
  })

  it('leaves out what fell off the far end, and anything with no date at all', () => {
    const of = insightsOf([receipt('2026-08-20T12:00:00'), receipt('not a date')], NOW)
    expect(of.total).toBe(2)
    expect(of.days.reduce((n, d) => n + d.n, 0)).toBe(0)
  })

  it('reads the hour off the accident’s own local clock, and skips a receipt that has none', () => {
    const of = insightsOf([receipt('2026-09-19T09:00:00', { at: '2026-09-18T17:45' }), receipt('2026-09-19T09:00:00', { at: '2026-09-18T17:05' }), receipt('2026-09-19T09:00:00', { at: '' })], NOW)
    expect(of.hours[17]).toBe(2)
    expect(of.hours.reduce((a, b) => a + b, 0)).toBe(2)
  })

  it('counts a panel once per report however many marks landed on it, and names it', () => {
    const of = insightsOf(
      [
        receipt('2026-09-19T09:00:00', { panels: ['left_front_door', 'left_front_door', 'hood'] }),
        receipt('2026-09-19T09:00:00', { panels: ['hood'] }),
        receipt('2026-09-19T09:00:00', { panels: ['trunk'] }),
      ],
      NOW,
    )
    expect(of.panels).toEqual([
      { id: 'hood', label: 'Hood', n: 2 },
      { id: 'left_front_door', label: 'Left front door', n: 1 },
      { id: 'trunk', label: 'Trunk / tailgate', n: 1 },
    ])
  })

  it('counts the kinds, the weather and the light, most first, and ignores what was never answered', () => {
    const of = insightsOf(
      [
        receipt('2026-09-19T09:00:00', { kind: 'glass', weather: 'rain', light: 'dark_lit' }),
        receipt('2026-09-19T09:00:00', { kind: 'collision', weather: 'rain', light: '' }),
        receipt('2026-09-19T09:00:00', { kind: 'collision' }),
      ],
      NOW,
    )
    expect(of.kinds.map((b) => [b.id, b.n])).toEqual([
      ['collision', 2],
      ['glass', 1],
    ])
    expect(of.weather).toEqual([{ id: 'rain', label: 'Rain', n: 1 * 2 }])
    expect(of.light).toEqual([{ id: 'dark_lit', label: 'Dark, street lights on', n: 1 }])
  })

  it('counts a report as hurt or not drivable once, whoever many were in it', () => {
    const of = insightsOf([receipt('2026-09-19T09:00:00', { hurt: 3, drivable: false }), receipt('2026-09-19T09:00:00', { hurt: 0, drivable: null })], NOW)
    expect(of.hurt).toBe(1)
    expect(of.notDrivable).toBe(1)
  })

  it('takes the median lag only from the reports whose time is an instant', () => {
    // 09:00 local at +60 is 08:00Z; received 10:00Z is two hours later
    const at = '2026-09-19T09:00'
    const of = insightsOf(
      [
        receipt('2026-09-19T10:00:00.000Z', { at, utcOffset: 60 }),
        receipt('2026-09-19T12:00:00.000Z', { at, utcOffset: 60 }),
        receipt('2026-09-19T20:00:00.000Z', { at, utcOffset: 60 }),
        // no offset: a wall clock could be half a day out either way, so it is not in the median
        receipt('2026-09-20T09:00:00.000Z', { at }),
      ],
      NOW,
    )
    expect(of.medianLag).toBe(4 * 60)
    // an even count takes the middle two
    expect(insightsOf([receipt('2026-09-19T10:00:00.000Z', { at, utcOffset: 60 }), receipt('2026-09-19T12:00:00.000Z', { at, utcOffset: 60 })], NOW).medianLag).toBe(3 * 60)
  })

  it('counts one accident once, however many accounts of it were filed', () => {
    const two = [
      { reference: 'INS-1', receivedAt: '2026-09-19T09:00:00', incident: 'INC-1', party: 'policyholder' as const, summary: { kind: 'collision', at: '2026-09-19T08:00' } },
      { reference: 'INS-2', receivedAt: '2026-09-19T09:30:00', incident: 'INC-1', party: 'other_party' as const, summary: { kind: 'collision', at: '2026-09-19T08:00' } },
    ]
    expect(insightsOf(two, NOW).total).toBe(2)
    expect(insightsOf(inboxRows(two).map((r) => r.lead), NOW).total).toBe(1)
  })
})

describe('the tile the list is held to', () => {
  const r = receipt('2026-09-19T09:00:00', { kind: 'glass', at: '2026-09-18T17:45', panels: ['hood'], weather: 'rain', light: 'dusk' })

  it('keeps everything when nothing is held', () => {
    expect(inFocus(r, null)).toBe(true)
  })

  it('matches on each of the five things a tile can be', () => {
    expect(inFocus(r, { by: 'kind', id: 'glass' })).toBe(true)
    expect(inFocus(r, { by: 'kind', id: 'collision' })).toBe(false)
    expect(inFocus(r, { by: 'panel', id: 'hood' })).toBe(true)
    expect(inFocus(r, { by: 'panel', id: 'roof' })).toBe(false)
    expect(inFocus(r, { by: 'hour', id: '17' })).toBe(true)
    expect(inFocus(r, { by: 'hour', id: '18' })).toBe(false)
    expect(inFocus(r, { by: 'weather', id: 'rain' })).toBe(true)
    expect(inFocus(r, { by: 'light', id: 'dusk' })).toBe(true)
  })

  it('never matches a receipt that does not carry that field at all', () => {
    const bare = receipt('2026-09-19T09:00:00')
    expect(inFocus(bare, { by: 'panel', id: 'hood' })).toBe(false)
    expect(inFocus(bare, { by: 'weather', id: 'rain' })).toBe(false)
    expect(inFocus(bare, { by: 'light', id: 'dusk' })).toBe(false)
  })

  it('says in words what it is holding', () => {
    const of = insightsOf([r], NOW)
    expect(focusLabel({ by: 'kind', id: 'glass' }, of)).toBe('Glass only')
    expect(focusLabel({ by: 'panel', id: 'hood' }, of)).toBe('Hood')
    expect(focusLabel({ by: 'hour', id: '7' }, of)).toBe('07:00')
  })
})

describe('how long people take to report', () => {
  it('reads in the units an adjuster would say', () => {
    expect(lagLabel(20)).toBe('20 min')
    expect(lagLabel(180)).toBe('3 h')
    expect(lagLabel(4 * 1440)).toBe('4 days')
  })
})
