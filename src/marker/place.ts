/**
 * Where each car stands in the reconstruction — the studio's frame, three's y-up, metres — with
 * the impact at the origin, east +x and north −z. It is the map layer's placement read in
 * metres instead of mercator units: the same `mercator` offset from the same origin that
 * `vehicleMatrix` translates by, divided by the metre at the impact, so a car stands exactly
 * where the diagram put it. Mercator runs (east, south); so does the studio's (x, z).
 *
 * The heading is a compass bearing, clockwise from north. The body's nose is +Z and its left
 * +X; three's rotation-y turns +Z to (sin r, 0, cos r), and the nose must point at
 * (sin h, 0, −cos h), so r = π − h. Both frames are right-handed here — unlike the map's,
 * where `CAR_BASIS` has determinant −1 — so the car's left lands on its left with no mirror.
 * `test/place.test.ts` checks the offset, the nose and the left against `vehicleMatrix` itself.
 */
import { toRad, type LngLat } from '../geo'
import { mercator, metresToMercator } from '../map/transform'
import type { V3 } from '../zones'

export type Placed = { id: string; position: V3; rotationY: number }

export function placeVehicles(vehicles: { id: string; position: LngLat; heading: number }[], impact: LngLat): Placed[] {
  const o = mercator(impact)
  const metre = metresToMercator(impact[1])
  return vehicles.map((v) => {
    const m = mercator(v.position)
    return { id: v.id, position: [(m.x - o.x) / metre, 0, (m.y - o.y) / metre], rotationY: Math.PI - toRad(v.heading) }
  })
}
