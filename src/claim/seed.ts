/**
 * What the other driver's page starts from.
 *
 * At the scene the customer shows a QR code; the other driver scans it and gives their own
 * account on their own phone. To do that their page needs the few facts both accounts must
 * share — where, when, what ground to draw it on, and roughly what the other vehicles look
 * like — and it must need **nothing else**, because the other driver is a stranger and the
 * first report is not theirs to read.
 *
 * So the seed carries no names, no phone numbers, no licences, no plates, no VINs, no people,
 * no damage, no description, no photographs and no reference. The server stores only these
 * keys, and this parses only these keys, so the two agree from both ends; a test walks a seed
 * built out of a whole claim and fails on anything else surviving. Same rule as
 * `parsePrefill`: what arrives from outside is parsed, never trusted.
 */
import { isSurface, isHex, type Location, type Surface } from './schema'
import { isVehicle, type Vehicle } from '../zones'

/** the shape of one of the inviting customer's vehicles, as the other driver may see it */
export type SeedVehicle = { body: Vehicle; color: string; make: string; model: string }

export type IncidentSeed = {
  location: Location | null
  at: string
  utcOffset: number | null
  surface: Surface
  vehicles: SeedVehicle[]
}

/** the same cap the document uses for a party's own list */
export const MAX_SEED_VEHICLES = 6
const MAX_NAME = 60

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {})
const str = (v: unknown, cap = MAX_NAME) => (typeof v === 'string' ? v.trim().slice(0, cap) : '')

/** what the page sends when it invites the other driver: the shared facts and nothing else */
export function seedOf(incident: { location: Location | null; at: string; utcOffset: number | null; surface: Surface }, vehicles: SeedVehicle[]): IncidentSeed {
  return {
    location: incident.location ? { lng: incident.location.lng, lat: incident.location.lat, address: incident.location.address } : null,
    at: incident.at,
    utcOffset: incident.utcOffset,
    surface: incident.surface,
    vehicles: vehicles.slice(0, MAX_SEED_VEHICLES).map((v) => ({ body: v.body, color: v.color, make: str(v.make), model: str(v.model) })),
  }
}

/** read a seed back, dropping anything malformed and anything that is not one of these keys */
export function parseSeed(input: unknown): IncidentSeed | null {
  const s = obj(input)
  const loc = obj(s.location)
  const lng = loc.lng
  const lat = loc.lat
  const at = typeof s.at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s.at) ? s.at : ''
  if (!at) return null
  return {
    location:
      typeof lng === 'number' && typeof lat === 'number' && Math.abs(lng) <= 180 && Math.abs(lat) <= 90
        ? { lng, lat, address: str(loc.address, 200) }
        : null,
    at,
    utcOffset: typeof s.utcOffset === 'number' && Number.isFinite(s.utcOffset) && Math.abs(s.utcOffset) <= 960 ? Math.round(s.utcOffset) : null,
    surface: isSurface(s.surface) ? s.surface : 'satellite',
    vehicles: (Array.isArray(s.vehicles) ? s.vehicles : [])
      .map(obj)
      .filter((v) => isVehicle(v.body) && isHex(v.color))
      .slice(0, MAX_SEED_VEHICLES)
      .map((v) => ({ body: v.body as Vehicle, color: (v.color as string).toLowerCase(), make: str(v.make), model: str(v.model) })),
  }
}
