/** The product: a versioned, self-describing damage report. */
import { isVehicle, zonesOf, type V3, type Vehicle, type ZoneId } from './zones'

export const SCHEMA = 'claim-marker/1'

export const SEVERITIES = ['scratch', 'dent', 'crack', 'missing'] as const
export type Severity = (typeof SEVERITIES)[number]

export const SEVERITY_COLOR: Record<Severity, string> = {
  scratch: '#eab308',
  dent: '#f97316',
  crack: '#ef4444',
  missing: '#7c3aed',
}

export type Damage = {
  zone: ZoneId
  point: V3
  severity: Severity
  note: string
}

export type ClaimValue = {
  schema: typeof SCHEMA
  vehicle: Vehicle
  damages: Damage[]
}

/** millimetre precision is plenty, and rounding once keeps export → load → export identical */
const round = (n: number) => Math.round(n * 1000) / 1000

export const damage = (zone: ZoneId, point: V3, severity: Severity, note = ''): Damage => ({
  zone,
  point: [round(point[0]), round(point[1]), round(point[2])],
  severity,
  note,
})

export const emptyValue = (vehicle: Vehicle = 'sedan'): ClaimValue => ({
  schema: SCHEMA,
  vehicle,
  damages: [],
})

const isV3 = (v: unknown): v is V3 =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n))

/**
 * Validate a damage list for one vehicle. A single malformed entry is dropped rather than
 * losing the other twenty, and the count comes back so a caller can surface it.
 *
 * Shared with the scenario schema, which embeds one of these per vehicle.
 */
export function parseDamages(vehicle: Vehicle, input: unknown): { damages: Damage[]; rejected: number } {
  // zone sets differ per body — a pickup has no rear doors — so validate against this
  // vehicle's own zones rather than the union of every body's
  const known = new Set<string>(zonesOf(vehicle).map((z) => z.id))
  const damages: Damage[] = []
  let rejected = 0
  for (const entry of Array.isArray(input) ? (input as unknown[]) : []) {
    const d = entry as Record<string, unknown>
    const ok =
      typeof d === 'object' &&
      d !== null &&
      typeof d.zone === 'string' &&
      known.has(d.zone) &&
      isV3(d.point) &&
      typeof d.severity === 'string' &&
      (SEVERITIES as readonly string[]).includes(d.severity)
    if (!ok) {
      rejected++
      continue
    }
    damages.push(
      damage(d.zone as ZoneId, d.point as V3, d.severity as Severity, typeof d.note === 'string' ? d.note : ''),
    )
  }
  return { damages, rejected }
}

/**
 * Validate host-supplied JSON. Structural problems throw — "you handed me the wrong object"
 * should be loud — but individual damages degrade gracefully, see parseDamages.
 */
export function parse(input: unknown): { value: ClaimValue; rejected: number } {
  if (typeof input !== 'object' || input === null) throw new TypeError('claim-marker: expected an object')
  const raw = input as Record<string, unknown>
  if (raw.schema !== SCHEMA) throw new TypeError(`claim-marker: expected schema "${SCHEMA}", got ${JSON.stringify(raw.schema)}`)
  if (!isVehicle(raw.vehicle)) throw new TypeError(`claim-marker: unknown vehicle ${JSON.stringify(raw.vehicle)}`)
  if (raw.damages !== undefined && !Array.isArray(raw.damages)) throw new TypeError('claim-marker: damages must be an array')

  const { damages, rejected } = parseDamages(raw.vehicle, raw.damages ?? [])
  return { value: { schema: SCHEMA, vehicle: raw.vehicle, damages }, rejected }
}
