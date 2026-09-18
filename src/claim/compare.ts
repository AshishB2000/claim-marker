/**
 * Two accounts of one accident, laid side by side: the policyholder's `claim/1` document and
 * the other driver's, each written on their own phone, each complete in itself. `compare`
 * says where they agree and where they do not — nothing more.
 *
 * Three rules this file keeps:
 *
 * 1. The customer never sees any of this — it is the desk's, English only, no language switch.
 * 2. A difference is a difference, not a verdict. This module names no one as right and no one
 *    as wrong; it has no opinion on why the two stories differ, only that they do. A short list
 *    of words that would turn a difference into an accusation is kept out of it on purpose —
 *    not in the code, not in a message, not in a comment, this one included — and a test greps
 *    this file's own source to prove it.
 * 3. Pure: no network, no store, no DOM. Two documents in, one comparison out.
 */
import { cap, conditionLabels, vehicleName } from './describe'
import { KIND_INFO, instantOf, type Claim, type ClaimVehicle, type Incident, type Location, type Role } from './schema'
import { bearing, distance, normalizeBearing, type LngLat } from '../geo'
import { zoneById } from '../zones'

/** one thing the two accounts both speak to */
export type Row = {
  /** a stable snake_case identifier */
  key: string
  /** what this row is about, in an adjuster's words: "Where it happened", "Which way the Camry came from" */
  label: string
  /** what each account says, already in words */
  a: string
  b: string
  /** how far apart they are, in the row's own units, when that is a number */
  gap?: string
}

export type Comparison = { agree: Row[]; differ: Row[]; unmatched: string[] }

/** agree on where it happened within this many metres */
export const PLACE_METRES = 10
/** agree on when it happened within this many minutes */
export const TIME_MINUTES = 10
/** agree on where a vehicle came to rest within this many metres */
export const REST_METRES = 10
/** agree on a heading or a bearing within this many degrees */
export const HEADING_DEGREES = 30

const partyLabel = (c: Claim) => (c.reporter.party === 'other_party' ? 'the other driver' : 'the policyholder')

/** something a row asked about that one side never answered */
const blank = (subject: string, who: Claim) => `${subject} was not given by ${partyLabel(who)}.`

const fmtLatLng = (lng: number, lat: number) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`
const fmtLocation = (loc: Location) => loc.address || fmtLatLng(loc.lng, loc.lat)
const fmtLngLat = ([lng, lat]: LngLat) => fmtLatLng(lng, lat)
const fmtMetres = (n: number) => `${Math.round(n)} m`
const fmtMinutes = (n: number) => `${Math.round(n)} min`
const fmtDegrees = (n: number) => `${Math.round(n)}°`
const fmtLocalTime = (inc: Incident) => inc.at.replace('T', ' ') + (inc.utcOffset === null ? '' : ` (UTC${inc.utcOffset >= 0 ? '+' : ''}${inc.utcOffset / 60})`)
const fmtHurt = (n: number) => (n === 0 ? 'No one hurt' : n === 1 ? '1 person hurt' : `${n} people hurt`)

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] as const
const compassWord = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]
const fmtHeading = (deg: number) => `${cap(compassWord(deg))} (${Math.round(normalizeBearing(deg))}°)`

/** the shortest angle between two bearings, 0–180 — plausibility.ts keeps its own copy of this too */
const angleDiff = (a: number, b: number) => Math.abs((((b - a + 540) % 360) - 180))

/** minutes apart, as an instant when both sides resolved a zone, otherwise as the same wall clock */
function timeDiffMinutes(a: Incident, b: Incident): number | null {
  if (a.utcOffset !== null && b.utcOffset !== null) {
    const ia = instantOf(a.at, a.utcOffset)
    const ib = instantOf(b.at, b.utcOffset)
    return ia !== null && ib !== null ? Math.abs(ia - ib) / 60_000 : null
  }
  const ta = Date.parse(`${a.at.slice(0, 16)}Z`)
  const tb = Date.parse(`${b.at.slice(0, 16)}Z`)
  return Number.isFinite(ta) && Number.isFinite(tb) ? Math.abs(ta - tb) / 60_000 : null
}

/** the bearing of a vehicle's first travel leg, or null when it drew no path to have one */
function firstLegBearing(v: ClaimVehicle): number | null {
  if (v.path.length === 0) return null
  const to = v.path[1] ?? v.position
  return to ? bearing(v.path[0], to) : null
}

const panelLabels = (v: ClaimVehicle): string => {
  const labels = [...new Set(v.damages.map((d) => zoneById(v.body, d.zone)?.label ?? d.zone))]
  return labels.length ? labels.join(', ') : '(none marked)'
}

type Pair = { a: ClaimVehicle; b: ClaimVehicle }

/**
 * The same physical car, described twice. In A's own account the writer's car carries
 * `role: 'insured'`; in B's own account — written by the other driver, about the same
 * accident — that same car is the one *they* did not write, so it carries `role: 'other'`,
 * and vice versa. The roles are a mirror of each other, not a match: A's insured pairs with
 * B's other, and A's other pairs with B's insured. A pairing is only trusted once the body and
 * the paint colour also agree, so two accounts that do not actually describe the same vehicles
 * are left apart rather than forced together.
 */
function matchVehicles(a: Claim, b: Claim): { pairs: Pair[]; unmatched: string[] } {
  const mirror: Record<Role, Role> = { insured: 'other', other: 'insured' }
  const usedB = new Set<ClaimVehicle>()
  const pairs: Pair[] = []
  const unmatched: string[] = []
  for (const av of a.vehicles) {
    const bv = b.vehicles.find((v) => !usedB.has(v) && v.role === mirror[av.role] && v.body === av.body && v.color.toLowerCase() === av.color.toLowerCase())
    if (bv) {
      usedB.add(bv)
      pairs.push({ a: av, b: bv })
    } else {
      unmatched.push(`${vehicleName(av, 'en')} appears only in ${partyLabel(a)}'s account.`)
    }
  }
  for (const bv of b.vehicles) {
    if (!usedB.has(bv)) unmatched.push(`${vehicleName(bv, 'en')} appears only in ${partyLabel(b)}'s account.`)
  }
  return { pairs, unmatched }
}

/**
 * Compare two accounts of one accident, row by row. Order is fixed — place, time, kind, each
 * matched vehicle's rest position, heading and approach, the impact, each vehicle's marked
 * panels, the police, who was hurt, the conditions — so two comparisons of the same pair of
 * documents read the same way.
 */
export function compare(a: Claim, b: Claim): Comparison {
  const agree: Row[] = []
  const differ: Row[] = []
  const unmatched: string[] = []
  const push = (row: Row, agrees: boolean) => (agrees ? agree : differ).push(row)

  if (a.incident.location && b.incident.location) {
    const gap = distance([a.incident.location.lng, a.incident.location.lat], [b.incident.location.lng, b.incident.location.lat])
    push({ key: 'place', label: 'Where it happened', a: fmtLocation(a.incident.location), b: fmtLocation(b.incident.location), gap: fmtMetres(gap) }, gap <= PLACE_METRES)
  } else if (a.incident.location || b.incident.location) {
    unmatched.push(blank('Where it happened', a.incident.location ? b : a))
  }

  const timeGap = timeDiffMinutes(a.incident, b.incident)
  if (timeGap !== null) {
    push({ key: 'time', label: 'When it happened', a: fmtLocalTime(a.incident), b: fmtLocalTime(b.incident), gap: fmtMinutes(timeGap) }, timeGap <= TIME_MINUTES)
  }

  push({ key: 'kind', label: 'What kind of incident', a: KIND_INFO[a.incident.kind].label, b: KIND_INFO[b.incident.kind].label }, a.incident.kind === b.incident.kind)

  const { pairs, unmatched: vehicleGaps } = matchVehicles(a, b)
  unmatched.push(...vehicleGaps)

  for (const { a: av, b: bv } of pairs) {
    const name = vehicleName(av, 'en')
    const id = av.id

    if (av.position && bv.position) {
      const gap = distance(av.position, bv.position)
      push({ key: `rest:${id}`, label: `Where ${name} came to rest`, a: fmtLngLat(av.position), b: fmtLngLat(bv.position), gap: fmtMetres(gap) }, gap <= REST_METRES)
    } else if (av.position || bv.position) {
      unmatched.push(blank(`Where ${name} came to rest`, av.position ? b : a))
    }

    const headingGap = angleDiff(av.heading, bv.heading)
    push({ key: `facing:${id}`, label: `Which way ${name} was facing`, a: fmtHeading(av.heading), b: fmtHeading(bv.heading), gap: fmtDegrees(headingGap) }, headingGap <= HEADING_DEGREES)

    const fromA = firstLegBearing(av)
    const fromB = firstLegBearing(bv)
    if (fromA !== null && fromB !== null) {
      const gap = angleDiff(fromA, fromB)
      push({ key: `from:${id}`, label: `Which way ${name} came from`, a: fmtHeading(fromA), b: fmtHeading(fromB), gap: fmtDegrees(gap) }, gap <= HEADING_DEGREES)
    }
  }

  if (a.impact && b.impact) {
    const gap = distance(a.impact, b.impact)
    push({ key: 'impact', label: 'Where the impact was', a: fmtLngLat(a.impact), b: fmtLngLat(b.impact), gap: fmtMetres(gap) }, gap <= PLACE_METRES)
  }

  for (const { a: av, b: bv } of pairs) {
    const name = vehicleName(av, 'en')
    const zonesA = new Set(av.damages.map((d) => d.zone))
    const zonesB = new Set(bv.damages.map((d) => d.zone))
    if (zonesA.size && zonesB.size) {
      const overlap = [...zonesA].some((z) => zonesB.has(z))
      push({ key: `panel:${av.id}`, label: `Where ${name} is marked damaged`, a: panelLabels(av), b: panelLabels(bv) }, overlap)
    } else if (zonesA.size || zonesB.size) {
      unmatched.push(blank(`Where ${name} is marked damaged`, zonesA.size ? b : a))
    }
  }

  if (a.police.called !== null && b.police.called !== null) {
    push({ key: 'police', label: 'Whether the police were called', a: a.police.called ? 'Called' : 'Not called', b: b.police.called ? 'Called' : 'Not called' }, a.police.called === b.police.called)
  } else if (a.police.called !== null || b.police.called !== null) {
    unmatched.push(blank('Whether the police were called', a.police.called !== null ? b : a))
  }

  const hurtA = a.people.filter((p) => p.injured).length
  const hurtB = b.people.filter((p) => p.injured).length
  push({ key: 'hurt', label: 'Whether anyone was hurt', a: fmtHurt(hurtA), b: fmtHurt(hurtB) }, (hurtA > 0) === (hurtB > 0))

  const condA = conditionLabels(a.incident.conditions, 'en')
  const condB = conditionLabels(b.incident.conditions, 'en')
  if (condA.length || condB.length) {
    const same =
      a.incident.conditions.weather === b.incident.conditions.weather &&
      a.incident.conditions.road === b.incident.conditions.road &&
      a.incident.conditions.light === b.incident.conditions.light
    push({ key: 'conditions', label: 'The conditions', a: condA.join(', ') || '(not given)', b: condB.join(', ') || '(not given)' }, same)
  }

  return { agree, differ, unmatched }
}
