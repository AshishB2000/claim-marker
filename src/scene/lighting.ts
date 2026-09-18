/**
 * What the light was like at the moment of the accident, from the record alone — where the sun
 * stood, what the weather was doing, whether the street was lit — as the numbers the two
 * three.js scenes set their lights from: the car layer on the map and the damage studio. Both
 * read the same `Lighting`, so the marked-up car on the review page is lit like the map above
 * it. Pure, and free of three and maplibre, so `test/lighting.test.ts` runs in plain node.
 *
 * All of it is decoration keyed off stored facts. Nothing here moves a car, a mark or a word of
 * the document, and `lightingFor(null)` is exactly the fixed light the map has always had.
 */
import type { SceneContext } from '../claim/schema'
import { weatherOfCode } from './weather'

export type Vec3 = [number, number, number]

export type Lighting = {
  /** unit vector towards the sun in the map layer's frame — x east, y south, z up */
  sun: Vec3
  /** the record puts the sun up under a sky clear enough to cast one: a real shadow map, not the blob */
  shadows: boolean
  /** the key light: today's 1.5 at a high clear sun, a quarter of that at the horizon, off after it sets */
  sunIntensity: number
  sunColor: string
  /** the hemisphere light: sky above, ground below */
  sky: string
  ground: string
  skyIntensity: number
  /** how much of the environment map shows — the map's 0.3 and the studio's 0.9 scale by it */
  environment: number
  rain: boolean
  snow: boolean
  fog: boolean
  /** the sun more than 6° under the horizon, the same line `lightFrom` draws for "dark" */
  night: boolean
  /** after dark on a road the record says is lit: a warm pool under the incident */
  lit: boolean
}

// today's fixed light — (0.45, −0.6, 1) from the east-north-east, high — as a unit vector
const FIXED_SUN: Vec3 = [0.36, -0.48, 0.8]

const DAY = { sunColor: '#ffffff', sky: '#dfe8f5', ground: '#6b6f78', skyIntensity: 0.45, environment: 1 }
const DUSK = { sunColor: '#ffb072', sky: '#f2b07a', ground: '#5a4a48', skyIntensity: 0.5, environment: 0.6 }
const NIGHT = { sunColor: '#ffffff', sky: '#24304d', ground: '#0b0f1a', skyIntensity: 0.35, environment: 0.12 }

export const DEFAULT_LIGHTING: Lighting = {
  sun: FIXED_SUN,
  shadows: false,
  sunIntensity: 1.5,
  ...DAY,
  rain: false,
  snow: false,
  fog: false,
  night: false,
  lit: false,
}

/** the sky's altitude buckets: orange below 10°, blue below −6° — `lightFrom`'s dark line */
const DUSK_BELOW = 10
const NIGHT_BELOW = -6
/** full sun from this altitude up; below it the intensity falls linearly to a floor of a quarter */
const FULL_SUN_ABOVE = 25

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/**
 * How much of the sun the weather lets through, and whether what is left still casts a shadow.
 * Overcast (code 3) is the one code `weatherOfCode` folds into "cloudy" that has no shadows.
 */
function weatherDim(code: number | undefined): { dim: number; env: number; shadows: boolean } {
  if (code === undefined) return { dim: 1, env: 1, shadows: true }
  switch (weatherOfCode(code)) {
    case 'rain':
      return { dim: 0.25, env: 0.7, shadows: false }
    case 'snow':
      return { dim: 0.3, env: 0.8, shadows: false }
    case 'fog':
      return { dim: 0.15, env: 0.5, shadows: false }
    case 'cloudy':
      return code === 3 ? { dim: 0.5, env: 0.9, shadows: false } : { dim: 0.8, env: 1, shadows: true }
    default:
      return { dim: 1, env: 1, shadows: true }
  }
}

export function lightingFor(context: SceneContext | null): Lighting {
  if (!context) return DEFAULT_LIGHTING
  const code = context.weather?.code
  const word = code === undefined ? null : weatherOfCode(code)
  const weather = weatherDim(code)
  const sun = context.sun
  const altitude = sun?.altitude ?? null
  const night = altitude !== null && altitude < NIGHT_BELOW
  const palette = altitude === null || altitude >= DUSK_BELOW ? DAY : night ? NIGHT : DUSK
  const up = altitude !== null && altitude > 0

  let direction = FIXED_SUN
  if (sun && up) {
    const alt = (sun.altitude * Math.PI) / 180
    const az = (sun.azimuth * Math.PI) / 180
    direction = [Math.cos(alt) * Math.sin(az), -Math.cos(alt) * Math.cos(az), Math.sin(alt)]
  }
  // no sun in the record leaves the fixed light at full; a recorded one dims as it drops
  const height = altitude === null ? 1 : up ? clamp(altitude / FULL_SUN_ABOVE, 0.25, 1) : 0

  return {
    sun: direction,
    shadows: up && weather.shadows,
    sunIntensity: 1.5 * height * weather.dim,
    sunColor: palette.sunColor,
    sky: palette.sky,
    ground: palette.ground,
    skyIntensity: palette.skyIntensity,
    environment: palette.environment * weather.env,
    rain: word === 'rain',
    snow: word === 'snow',
    fog: word === 'fog',
    night,
    lit: night && context.road?.lit === true,
  }
}

/**
 * The studio takes the same sun and weather, with a floor: the marked-up car is the evidence
 * an adjuster reads, exported from this scene at send time, and a claim filed at night must
 * not ship a black car. Fractions of the studio's own key (1.1) and environment (0.9).
 */
export const STUDIO_KEY_FLOOR = 0.45
export const STUDIO_ENVIRONMENT_FLOOR = 0.4

export function studioLight(l: Lighting): { key: number; environment: number } {
  return { key: Math.max(STUDIO_KEY_FLOOR, l.sunIntensity / 1.5), environment: Math.max(STUDIO_ENVIRONMENT_FLOOR, l.environment) }
}
