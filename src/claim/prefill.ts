/**
 * What the insurer's portal already knows about the customer, handed to the page at runtime
 * so the person who just crashed is not asked to type their own policy number: who they are,
 * how to reach them, and the vehicles on the policy. One vehicle fills the card; several
 * become a "which of your vehicles?" pick on the vehicles step.
 *
 * It arrives across a trust boundary (postMessage from the host page, or a global the host
 * set), so it is parsed, not trusted: strings are trimmed and capped, a body must be one of
 * the seven, a colour must be a hex, and anything else is dropped rather than failing.
 * Prefill only ever fills what is empty; a field the customer has typed is theirs.
 */
import { isHex, type Claim, type ClaimVehicle, type Reporter } from './schema'
import { isVehicle, type Vehicle } from '../zones'
import { guessBody } from '../vehicles/catalog'

export type PrefillVehicle = {
  make?: string
  model?: string
  year?: number
  plate?: string
  plateState?: string
  vin?: string
  /** paint as #rrggbb */
  color?: string
  body?: Vehicle
}

export type Prefill = {
  reporter?: Partial<Pick<Reporter, 'name' | 'phone' | 'email' | 'policy' | 'policyholder'>>
  /** the vehicles on the policy, the first being the default */
  vehicles?: PrefillVehicle[]
}

/** the most vehicles a policy is taken to carry; beyond that it is a fleet, not a family */
export const MAX_POLICY_VEHICLES = 6
const MAX_LEN = 120

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {})
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, MAX_LEN) : undefined)

function vehicle(input: unknown): PrefillVehicle | null {
  const v = obj(input)
  const out: PrefillVehicle = {}
  const make = str(v.make)
  const model = str(v.model)
  if (make) out.make = make
  if (model) out.model = model
  if (Number.isInteger(v.year) && (v.year as number) >= 1900 && (v.year as number) <= 2100) out.year = v.year as number
  const plate = str(v.plate)
  const plateState = str(v.plateState)
  const vin = str(v.vin)
  if (plate) out.plate = plate.toUpperCase()
  if (plateState) out.plateState = plateState.toUpperCase().slice(0, 3)
  if (vin) out.vin = vin.toUpperCase().slice(0, 17)
  if (isHex(v.color)) out.color = (v.color as string).toLowerCase()
  if (isVehicle(v.body)) out.body = v.body
  return Object.keys(out).length ? out : null
}

/** read prefill from anything the host sent; never throws, an unusable input is an empty prefill */
export function parsePrefill(input: unknown): Prefill {
  const raw = obj(input)
  const out: Prefill = {}
  const r = obj(raw.reporter)
  const reporter: Prefill['reporter'] = {}
  const name = str(r.name)
  const phone = str(r.phone)
  const email = str(r.email)
  const policy = str(r.policy)
  if (name) reporter.name = name
  if (phone) reporter.phone = phone
  if (email) reporter.email = email.toLowerCase()
  if (policy) reporter.policy = policy.toUpperCase()
  if (typeof r.policyholder === 'boolean') reporter.policyholder = r.policyholder
  if (Object.keys(reporter).length) out.reporter = reporter
  if (Array.isArray(raw.vehicles)) {
    const vehicles = raw.vehicles.map(vehicle).filter((v): v is PrefillVehicle => !!v).slice(0, MAX_POLICY_VEHICLES)
    if (vehicles.length) out.vehicles = vehicles
  }
  return out
}

/** "2021 Toyota Camry · ABC 123", or whatever of that is known */
export const policyVehicleLabel = (v: PrefillVehicle): string =>
  [[v.year, v.make, v.model].filter(Boolean).join(' '), v.plate].filter(Boolean).join(' · ') || 'A vehicle on the policy'

/**
 * A vehicle on the policy written onto a card. `overwrite` is for the customer picking it
 * themselves; otherwise only empty fields are filled. The shape follows the model name when
 * the policy did not say, and changing it clears damage marked on the old shape, as the
 * shape picker does.
 */
export function vehicleFromPolicy(v: ClaimVehicle, p: PrefillVehicle, overwrite = false): ClaimVehicle {
  const take = <T,>(cur: T, next: T | undefined, empty: T): T => (next === undefined ? cur : overwrite || cur === empty ? next : cur)
  const body = take(v.body, p.body ?? (p.model ? (guessBody(p.model) ?? undefined) : undefined), v.body)
  return {
    ...v,
    make: take(v.make, p.make, ''),
    model: take(v.model, p.model, ''),
    year: take(v.year, p.year, null),
    plate: take(v.plate, p.plate, ''),
    plateState: take(v.plateState, p.plateState, ''),
    vin: take(v.vin, p.vin, ''),
    color: take(v.color, p.color, v.color),
    body,
    damages: body === v.body ? v.damages : [],
  }
}

/** fill the empty parts of a claim from the prefill: the reporter, and the insured vehicle when the policy has exactly one */
export function applyPrefill(claim: Claim, p: Prefill): Claim {
  const r = p.reporter ?? {}
  const reporter: Reporter = {
    name: claim.reporter.name || r.name || '',
    phone: claim.reporter.phone || r.phone || '',
    email: claim.reporter.email || r.email || '',
    policy: claim.reporter.policy || r.policy || '',
    policyholder: claim.reporter.policyholder ?? r.policyholder ?? null,
  }
  const only = p.vehicles?.length === 1 ? p.vehicles[0] : null
  const vehicles = only ? claim.vehicles.map((v) => (v.role === 'insured' ? vehicleFromPolicy(v, only) : v)) : claim.vehicles
  return { ...claim, reporter, vehicles }
}
