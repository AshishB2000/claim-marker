/**
 * The scenario document: how the accident happened.
 *
 * A sibling of `claim-marker/1`, not a replacement. The marker schema is shipped and
 * versioned; breaking it would force a migration on consumers who never asked for a
 * scenario. This one embeds the marker's `Damage` shape per vehicle instead of redefining it.
 */
import { parseDamages, type Damage } from '../schema'
import { isVehicle, type Vehicle } from '../zones'
import { LAYOUTS, isLayout, type LayoutId, type Point2 } from './layouts'

export const SCENARIO_SCHEMA = 'claim-scenario/1'

export const ROLES = ['insured', 'other'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_COLOR: Record<Role, string> = { insured: '#2563eb', other: '#f59e0b' }
export const ROLE_LABEL: Record<Role, string> = { insured: 'Insured', other: 'Other party' }

export type ScenarioVehicle = {
  id: string
  role: Role
  body: Vehicle
  /** where it came to rest, ground plane [x, z] in metres */
  position: Point2
  /** Y-rotation in radians; nose at +Z when 0 */
  heading: number
  /** the approach, in travel order. The arrow is drawn through [...path, position]. */
  path: Point2[]
  /** in this vehicle's own local frame, exactly as `claim-marker/1` records them */
  damages: Damage[]
}

export type ScenarioValue = {
  schema: typeof SCENARIO_SCHEMA
  layout: LayoutId
  vehicles: ScenarioVehicle[]
  impact: Point2 | null
  note: string
}

const mm = (n: number) => Math.round(n * 1000) / 1000
const rad = (n: number) => Math.round(n * 10000) / 10000
export const roundPoint = ([x, z]: Point2): Point2 => [mm(x), mm(z)]
const pt = roundPoint

const isPoint2 = (v: unknown): v is Point2 =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n))

export const emptyScenario = (layout: LayoutId = 'intersection'): ScenarioValue => ({
  schema: SCENARIO_SCHEMA,
  layout,
  vehicles: [],
  impact: null,
  note: '',
})

/** normalise one vehicle so that export → load → export is byte-identical */
export const scenarioVehicle = (v: ScenarioVehicle): ScenarioVehicle => ({
  id: v.id,
  role: v.role,
  body: v.body,
  position: pt(v.position),
  heading: rad(v.heading),
  path: v.path.map(pt),
  damages: v.damages,
})

/** a fresh pair of vehicles placed on the correct side of the road for this layout */
export function seedVehicles(layout: LayoutId): ScenarioVehicle[] {
  return LAYOUTS[layout].spawns.map((spawn, i) => {
    const id = String.fromCharCode(97 + i) // a, b
    return scenarioVehicle({
      id,
      role: i === 0 ? 'insured' : 'other',
      body: i === 0 ? 'sedan' : 'suv',
      position: spawn.position,
      heading: spawn.heading,
      path: [approach(spawn.position, spawn.heading, 9)],
      damages: [],
    })
  })
}

/** a point `back` metres behind a pose, so a new vehicle shows a travel arrow immediately */
export const approach = ([x, z]: Point2, heading: number, back: number): Point2 => [
  mm(x - Math.sin(heading) * back),
  mm(z - Math.cos(heading) * back),
]

/**
 * Validate host-supplied JSON. Structural problems throw; a single malformed vehicle is
 * dropped rather than losing the rest of the diagram.
 */
export function parseScenario(input: unknown): { value: ScenarioValue; rejected: number } {
  if (typeof input !== 'object' || input === null) throw new TypeError('claim-scenario: expected an object')
  const raw = input as Record<string, unknown>
  if (raw.schema !== SCENARIO_SCHEMA) {
    throw new TypeError(`claim-scenario: expected schema "${SCENARIO_SCHEMA}", got ${JSON.stringify(raw.schema)}`)
  }
  if (!isLayout(raw.layout)) throw new TypeError(`claim-scenario: unknown layout ${JSON.stringify(raw.layout)}`)
  if (raw.vehicles !== undefined && !Array.isArray(raw.vehicles)) {
    throw new TypeError('claim-scenario: vehicles must be an array')
  }

  const vehicles: ScenarioVehicle[] = []
  let rejected = 0
  for (const entry of (raw.vehicles ?? []) as unknown[]) {
    const v = entry as Record<string, unknown>
    const ok =
      typeof v === 'object' &&
      v !== null &&
      typeof v.id === 'string' &&
      v.id.length > 0 &&
      isVehicle(v.body) &&
      isPoint2(v.position) &&
      typeof v.heading === 'number' &&
      Number.isFinite(v.heading) &&
      (v.path === undefined || (Array.isArray(v.path) && v.path.every(isPoint2)))
    if (!ok) {
      rejected++
      continue
    }
    vehicles.push(
      scenarioVehicle({
        id: v.id as string,
        role: (ROLES as readonly string[]).includes(v.role as string) ? (v.role as Role) : 'other',
        body: v.body as Vehicle,
        position: v.position as Point2,
        heading: v.heading as number,
        path: (v.path ?? []) as Point2[],
        damages: parseDamages(v.body as Vehicle, v.damages ?? []).damages,
      }),
    )
  }

  return {
    value: {
      schema: SCENARIO_SCHEMA,
      layout: raw.layout,
      vehicles,
      impact: isPoint2(raw.impact) ? pt(raw.impact) : null,
      note: typeof raw.note === 'string' ? raw.note : '',
    },
    rejected,
  }
}
