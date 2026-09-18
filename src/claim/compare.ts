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
import { cap, conditionLabels, deskVoice, driverName, vehicleName } from './describe'
import { KIND_INFO, instantOf, type Claim, type ClaimVehicle, type Incident, type Location, type Role } from './schema'
import { bearing, distance, normalizeBearing, type LngLat } from '../geo'
import { impactPlaceOf, lengthOf, routeOf, timelineOf } from '../map/playback'
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
  /**
   * The other driver's page started from the policyholder's answer here and it was not
   * changed: the two agree because one was handed the other's, which says little either way.
   */
  seeded?: true
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

/** who was in a vehicle by one account — the driver and how many passengers — or null when it lists no one */
function occupants(c: Claim, v: ClaimVehicle): { text: string; count: number } | null {
  const inside = c.people.filter((p) => p.vehicle === v.id && (p.role === 'driver' || p.role === 'passenger'))
  if (inside.length === 0) return null
  const driver = inside.find((p) => p.role === 'driver')
  const passengers = inside.filter((p) => p.role === 'passenger').length
  const who = driver ? `Driver: ${driverName(driver, deskVoice(c.reporter.party)) ?? 'name not given'}` : 'No driver named'
  return { text: passengers ? `${who}, ${passengers} passenger${passengers === 1 ? '' : 's'}` : who, count: inside.length }
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

/** the account has something driving, so playing it back gives its impact a moment as well as a place */
const timed = (c: Claim) =>
  c.vehicles.some((v) => {
    const route = routeOf(v)
    return route !== null && lengthOf(route) > 0
  })

/** where this account puts the impact: the cross its customer placed, or where its own cars meet */
const impactPointOf = (c: Claim): LngLat | null => c.impact ?? impactPlaceOf(c.vehicles, timelineOf(c.vehicles).impactT)

/**
 * The headline above the comparison: how far apart the two accounts put the impact, and how far
 * apart it happens once both diagrams are played from the same start — the one number a table of
 * rows cannot show, because it belongs to neither row and neither account.
 *
 * The metres are between each account's own point of impact; an account whose customer never
 * placed the cross still has the place its cars meet. The seconds are the gap between the two
 * `impactMs` on that shared clock, so an account with nothing driving has no moment to compare,
 * and this says so rather than reporting a gap of nought. A gap is a gap: two people remember a
 * two-second event differently, and nothing here reads it as anything more than that.
 */
export function impactApart(a: Claim, b: Claim): string {
  const pa = impactPointOf(a)
  const pb = impactPointOf(b)
  if (!pa || !pb) return `${cap(partyLabel(pa ? b : a))}'s account does not put the impact anywhere on a map.`
  const metres = fmtMetres(distance(pa, pb))
  const untimed = [timed(a) ? null : partyLabel(a), timed(b) ? null : partyLabel(b)].filter((s): s is string => s !== null)
  if (untimed.length > 0) {
    return `The two accounts' impacts are ${metres} apart; ${untimed.map((who) => `${who}'s account`).join(' and ')} ${untimed.length > 1 ? 'have' : 'has'} no route to time it from.`
  }
  const seconds = Math.abs(timelineOf(a.vehicles).impactMs - timelineOf(b.vehicles).impactMs) / 1000
  return `The two accounts' impacts are ${metres} and ${seconds.toFixed(1)} s apart.`
}

/**
 * Compare two accounts of one accident, row by row. Order is fixed — place, time, kind, each
 * matched vehicle's rest position, heading and approach, the impact, each vehicle's marked
 * panels, who was in each vehicle, the police, who was hurt, the conditions — so two
 * comparisons of the same pair of documents read the same way.
 */
export function compare(a: Claim, b: Claim): Comparison {
  const agree: Row[] = []
  const differ: Row[] = []
  const unmatched: string[] = []
  const push = (row: Row, agrees: boolean) => (agrees ? agree : differ).push(row)
  // The other driver's page opens on the policyholder's place and time. The desk is not handed
  // that seed, so an answer still exactly the policyholder's stands for "left as it was given".
  // ponytail: exact equality — one re-entered to the very same value reads as seeded too, which
  // for the desk is the same thing; hand the desk the seed if that ever needs telling apart
  const seedable = a.reporter.party !== b.reporter.party
  const seeded = (same: boolean): { seeded?: true } => (seedable && same ? { seeded: true } : {})

  const la = a.incident.location
  const lb = b.incident.location
  if (la && lb) {
    const gap = distance([la.lng, la.lat], [lb.lng, lb.lat])
    push(
      { key: 'place', label: 'Where it happened', a: fmtLocation(la), b: fmtLocation(lb), gap: fmtMetres(gap), ...seeded(la.lng === lb.lng && la.lat === lb.lat) },
      gap <= PLACE_METRES,
    )
  } else if (la || lb) {
    unmatched.push(blank('Where it happened', la ? b : a))
  }

  const timeGap = timeDiffMinutes(a.incident, b.incident)
  if (timeGap !== null) {
    push(
      { key: 'time', label: 'When it happened', a: fmtLocalTime(a.incident), b: fmtLocalTime(b.incident), gap: fmtMinutes(timeGap), ...seeded(a.incident.at === b.incident.at) },
      timeGap <= TIME_MINUTES,
    )
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

  for (const { a: av, b: bv } of pairs) {
    const inA = occupants(a, av)
    const inB = occupants(b, bv)
    const subject = `Who was in ${vehicleName(av, 'en')}`
    if (inA && inB) push({ key: `occupants:${av.id}`, label: subject, a: inA.text, b: inB.text }, inA.count === inB.count)
    else if (inA || inB) unmatched.push(blank(subject, inA ? b : a))
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
