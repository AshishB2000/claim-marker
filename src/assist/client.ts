/**
 * Calling the insurer's assist endpoint. The page holds no key and knows no model: it POSTs
 * `claim-assist/1` and reads the answer back. See `schema.ts` for the contract and
 * `scripts/assist-server.mjs` for an endpoint that satisfies it.
 */
import type { Claim, ClaimVehicle } from '../claim/schema'
import { paintLabel } from '../vehicles/paint'
import { zoneById } from '../zones'
import { toFrame } from './frame'
import {
  ASSIST_SCHEMA,
  parseScene,
  type AssistRequest,
  type AssistVehicle,
  type Metres,
  type Scene,
} from './schema'

const URL_: string | undefined = import.meta.env.VITE_ASSIST_URL

/** false when no endpoint is configured, and then nothing in the page mentions AI */
export const assistOn = !!URL_

const brief = (v: ClaimVehicle): AssistVehicle => ({
  id: v.id,
  role: v.role,
  body: v.body,
  color: paintLabel(v.color).toLowerCase(),
  make: v.make,
  model: v.model,
  year: v.year,
})

async function call<T>(body: AssistRequest, signal: AbortSignal | undefined, read: (json: unknown) => T): Promise<T> {
  if (!URL_) throw new Error('The assistant is not switched on for this page.')
  const res = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal })
  if (!res.ok) throw new Error(`The assistant could not answer (${res.status}). Please try again, or fill it in yourself.`)
  const json: unknown = await res.json()
  if (typeof json !== 'object' || json === null || (json as { schema?: unknown }).schema !== ASSIST_SCHEMA) {
    throw new Error('The assistant answered in a shape this page does not understand.')
  }
  return read(json)
}

/** The customer's words as a scene, in metres around the incident. Existing vehicles only. */
export async function buildDiagram(claim: Claim, signal?: AbortSignal): Promise<Scene> {
  const ids = claim.vehicles.map((v) => v.id)
  return call(
    {
      schema: ASSIST_SCHEMA,
      task: 'diagram',
      text: claim.incident.description,
      place: claim.incident.location?.address ?? '',
      vehicles: claim.vehicles.map(brief),
    },
    signal,
    (json) => parseScene((json as { scene?: unknown }).scene, ids),
  )
}

/** The diagram in words, for the customer to read, edit and confirm. */
export async function writeStatement(claim: Claim, signal?: AbortSignal): Promise<string> {
  const loc = claim.incident.location
  const centre = loc ? ([loc.lng, loc.lat] as const) : null
  const at = (p: [number, number] | null): Metres => (centre && p ? toFrame([centre[0], centre[1]], p) : [0, 0])
  return call(
    {
      schema: ASSIST_SCHEMA,
      task: 'describe',
      place: loc?.address ?? '',
      at: claim.incident.at,
      surface: claim.incident.surface,
      vehicles: claim.vehicles
        .filter((v) => v.position)
        .map((v) => ({
          ...brief(v),
          at: at(v.position),
          heading: v.heading,
          from: v.path.map(at),
          damage: v.damages.map((d) => `${zoneById(v.body, d.zone)?.label ?? d.zone} (${d.severity})`),
        })),
      impact: claim.impact ? at(claim.impact) : null,
    },
    signal,
    (json) => {
      const text = (json as { text?: unknown }).text
      if (typeof text !== 'string' || !text.trim()) throw new Error('The assistant sent nothing back.')
      return text.trim()
    },
  )
}
