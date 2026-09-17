import { describe, expect, it } from 'vitest'
import { expired } from '../server/retention.mjs'

const NOW = Date.parse('2026-09-17T12:00:00.000Z')
const ago = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString()

describe('retention', () => {
  it('forgets a report once it is older than the limit, and not a moment before', () => {
    expect(expired(ago(24 * 7), 7, NOW)).toBe(false)
    expect(expired(new Date(NOW - 7 * 86_400_000 - 1).toISOString(), 7, NOW)).toBe(true)
    expect(expired(ago(24 * 30), 7, NOW)).toBe(true)
    expect(expired(ago(1), 7, NOW)).toBe(false)
  })

  it('keeps everything when there is no limit', () => {
    for (const days of [undefined, null, 0, -3, Number.NaN]) expect(expired(ago(24 * 3650), days, NOW)).toBe(false)
  })

  it('keeps a report it cannot date', () => {
    for (const at of [undefined, null, '', 'yesterday', 42]) expect(expired(at, 1, NOW)).toBe(false)
  })

  it('takes a day as a day, fractions included', () => {
    expect(expired(ago(13), 0.5, NOW)).toBe(true)
    expect(expired(ago(11), 0.5, NOW)).toBe(false)
  })
})
