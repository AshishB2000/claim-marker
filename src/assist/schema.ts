/**
 * The contract between this page and whatever the insurer runs in front of Claude.
 *
 * One endpoint, `VITE_ASSIST_URL`, two tasks: `diagram` turns the customer's words into a
 * scene, `describe` turns the scene back into words. JSON in, JSON out, versioned, so an
 * insurer implements one route and can move from the Anthropic API to Bedrock, Vertex or
 * their own gateway without this page changing. The API key lives there and never here:
 * anything in this bundle is public. With the variable unset the page has no AI in it.
 *
 * Positions are **metres east and north of the incident**, not longitude and latitude: a
 * model reasons about "six metres back from the junction" and cannot do spherical arithmetic,
 * so the conversion is this page's job (`frame.ts`). Headings are compass bearings.
 */
import { normalizeBearing } from '../geo'
import type { Role, Surface } from '../claim/schema'
import type { Vehicle } from '../zones'

export const ASSIST_SCHEMA = 'claim-assist/1'

export type AssistTask = 'diagram' | 'describe'

/** metres [east, north] of the incident */
export type Metres = [number, number]

/** the scene must fit the diagram; the drawn grounds are 200 m across for the same reason */
export const RANGE = 200
/** a route with more bends than this is noise, not a route */
export const MAX_PATH = 12

/** what the endpoint is told about a vehicle. No plate: the model has no use for it. */
export type AssistVehicle = {
  id: string
  role: Role
  body: Vehicle
  /** the colour by name — "black", "red" — which is how a description says it */
  color: string
  make: string
  model: string
  year: number | null
}

/** a vehicle placed in the scene, plus the route it took in travel order */
export type ScenePose = {
  id: string
  at: Metres
  /** compass bearing of the nose, degrees clockwise from north */
  heading: number
  from: Metres[]
}

export type Scene = {
  vehicles: ScenePose[]
  impact: Metres | null
  /** one line back to the customer: what it understood, or what it could not place */
  note: string
}

export type DiagramRequest = {
  schema: typeof ASSIST_SCHEMA
  task: 'diagram'
  /** what the customer wrote or dictated */
  text: string
  /** the address, so "the junction" and "the car park entrance" mean something */
  place: string
  vehicles: AssistVehicle[]
}

export type DescribeRequest = {
  schema: typeof ASSIST_SCHEMA
  task: 'describe'
  place: string
  /** local date and time, as the form holds it */
  at: string
  surface: Surface
  vehicles: (AssistVehicle & ScenePose & { damage: string[] })[]
  impact: Metres | null
}

export type AssistRequest = DiagramRequest | DescribeRequest

export type DiagramResponse = { schema: typeof ASSIST_SCHEMA; task: 'diagram'; scene: Scene }
export type DescribeResponse = { schema: typeof ASSIST_SCHEMA; task: 'describe'; text: string }

const isMetres = (v: unknown): v is Metres =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= RANGE)

/**
 * Validate a scene that came back over the wire.
 *
 * A model's answer is input, not data: a vehicle that is malformed, out of range or not one
 * of `ids` is dropped rather than trusted, the same way `parseClaim` drops a bad vehicle
 * instead of losing the claim. Throws only when the whole answer is the wrong shape.
 */
export function parseScene(input: unknown, ids: readonly string[]): Scene {
  if (typeof input !== 'object' || input === null) throw new TypeError('assist: expected a scene object')
  const raw = input as Record<string, unknown>
  const vehicles: ScenePose[] = []
  const seen = new Set<string>()
  for (const entry of Array.isArray(raw.vehicles) ? raw.vehicles : []) {
    const v = entry as Record<string, unknown>
    if (typeof v?.id !== 'string' || !ids.includes(v.id) || seen.has(v.id)) continue
    if (!isMetres(v.at)) continue
    if (typeof v.heading !== 'number' || !Number.isFinite(v.heading)) continue
    seen.add(v.id)
    vehicles.push({
      id: v.id,
      at: v.at,
      heading: Math.round(normalizeBearing(v.heading)) % 360,
      from: (Array.isArray(v.from) ? v.from : []).filter(isMetres).slice(0, MAX_PATH),
    })
  }
  return {
    vehicles,
    impact: isMetres(raw.impact) ? raw.impact : null,
    note: typeof raw.note === 'string' ? raw.note.trim().slice(0, 300) : '',
  }
}
