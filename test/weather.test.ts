import { describe, expect, it } from 'vitest'
import { parseWeather, toConditions, toSceneWeather, weatherLabel, type HourlyWeather } from '../src/scene/weather'

/**
 * A day of Open-Meteo's `hourly` block, local time, midnight to 23:00 — the shape
 * `parseWeather` reads. Each variable defaults to all zeros/code 0 so a test only has to name
 * the hours it cares about.
 */
function hourly(day: string, over: Partial<Record<'weather_code' | 'temperature_2m' | 'precipitation' | 'wind_speed_10m' | 'cloud_cover', number[]>> = {}) {
  const zeros = () => Array<number>(24).fill(0)
  return {
    time: Array.from({ length: 24 }, (_, h) => `${day}T${String(h).padStart(2, '0')}:00`),
    weather_code: over.weather_code ?? zeros(),
    temperature_2m: over.temperature_2m ?? zeros(),
    precipitation: over.precipitation ?? zeros(),
    wind_speed_10m: over.wind_speed_10m ?? zeros(),
    cloud_cover: over.cloud_cover ?? zeros(),
  }
}

const payload = (h: ReturnType<typeof hourly>, utcOffsetSeconds = -18000) => ({ utc_offset_seconds: utcOffsetSeconds, hourly: h })

const fixture = (patch: Partial<HourlyWeather> = {}): HourlyWeather => ({
  code: 0,
  tempC: 10,
  precipMm: 0,
  windKph: 5,
  cloudPct: 20,
  prevPrecipMm: [0, 0],
  prevTempC: [10, 10],
  utcOffsetMinutes: 0,
  ...patch,
})

describe('parseWeather', () => {
  it('picks the hour the form gave, truncated to the hour', () => {
    const h = hourly('2024-01-15', { temperature_2m: Array.from({ length: 24 }, (_, i) => i) })
    const w = parseWeather(payload(h), '2024-01-15T14:37')
    expect(w?.tempC).toBe(14)
  })

  it('brings the two preceding hours along, oldest first', () => {
    const h = hourly('2024-01-15', {
      precipitation: Array.from({ length: 24 }, (_, i) => i),
      temperature_2m: Array.from({ length: 24 }, (_, i) => i + 100),
    })
    const w = parseWeather(payload(h), '2024-01-15T14:00')
    expect(w?.prevPrecipMm).toEqual([12, 13])
    expect(w?.prevTempC).toEqual([112, 113])
  })

  it('an hour outside the payload is null', () => {
    const h = hourly('2024-01-15')
    expect(parseWeather(payload(h), '2024-01-16T05:00')).toBeNull()
  })

  it('rejects garbage, null and a bare string', () => {
    expect(parseWeather(null, '2024-01-15T14:00')).toBeNull()
    expect(parseWeather('nope', '2024-01-15T14:00')).toBeNull()
    expect(parseWeather({}, '2024-01-15T14:00')).toBeNull()
    expect(parseWeather({ hourly: null }, '2024-01-15T14:00')).toBeNull()
    expect(parseWeather({ hourly: { time: 'nope' } }, '2024-01-15T14:00')).toBeNull()
  })

  it('a malformed field at the chosen hour is null, not a guess', () => {
    const h = hourly('2024-01-15')
    // @ts-expect-error deliberately wrong shape, proving parseWeather does not trust it
    h.weather_code[14] = 'sunny'
    expect(parseWeather(payload(h), '2024-01-15T14:00')).toBeNull()
  })

  it('missing preceding hours default to no rain and the same temperature, not null', () => {
    const h = hourly('2024-01-15', { precipitation: [5, 0, ...Array<number>(22).fill(0)], temperature_2m: [3, ...Array<number>(23).fill(3)] })
    const w = parseWeather(payload(h), '2024-01-15T00:00')
    expect(w).not.toBeNull()
    expect(w?.prevPrecipMm).toEqual([0, 0])
    expect(w?.prevTempC).toEqual([3, 3])
  })

  it('converts utc_offset_seconds to minutes', () => {
    const h = hourly('2024-01-15')
    expect(parseWeather(payload(h, -18000), '2024-01-15T00:00')?.utcOffsetMinutes).toBe(-300)
    expect(parseWeather(payload(h, 3600), '2024-01-15T00:00')?.utcOffsetMinutes).toBe(60)
  })
})

describe('toConditions: weather from the WMO code', () => {
  const weatherOf = (code: number, cloudPct = 20) => toConditions(fixture({ code, cloudPct })).weather

  it('0-1 is clear, 2-3 is cloudy', () => {
    expect(weatherOf(0)).toBe('clear')
    expect(weatherOf(1)).toBe('clear')
    expect(weatherOf(2)).toBe('cloudy')
    expect(weatherOf(3)).toBe('cloudy')
  })

  it('45 and 48 are fog', () => {
    expect(weatherOf(45)).toBe('fog')
    expect(weatherOf(48)).toBe('fog')
  })

  it('51-67 and 80-82 are rain, including the freezing-rain codes in that range', () => {
    expect(weatherOf(51)).toBe('rain')
    expect(weatherOf(61)).toBe('rain')
    expect(weatherOf(66)).toBe('rain')
    expect(weatherOf(67)).toBe('rain')
    expect(weatherOf(80)).toBe('rain')
    expect(weatherOf(82)).toBe('rain')
  })

  it('71-77 and 85-86 are snow', () => {
    expect(weatherOf(71)).toBe('snow')
    expect(weatherOf(77)).toBe('snow')
    expect(weatherOf(85)).toBe('snow')
    expect(weatherOf(86)).toBe('snow')
  })

  it('95-99 (thunderstorms) fall back to rain', () => {
    expect(weatherOf(95)).toBe('rain')
    expect(weatherOf(99)).toBe('rain')
  })

  it('an unlisted code falls back to cloud cover', () => {
    expect(weatherOf(9, 80)).toBe('cloudy')
    expect(weatherOf(9, 10)).toBe('clear')
  })
})

describe('toConditions: road state', () => {
  it('a snow code is a snowy road even if it is not freezing', () => {
    expect(toConditions(fixture({ code: 73, tempC: 5, precipMm: 0 })).road).toBe('snow')
  })

  it('freezing with recent precipitation is icy', () => {
    expect(toConditions(fixture({ code: 61, tempC: 0, precipMm: 1 })).road).toBe('icy')
    expect(toConditions(fixture({ code: 61, tempC: -3, prevPrecipMm: [0, 2] })).road).toBe('icy')
  })

  it('precipitation right now, above freezing, is wet', () => {
    expect(toConditions(fixture({ code: 61, tempC: 10, precipMm: 2 })).road).toBe('wet')
  })

  it('rain stopped an hour ago, but the road is still wet', () => {
    expect(toConditions(fixture({ code: 0, tempC: 12, precipMm: 0, prevPrecipMm: [0, 3] })).road).toBe('wet')
  })

  it('nothing wet in the last two hours is dry', () => {
    expect(toConditions(fixture({ code: 0, tempC: 15, precipMm: 0, prevPrecipMm: [0, 0] })).road).toBe('dry')
  })
})

describe('weatherLabel', () => {
  it('a known code is short plain English', () => {
    expect(weatherLabel(0)).toBe('Clear sky')
    expect(weatherLabel(75)).toBe('Heavy snow')
    expect(weatherLabel(95)).toBe('Thunderstorm')
  })

  it('an unknown code says so', () => {
    expect(weatherLabel(12345)).toBe('Unknown')
  })
})

describe('toSceneWeather', () => {
  it('carries the code, its label, and the readings straight through', () => {
    const w = fixture({ code: 61, tempC: 8.5, precipMm: 1.2, windKph: 14 })
    expect(toSceneWeather(w)).toEqual({ code: 61, label: 'Light rain', tempC: 8.5, precipMm: 1.2, windKph: 14 })
  })
})
