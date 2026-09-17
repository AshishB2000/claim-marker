import { describe, expect, it } from 'vitest'
import { LIGHT } from '../src/claim/schema'
import type { LngLat } from '../src/geo'
import { glare, lightFrom, sunPosition } from '../src/scene/sun'

/** absolute-degree tolerance helper; every call states why that many degrees */
const near = (actual: number, expected: number, toleranceDeg: number) => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(toleranceDeg)
}

const ms = (iso: string) => Date.parse(iso)

describe('sunPosition', () => {
  it('solar noon a little north of the equator on the March equinox: near the zenith, due south', () => {
    // The March 2024 equinox (declination 0°, published: 2024-03-20 03:06 UTC) is the one
    // moment a hand calculation needs no ephemeris — the sun sits on the equator, so every
    // latitude's local noon puts it almost straight up.
    //
    // Not literally *on* the equator: right at latitude 0 the sun passes through the zenith
    // itself at local solar noon on the equinox, and azimuth is genuinely undefined there —
    // it swings from due east to due west within the same minute (verified against this
    // file's own algorithm while designing this test: at 1°N, a 16-minute window around noon
    // swings azimuth by over 130°, because near the zenith a small hour-angle error is a huge
    // bearing error, the same way a small position error near Earth's pole is a huge change
    // of compass bearing). 10°N stays close enough to the equator for "near the top of the
    // sky" to hold while being comfortably clear of that singularity.
    //
    // Locating "solar noon" needs the equation of time: the standard low-order approximation
    // (Spencer 1971) gives about -7.9 minutes on this date, so true solar noon at 0°
    // longitude is 12:00 + 7.9min ≈ 12:08 UTC.
    const at: LngLat = [0, 10]
    const sun = sunPosition(ms('2024-03-20T12:08:00Z'), at)
    // altitude = 90° - |lat - declination| ≈ 90° - 10° = 80°; declination has drifted a hair
    // off zero in the ~9 hours since the exact equinox instant, hence the small allowance.
    near(sun.altitude, 80, 2)
    // the observer (10°N) is north of the sun's ~0° declination, so the sun is to their south
    near(sun.azimuth, 180, 4)
  })

  it('a sunrise near the equator (Quito, on the equinox): altitude near 0°', () => {
    // Quito sits almost exactly on the equator (0.22°S), so — the well-known fact this test
    // leans on — its day is close to 12 hours long all year, and on the equinox specifically
    // sunrise is at 06:00 local *apparent solar* time everywhere except the poles (the sunrise
    // hour-angle formula cos(H0) = -tan(lat)·tan(declination) gives H0 = 90° whenever
    // declination is 0°, independent of latitude). Converting 06:00 solar time to UTC needs
    // only Quito's longitude (-78.51°, exact) and the same -7.9 minute equation-of-time
    // estimate used above, giving 2024-03-20T11:22 UTC.
    //
    // Tolerance is ~1.2°: about 0.3° from the equation-of-time approximation's own few-minute
    // error, plus the ~0.83° by which a *published* sunrise (the sun's upper limb, bent up by
    // atmospheric refraction) leads this file's refraction-free geometric center — the gap the
    // file's own doc comment says it accepts.
    const quito: LngLat = [-78.51, -0.22]
    const sun = sunPosition(ms('2024-03-20T11:22:00Z'), quito)
    near(sun.altitude, 0, 1.2)
  })

  it('polar night: Longyearbyen stays below the horizon all day in mid-December', () => {
    const longyearbyen: LngLat = [15.65, 78.22]
    for (const hour of [0, 4, 8, 12, 16, 20]) {
      const sun = sunPosition(ms(`2024-12-15T${String(hour).padStart(2, '0')}:00:00Z`), longyearbyen)
      expect(sun.altitude).toBeLessThan(0)
    }
  })

  it('polar day: Longyearbyen sees the sun above the horizon at local midnight in mid-June', () => {
    // Svalbard is UTC+2 in June (CEST); local midnight on the 15th is 22:00 UTC on the 14th.
    const longyearbyen: LngLat = [15.65, 78.22]
    const sun = sunPosition(ms('2024-06-14T22:00:00Z'), longyearbyen)
    expect(sun.altitude).toBeGreaterThan(0)
  })

  it('azimuth sweeps clockwise through a northern-hemisphere day: morning east, noon south, evening west', () => {
    const nyc: LngLat = [-74.006, 40.7128]
    // 08:00, 12:00 and 16:00 EDT (UTC-4) on the summer solstice — no need for the exact
    // equation of time here, only that the three samples land in the morning, around local
    // noon, and in the afternoon, which any reading within an hour of these still would.
    const morning = sunPosition(ms('2024-06-21T12:00:00Z'), nyc)
    const midday = sunPosition(ms('2024-06-21T16:00:00Z'), nyc)
    const afternoon = sunPosition(ms('2024-06-21T20:00:00Z'), nyc)
    expect(morning.azimuth).toBeLessThan(midday.azimuth)
    expect(midday.azimuth).toBeLessThan(afternoon.azimuth)
    // sanity check on the two ends: morning sun in the eastern half of the sky, evening in the
    // western half
    expect(morning.azimuth).toBeLessThan(180)
    expect(afternoon.azimuth).toBeGreaterThan(180)
  })
})

describe('lightFrom', () => {
  const lits = [true, false, null] as const

  it.each(lits)('above 6°: daylight regardless of lit=%s', (lit) => {
    expect(lightFrom(7, lit)).toBe('daylight')
  })

  it.each(lits)('exactly 6°: dusk regardless of lit=%s', (lit) => {
    expect(lightFrom(6, lit)).toBe('dusk')
  })

  it.each(lits)('0°: dusk regardless of lit=%s', (lit) => {
    expect(lightFrom(0, lit)).toBe('dusk')
  })

  it.each(lits)('exactly -6°: dusk regardless of lit=%s', (lit) => {
    expect(lightFrom(-6, lit)).toBe('dusk')
  })

  it('below -6°, lit true: dark_lit', () => {
    expect(lightFrom(-7, true)).toBe('dark_lit')
  })

  it('below -6°, lit false: dark_unlit', () => {
    expect(lightFrom(-7, false)).toBe('dark_unlit')
  })

  it('below -6°, lit null (unknown treated as unlit): dark_unlit', () => {
    expect(lightFrom(-7, null)).toBe('dark_unlit')
  })

  it('only returns values from the LIGHT enum', () => {
    for (const altitude of [10, 6, 0, -6, -10]) {
      for (const lit of lits) {
        expect(LIGHT).toContain(lightFrom(altitude, lit))
      }
    }
  })
})

describe('glare', () => {
  it('a low sun dead ahead is glare', () => {
    expect(glare({ altitude: 10, azimuth: 90 }, 90)).toBe(true)
  })

  it('the same low sun behind the driver is not glare', () => {
    expect(glare({ altitude: 10, azimuth: 90 }, 270)).toBe(false)
  })

  it('the same low sun to the side (90° off) is not glare', () => {
    expect(glare({ altitude: 10, azimuth: 90 }, 0)).toBe(false)
  })

  it('a high noon sun ahead is not glare, however aligned', () => {
    expect(glare({ altitude: 60, azimuth: 180 }, 180)).toBe(false)
  })

  it('a sun below the horizon ahead is not glare', () => {
    expect(glare({ altitude: -5, azimuth: 180 }, 180)).toBe(false)
  })

  it('exactly at the 25° edge counts as glare', () => {
    expect(glare({ altitude: 10, azimuth: 115 }, 90)).toBe(true)
  })

  it('just past the 25° edge does not', () => {
    expect(glare({ altitude: 10, azimuth: 115.5 }, 90)).toBe(false)
  })

  it('exactly at the 25° altitude edge is not glare (0–25° is half-open at 25)', () => {
    expect(glare({ altitude: 25, azimuth: 90 }, 90)).toBe(false)
  })

  it('exactly at 0° altitude is not glare (0–25° is half-open at 0)', () => {
    expect(glare({ altitude: 0, azimuth: 90 }, 90)).toBe(false)
  })

  it('wraps correctly across 350°/10°: a heading of 350° with the sun at 10° is 20° off, within range', () => {
    expect(glare({ altitude: 10, azimuth: 10 }, 350)).toBe(true)
  })

  it('wraps correctly across 350°/10°: a heading of 350° with the sun at 40° is 50° off, outside range', () => {
    expect(glare({ altitude: 10, azimuth: 40 }, 350)).toBe(false)
  })
})
