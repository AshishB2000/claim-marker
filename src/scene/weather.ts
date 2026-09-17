/**
 * The weather at the hour of the incident, looked up from the place and the time rather than
 * typed by the customer. Open-Meteo is keyless and CORS-open, so this runs straight from the
 * browser like the geocoder in `src/geocode.ts` — same pattern, same reason: no key to hide,
 * so nothing needs to sit behind the page's own server.
 *
 * Two of its endpoints are used, picked by how old the incident is: `forecast` keeps a rolling
 * window of recent history (`past_days`) but not much of it, while `archive` holds the full
 * record back to 1940 but only backfills a location a few days after the fact. Five days is a
 * safe margin between "still in the forecast API's window" and "archive has definitely caught
 * up", not a boundary Open-Meteo documents precisely.
 */
import type { SceneWeather } from '../claim/schema'
import { ROAD, WEATHER } from '../claim/schema'
import type { LngLat } from '../geo'

type Weather = (typeof WEATHER)[number]
type Road = (typeof ROAD)[number]

// build-time provider settings, exactly like the tile and geocoder URLs: an insurer can point
// these at their own instance, but which one to call is never a per-request decision
const FORECAST_URL = import.meta.env.VITE_WEATHER_URL ?? 'https://api.open-meteo.com/v1/forecast'
const ARCHIVE_URL = import.meta.env.VITE_WEATHER_ARCHIVE_URL ?? 'https://archive-api.open-meteo.com/v1/archive'

const HOURLY_VARS = 'weather_code,precipitation,temperature_2m,wind_speed_10m,cloud_cover'

/**
 * The chosen hour, plus enough of what came before it for the road-state rules in
 * `toConditions`: whether it was raining or below freezing in the two hours leading up to the
 * incident, not just at the instant of it. `prevPrecipMm`/`prevTempC` are oldest first (two
 * hours before, then one hour before).
 */
export type HourlyWeather = {
  code: number
  tempC: number
  precipMm: number
  windKph: number
  cloudPct: number
  prevPrecipMm: [number, number]
  prevTempC: [number, number]
  /** `utc_offset_seconds` from the response, converted once so nothing downstream repeats the /60 */
  utcOffsetMinutes: number
}

function numAt(hourly: Record<string, unknown>, key: string, index: number): number | undefined {
  const arr = hourly[key]
  if (!Array.isArray(arr)) return undefined
  const v = arr[index]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/**
 * Pure: no network. `at` is the form's local `YYYY-MM-DDTHH:mm`, and with `timezone=auto`
 * Open-Meteo's `hourly.time` is already an array of local timestamps in that same zone — so
 * the hour is found by matching the string truncated to the hour, not by parsing it as an
 * instant and redoing the timezone arithmetic Open-Meteo already did.
 *
 * Every field is read defensively: the endpoint is trusted for shape (it is ours to configure)
 * but not for content, the same stance `assist/schema.ts` takes with the assistant's answers.
 * A missing hour, a malformed payload, or a non-finite value at the chosen hour all come back
 * null; a missing *preceding* hour does not — see below.
 */
export function parseWeather(json: unknown, at: string): HourlyWeather | null {
  if (typeof json !== 'object' || json === null) return null
  const root = json as Record<string, unknown>
  if (typeof root.hourly !== 'object' || root.hourly === null) return null
  const hourly = root.hourly as Record<string, unknown>
  if (!Array.isArray(hourly.time)) return null

  const i = hourly.time.indexOf(`${at.slice(0, 13)}:00`)
  if (i < 0) return null

  const code = numAt(hourly, 'weather_code', i)
  const tempC = numAt(hourly, 'temperature_2m', i)
  const precipMm = numAt(hourly, 'precipitation', i)
  const windKph = numAt(hourly, 'wind_speed_10m', i)
  const cloudPct = numAt(hourly, 'cloud_cover', i)
  if (code === undefined || tempC === undefined || precipMm === undefined || windKph === undefined || cloudPct === undefined) return null

  // near the edge of the fetched range (the incident was within an hour or two of local
  // midnight, where the archive call's day starts) there may be no data before the chosen
  // hour at all. Treating that as "no rain, same temperature" is the least alarming reading
  // and keeps a valid hour from being thrown away for something the road rules can do without.
  const prevPrecipMm: [number, number] = [numAt(hourly, 'precipitation', i - 2) ?? 0, numAt(hourly, 'precipitation', i - 1) ?? 0]
  const prevTempC: [number, number] = [numAt(hourly, 'temperature_2m', i - 2) ?? tempC, numAt(hourly, 'temperature_2m', i - 1) ?? tempC]

  const offset = root.utc_offset_seconds
  const utcOffsetMinutes = typeof offset === 'number' && Number.isFinite(offset) ? offset / 60 : 0

  return { code, tempC, precipMm, windKph, cloudPct, prevPrecipMm, prevTempC, utcOffsetMinutes }
}

const isSnowCode = (code: number) => (code >= 71 && code <= 77) || code === 85 || code === 86

function weatherFromCode(code: number, cloudPct: number): Weather {
  if (code === 0 || code === 1) return 'clear'
  if (code === 2 || code === 3) return 'cloudy'
  if (code === 45 || code === 48) return 'fog'
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || (code >= 95 && code <= 99)) return 'rain'
  if (isSnowCode(code)) return 'snow'
  // an unlisted code (Open-Meteo adds them rarely) falls back to how much sky is covered
  // rather than defaulting to "clear", which would be a claim of good visibility this data
  // does not support
  return cloudPct > 60 ? 'cloudy' : 'clear'
}

/**
 * The claim's own condition enums, derived rather than guessed at by the customer. `weather`
 * always comes from the WMO code; `road` needs the two hours before too, because a road stays
 * wet after rain stops and a snow code should say "snow" outright rather than "wet at 0°C".
 */
export function toConditions(w: HourlyWeather): { weather: Weather; road: Road } {
  const weather = weatherFromCode(w.code, w.cloudPct)
  const recentPrecip = w.precipMm > 0 || w.prevPrecipMm[0] > 0 || w.prevPrecipMm[1] > 0
  const road: Road = isSnowCode(w.code) ? 'snow' : w.tempC <= 0 && recentPrecip ? 'icy' : recentPrecip ? 'wet' : 'dry'
  return { weather, road }
}

// short plain-English words for the WMO codes Open-Meteo actually returns (the official list
// tops out at 99); this is `SceneWeather.label`, read by an adjuster, not translated — see
// the note in `src/i18n/` about what stays English on purpose
const CODE_LABEL: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Dense drizzle',
  56: 'Light freezing drizzle',
  57: 'Freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Light rain showers',
  81: 'Rain showers',
  82: 'Heavy rain showers',
  85: 'Light snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Thunderstorm with heavy hail',
}

export function weatherLabel(code: number): string {
  return CODE_LABEL[code] ?? 'Unknown'
}

export function toSceneWeather(w: HourlyWeather): SceneWeather {
  return { code: w.code, label: weatherLabel(w.code), tempC: w.tempC, precipMm: w.precipMm, windKph: w.windKph }
}

/**
 * The only impure function here. Resolves to null on any failure — network, non-2xx, a body
 * that `parseWeather` cannot read, or an abort — because a customer's report is not blocked on
 * a weather lookup: `assist/client.ts` and `geocode.ts` take the same stance with their own
 * endpoints. An `AbortError` from a caller-supplied `signal` is a failure like any other here,
 * not something to rethrow, so callers that abort on every keystroke never need a try/catch.
 */
export async function fetchWeather(at: LngLat, when: string, signal?: AbortSignal): Promise<HourlyWeather | null> {
  const [lng, lat] = at
  const day = when.slice(0, 10)

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 5)
  const isOld = day < cutoff.toISOString().slice(0, 10)

  const params = new URLSearchParams({ latitude: String(lat), longitude: String(lng), hourly: HOURLY_VARS, timezone: 'auto' })
  let url: string
  if (isOld) {
    params.set('start_date', day)
    params.set('end_date', day)
    url = `${ARCHIVE_URL}?${params}`
  } else {
    // forecast_days=1 is "today"; past_days=7 reaches back far enough that even an incident
    // from first thing this morning still has its two preceding hours in the response
    params.set('past_days', '7')
    params.set('forecast_days', '1')
    url = `${FORECAST_URL}?${params}`
  }

  try {
    const res = await fetch(url, { signal })
    if (!res.ok) return null
    const json: unknown = await res.json()
    return parseWeather(json, when)
  } catch {
    return null
  }
}
