/**
 * Which panel took the hit, worked out from the diagram: the point of impact, seen from the
 * vehicle's centre and turned into the vehicle's own frame, lands nearest one zone's anchor.
 * That zone is marked as damaged before the customer reaches the damage step, so they adjust
 * a suggestion rather than start from a clean car.
 */
import { bearing, distance, type LngLat } from '../geo'
import { damage, type Damage } from '../schema'
import { SIZE, toModel } from '../vehicles/bodies'
import { zonesOf, type Zone } from '../zones'
import type { ClaimVehicle } from './schema'

/** how far beyond the bumper the impact can sit and still be this vehicle's hit, in metres */
export const REACH = 1.5
/** never the first thing blamed for a collision: glass, the roof, a mirror */
const NEVER = /roof|window|windshield|mirror/
/** this close to head-on or rear-end it is the bumper's hit, whatever corner light sits nearer the point */
const AXIS = 25

export function hitZone(v: Pick<ClaimVehicle, 'body' | 'position' | 'heading'>, impact: LngLat): Zone | null {
  if (!v.position) return null
  const d = distance(v.position, impact)
  if (d > SIZE[v.body].length / 2 + REACH) return null
  // where the impact is, seen from the nose: 0 dead ahead, 90 on the right-hand side
  const around = (((bearing(v.position, impact) - v.heading) % 360) + 360) % 360
  const zones = zonesOf(v.body)
  // the common collisions first: head-on and rear-end are the bumpers, not the lights beside them
  const axial = around <= AXIS || around >= 360 - AXIS ? 'front_bumper' : Math.abs(around - 180) <= AXIS ? 'rear_bumper' : null
  const bumper = axial && zones.find((zone) => zone.id === axial)
  if (bumper) return bumper
  // into the vehicle's frame: nose +Z, and its left is +X, so the right-hand side is −X
  const rel = (around * Math.PI) / 180
  const [x, , z] = toModel(v.body, [-d * Math.sin(rel), 0, d * Math.cos(rel)])
  let best: Zone | null = null
  let bestD = Infinity
  for (const zone of zones) {
    if (NEVER.test(zone.id)) continue
    // the impact is on the ground, so only where it is around the car matters, not how high;
    // and a panel reaches its radius out from its anchor, so a bumper — one anchor, the whole
    // width — is not beaten by the corner light beside it on an offset hit
    const dd = Math.max(0, Math.hypot(zone.anchor[0] - x, zone.anchor[2] - z) - zone.radius)
    if (dd < bestD) {
      bestD = dd
      best = zone
    }
  }
  return best
}

/** the suggested damage for a vehicle, or null when the impact is not its hit */
export function suggestDamage(v: Pick<ClaimVehicle, 'body' | 'position' | 'heading'>, impact: LngLat): Damage | null {
  const zone = hitZone(v, impact)
  return zone ? damage(zone.id, zone.anchor, 'dent') : null
}
