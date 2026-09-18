import { describe, expect, it } from 'vitest'
import type { SceneContext, SceneRoad } from '../src/claim/schema'
import { DEFAULT_LIGHTING, lightingFor, type Lighting } from '../src/scene/lighting'

const road = (lit: boolean | null): SceneRoad => ({ name: 'W 44th St', class: 'residential', lanes: 2, oneway: false, maxspeed: '', lit, junction: 'none', controls: [] })

const ctx = (over: Partial<SceneContext>): SceneContext => ({
  weather: { code: 0, label: 'Clear sky', tempC: 20, precipMm: 0, windKph: 5 },
  sun: { altitude: 45, azimuth: 180 },
  road: road(null),
  source: 'test',
  fetchedAt: '2026-09-08T12:00:00.000Z',
  ...over,
})

const length = ([x, y, z]: Lighting['sun']) => Math.hypot(x, y, z)

describe('lightingFor', () => {
  it('is the fixed studio light when nothing was looked up', () => {
    expect(lightingFor(null)).toEqual(DEFAULT_LIGHTING)
    const l = DEFAULT_LIGHTING
    // today's light: from the east-north-east, high, white, no shadow map, no weather
    expect(l.sun[0]).toBeGreaterThan(0)
    expect(l.sun[1]).toBeLessThan(0)
    expect(l.sun[2]).toBeGreaterThan(0.7)
    expect(length(l.sun)).toBeCloseTo(1, 6)
    expect(l.shadows).toBe(false)
    expect(l.sunIntensity).toBe(1.5)
    expect(l).toMatchObject({ rain: false, snow: false, fog: false, night: false, lit: false, environment: 1 })
  })

  it('points the sun where the record puts it, in the layer’s frame: x east, y south, z up', () => {
    const east = lightingFor(ctx({ sun: { altitude: 30, azimuth: 90 } })).sun
    expect(east[0]).toBeCloseTo(Math.cos(Math.PI / 6), 6)
    expect(east[1]).toBeCloseTo(0, 6)
    expect(east[2]).toBeCloseTo(0.5, 6)
    const south = lightingFor(ctx({ sun: { altitude: 45, azimuth: 180 } })).sun
    expect(south[0]).toBeCloseTo(0, 6)
    expect(south[1]).toBeGreaterThan(0.7)
    const north = lightingFor(ctx({ sun: { altitude: 45, azimuth: 0 } })).sun
    expect(north[1]).toBeLessThan(-0.7)
    for (const az of [0, 37, 90, 200, 359]) expect(length(lightingFor(ctx({ sun: { altitude: 20, azimuth: az } })).sun)).toBeCloseTo(1, 6)
  })

  it('casts real shadows only under a clear sky with the sun up', () => {
    expect(lightingFor(ctx({})).shadows).toBe(true)
    expect(lightingFor(ctx({ sun: { altitude: -3, azimuth: 270 } })).shadows).toBe(false)
    expect(lightingFor(ctx({ sun: null })).shadows).toBe(false)
    expect(lightingFor(ctx({ weather: { code: 61, label: 'Light rain', tempC: 12, precipMm: 1, windKph: 10 } })).shadows).toBe(false)
    expect(lightingFor(ctx({ weather: { code: 3, label: 'Overcast', tempC: 12, precipMm: 0, windKph: 10 } })).shadows).toBe(false)
    expect(lightingFor(ctx({ weather: { code: 2, label: 'Partly cloudy', tempC: 12, precipMm: 0, windKph: 10 } })).shadows).toBe(true)
    expect(lightingFor(ctx({ weather: null })).shadows).toBe(true)
  })

  it('dims the sun as it drops, never below a quarter while it is up, and off once it has set', () => {
    expect(lightingFor(ctx({ sun: { altitude: 60, azimuth: 180 } })).sunIntensity).toBe(1.5)
    expect(lightingFor(ctx({ sun: { altitude: 25, azimuth: 180 } })).sunIntensity).toBe(1.5)
    expect(lightingFor(ctx({ sun: { altitude: 12.5, azimuth: 180 } })).sunIntensity).toBeCloseTo(0.75, 6)
    expect(lightingFor(ctx({ sun: { altitude: 2, azimuth: 180 } })).sunIntensity).toBeCloseTo(0.375, 6)
    expect(lightingFor(ctx({ sun: { altitude: 0, azimuth: 180 } })).sunIntensity).toBe(0)
    expect(lightingFor(ctx({ sun: { altitude: -20, azimuth: 180 } })).sunIntensity).toBe(0)
    // no sun in the record: the fixed light at full, so the map looks as it always did
    expect(lightingFor(ctx({ sun: null })).sunIntensity).toBe(1.5)
    expect(lightingFor(ctx({ sun: null })).sun).toEqual(DEFAULT_LIGHTING.sun)
  })

  it('tints the sky orange near the horizon and blue after dark', () => {
    const day = lightingFor(ctx({ sun: { altitude: 40, azimuth: 180 } }))
    const dusk = lightingFor(ctx({ sun: { altitude: 5, azimuth: 270 } }))
    const set = lightingFor(ctx({ sun: { altitude: -3, azimuth: 270 } }))
    const night = lightingFor(ctx({ sun: { altitude: -20, azimuth: 300 } }))
    expect(day.sky).toBe(DEFAULT_LIGHTING.sky)
    expect(day.night).toBe(false)
    expect(dusk.sky).not.toBe(day.sky)
    expect(dusk.sunColor).not.toBe(day.sunColor)
    expect(dusk.night).toBe(false)
    expect(set.sky).toBe(dusk.sky)
    expect(set.night).toBe(false)
    expect(night.sky).not.toBe(dusk.sky)
    expect(night.night).toBe(true)
    // the sky reads as blue, the dusk as orange: channel order is the whole assertion
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
    const [nr, , nb] = rgb(night.sky)
    const [dr, , db] = rgb(dusk.sky)
    expect(nb).toBeGreaterThan(nr)
    expect(dr).toBeGreaterThan(db)
    expect(night.environment).toBeLessThan(dusk.environment)
    expect(dusk.environment).toBeLessThan(day.environment)
  })

  it('reads rain, snow and fog off the WMO code, through weatherOfCode', () => {
    const w = (code: number) => lightingFor(ctx({ weather: { code, label: '', tempC: 5, precipMm: 1, windKph: 10 } }))
    expect(w(61)).toMatchObject({ rain: true, snow: false, fog: false })
    expect(w(80)).toMatchObject({ rain: true, snow: false, fog: false })
    expect(w(95)).toMatchObject({ rain: true, snow: false, fog: false })
    expect(w(71)).toMatchObject({ rain: false, snow: true, fog: false })
    expect(w(85)).toMatchObject({ rain: false, snow: true, fog: false })
    expect(w(45)).toMatchObject({ rain: false, snow: false, fog: true })
    expect(w(48)).toMatchObject({ rain: false, snow: false, fog: true })
    expect(w(0)).toMatchObject({ rain: false, snow: false, fog: false })
    expect(w(3)).toMatchObject({ rain: false, snow: false, fog: false })
    expect(lightingFor(ctx({ weather: null }))).toMatchObject({ rain: false, snow: false, fog: false })
  })

  it('dims the sun and the reflections under weather', () => {
    const clear = lightingFor(ctx({}))
    const w = (code: number) => lightingFor(ctx({ weather: { code, label: '', tempC: 5, precipMm: 1, windKph: 10 } }))
    expect(w(3).sunIntensity).toBeLessThan(clear.sunIntensity)
    expect(w(61).sunIntensity).toBeLessThan(w(3).sunIntensity)
    expect(w(45).sunIntensity).toBeLessThan(w(61).sunIntensity)
    expect(w(45).environment).toBeLessThan(clear.environment)
    expect(w(61).environment).toBeLessThan(clear.environment)
  })

  it('lights the street only after dark, and only when the record says the road is lit', () => {
    const night = { altitude: -20, azimuth: 300 }
    expect(lightingFor(ctx({ sun: night, road: road(true) })).lit).toBe(true)
    expect(lightingFor(ctx({ sun: night, road: road(false) })).lit).toBe(false)
    expect(lightingFor(ctx({ sun: night, road: road(null) })).lit).toBe(false)
    expect(lightingFor(ctx({ sun: night, road: null })).lit).toBe(false)
    expect(lightingFor(ctx({ sun: { altitude: 30, azimuth: 120 }, road: road(true) })).lit).toBe(false)
    // no sun in the record is not night: nothing says it was dark
    expect(lightingFor(ctx({ sun: null, road: road(true) }))).toMatchObject({ night: false, lit: false })
  })
})
