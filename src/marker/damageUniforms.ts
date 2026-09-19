/**
 * The marks on a body, packed for the damage shader (`damageShader.ts`): flat typed arrays a
 * uniform can take as they are. Pure, with no value import of three, so the packing is
 * unit-tested in plain node; the shader module is the only thing that turns it into GPU state.
 *
 * Points are in the body's own metres — the kit's units through `toWorld`, which is the
 * studio's world frame and the frame the shader compares in on the map too, so a mark stays
 * put when the car is moved or turned. The kind of a mark is `claim-marker/1`'s `severity`,
 * which is what the picker offers: scratch, dent, crack, missing.
 */
import { type Damage, type Severity } from '../schema'
import { radiusToWorld, toWorld } from '../vehicles/bodies'
import { zoneById, type Vehicle } from '../zones'

/** the shader takes this many marks; the rest keep their pins and no more */
export const MAX_MARKS = 12

/** the kind code the shader branches on, per `claim-marker/1` severity */
export const KIND: Record<Severity, number> = { scratch: 0, dent: 1, crack: 2, missing: 3 }
/** a missing *wheel* is its own code: only the wheel takes it, and a missing fender leaves the tyre beside it alone */
export const KIND_MISSING_WHEEL = 4

/** how far a mark reaches on the panel, in metres; a missing part reaches as far as its zone */
export const RADIUS_M: Record<Severity, number> = { scratch: 0.28, dent: 0.22, crack: 0.26, missing: 0.4 }

/** how much of the body's damage one mark is: the dish's depth, and the severity map's heat */
export const WEIGHT: Record<Severity, number> = { scratch: 0.35, dent: 0.6, crack: 0.8, missing: 1 }

/**
 * Whether the shader draws this mark at all, by what its zone is made of: a dent or a scratch
 * on bodywork, a crack on glass or a lamp, a missing part anywhere. The shader itself decides
 * per material role inside the mark's reach, and a zone's sphere can spill onto another surface
 * — a windshield's onto the pillars, a headlight's onto the fender — so a kind the zone does
 * not take may still show a sliver there; the pin follows the zone, and stays a numbered pin
 * then. Conservative on purpose: a mark must never vanish from the customer's view.
 */
export function renders(d: Damage, body: Vehicle): boolean {
  if (!zoneById(body, d.zone)) return false
  const surface = /wheel/.test(d.zone) ? 'wheel' : /windshield|rear_window|headlight|taillight/.test(d.zone) ? 'glass' : 'bodywork'
  if (d.severity === 'missing') return true
  if (d.severity === 'crack') return surface === 'glass'
  return surface === 'bodywork'
}

export type DamagePack = {
  count: number
  /** xyz per mark, body metres */
  points: Float32Array
  radii: Float32Array
  severities: Float32Array
  kinds: Float32Array
}

export function damageUniforms(damages: Damage[], body: Vehicle): DamagePack {
  const points = new Float32Array(MAX_MARKS * 3)
  const radii = new Float32Array(MAX_MARKS)
  const severities = new Float32Array(MAX_MARKS)
  const kinds = new Float32Array(MAX_MARKS)
  const marks = damages.slice(0, MAX_MARKS)
  marks.forEach((d, i) => {
    // a missing part is the whole panel: the zone's measured anchor and reach, not the tap
    const zone = d.severity === 'missing' ? zoneById(body, d.zone) : undefined
    points.set(toWorld(body, zone ? zone.anchor : d.point), i * 3)
    radii[i] = zone ? radiusToWorld(body, zone.radius) : RADIUS_M[d.severity]
    severities[i] = WEIGHT[d.severity]
    kinds[i] = zone && /wheel/.test(zone.id) ? KIND_MISSING_WHEEL : KIND[d.severity]
  })
  return { count: marks.length, points, radii, severities, kinds }
}
