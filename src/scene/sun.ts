/**
 * Where the sun was at the instant of the accident, and whether it was in a driver's eyes —
 * "the sun was low and in your face" is a fact a photograph rarely proves but the clock and the
 * map already know.
 *
 * `sunPosition` is the NOAA solar-position approximation: the same maths behind NOAA's own
 * solar calculator and its published sunrise/sunset tables (equation of center, apparent
 * longitude, obliquity correction, equation of time — see the comments inline). It is accurate
 * to a few hundredths of a degree away from the horizon, degrading to a few tenths of a degree
 * right at it, which is far more than "the sun was low and behind you" needs. Deliberately not
 * done: atmospheric refraction. A real horizon bends light by up to ~0.5° (more right at the
 * rim, essentially none overhead), which is why a geometric altitude this file reports as, say,
 * -0.3° can already be visible to an observer — the cost of skipping it is a few tenths of a
 * degree of slop exactly where `lightFrom`'s dusk/dark boundary sits, never more.
 */
import type { SceneSun } from '../claim/schema'
import { LIGHT } from '../claim/schema'
import { normalizeBearing, toDeg, toRad, type LngLat } from '../geo'

export type Light = (typeof LIGHT)[number]

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

// the Julian day of the Unix epoch (1970-01-01T00:00:00Z), so instantMs converts in one line
const JULIAN_DAY_AT_UNIX_EPOCH = 2440587.5
const MS_PER_DAY = 86_400_000
const MINUTES_PER_DAY = 1440

/**
 * The sun's altitude (degrees above the horizon, negative below) and azimuth (degrees clockwise
 * from north) at `instantMs` (epoch ms, UTC) as seen from `at`. Pure and synchronous — no
 * atlas, no network, just the date and a position, which is all the algorithm needs.
 */
export function sunPosition(instantMs: number, at: LngLat): SceneSun {
  const [lng, lat] = at

  // Julian centuries since J2000.0 (2000-01-01T12:00 UTC): the time variable every term below
  // is a polynomial in
  const jd = instantMs / MS_PER_DAY + JULIAN_DAY_AT_UNIX_EPOCH
  const t = (jd - 2451545.0) / 36525.0

  // geometric mean longitude and anomaly of the sun, degrees
  const meanLong = normalizeBearing(280.46646 + t * (36000.76983 + t * 0.0003032))
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t)
  const meanAnomalyRad = toRad(meanAnomaly)

  // Earth's orbital eccentricity, and the equation of center (degrees) it produces — the
  // difference between where the sun would be on a circular orbit and where it actually is
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
  const center =
    Math.sin(meanAnomalyRad) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * meanAnomalyRad) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * meanAnomalyRad) * 0.000289

  const trueLong = meanLong + center
  // apparent longitude: true longitude corrected for the ~20" aberration of light and the
  // nutation of Earth's axis, both folded into this one small term
  const omega = 125.04 - 1934.136 * t
  const apparentLong = trueLong - 0.00569 - 0.00478 * Math.sin(toRad(omega))

  // obliquity of the ecliptic (Earth's axial tilt), mean plus the same nutation correction
  const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
  const obliquity = meanObliquity + 0.00256 * Math.cos(toRad(omega))

  const declination = Math.asin(Math.sin(toRad(obliquity)) * Math.sin(toRad(apparentLong)))

  // equation of time, in minutes: how far a sundial reads from a clock, from the orbit's
  // eccentricity and the tilt both distorting the sun's apparent rate of travel through the year
  const y = Math.tan(toRad(obliquity) / 2) ** 2
  const eqTimeMinutes =
    4 *
    toDeg(
      y * Math.sin(2 * toRad(meanLong)) -
        2 * eccentricity * Math.sin(meanAnomalyRad) +
        4 * eccentricity * y * Math.sin(meanAnomalyRad) * Math.cos(2 * toRad(meanLong)) -
        0.5 * y * y * Math.sin(4 * toRad(meanLong)) -
        1.25 * eccentricity * eccentricity * Math.sin(2 * meanAnomalyRad),
    )

  // minutes since UTC midnight of instantMs's own day, wrapped positive for dates before 1970
  const utcMinutes = (((instantMs / 60_000) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  const trueSolarMinutes = (((utcMinutes + eqTimeMinutes + 4 * lng) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY

  // hour angle: 0 at true solar noon, ±180 at true solar midnight, negative in the morning
  let hourAngle = trueSolarMinutes / 4 - 180
  if (hourAngle < -180) hourAngle += 360

  const latRad = toRad(lat)
  const hourAngleRad = toRad(hourAngle)
  const cosZenith = clamp(
    Math.sin(latRad) * Math.sin(declination) + Math.cos(latRad) * Math.cos(declination) * Math.cos(hourAngleRad),
    -1,
    1,
  )
  const zenith = Math.acos(cosZenith)
  const altitude = 90 - toDeg(zenith)

  // right at the zenith the azimuth formula divides by (near) zero — the sun is straight up and
  // "which way is it" stops meaning anything, so NOAA's own algorithm falls back to a fixed
  // direction there rather than let the division blow up
  const azimuthDenominator = Math.cos(latRad) * Math.sin(zenith)
  let azimuth: number
  if (Math.abs(azimuthDenominator) > 0.001) {
    const azimuthCos = clamp((Math.sin(latRad) * Math.cos(zenith) - Math.sin(declination)) / azimuthDenominator, -1, 1)
    azimuth = 180 - toDeg(Math.acos(azimuthCos))
    if (hourAngle > 0) azimuth = -azimuth
  } else {
    azimuth = lat > 0 ? 180 : 0
  }

  return { altitude, azimuth: normalizeBearing(azimuth) }
}

/**
 * The claim's four-way light bucket from the sun's altitude, and — once it's dark — whether the
 * road was lit. `lit` is the OSM street-lighting tag the road lookup supplies.
 *
 * **Null when it is dark and the record does not say.** Most streets carry no `lit` tag at all —
 * West 44th Street, a hundred metres from Times Square, is one — so reading "unknown" as "unlit"
 * told a customer in the brightest square on earth that there were no street lights. The lookup
 * fills only what it actually knows: after dark with no tag, the light select is left for the
 * customer, and the card still says it was after dark from the sun alone.
 */
export function lightFrom(altitude: number, lit: boolean | null): Light | null {
  if (altitude > 6) return 'daylight'
  if (altitude >= -6) return 'dusk'
  if (lit === null) return null
  return lit ? 'dark_lit' : 'dark_unlit'
}

/**
 * True when a low sun sits ahead of the driver rather than beside or behind them — the one
 * combination that plausibly blinded them. "Low" is 0–25° of altitude (below 0° it is below the
 * horizon and gone; above 25° a windshield visor handles it); "ahead" is within 25° either side
 * of the vehicle's heading, wrapped through 0/360 with `normalizeBearing` rather than plain
 * subtraction, which would call 350° and 10° thirty degrees apart instead of the twenty they are.
 */
export function glare(sun: SceneSun, heading: number): boolean {
  if (sun.altitude <= 0 || sun.altitude >= 25) return false
  const delta = normalizeBearing(sun.azimuth - heading)
  return Math.min(delta, 360 - delta) <= 25
}
