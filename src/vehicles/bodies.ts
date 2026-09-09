/**
 * How each body is sized and shown. `zones.ts` is about damage and has no reason to hold this.
 *
 * **Proportions are why the kit looks like a toy.** Kenney's sedan measures 1.50 wide by 1.45
 * tall by 2.55 long; a real saloon is 1.84 × 1.45 × 4.88. Relative to its length the kit car
 * is more than half again too wide and too tall, which is the stubby cube-car silhouette a
 * person reads as a cartoon. Every body is therefore stretched to the real dimensions of its
 * class, per axis, and after that one model unit is one metre everywhere: on the map, in the
 * studio previews and in the damage marker.
 *
 * The scale is a *rendering* transform. Damage points and zone anchors stay in the kit's own
 * units, because `claim-marker/1` records them that way and a stored claim must keep meaning
 * what it meant. `toWorld` and `toModel` convert at the two boundaries.
 */
import type { V3, Vehicle } from '../zones'

/** typical real dimensions of each class, in metres: length, width, height */
export const SIZE: Record<Vehicle, { length: number; width: number; height: number }> = {
  sedan: { length: 4.88, width: 1.84, height: 1.45 },
  hatchback: { length: 4.33, width: 1.8, height: 1.47 },
  coupe: { length: 4.7, width: 1.87, height: 1.36 },
  suv: { length: 4.7, width: 1.92, height: 1.7 },
  truck: { length: 5.89, width: 2.03, height: 1.96 },
  van: { length: 5.53, width: 2.03, height: 2.55 },
  box_truck: { length: 6.6, width: 2.24, height: 3.25 },
}

/**
 * Per-axis scale from kit units to metres, measured from each model's own bounding box
 * against `SIZE` (see `scripts/profile-body.mjs`). x is width, y is height, z is length.
 */
export const PROPORTION: Record<Vehicle, V3> = {
  sedan: [1.227, 1.0, 1.914],
  hatchback: [1.385, 1.176, 1.519],
  coupe: [1.438, 1.088, 1.843],
  suv: [1.28, 1.214, 1.843],
  truck: [1.353, 1.352, 1.997],
  van: [1.353, 1.759, 2.011],
  box_truck: [1.493, 1.3, 2.031],
}

/** a point in the kit's units → metres */
export const toWorld = (body: Vehicle, [x, y, z]: V3): V3 => {
  const s = PROPORTION[body]
  return [x * s[0], y * s[1], z * s[2]]
}

/** a point in metres → the kit's units, which is what zones and the document speak */
export const toModel = (body: Vehicle, [x, y, z]: V3): V3 => {
  const s = PROPORTION[body]
  return [x / s[0], y / s[1], z / s[2]]
}

/** a zone's tint radius in metres; the axes differ, so the mean is the honest approximation */
export const radiusToWorld = (body: Vehicle, radius: number) => {
  const s = PROPORTION[body]
  return (radius * (s[0] + s[1] + s[2])) / 3
}

/** the ids shown to a customer, in the order they are offered */
export const BODY_ORDER = ['sedan', 'hatchback', 'coupe', 'suv', 'truck', 'van', 'box_truck'] as const
