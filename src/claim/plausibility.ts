/**
 * What a finished diagram says about itself: pure geometry over a `claim/1` document that
 * flags where two parts of the same account do not line up. No AI, no network — every check
 * here is arithmetic over positions, headings and marks the customer already drew.
 *
 * Three rules this file keeps:
 *
 * 1. The customer never sees any of this. It is rendered only by `src/adjuster/Desk.tsx`, so
 *    the words are English and desk voice throughout — the desk reads one language, and this
 *    is never composed on the customer's own review page.
 * 2. Nothing here ever assigns responsibility for the crash, calls anything invented or
 *    staged, or reaches for an accusing word to describe a mismatch — not in a code, not in a
 *    message, not in a comment, this one included. A geometry check is not an accusation — it
 *    is a note that two parts of the same account do not line up, which is usually a customer
 *    mis-remembering under stress after a bad afternoon. Every sentence here should read fine
 *    out loud to the person it is about.
 * 3. Nothing here ever blocks anything. `findings` only ever adds a card to the desk; sending
 *    a report never asks it anything.
 */
import { vehicleName, cap } from './describe'
import type { Claim, ClaimVehicle } from './schema'
import { bearing, distance, type LngLat } from '../geo'
import { REACH } from './suggest'
import { SIZE, toModel } from '../vehicles/bodies'
import { zoneById, type V3, type Vehicle } from '../zones'

export type Finding = {
  /** a stable identifier, snake_case, for a desk to filter on */
  code: string
  /** `note` is context; `look` is something an adjuster should actually check */
  level: 'note' | 'look'
  /** one sentence, English, desk voice */
  text: string
  /** the numbers behind it, so an adjuster can judge the rule rather than trust it */
  evidence: string
}

// ── shared geometry ──────────────────────────────────────────────────

type Side = 'front' | 'rear' | 'left' | 'right'
const OPPOSITE: Record<Side, Side> = { front: 'rear', rear: 'front', left: 'right', right: 'left' }

/** the quadrant a point in the car's own frame is nearest to; left is +X, the insurance convention */
const sideOf = ([x, , z]: V3): Side => (Math.abs(x) > Math.abs(z) ? (x > 0 ? 'left' : 'right') : z > 0 ? 'front' : 'rear')

/** the shortest angle between two bearings, 0–180 */
const angleDiff = (a: number, b: number) => Math.abs((((b - a + 540) % 360) - 180))

/** a point turned into the car's own frame, the same conversion `suggest.ts` uses for the impact */
function impactFrame(position: LngLat, heading: number, body: Vehicle, impact: LngLat): V3 {
  const d = distance(position, impact)
  const around = bearing(position, impact) - heading
  const rad = (around * Math.PI) / 180
  return toModel(body, [-d * Math.sin(rad), 0, d * Math.cos(rad)])
}

const positioned = (v: ClaimVehicle): v is Positioned => v.position !== null

/** true when every mark this vehicle carries is on `side`, and it carries at least one */
function markedOnlyAt(v: ClaimVehicle, side: Side): boolean {
  let any = false
  for (const d of v.damages) {
    const zone = zoneById(v.body, d.zone)
    if (!zone) continue
    any = true
    if (sideOf(zone.anchor) !== side) return false
  }
  return any
}

// ── the checks ───────────────────────────────────────────────────────

/**
 * A vehicle marked as damaged only on the side of itself facing directly away from where the
 * diagram puts the impact. The two do not have to agree exactly — a hit near a corner can
 * plausibly mark either of the two panels it sits between — but a mark and an impact on
 * opposite ends of the car are a diagram worth a second look before the panels are quoted.
 */
function panelVsImpact(claim: Claim): Finding[] {
  const out: Finding[] = []
  if (!claim.impact) return out
  for (const v of claim.vehicles) {
    if (!v.position || v.damages.length === 0) continue
    const frame = impactFrame(v.position, v.heading, v.body, claim.impact)
    const impactSide = sideOf(frame)
    const markSides = new Set<Side>()
    for (const d of v.damages) {
      const zone = zoneById(v.body, d.zone)
      if (zone) markSides.add(sideOf(zone.anchor))
    }
    if (markSides.size !== 1) continue
    const [markSide] = markSides
    if (markSide !== OPPOSITE[impactSide]) continue
    out.push({
      code: 'panel_vs_impact',
      level: 'look',
      text: `Marked on the ${markSide} of ${vehicleName(v)}, but the point of impact in the diagram is at its ${impactSide}.`,
      evidence: `impact at (x=${frame[0].toFixed(2)}, z=${frame[2].toFixed(2)}) → ${impactSide}; every mark anchored at the ${markSide}`,
    })
  }
  return out
}

/**
 * The angle between the way a vehicle's route arrives and the way it is drawn facing at rest.
 * A car really can end up facing the way it came from, after a spin — that is exactly why this
 * is a note for an adjuster to weigh rather than a verdict, and why it is a `look` and not
 * something stronger.
 */
export const BACKWARDS_DEGREES = 120

function arrivedBackwards(claim: Claim): Finding[] {
  const out: Finding[] = []
  for (const v of claim.vehicles) {
    if (!v.position || v.path.length === 0) continue
    const last = v.path[v.path.length - 1]
    const travel = bearing(last, v.position)
    const diff = angleDiff(travel, v.heading)
    if (diff <= BACKWARDS_DEGREES) continue
    out.push({
      code: 'arrived_backwards',
      level: 'look',
      text: `${cap(vehicleName(v))}'s route arrives heading ${Math.round(travel)}°, but it is drawn resting at ${Math.round(v.heading)}° — as if it had been travelling backwards to get there.`,
      evidence: `travel bearing ${travel.toFixed(0)}°, resting heading ${v.heading.toFixed(0)}°, difference ${diff.toFixed(0)}°`,
    })
  }
  return out
}

/** a vehicle marked as damaged from further away than its own length could reach the impact */
function damageWithoutReach(claim: Claim): Finding[] {
  const out: Finding[] = []
  if (!claim.impact) return out
  for (const v of claim.vehicles) {
    if (!v.position || v.damages.length === 0) continue
    const d = distance(v.position, claim.impact)
    const max = SIZE[v.body].length / 2 + REACH
    if (d <= max) continue
    out.push({
      code: 'damage_without_reach',
      level: 'look',
      text: `${cap(vehicleName(v))} is marked as damaged but stands ${d.toFixed(0)} m from the point of impact.`,
      evidence: `distance ${d.toFixed(1)} m, reach ${max.toFixed(1)} m (half-length ${(SIZE[v.body].length / 2).toFixed(2)} m + ${REACH} m)`,
    })
  }
  return out
}

/** two vehicles drawn standing inside one another by more than a token overlap */
export const OVERLAP_METRES = 1

type Positioned = ClaimVehicle & { position: LngLat }

/**
 * How far two drawn footprints push into each other — the separating-axis test on the two
 * rotated rectangles `SIZE` gives, in metres east/north of `a`. The overlap on each of the four
 * axes (each car's length and width) is the sum of the two footprints' half-extents along it
 * less the distance between centres along it; the smallest of the four is how far they would
 * have to move apart to stop touching. Zero or less means some axis separates them. A T-bone
 * or a sideswipe drawn bumper-to-door is exactly zero here, where a test on half-lengths alone
 * called both of them overlapping by metres.
 */
function penetration(a: Positioned, b: Positioned): number {
  const d = distance(a.position, b.position)
  const toward = (bearing(a.position, b.position) * Math.PI) / 180
  const between: [number, number] = [d * Math.sin(toward), d * Math.cos(toward)]
  const frame = (heading: number): [number, number][] => {
    const h = (heading * Math.PI) / 180
    return [
      [Math.sin(h), Math.cos(h)], // along its length
      [Math.cos(h), -Math.sin(h)], // across its width
    ]
  }
  const dot = (p: [number, number], q: [number, number]) => p[0] * q[0] + p[1] * q[1]
  const reach = ([along, across]: [number, number][], body: Vehicle, axis: [number, number]) =>
    (SIZE[body].length / 2) * Math.abs(dot(along, axis)) + (SIZE[body].width / 2) * Math.abs(dot(across, axis))
  const fa = frame(a.heading)
  const fb = frame(b.heading)
  return Math.min(...[...fa, ...fb].map((axis) => reach(fa, a.body, axis) + reach(fb, b.body, axis) - Math.abs(dot(between, axis))))
}

function bodiesOverlap(claim: Claim): Finding[] {
  const out: Finding[] = []
  const vs = claim.vehicles.filter(positioned)
  for (let i = 0; i < vs.length; i++) {
    for (let j = i + 1; j < vs.length; j++) {
      const a = vs[i]
      const b = vs[j]
      const overlap = penetration(a, b)
      if (overlap <= OVERLAP_METRES) continue
      out.push({
        code: 'bodies_overlap',
        level: 'look',
        text: `${cap(vehicleName(a))} and ${vehicleName(b)} are drawn overlapping by ${overlap.toFixed(1)} m.`,
        evidence: `footprints overlap by ${overlap.toFixed(1)} m on their least-overlapping axis; centres ${distance(a.position, b.position).toFixed(1)} m apart`,
      })
    }
  }
  return out
}

/**
 * Two vehicles heading close enough to the same way to read as one behind the other — a
 * rear-end — where the panels marked do not fit that story: the leading vehicle should have
 * been struck at its rear, not its front, and the trailing one should have struck with its
 * front, not its rear.
 */
export const SAME_DIRECTION_DEGREES = 30

function rearEndVsPanels(claim: Claim): Finding[] {
  const out: Finding[] = []
  const vs = claim.vehicles.filter(positioned)
  for (let i = 0; i < vs.length; i++) {
    for (let j = i + 1; j < vs.length; j++) {
      const a = vs[i]
      const b = vs[j]
      if (angleDiff(a.heading, b.heading) >= SAME_DIRECTION_DEGREES) continue
      const d = distance(a.position, b.position)
      if (d === 0) continue
      // the vector from a to b, projected onto the shared heading: positive means b sits
      // ahead of a along that heading, negative means a sits ahead of b
      const proj = d * Math.cos(((bearing(a.position, b.position) - a.heading) * Math.PI) / 180)
      const [front, behind] = proj > 0 ? [b, a] : [a, b]
      if (markedOnlyAt(front, 'front')) {
        out.push({
          code: 'rear_end_vs_panels',
          level: 'look',
          text: `${cap(vehicleName(front))} is drawn ahead of ${vehicleName(behind)} in what looks like a rear-end, but it is marked only at its front — the leading vehicle in a rear-end is struck at its rear.`,
          evidence: `heading difference ${angleDiff(a.heading, b.heading).toFixed(0)}°, ${vehicleName(front)} ${Math.abs(proj).toFixed(1)} m ahead`,
        })
      }
      if (markedOnlyAt(behind, 'rear')) {
        out.push({
          code: 'rear_end_vs_panels',
          level: 'look',
          text: `${cap(vehicleName(behind))} is drawn behind ${vehicleName(front)} in what looks like a rear-end, but it is marked only at its rear — the trailing vehicle in a rear-end strikes with its front.`,
          evidence: `heading difference ${angleDiff(a.heading, b.heading).toFixed(0)}°, ${vehicleName(behind)} ${Math.abs(proj).toFixed(1)} m behind`,
        })
      }
    }
  }
  return out
}

/** the WMO present-weather codes `src/scene/weather.ts` reads as rain or snow, mirrored here */
const isRainOrSnowCode = (code: number) =>
  (code >= 51 && code <= 67) || (code >= 71 && code <= 77) || code === 80 || code === 81 || code === 82 || code === 85 || code === 86 || (code >= 95 && code <= 99)

/** how far below the horizon counts as no longer daylight */
export const SUN_BELOW_HORIZON_DEGREES = -6

/**
 * What the customer remembers of the conditions against what the public record says for that
 * place and hour. A memory of the weather is the single shakiest thing on a claim form — people
 * notice the crash, not the drizzle — so this is only ever a `note`, never a `look`.
 */
function storyVsRecord(claim: Claim): Finding[] {
  const out: Finding[] = []
  const { conditions, context } = claim.incident
  if (!context) return out
  if (conditions.weather === 'clear' && context.weather && isRainOrSnowCode(context.weather.code)) {
    out.push({
      code: 'story_vs_record',
      level: 'note',
      text: `The report describes the weather as clear, but the public record for that time and place shows ${context.weather.label.toLowerCase()}.`,
      evidence: `conditions.weather=clear, record weather code ${context.weather.code} (${context.weather.label})`,
    })
  }
  if (conditions.road === 'dry' && context.weather && context.weather.precipMm !== null && context.weather.precipMm > 0) {
    out.push({
      code: 'story_vs_record',
      level: 'note',
      text: `The report describes the road as dry, but the public record shows ${context.weather.precipMm} mm of precipitation that hour.`,
      evidence: `conditions.road=dry, record precipitation ${context.weather.precipMm} mm`,
    })
  }
  if (conditions.light === 'daylight' && context.sun && context.sun.altitude < SUN_BELOW_HORIZON_DEGREES) {
    out.push({
      code: 'story_vs_record',
      level: 'note',
      text: `The report describes it as daylight, but the public record puts the sun ${Math.abs(context.sun.altitude).toFixed(0)}° below the horizon at that time.`,
      evidence: `conditions.light=daylight, sun altitude ${context.sun.altitude.toFixed(1)}°`,
    })
  }
  return out
}

/** how early a photograph's own metadata can put it before the stated time and still just be an early arrival */
export const PHOTO_EARLY_MINUTES = -10

function photoBeforeIncident(claim: Claim): Finding[] {
  const out: Finding[] = []
  for (const p of claim.attachments.photos) {
    if (p.minutesFromIncident === undefined || p.minutesFromIncident >= PHOTO_EARLY_MINUTES) continue
    out.push({
      code: 'photo_before_incident',
      level: 'look',
      text: `A photograph was taken ${Math.abs(p.minutesFromIncident)} minutes before the stated time.`,
      evidence: `minutesFromIncident ${p.minutesFromIncident}`,
    })
  }
  return out
}

/** how far a photograph's own metadata can put it from the scene before a poor fix stops explaining it */
export const PHOTO_FAR_METRES = 500

function photoFarFromScene(claim: Claim): Finding[] {
  const out: Finding[] = []
  for (const p of claim.attachments.photos) {
    if (p.metresFromScene === undefined || p.metresFromScene <= PHOTO_FAR_METRES) continue
    out.push({
      code: 'photo_far_from_scene',
      level: 'note',
      text: `A photograph was taken ${p.metresFromScene} m from the scene.`,
      evidence: `metresFromScene ${p.metresFromScene}`,
    })
  }
  return out
}

/** everything the diagram and the rest of the report say about themselves worth an adjuster's look, `look` first */
export function findings(claim: Claim): Finding[] {
  const all = [
    ...panelVsImpact(claim),
    ...arrivedBackwards(claim),
    ...damageWithoutReach(claim),
    ...bodiesOverlap(claim),
    ...rearEndVsPanels(claim),
    ...storyVsRecord(claim),
    ...photoBeforeIncident(claim),
    ...photoFarFromScene(claim),
  ]
  return [...all.filter((f) => f.level === 'look'), ...all.filter((f) => f.level === 'note')]
}
