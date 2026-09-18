/**
 * The contract between this page and whatever the insurer runs in front of Claude.
 *
 * One endpoint, `VITE_ASSIST_URL`, five tasks: `diagram` turns the customer's words into a
 * scene, `describe` turns the scene back into words, `check` reads the finished report back
 * and says what an adjuster would ring up about, `damage` reads the photographs and says
 * which panels look hit, and `intake` turns one spoken or typed account of the whole accident
 * into a draft of the report. JSON in, JSON out, versioned, so an insurer implements one route
 * and can move from the Anthropic API to Bedrock, Vertex or their own gateway without this
 * page changing. The API key lives there and never here: anything in this bundle is public.
 * With the variable unset the page has no AI in it.
 *
 * None of it decides anything. A check is a question the customer may ignore and never blocks
 * sending; a damage suggestion is a row with an "Add" button beside it; an intake draft is a
 * **proposal, never an entry** — the customer confirms it piece by piece, on the same steps
 * they would have gone through anyway, and nothing from it lands in the document unconfirmed.
 * Fault, liability, speeds and cost are out of scope of the contract, not just of the prompts.
 *
 * Positions are **metres east and north of the incident**, not longitude and latitude: a
 * model reasons about "six metres back from the junction" and cannot do spherical arithmetic,
 * so the conversion is this page's job (`frame.ts`). Headings are compass bearings. An intake
 * draft's `place` is the same rule from the other side: it comes back as words to search for,
 * never coordinates, because the model still cannot do that arithmetic and the customer is the
 * one who has to pick the actual match off the map.
 */
import { normalizeBearing } from '../geo'
import type { Lang } from '../i18n'
import {
  isStep,
  KINDS,
  LIGHT,
  PERSON_ROLES,
  ROAD,
  ROLES,
  WEATHER,
  type Conditions,
  type Kind,
  type PersonRole,
  type Role,
  type Step,
  type Surface,
} from '../claim/schema'
import { SEVERITIES, type Damage, type Severity } from '../schema'
import { VEHICLE_IDS, zoneById, type Vehicle } from '../zones'

export const ASSIST_SCHEMA = 'claim-assist/1'

export type AssistTask = 'diagram' | 'describe' | 'check' | 'damage' | 'intake'

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

/**
 * The language the customer is reading and writing in. Every request carries it, because
 * everything that comes back is read by them: the note under a diagram, the statement, the
 * questions. What the endpoint *validates* is language-agnostic — a zone id and a severity
 * are the same word in every language, and always the page's own words, never the model's.
 */
export type Spoken = { lang: Lang }

export type DiagramRequest = Spoken & {
  schema: typeof ASSIST_SCHEMA
  task: 'diagram'
  /** what the customer wrote or dictated */
  text: string
  /** the address, so "the junction" and "the car park entrance" mean something */
  place: string
  vehicles: AssistVehicle[]
}

export type DescribeRequest = Spoken & {
  schema: typeof ASSIST_SCHEMA
  task: 'describe'
  place: string
  /** local date and time, as the form holds it */
  at: string
  surface: Surface
  vehicles: (AssistVehicle & ScenePose & { damage: string[] })[]
  impact: Metres | null
}

export type AssistRequest = DiagramRequest | DescribeRequest | CheckRequest | DamageRequest | IntakeRequest

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

// ── a second look before it is sent ──────────────────────────────────

/** one thing worth another look, and the step it lives on when there is one */
export type Check = { text: string; step?: Step }

/** more than five questions is not a second look, it is a form */
export const MAX_CHECKS = 5
const MAX_CHECK_TEXT = 200

/** a vehicle as the check sees it: where it ended up, what is marked on it, what state it is in */
export type CheckVehicle = AssistVehicle & {
  /** null when it was never placed on the map */
  at: Metres | null
  heading: number
  from: Metres[]
  damage: string[]
  drivable: boolean | null
  airbags: boolean | null
  towed: boolean | null
}

/**
 * The report read back to the endpoint.
 *
 * Deliberately not the document: no reporter, no names, no phone numbers, no licences, no
 * plates, no VINs, no insurers, and no attachments. A consistency check needs to know that
 * *someone* is marked hurt and the police were not called; it does not need to know who they
 * are. `brief()` in the client set that precedent for the diagram and this keeps it.
 */
export type CheckRequest = Spoken & {
  schema: typeof ASSIST_SCHEMA
  task: 'check'
  kind: Kind
  /** local date and time, as the form holds it */
  at: string
  place: string
  surface: Surface
  conditions: Conditions
  description: string
  vehicles: CheckVehicle[]
  /** who was there, by role only */
  people: { role: PersonRole; vehicle: string | null; self: boolean; injured: boolean; injury: string }[]
  police: { called: boolean | null; citations: string }
  /** what else was damaged, in the customer's words */
  property: string
  impact: Metres | null
  /** how many photographs there are, not the photographs */
  photos: number
}

export type CheckResponse = { schema: typeof ASSIST_SCHEMA; task: 'check'; checks: unknown }

/**
 * Validate the questions that came back. Every one is shown to the customer, so a question
 * that is not a short piece of text is dropped rather than rendered; a step this page does
 * not have loses its link but keeps its text, because the question may still be a good one.
 */
export function parseChecks(input: unknown): Check[] {
  const out: Check[] = []
  const seen = new Set<string>()
  for (const entry of Array.isArray(input) ? input : []) {
    const c = entry as Record<string, unknown>
    const text = typeof c?.text === 'string' ? c.text.trim().slice(0, MAX_CHECK_TEXT) : ''
    if (!text) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(isStep(c.step) ? { text, step: c.step } : { text })
    if (out.length === MAX_CHECKS) break
  }
  return out
}

// ── the damage in the photographs ────────────────────────────────────

/** the most marks one photograph run may add; a car with nine hit panels is a total loss */
export const MAX_SUGGESTIONS = 8
const MAX_NOTE = 120

/**
 * One vehicle's photographs, and the panels it actually has. The zone list goes on the wire
 * because zone sets differ per body — a pickup has no rear doors — and the endpoint should be
 * choosing from this vehicle's own panels, not from the union of every body's.
 */
export type DamageRequest = Spoken & {
  schema: typeof ASSIST_SCHEMA
  task: 'damage'
  vehicle: Vehicle
  zones: { id: string; label: string }[]
  /** data URLs, as the page keeps them */
  photos: string[]
}

export type DamageResponse = { schema: typeof ASSIST_SCHEMA; task: 'damage'; damages: unknown }

/**
 * Validate the marks that came back, against the body they are for.
 *
 * The point is the zone's own anchor rather than anything the endpoint sent: a model cannot
 * see where a panel is in the car's frame, and a mark has to land on the panel it names or
 * the marked-up car in the report is a lie. So it picks the panel; the geometry is ours.
 */
export function parseSuggestions(input: unknown, body: Vehicle): Damage[] {
  const out: Damage[] = []
  const seen = new Set<string>()
  for (const entry of Array.isArray(input) ? input : []) {
    const d = entry as Record<string, unknown>
    const zone = typeof d?.zone === 'string' ? zoneById(body, d.zone) : undefined
    if (!zone || seen.has(zone.id)) continue
    if (typeof d.severity !== 'string' || !(SEVERITIES as readonly string[]).includes(d.severity)) continue
    seen.add(zone.id)
    out.push({
      zone: zone.id,
      point: zone.anchor,
      severity: d.severity as Severity,
      note: typeof d.note === 'string' ? d.note.trim().slice(0, MAX_NOTE) : '',
    })
    if (out.length === MAX_SUGGESTIONS) break
  }
  return out
}

// ── the whole report from one telling ────────────────────────────────

/** the caps a spoken account is trimmed to; generous enough for a real account, not an essay */
const MAX_PLACE = 200
const MAX_DESCRIPTION = 1000
const MAX_NAME_FIELD = 60
const MAX_INJURY = 200
const MAX_REPORT = 60
const MAX_PROPERTY = 300
/** a claim with more vehicles or people than this is not one accident any more */
const MAX_INTAKE_VEHICLES = 6
const MAX_INTAKE_PEOPLE = 12

export type IntakeRequest = Spoken & {
  schema: typeof ASSIST_SCHEMA
  task: 'intake'
  /** the customer's own words, spoken or typed */
  transcript: string
  /** the page's current local minute, `YYYY-MM-DDTHH:mm`, so "this morning" and "an hour ago" can be resolved */
  now: string
  /** the enums the draft must use, so the endpoint never has to guess spellings */
  kinds: readonly Kind[]
  bodies: readonly Vehicle[]
  colours: readonly string[]
}

export type IntakeDraft = {
  kind?: Kind
  /** local `YYYY-MM-DDTHH:mm`; never in the future */
  when?: string
  /** a place **as words to search for** — never coordinates; the customer picks the match */
  place?: string
  conditions?: Partial<Conditions>
  vehicles?: { role: Role; make?: string; model?: string; year?: number; color?: string; body?: Vehicle }[]
  people?: { role: PersonRole; vehicle?: Role; injured: boolean; injury?: string }[]
  police?: { called: boolean; report?: string }
  property?: string
  /** the model's short summary of what happened — shown to the customer only as a proposal */
  description?: string
}

export type IntakeResponse = { schema: typeof ASSIST_SCHEMA; task: 'intake'; draft: unknown }

/** the value when it is one of `list`, otherwise absent — never a substituted default */
const enumOf = <T extends string>(list: readonly T[], v: unknown): T | undefined =>
  (list as readonly string[]).includes(v as string) ? (v as T) : undefined

/** trimmed and capped; an empty string is absent, not `''`, same as the rest of the draft */
const capped = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined
  const s = v.trim().slice(0, max)
  return s || undefined
}

/** `now` is `YYYY-MM-DDTHH:mm`, which sorts the same as it reads, so a plain string
 * comparison is enough to tell a future time from one at or before it. */
const whenOf = (v: unknown, now: string): string | undefined =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) && v <= now ? v : undefined

/** an integer year, 1900 up to the year after `now`'s — a dealer sells next year's model early */
const yearOf = (v: unknown, now: string): number | undefined => {
  const max = Number(now.slice(0, 4)) + 1
  return Number.isInteger(v) && (v as number) >= 1900 && (v as number) <= max ? (v as number) : undefined
}

type IntakeVehicleDraft = NonNullable<IntakeDraft['vehicles']>[number]

const intakeVehicle = (entry: unknown, now: string, colours: readonly string[]): IntakeVehicleDraft | undefined => {
  if (typeof entry !== 'object' || entry === null) return undefined
  const v = entry as Record<string, unknown>
  const role = enumOf(ROLES, v.role)
  if (!role) return undefined
  const out: IntakeVehicleDraft = { role }
  const make = capped(v.make, MAX_NAME_FIELD)
  if (make) out.make = make
  const model = capped(v.model, MAX_NAME_FIELD)
  if (model) out.model = model
  const year = yearOf(v.year, now)
  if (year !== undefined) out.year = year
  const color = typeof v.color === 'string' && colours.includes(v.color) ? v.color : undefined
  if (color) out.color = color
  const body = enumOf(VEHICLE_IDS, v.body)
  if (body) out.body = body
  return out
}

type IntakePersonDraft = NonNullable<IntakeDraft['people']>[number]

const intakePerson = (entry: unknown): IntakePersonDraft | undefined => {
  if (typeof entry !== 'object' || entry === null) return undefined
  const p = entry as Record<string, unknown>
  const role = enumOf(PERSON_ROLES, p.role)
  if (!role) return undefined
  const out: IntakePersonDraft = { role, injured: p.injured === true }
  const vehicle = enumOf(ROLES, p.vehicle)
  if (vehicle) out.vehicle = vehicle
  const injury = capped(p.injury, MAX_INJURY)
  if (injury) out.injury = injury
  return out
}

const intakePolice = (v: unknown): IntakeDraft['police'] | undefined => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined
  const p = v as Record<string, unknown>
  const out: NonNullable<IntakeDraft['police']> = { called: p.called === true }
  const report = capped(p.report, MAX_REPORT)
  if (report) out.report = report
  return out
}

const intakeConditions = (v: unknown): Partial<Conditions> | undefined => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined
  const c = v as Record<string, unknown>
  const out: Partial<Conditions> = {}
  const weather = enumOf(WEATHER, c.weather)
  if (weather) out.weather = weather
  const road = enumOf(ROAD, c.road)
  if (road) out.road = road
  const light = enumOf(LIGHT, c.light)
  if (light) out.light = light
  return Object.keys(out).length ? out : undefined
}

/**
 * Validate a draft that came back over the wire. Built entirely from an allow-list — never by
 * spreading the endpoint's answer — so a name, phone number, licence, plate or VIN the model
 * invents has nowhere to land; those are not part of this shape at all. An enum outside its
 * list drops only that field; a vehicle or person missing its (required) role drops the whole
 * entry, the way `parseScene` drops a whole vehicle rather than guess at a role for it.
 * Garbage of any other shape — not an object, an array, `null` — is an empty draft, itself a
 * valid answer, and nothing here throws.
 *
 * `colours` is the request's own `colours` list, passed back in by the caller: a customer's
 * page only offers a fixed palette (`src/vehicles/paint.ts`), and this file does not import it
 * so the assist contract and the paint list stay free to change independently.
 */
export function parseIntake(input: unknown, now: string, colours: readonly string[] = []): IntakeDraft {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return {}
  const raw = input as Record<string, unknown>
  const draft: IntakeDraft = {}

  const kind = enumOf(KINDS, raw.kind)
  if (kind) draft.kind = kind

  const when = whenOf(raw.when, now)
  if (when) draft.when = when

  const place = capped(raw.place, MAX_PLACE)
  if (place) draft.place = place

  const conditions = intakeConditions(raw.conditions)
  if (conditions) draft.conditions = conditions

  if (Array.isArray(raw.vehicles)) {
    const vehicles: IntakeVehicleDraft[] = []
    for (const entry of raw.vehicles) {
      const v = intakeVehicle(entry, now, colours)
      if (v) vehicles.push(v)
      if (vehicles.length === MAX_INTAKE_VEHICLES) break
    }
    if (vehicles.length) draft.vehicles = vehicles
  }

  if (Array.isArray(raw.people)) {
    const people: IntakePersonDraft[] = []
    for (const entry of raw.people) {
      const p = intakePerson(entry)
      if (p) people.push(p)
      if (people.length === MAX_INTAKE_PEOPLE) break
    }
    if (people.length) draft.people = people
  }

  const police = intakePolice(raw.police)
  if (police) draft.police = police

  const property = capped(raw.property, MAX_PROPERTY)
  if (property) draft.property = property

  const description = capped(raw.description, MAX_DESCRIPTION)
  if (description) draft.description = description

  return draft
}
