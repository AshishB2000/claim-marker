/**
 * Calling the insurer's assist endpoint. The page holds no key and knows no model: it POSTs
 * `claim-assist/1` and reads the answer back. See `schema.ts` for the contract and
 * `scripts/assist-server.mjs` for an endpoint that satisfies it.
 */
import type { Claim, ClaimVehicle } from '../claim/schema'
import { config } from '../config'
import type { Damage } from '../schema'
import { paintLabel } from '../vehicles/paint'
import { zoneById, zonesOf } from '../zones'
import { toFrame } from './frame'
import {
  ASSIST_SCHEMA,
  parseChecks,
  parseScene,
  parseSuggestions,
  type AssistRequest,
  type AssistVehicle,
  type Check,
  type CheckVehicle,
  type Metres,
  type Scene,
} from './schema'

/** the most photographs one damage run sends; twelve of the same bumper is not twelve views */
const MAX_PHOTOS_SENT = 6

/** false when no endpoint is configured, and then nothing in the page mentions AI */
export const assistOn = () => !!config.assistUrl

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
  const url = config.assistUrl
  if (!url) throw new Error('The assistant is not switched on for this page.')
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal })
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

/** everything in the claim that has a position, in metres around the incident */
function placed(claim: Claim) {
  const loc = claim.incident.location
  const centre: [number, number] | null = loc ? [loc.lng, loc.lat] : null
  const at = (p: [number, number] | null): Metres => (centre && p ? toFrame(centre, p) : [0, 0])
  const marks = (v: ClaimVehicle) => v.damages.map((d) => `${zoneById(v.body, d.zone)?.label ?? d.zone} (${d.severity})`)
  return {
    place: loc?.address ?? '',
    impact: claim.impact ? at(claim.impact) : null,
    vehicles: claim.vehicles.map((v) => ({
      ...brief(v),
      at: v.position ? at(v.position) : null,
      heading: v.heading,
      from: v.path.map(at),
      damage: marks(v),
    })),
  }
}

/** The diagram in words, for the customer to read, edit and confirm. */
export async function writeStatement(claim: Claim, signal?: AbortSignal): Promise<string> {
  const scene = placed(claim)
  return call(
    {
      schema: ASSIST_SCHEMA,
      task: 'describe',
      place: scene.place,
      at: claim.incident.at,
      surface: claim.incident.surface,
      vehicles: scene.vehicles.filter((v) => v.at).map((v) => ({ ...v, at: v.at! })),
      impact: scene.impact,
    },
    signal,
    (json) => {
      const text = (json as { text?: unknown }).text
      if (typeof text !== 'string' || !text.trim()) throw new Error('The assistant sent nothing back.')
      return text.trim()
    },
  )
}

/**
 * The finished report read back: what an adjuster would ring up about. Identity and contact
 * details are left out on the way — see `CheckRequest` — so what goes over the wire is the
 * shape of the accident and nothing that names anyone.
 */
export async function checkReport(claim: Claim, signal?: AbortSignal): Promise<Check[]> {
  const scene = placed(claim)
  const vehicles: CheckVehicle[] = scene.vehicles.map((v) => {
    const full = claim.vehicles.find((x) => x.id === v.id)!
    return { ...v, drivable: full.condition.drivable, airbags: full.condition.airbags, towed: full.condition.towed }
  })
  return call(
    {
      schema: ASSIST_SCHEMA,
      task: 'check',
      kind: claim.incident.kind,
      at: claim.incident.at,
      place: scene.place,
      surface: claim.incident.surface,
      conditions: claim.incident.conditions,
      description: claim.incident.description,
      vehicles,
      people: claim.people.map((p) => ({ role: p.role, vehicle: p.vehicle, self: p.self, injured: p.injured, injury: p.injury })),
      police: { called: claim.police.called, citations: claim.police.citations },
      property: claim.property.description,
      impact: scene.impact,
      photos: claim.attachments.photos.length,
    },
    signal,
    (json) => parseChecks((json as { checks?: unknown }).checks),
  )
}

/** The photographs of one vehicle, back as marks on its own panels, ready to add. */
export async function damageFromPhotos(claim: Claim, vehicleId: string, signal?: AbortSignal): Promise<Damage[]> {
  const v = claim.vehicles.find((x) => x.id === vehicleId)
  if (!v) throw new Error('The assistant was asked about a vehicle that is not in this report.')
  const photos = claim.attachments.photos.filter((p) => p.of === vehicleId).slice(0, MAX_PHOTOS_SENT)
  if (!photos.length) throw new Error('There are no photos of this vehicle to look at.')
  return call(
    {
      schema: ASSIST_SCHEMA,
      task: 'damage',
      vehicle: v.body,
      zones: zonesOf(v.body).map((z) => ({ id: z.id, label: z.label })),
      photos: photos.map((p) => p.data),
    },
    signal,
    (json) => parseSuggestions((json as { damages?: unknown }).damages, v.body),
  )
}
