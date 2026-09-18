/**
 * The claim document: what the insurer receives. `claim/1` wraps the v1 damage shape rather
 * than redefining it, so zone ids, hit points and severities keep exactly the meaning they
 * had in `claim-marker/1`.
 *
 * Around the reconstruction — the map, the vehicles, the diagram, the marked damage — sit the
 * sections every first-notice-of-loss form has and this page did not until v5: what kind of
 * incident it was, who was driving and who else was there, who was hurt, the police, the
 * other party's insurance, photographs, the state the car is in now, other property, the
 * conditions, who is reporting and their attestation. All of it is additive to `claim/1`.
 *
 * Positions are `[lng, lat]` on the real map and headings are compass bearings in degrees,
 * clockwise from north. Coordinates round to six decimals and headings to a degree, and every
 * string is trimmed once, so export → load → export is byte-identical; that round trip is a
 * test. `parseClaim` funnels through `toDocument` so the two can never disagree on shape.
 */
import { parseDamages, type Damage } from '../schema'
import { isVehicle, zoneById, type Vehicle } from '../zones'
import { normalizeBearing, roundLngLat, type LngLat } from '../geo'

export const CLAIM_SCHEMA = 'claim/1'

/**
 * The steps the customer walks through, in order. Here rather than in the store because the
 * assistant names one when it raises a question, and its wire contract must stay free of
 * anything that pulls in zustand and the browser.
 */
export const STEPS = ['kind', 'where', 'vehicles', 'people', 'scene', 'damage', 'review'] as const
export type Step = (typeof STEPS)[number]
export const isStep = (v: unknown): v is Step => (STEPS as readonly string[]).includes(v as string)

export const ROLES = ['insured', 'other'] as const
export type Role = (typeof ROLES)[number]

/** the customer's vehicle is always blue, everyone else's amber — on the map, in the list, everywhere */
export const ROLE_COLOR: Record<Role, string> = { insured: '#2f6bff', other: '#f59e0b' }

// ── what kind of incident ────────────────────────────────────────────

/**
 * The first question every claim form asks, because it decides which questions follow: a
 * hail claim has no other driver and nothing to diagram; a hit-and-run has a driver nobody
 * can name. `others` says whether other vehicles are expected at all; `diagram` whether the
 * map step is shown.
 */
export const KINDS = ['collision', 'single', 'parked', 'theft', 'vandalism', 'weather', 'glass', 'fire'] as const
export type Kind = (typeof KINDS)[number]
export const isKind = (v: unknown): v is Kind => (KINDS as readonly string[]).includes(v as string)

export const KIND_INFO: Record<Kind, { label: string; hint: string; others: boolean; diagram: boolean }> = {
  collision: { label: 'Collision with another vehicle', hint: 'Two or more vehicles hit each other', others: true, diagram: true },
  single: { label: 'Hit something', hint: 'A pole, a kerb, a wall, an animal — no other vehicle', others: false, diagram: true },
  parked: { label: 'Hit while parked', hint: 'You came back to find it damaged, or the other driver left', others: true, diagram: true },
  theft: { label: 'Stolen or broken into', hint: 'The vehicle itself, or things inside it', others: false, diagram: false },
  vandalism: { label: 'Vandalised', hint: 'Keyed, smashed, sprayed', others: false, diagram: false },
  weather: { label: 'Weather', hint: 'Hail, flood, a falling branch', others: false, diagram: false },
  glass: { label: 'Glass only', hint: 'A cracked or chipped windscreen or window', others: false, diagram: false },
  fire: { label: 'Fire', hint: 'It caught fire, or was damaged by one', others: false, diagram: false },
}

// ── conditions ───────────────────────────────────────────────────────

export const WEATHER = ['clear', 'cloudy', 'rain', 'snow', 'fog', 'wind'] as const
export const ROAD = ['dry', 'wet', 'icy', 'snow', 'gravel'] as const
export const LIGHT = ['daylight', 'dusk', 'dark_lit', 'dark_unlit'] as const
export const LIGHT_LABEL: Record<(typeof LIGHT)[number], string> = {
  daylight: 'Daylight',
  dusk: 'Dusk or dawn',
  dark_lit: 'Dark, street lights on',
  dark_unlit: 'Dark, no street lights',
}
/** empty string means not given; the form does not insist */
export type Conditions = { weather: (typeof WEATHER)[number] | ''; road: (typeof ROAD)[number] | ''; light: (typeof LIGHT)[number] | '' }

// ── what the public record says ──────────────────────────────────────

/**
 * The scene as the public record has it: the weather at that hour, where the sun was, and the
 * road itself. Looked up from the place and the time, never typed — `conditions` above stay
 * the customer's own answer, and this sits beside them so an adjuster can see both.
 *
 * Every number is rounded on the way in, like every coordinate, so export → load → export is
 * byte-identical.
 */
export const JUNCTIONS = ['none', 'T', 'cross', 'roundabout'] as const
export type Junction = (typeof JUNCTIONS)[number]

export type SceneWeather = {
  /** the WMO present-weather code the archive gave */
  code: number
  /** the code in words, English, as the lookup named it */
  label: string
  tempC: number | null
  precipMm: number | null
  windKph: number | null
}

/** degrees: altitude above the horizon (negative below it), azimuth clockwise from north */
export type SceneSun = { altitude: number; azimuth: number }

export type SceneRoad = {
  name: string
  /** the OSM `highway` value: residential, primary, motorway… */
  class: string
  lanes: number | null
  oneway: boolean
  /** as posted, in the units the record uses: "25 mph", "50" */
  maxspeed: string
  /** whether it is lit at night; null when the record does not say */
  lit: boolean | null
  junction: Junction
  /** traffic_signals, stop, give_way, crossing — whichever are within the junction */
  controls: string[]
}

/** the whole lookup, or null when nothing came back; `source` names who was asked */
export type SceneContext = {
  weather: SceneWeather | null
  sun: SceneSun | null
  road: SceneRoad | null
  source: string
  fetchedAt: string
}

// ── people ───────────────────────────────────────────────────────────

/**
 * Everyone involved, one flat list, the way an accident report form does it: drivers and
 * passengers belong to a vehicle, pedestrians and witnesses to none. Injuries are on the
 * person — "who was hurt" is the first thing an adjuster reads.
 */
export const PERSON_ROLES = ['driver', 'passenger', 'pedestrian', 'witness'] as const
export type PersonRole = (typeof PERSON_ROLES)[number]
export const isPersonRole = (v: unknown): v is PersonRole => (PERSON_ROLES as readonly string[]).includes(v as string)

export type Person = {
  role: PersonRole
  /** the vehicle they were in; null for a pedestrian, cyclist or witness */
  vehicle: string | null
  /** true when this is the person reporting, whose details are in `reporter` */
  self: boolean
  name: string
  phone: string
  /** drivers only: licence number, if known */
  licence: string
  injured: boolean
  /** what happened to them, in the customer's words */
  injury: string
}

export type Police = {
  /** null until answered */
  called: boolean | null
  department: string
  /** the report or incident number, the one thing an adjuster will ask for */
  report: string
  /** tickets given, and to whom, in the customer's words */
  citations: string
}

/** something other than a vehicle was damaged: a fence, a pole, a wall — and whose it was */
export type Property = { description: string; owner: string }

/** who is filling this in; on an insurer's own site this comes from the login */
/**
 * Which side of the accident this report is. `policyholder` is the customer the page was built
 * for; `other_party` is the other driver, who scanned a QR code at the scene and gave their own
 * account on their own phone, with no account and no app. Their own vehicle still carries role
 * `insured` inside their document — schema-wise that means "the reporter's vehicle" — so every
 * step, the marker and `describe.ts` work unchanged on either side.
 */
export const PARTIES = ['policyholder', 'other_party'] as const
export type Party = (typeof PARTIES)[number]
export const isParty = (v: unknown): v is Party => (PARTIES as readonly string[]).includes(v as string)

export type Reporter = {
  name: string
  phone: string
  email: string
  /** policy number, if they have it to hand */
  policy: string
  /** null until answered */
  policyholder: boolean | null
  /** whose side of it this is; `policyholder` for every document written before there were two */
  party: Party
}

/**
 * The customer's word that it is true. `agreed` and `name` are theirs; `at` is stamped by
 * the page at the moment of sending, never before.
 */
export type Attestation = { agreed: boolean; name: string; at: string | null }

/** a photograph the customer took: the damage, the scene, the other party's documents */
export type Photo = {
  /** a JPEG data URL, downscaled by the page before it is kept */
  data: string
  /** the vehicle it shows, or null for the scene */
  of: string | null
  caption: string
  /**
   * the panel of that vehicle it shows, a zone id — set when the customer adds a mark the
   * assistant read off this photo, so the report can put the photo beside the mark. Absent
   * in documents written before it existed, and dropped when the zone is not on that body.
   */
  shows?: string | null
  /**
   * How far the photograph's own EXIF puts it from the incident the customer described: minutes
   * from `incident.at` (negative is before) and metres from `incident.location`, both rounded.
   *
   * **Distances, never coordinates.** A photograph picked from the gallery can carry the
   * customer's home, their child's school, everywhere they have been; the claim needs to know
   * "this was taken two hours later and four hundred metres away", and nothing else. The raw
   * position is read, used and thrown away in the page and never reaches the document. Both
   * are absent — not null — when the photograph carried no metadata, so every document written
   * before this existed stays byte-identical.
   */
  minutesFromIncident?: number
  metresFromScene?: number
  /**
   * A difference hash of the picture — sixteen hex characters — so the insurer's own server can
   * see that the same photograph has arrived before, on this claim or another. Computed in the
   * page at downscale time, because a claim server with no dependencies has no image decoder.
   * Absent when the canvas could not be read. What it means is an adjuster's call; the hash
   * itself says only "this is the same picture".
   */
  hash?: string
}

/** the state the vehicle is in now — what decides a tow, a rental and where to inspect */
export type Condition = {
  drivable: boolean | null
  airbags: boolean | null
  towed: boolean | null
  /** where it is: at home, the tow yard's name, a body shop, an address */
  location: string
}

// ── vehicles ─────────────────────────────────────────────────────────

export type ClaimVehicle = {
  id: string
  role: Role
  body: Vehicle
  /** paint, as #rrggbb */
  color: string
  make: string
  model: string
  /** model year, null when not given */
  year: number | null
  plate: string
  /** the state or region that issued the plate */
  plateState: string
  vin: string
  /** the owner when it was not the driver; empty otherwise */
  owner: string
  /** the other party's insurer and policy number — what starts the recovery between insurers */
  insurer: string
  policy: string
  condition: Condition
  /** where it came to rest; null until it has been placed on the map */
  position: LngLat | null
  /** compass bearing of the nose, degrees clockwise from north */
  heading: number
  /** the approach, in travel order; the arrow is drawn through [...path, position] */
  path: LngLat[]
  /** in the vehicle's own frame, exactly as `claim-marker/1` records them */
  damages: Damage[]
}

export type Location = { lng: number; lat: number; address: string }

/**
 * What the diagram is drawn on: the real place from above, or — for a covered car park, a
 * garage, a driveway, anywhere a map cannot see — a drawn parking lot or a blank sheet.
 */
export const SURFACES = ['satellite', 'streets', 'lot', 'paper'] as const
export type Surface = (typeof SURFACES)[number]
export const isSurface = (v: unknown): v is Surface => (SURFACES as readonly string[]).includes(v as string)

/**
 * The language the customer wrote the report in. The document's words — the description, the
 * captions, the notes — are the customer's own; an adjuster needs to know which language they
 * are in before reading them. Listed here rather than imported from `src/i18n` so this file,
 * which is also the server's parser, does not pull every dictionary into `dist/lib/claim.js`;
 * `test/i18n.test.ts` asserts the two lists agree.
 */
export const LANGUAGES = ['en', 'es'] as const
export type Language = (typeof LANGUAGES)[number]
export const isLanguage = (v: unknown): v is Language => (LANGUAGES as readonly string[]).includes(v as string)

export type Incident = {
  kind: Kind
  /** local date and time, `YYYY-MM-DDTHH:mm`, as the form field holds it */
  at: string
  /**
   * The id two reports of one accident share, `INC-…`, when the other driver was invited to add
   * their side. Null on a report with only one account. A backend that keeps its own records
   * needs only this and `reporter.party` to link them itself.
   */
  shared: string | null
  /**
   * minutes east of UTC at the place and moment above, so `at` names an instant rather than a
   * wall clock. Filled by the weather lookup, which has to resolve the zone anyway; null when
   * nothing looked it up, which is how every document written before this existed reads.
   */
  utcOffset: number | null
  location: Location | null
  /** what the public record says about that place at that time; null until it is looked up */
  context: SceneContext | null
  surface: Surface
  conditions: Conditions
  description: string
  /** what language `description` and the other free text are in; `en` for documents from before there was a choice */
  language: Language
}

export type Attachments = {
  /** PNG data URL of the map with the vehicles on it */
  scene: string | null
  /** PNG data URL of the marked-up car, per vehicle id */
  damage: Record<string, string>
  /** the customer's own photographs */
  photos: Photo[]
}

export type Claim = {
  schema: typeof CLAIM_SCHEMA
  reference: string | null
  submittedAt: string | null
  reporter: Reporter
  incident: Incident
  vehicles: ClaimVehicle[]
  people: Person[]
  impact: LngLat | null
  police: Police
  property: Property
  attestation: Attestation
  attachments: Attachments
}

// ── guards and normalisers ───────────────────────────────────────────

export const isLngLat = (v: unknown): v is LngLat =>
  Array.isArray(v) &&
  v.length === 2 &&
  v.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
  Math.abs(v[0]) <= 180 &&
  Math.abs(v[1]) <= 90

export const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

const isPng = (v: unknown): v is string => typeof v === 'string' && v.startsWith('data:image/png;base64,')
const isPhotoData = (v: unknown): v is string => typeof v === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(v)

/** the most photographs one claim carries; each is a few hundred kB after downscaling */
export const MAX_PHOTOS = 12

/**
 * How far out a photograph's own metadata can put it and still be worth recording: a fortnight
 * and a thousand kilometres. Past that the camera's clock or its fix is wrong, not the
 * customer, and a number that large says nothing to an adjuster.
 */
export const MAX_PHOTO_MINUTES = 14 * 24 * 60
export const MAX_PHOTO_METRES = 1_000_000

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const bool = (v: unknown) => v === true
const bool3 = (v: unknown) => (typeof v === 'boolean' ? v : null)
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | '' => ((list as readonly string[]).includes(v as string) ? (v as T) : '')
const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {})

/** minutes east of UTC; no zone on earth is further out than this, so anything else is not one */
const offsetMinutes = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 16 * 60 ? Math.round(v) : null)

const roundTo = (v: unknown, places: number): number | null => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  const f = 10 ** places
  return Math.round(v * f) / f
}

/** `INC-` and up to thirty-two unambiguous characters; anything else is not one of ours */
const sharedId = (v: unknown): string | null => (typeof v === 'string' && /^INC-[A-Z0-9-]{4,32}$/.test(v.trim().toUpperCase()) ? v.trim().toUpperCase() : null)

/** enough of a junction's furniture to read at a glance, not a survey of it */
const MAX_CONTROLS = 6

/**
 * `at` as an instant: the wall clock the customer gave, read in the zone the lookup found.
 * Null without an offset — a bare local time is not a moment, and taking the browser's own
 * zone would be assuming the customer is standing where their phone is, which after an
 * accident on holiday is exactly wrong.
 */
export function instantOf(at: string, utcOffset: number | null): number | null {
  if (utcOffset === null || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(at)) return null
  const ms = Date.parse(`${at.slice(0, 16)}Z`)
  return Number.isFinite(ms) ? ms - utcOffset * 60_000 : null
}

/**
 * The looked-up scene, normalised and capped. A lookup that came back with nothing usable is
 * no context at all, so it is null rather than an object full of nulls.
 */
export const sceneContext = (v: unknown): SceneContext | null => {
  const c = obj(v)
  const w = obj(c.weather)
  const sun = obj(c.sun)
  const r = obj(c.road)
  const weather: SceneWeather | null =
    typeof w.code === 'number' && Number.isFinite(w.code)
      ? { code: Math.round(w.code), label: str(w.label), tempC: roundTo(w.tempC, 1), precipMm: roundTo(w.precipMm, 2), windKph: roundTo(w.windKph, 1) }
      : null
  const altitude = roundTo(sun.altitude, 2)
  const azimuth = roundTo(sun.azimuth, 2)
  const road: SceneRoad | null = str(r.class)
    ? {
        name: str(r.name),
        class: str(r.class),
        lanes: Number.isInteger(r.lanes) && (r.lanes as number) > 0 && (r.lanes as number) <= 12 ? (r.lanes as number) : null,
        oneway: bool(r.oneway),
        maxspeed: str(r.maxspeed),
        lit: typeof r.lit === 'boolean' ? r.lit : null,
        junction: (JUNCTIONS as readonly string[]).includes(r.junction as string) ? (r.junction as Junction) : 'none',
        controls: Array.isArray(r.controls)
          ? [...new Set(r.controls.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim()))].sort().slice(0, MAX_CONTROLS)
          : [],
      }
    : null
  if (!weather && !road && (altitude === null || azimuth === null)) return null
  return {
    weather,
    sun: altitude !== null && azimuth !== null ? { altitude, azimuth } : null,
    road,
    source: str(c.source) || 'open-meteo+osm',
    fetchedAt: str(c.fetchedAt),
  }
}

/** the current local minute in the shape `<input type="datetime-local">` holds */
export function nowLocal(now = new Date()): string {
  const d = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 16)
}

export const emptyCondition = (): Condition => ({ drivable: null, airbags: null, towed: null, location: '' })

/** normalise one vehicle so that export → load → export is byte-identical */
export const claimVehicle = (v: ClaimVehicle): ClaimVehicle => ({
  id: v.id,
  role: v.role,
  body: v.body,
  color: v.color.toLowerCase(),
  make: str(v.make),
  model: str(v.model),
  year: Number.isInteger(v.year) && (v.year as number) >= 1900 && (v.year as number) <= 2100 ? v.year : null,
  plate: str(v.plate).toUpperCase(),
  plateState: str(v.plateState).toUpperCase(),
  vin: str(v.vin).toUpperCase(),
  owner: str(v.owner),
  insurer: str(v.insurer),
  // like the plate, the VIN and the report number: identifiers are case-insensitive, so one case
  policy: str(v.policy).toUpperCase(),
  condition: {
    drivable: bool3(v.condition?.drivable),
    airbags: bool3(v.condition?.airbags),
    towed: bool3(v.condition?.towed),
    location: str(v.condition?.location),
  },
  position: v.position ? roundLngLat(v.position) : null,
  heading: Math.round(normalizeBearing(v.heading)) % 360,
  path: v.path.map(roundLngLat),
  damages: v.damages,
})

export const newVehicle = (id: string, role: Role, body: Vehicle, color: string): ClaimVehicle => ({
  id,
  role,
  body,
  color,
  make: '',
  model: '',
  year: null,
  plate: '',
  plateState: '',
  vin: '',
  owner: '',
  insurer: '',
  policy: '',
  condition: emptyCondition(),
  position: null,
  heading: 0,
  path: [],
  damages: [],
})

export const newPerson = (role: PersonRole, vehicle: string | null = null): Person => ({
  role,
  vehicle,
  self: false,
  name: '',
  phone: '',
  licence: '',
  injured: false,
  injury: '',
})

const person = (p: Person): Person => ({
  role: p.role,
  vehicle: p.vehicle,
  self: bool(p.self),
  name: str(p.name),
  phone: str(p.phone),
  licence: str(p.licence).toUpperCase(),
  injured: bool(p.injured),
  injury: str(p.injury),
})

/** a fresh claim: a collision, the customer's car and one other party, nothing placed yet */
export const emptyClaim = (): Claim => ({
  schema: CLAIM_SCHEMA,
  reference: null,
  submittedAt: null,
  reporter: { name: '', phone: '', email: '', policy: '', policyholder: null, party: 'policyholder' },
  incident: { kind: 'collision', at: nowLocal(), shared: null, utcOffset: null, location: null, context: null, surface: 'satellite', conditions: { weather: '', road: '', light: '' }, description: '', language: 'en' },
  vehicles: [newVehicle('a', 'insured', 'sedan', '#b9bec6'), newVehicle('b', 'other', 'suv', '#1c1f26')],
  people: [],
  impact: null,
  police: { called: null, department: '', report: '', citations: '' },
  property: { description: '', owner: '' },
  attestation: { agreed: false, name: '', at: null },
  attachments: { scene: null, damage: {}, photos: [] },
})

/** the normalised document, the shape that is sent and stored */
export const toDocument = (claim: Claim): Claim => {
  const ids = new Set(claim.vehicles.map((v) => v.id))
  const bodies = new Map(claim.vehicles.map((v) => [v.id, v.body]))
  // a driver or passenger must be in a vehicle that exists; one driver per vehicle
  const driven = new Set<string>()
  const people: Person[] = []
  for (const raw of claim.people) {
    const p = person({ ...raw, vehicle: raw.vehicle && ids.has(raw.vehicle) ? raw.vehicle : null })
    if ((p.role === 'driver' || p.role === 'passenger') && !p.vehicle) continue
    if (p.role === 'driver') {
      if (driven.has(p.vehicle!)) continue
      driven.add(p.vehicle!)
    }
    people.push(p)
  }
  return {
    schema: CLAIM_SCHEMA,
    reference: claim.reference,
    submittedAt: claim.submittedAt,
    reporter: {
      name: str(claim.reporter.name),
      phone: str(claim.reporter.phone),
      email: str(claim.reporter.email).toLowerCase(),
      policy: str(claim.reporter.policy).toUpperCase(),
      policyholder: bool3(claim.reporter.policyholder),
      party: isParty(claim.reporter.party) ? claim.reporter.party : 'policyholder',
    },
    incident: {
      kind: claim.incident.kind,
      at: claim.incident.at,
      shared: sharedId(claim.incident.shared),
      utcOffset: offsetMinutes(claim.incident.utcOffset),
      location: claim.incident.location
        ? {
            lng: roundLngLat([claim.incident.location.lng, claim.incident.location.lat])[0],
            lat: roundLngLat([claim.incident.location.lng, claim.incident.location.lat])[1],
            address: str(claim.incident.location.address),
          }
        : null,
      context: sceneContext(claim.incident.context),
      surface: claim.incident.surface,
      conditions: {
        weather: oneOf(WEATHER, claim.incident.conditions.weather),
        road: oneOf(ROAD, claim.incident.conditions.road),
        light: oneOf(LIGHT, claim.incident.conditions.light),
      },
      description: str(claim.incident.description),
      language: isLanguage(claim.incident.language) ? claim.incident.language : 'en',
    },
    vehicles: claim.vehicles.map(claimVehicle),
    people,
    impact: claim.impact ? roundLngLat(claim.impact) : null,
    police: {
      called: bool3(claim.police.called),
      department: str(claim.police.department),
      report: str(claim.police.report).toUpperCase(),
      citations: str(claim.police.citations),
    },
    property: { description: str(claim.property.description), owner: str(claim.property.owner) },
    attestation: { agreed: bool(claim.attestation.agreed), name: str(claim.attestation.name), at: claim.attestation.at },
    attachments: {
      scene: claim.attachments.scene,
      damage: claim.attachments.damage,
      photos: claim.attachments.photos
        .filter((p) => isPhotoData(p.data))
        .slice(0, MAX_PHOTOS)
        .map((p) => {
          const of = p.of && ids.has(p.of) ? p.of : null
          const photo: Photo = { data: p.data, of, caption: str(p.caption) }
          // only when present, so every document written before `shows` existed stays byte-identical
          if (of && p.shows && zoneById(bodies.get(of)!, p.shows)) photo.shows = p.shows
          if (typeof p.hash === 'string' && /^[0-9a-f]{16}$/.test(p.hash)) photo.hash = p.hash
          const minutes = roundTo(p.minutesFromIncident, 0)
          const metres = roundTo(p.metresFromScene, 0)
          if (minutes !== null && Math.abs(minutes) <= MAX_PHOTO_MINUTES) photo.minutesFromIncident = minutes
          if (metres !== null && metres >= 0 && metres <= MAX_PHOTO_METRES) photo.metresFromScene = metres
          return photo
        }),
    },
  }
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** a customer-facing reference: short, unambiguous glyphs, no 0/O or 1/I */
export function makeReference(random: () => number = Math.random): string {
  let s = 'CM-'
  for (let i = 0; i < 6; i++) s += ALPHABET[Math.floor(random() * ALPHABET.length)]
  return s
}

/**
 * Validate a stored or received document. Structural problems throw — "you handed me the
 * wrong object" should be loud — while a single malformed vehicle, person or photo is dropped
 * rather than losing the rest, and the vehicle count comes back so a caller can surface it.
 * Everything else missing takes its default. The result goes through `toDocument`, so what
 * comes out of here is exactly what would be sent.
 */
export function parseClaim(input: unknown): { value: Claim; rejected: number } {
  if (typeof input !== 'object' || input === null) throw new TypeError('claim: expected an object')
  const raw = input as Record<string, unknown>
  if (raw.schema !== CLAIM_SCHEMA) throw new TypeError(`claim: expected schema "${CLAIM_SCHEMA}", got ${JSON.stringify(raw.schema)}`)
  if (raw.vehicles !== undefined && !Array.isArray(raw.vehicles)) throw new TypeError('claim: vehicles must be an array')

  const base = emptyClaim()
  const inc = obj(raw.incident)
  const loc = typeof inc.location === 'object' && inc.location !== null ? (inc.location as Record<string, unknown>) : null
  const location: Location | null =
    loc && isLngLat([loc.lng, loc.lat]) ? { lng: loc.lng as number, lat: loc.lat as number, address: str(loc.address) } : null
  const cond = obj(inc.conditions)

  const vehicles: ClaimVehicle[] = []
  let rejected = 0
  for (const entry of (raw.vehicles ?? []) as unknown[]) {
    const v = entry as Record<string, unknown>
    const ok =
      typeof v === 'object' &&
      v !== null &&
      typeof v.id === 'string' &&
      v.id.length > 0 &&
      isVehicle(v.body) &&
      isHex(v.color) &&
      (v.position === null || v.position === undefined || isLngLat(v.position)) &&
      (v.heading === undefined || (typeof v.heading === 'number' && Number.isFinite(v.heading))) &&
      (v.path === undefined || (Array.isArray(v.path) && v.path.every(isLngLat)))
    if (!ok) {
      rejected++
      continue
    }
    const c = obj(v.condition)
    vehicles.push({
      id: v.id as string,
      role: (ROLES as readonly string[]).includes(v.role as string) ? (v.role as Role) : 'other',
      body: v.body as Vehicle,
      color: v.color as string,
      make: str(v.make),
      model: str(v.model),
      year: typeof v.year === 'number' ? v.year : null,
      plate: str(v.plate),
      plateState: str(v.plateState),
      vin: str(v.vin),
      owner: str(v.owner),
      insurer: str(v.insurer),
      policy: str(v.policy),
      condition: { drivable: bool3(c.drivable), airbags: bool3(c.airbags), towed: bool3(c.towed), location: str(c.location) },
      position: (v.position ?? null) as LngLat | null,
      heading: (v.heading ?? 0) as number,
      path: (v.path ?? []) as LngLat[],
      damages: parseDamages(v.body as Vehicle, v.damages ?? []).damages,
    })
  }

  const people: Person[] = []
  for (const entry of Array.isArray(raw.people) ? raw.people : []) {
    const p = obj(entry)
    if (!isPersonRole(p.role)) continue
    people.push({
      role: p.role,
      vehicle: typeof p.vehicle === 'string' ? p.vehicle : null,
      self: bool(p.self),
      name: str(p.name),
      phone: str(p.phone),
      licence: str(p.licence),
      injured: bool(p.injured),
      injury: str(p.injury),
    })
  }

  const att = obj(raw.attachments)
  const damage: Record<string, string> = {}
  for (const [id, png] of Object.entries(obj(att.damage))) {
    if (isPng(png) && vehicles.some((v) => v.id === id)) damage[id] = png
  }
  const photos: Photo[] = []
  for (const entry of Array.isArray(att.photos) ? att.photos : []) {
    const p = obj(entry)
    if (!isPhotoData(p.data)) continue
    photos.push({
      data: p.data,
      of: typeof p.of === 'string' ? p.of : null,
      caption: str(p.caption),
      shows: typeof p.shows === 'string' ? p.shows : null,
      ...(typeof p.hash === 'string' ? { hash: p.hash } : {}),
      ...(typeof p.minutesFromIncident === 'number' ? { minutesFromIncident: p.minutesFromIncident } : {}),
      ...(typeof p.metresFromScene === 'number' ? { metresFromScene: p.metresFromScene } : {}),
    })
  }

  const rep = obj(raw.reporter)
  const pol = obj(raw.police)
  const prop = obj(raw.property)
  const attn = obj(raw.attestation)

  const value = toDocument({
    schema: CLAIM_SCHEMA,
    reference: typeof raw.reference === 'string' ? raw.reference : null,
    submittedAt: typeof raw.submittedAt === 'string' ? raw.submittedAt : null,
    reporter: { name: str(rep.name), phone: str(rep.phone), email: str(rep.email), policy: str(rep.policy), policyholder: bool3(rep.policyholder), party: isParty(rep.party) ? rep.party : 'policyholder' },
    incident: {
      kind: isKind(inc.kind) ? inc.kind : base.incident.kind,
      at: typeof inc.at === 'string' ? inc.at : nowLocal(),
      shared: typeof inc.shared === 'string' ? inc.shared : null,
      utcOffset: typeof inc.utcOffset === 'number' ? inc.utcOffset : null,
      location,
      context: sceneContext(inc.context),
      surface: isSurface(inc.surface) ? inc.surface : 'satellite',
      conditions: { weather: oneOf(WEATHER, cond.weather), road: oneOf(ROAD, cond.road), light: oneOf(LIGHT, cond.light) },
      description: str(inc.description),
      language: isLanguage(inc.language) ? inc.language : 'en',
    },
    vehicles,
    people,
    impact: isLngLat(raw.impact) ? roundLngLat(raw.impact) : null,
    police: { called: bool3(pol.called), department: str(pol.department), report: str(pol.report), citations: str(pol.citations) },
    property: { description: str(prop.description), owner: str(prop.owner) },
    attestation: { agreed: bool(attn.agreed), name: str(attn.name), at: typeof attn.at === 'string' ? attn.at : null },
    attachments: { scene: isPng(att.scene) ? att.scene : null, damage, photos },
  })

  return { value, rejected }
}
