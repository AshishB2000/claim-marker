/**
 * Damage zones as named anchor points on each body.
 *
 * Frame (glTF, which Kenney's kit follows): nose at +Z, up +Y, and the car's LEFT at +X, its
 * right at −X — left and right as seen from the driver's seat, the insurance convention. That
 * is what a right-handed frame with the nose at +Z forces: face +Z with +Y up and your right
 * hand is at −X, which is also what the glTF spec says of an asset's front. Kenney's node
 * names agree (`wheel-front-left` sits at +X). v1–v3 documented the opposite and every
 * `right_*` zone was on the driver's left; fixed in v4 at the one place it originates, the
 * `pair()` helper below. Nose confirmed at +Z by rendering both ends: amber headlights at +Z,
 * red taillights at −Z.
 *
 * Every anchor below is placed against measurements from `scripts/profile-body.mjs`, not by
 * eye. Run it when adding a body; the numbers in each block's comment come from its output.
 *
 * Zone sets differ per body — a single-cab pickup has no rear doors and its rear flank is a
 * bed side, not a quarter panel. That is the whole reason zones are data.
 */

export type V3 = [number, number, number]

const LABEL_OVERRIDE: Record<string, string> = { trunk: 'Trunk / tailgate' }

const label = (id: string) =>
  LABEL_OVERRIDE[id] ?? id.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

const one = <T extends string>(id: T, anchor: V3, radius: number) =>
  [{ id, label: label(id), anchor, radius }] as const

/** mirrored pair; the given anchor is the car's left (+X) side, see the frame note above */
const pair = <T extends string>(id: T, [x, y, z]: V3, radius: number) =>
  [
    { id: `left_${id}` as const, label: label(`left_${id}`), anchor: [x, y, z] as V3, radius },
    { id: `right_${id}` as const, label: label(`right_${id}`), anchor: [-x, y, z] as V3, radius },
  ] as const

// sedan — body x ±0.75 (skin ±0.65), y 0.15–1.30, z −1.30–1.25; beltline 0.70; roof 1.30
// spanning z −0.59–0.21; wheels z ±0.66; mirrors |x|>0.68, y 0.70–0.80, z 0.32–0.42
const SEDAN_ZONES = [
  ...one('front_bumper', [0, 0.34, 1.24], 0.45),
  ...one('hood', [0, 0.76, 0.78], 0.5),
  ...one('windshield', [0, 1.06, 0.26], 0.32),
  ...one('roof', [0, 1.3, -0.2], 0.45),
  ...one('rear_window', [0, 1.04, -0.65], 0.28),
  ...one('trunk', [0, 0.7, -1.02], 0.36),
  ...one('rear_bumper', [0, 0.36, -1.28], 0.45),
  ...pair('headlight', [0.45, 0.58, 1.2], 0.2),
  ...pair('front_fender', [0.65, 0.58, 0.92], 0.3),
  ...pair('mirror', [0.72, 0.76, 0.37], 0.15),
  ...pair('front_door', [0.65, 0.5, 0.16], 0.34),
  ...pair('rear_door', [0.65, 0.5, -0.32], 0.34),
  ...pair('rear_quarter_panel', [0.65, 0.56, -0.9], 0.32),
  ...pair('taillight', [0.45, 0.6, -1.25], 0.2),
  ...pair('front_wheel', [0.42, 0.3, 0.66], 0.3),
  ...pair('rear_wheel', [0.42, 0.3, -0.66], 0.3),
] as const

// suv — body y 0.20–1.30, z −1.20–1.35; beltline 0.90; roof 1.30 spanning z −1.05–0.43;
// hood y 0.80; wheels z +0.76 / −0.56; mirrors y 0.70–0.90, z 0.42–0.52; spare on the tailgate.
// Taller and boxier than the sedan: the tailgate stacks rear window / trunk / bumper almost
// vertically, so those three separate on Y rather than Z.
const SUV_ZONES = [
  ...one('front_bumper', [0, 0.44, 1.33], 0.45),
  ...one('hood', [0, 0.82, 1.02], 0.42),
  ...one('windshield', [0, 1.12, 0.52], 0.3),
  ...one('roof', [0, 1.3, -0.3], 0.5),
  ...one('rear_window', [0, 1.14, -1.16], 0.26),
  ...one('trunk', [0, 0.76, -1.24], 0.3),
  ...one('rear_bumper', [0, 0.38, -1.26], 0.4),
  ...pair('headlight', [0.46, 0.66, 1.31], 0.2),
  ...pair('front_fender', [0.65, 0.62, 1.02], 0.28),
  ...pair('mirror', [0.72, 0.8, 0.47], 0.15),
  ...pair('front_door', [0.65, 0.6, 0.26], 0.32),
  ...pair('rear_door', [0.65, 0.6, -0.26], 0.32),
  ...pair('rear_quarter_panel', [0.65, 0.66, -0.86], 0.3),
  ...pair('taillight', [0.48, 0.96, -1.2], 0.2),
  ...pair('front_wheel', [0.42, 0.3, 0.76], 0.3),
  ...pair('rear_wheel', [0.42, 0.3, -0.56], 0.3),
] as const

// truck — body y 0.15–1.30, z −1.50–1.45; cabin only z −0.09–0.41, so it is a single cab:
// no rear doors, and the rear flank is the cargo bed. Hood y 0.70; wheels z +0.86 / −0.76;
// mirrors y 0.70–0.80, z 0.52–0.62; tailgate at z −1.50 rising to y 0.80.
const TRUCK_ZONES = [
  ...one('front_bumper', [0, 0.36, 1.44], 0.45),
  ...one('hood', [0, 0.72, 1.1], 0.42),
  ...one('windshield', [0, 1.06, 0.5], 0.28),
  ...one('roof', [0, 1.3, 0.16], 0.3),
  ...one('rear_window', [0, 1.04, -0.14], 0.24),
  ...one('trunk', [0, 0.66, -1.46], 0.4),
  ...one('rear_bumper', [0, 0.3, -1.5], 0.4),
  ...pair('headlight', [0.46, 0.56, 1.42], 0.2),
  ...pair('front_fender', [0.65, 0.58, 1.12], 0.3),
  ...pair('mirror', [0.72, 0.76, 0.57], 0.15),
  ...pair('front_door', [0.65, 0.52, 0.2], 0.32),
  ...pair('bed_side', [0.65, 0.62, -0.8], 0.45),
  ...pair('taillight', [0.48, 0.6, -1.44], 0.2),
  ...pair('front_wheel', [0.42, 0.3, 0.86], 0.3),
  ...pair('rear_wheel', [0.42, 0.3, -0.76], 0.3),
] as const

// hatchback — body x ±0.65 (no mirrors), y 0.15–1.10, z −1.45–1.40; wheels z ±0.81. Two-door:
// one door z −0.42–0.42 with its window at y 0.80–1.00, then a quarter panel. Hood y 0.80→0.60
// over z 0.57→1.29; windshield y 0.98→0.80 over z 0.33→0.57; roof y 1.10 z −0.74–0.17; the
// rear window is a dark pane at y 1.10, z −0.94–−0.74; the hatch slopes y 0.99→0.80 over
// z −0.94→−1.30 with the taillights on it at y 0.82–0.89, |x| 0.42–0.55; headlights y 0.50–0.59
// at z 1.30.
const HATCHBACK_ZONES = [
  ...one('front_bumper', [0, 0.42, 1.3], 0.45),
  ...one('hood', [0, 0.72, 0.95], 0.45),
  ...one('windshield', [0, 0.9, 0.44], 0.3),
  ...one('roof', [0, 1.1, -0.25], 0.45),
  ...one('rear_window', [0, 1.09, -0.84], 0.22),
  ...one('trunk', [0, 0.86, -1.2], 0.35),
  ...one('rear_bumper', [0, 0.45, -1.32], 0.4),
  ...pair('headlight', [0.48, 0.55, 1.3], 0.2),
  ...pair('front_fender', [0.6, 0.62, 1.02], 0.3),
  ...pair('front_door', [0.6, 0.6, 0], 0.45),
  ...pair('rear_quarter_panel', [0.56, 0.78, -0.85], 0.35),
  ...pair('taillight', [0.48, 0.86, -1.2], 0.2),
  ...pair('front_wheel', [0.42, 0.3, 0.81], 0.3),
  ...pair('rear_wheel', [0.42, 0.3, -0.81], 0.3),
] as const

// coupe — body x ±0.65 (no mirrors), y 0.15–1.10, z −1.30–1.25; wheels z ±0.66. Two-door: one
// door z −0.42–0.37 with its window at y 0.80–1.00. Hood y 0.80→0.60 over z 0.55→1.15;
// windshield y 1.04→0.80 over z 0.23→0.55; roof y 1.10 z −0.55–0.15; rear window y 1.03→0.87
// over z −0.62→−0.78; trunk lid y 0.84→0.75 behind it, carrying a spoiler (its own mesh, world
// y 0.60–0.90, z −1.19–−0.95) that counts as trunk. Headlights sit on top of the nose at
// y 0.60–0.67, z 1.03–1.15; taillights y 0.60–0.69 at z −1.25, |x| 0.41–0.55.
const COUPE_ZONES = [
  ...one('front_bumper', [0, 0.4, 1.16], 0.45),
  ...one('hood', [0, 0.76, 0.85], 0.42),
  ...one('windshield', [0, 0.92, 0.4], 0.3),
  ...one('roof', [0, 1.1, -0.2], 0.42),
  ...one('rear_window', [0, 0.95, -0.7], 0.24),
  ...one('trunk', [0, 0.82, -1.0], 0.35),
  ...one('rear_bumper', [0, 0.42, -1.22], 0.4),
  ...pair('headlight', [0.42, 0.64, 1.1], 0.2),
  ...pair('front_fender', [0.6, 0.62, 0.92], 0.3),
  ...pair('front_door', [0.6, 0.6, -0.03], 0.45),
  ...pair('rear_quarter_panel', [0.56, 0.76, -0.72], 0.32),
  ...pair('taillight', [0.48, 0.65, -1.18], 0.2),
  ...pair('front_wheel', [0.42, 0.3, 0.66], 0.3),
  ...pair('rear_wheel', [0.42, 0.3, -0.66], 0.3),
] as const

// van — body x ±0.75 (skin ±0.65), y 0.15–1.35, z −1.40–1.35; wheels z ±0.76; mirrors |x|>0.67,
// y 0.70–0.90, z 0.52–0.62. Panel van: one door each side (window z 0.20–0.73, y 0.80–1.19)
// and a blank cargo flank behind it, z −1.35–0.18, up to y 1.25 — no rear door and no quarter
// panel. Hood y 0.80→0.71 over z 0.85→1.19; windshield y 1.21→0.81 over z 0.68→0.84; roof
// y 1.30–1.35 over z −1.15–0.64; glazed tailgate: window y 0.89–1.21 at z −1.32–−1.19, panel
// y 0.50–0.89 at z −1.35 carrying the taillights at y 0.60–0.69, |x| 0.28–0.55; headlights
// y 0.62–0.71 at z 1.17–1.25.
const VAN_ZONES = [
  ...one('front_bumper', [0, 0.44, 1.26], 0.45),
  ...one('hood', [0, 0.76, 1.02], 0.36),
  ...one('windshield', [0, 1.02, 0.76], 0.3),
  ...one('roof', [0, 1.34, -0.3], 0.6),
  ...one('rear_window', [0, 1.06, -1.25], 0.26),
  ...one('trunk', [0, 0.72, -1.35], 0.32),
  ...one('rear_bumper', [0, 0.42, -1.33], 0.4),
  ...pair('headlight', [0.45, 0.66, 1.22], 0.2),
  ...pair('front_fender', [0.6, 0.62, 1.0], 0.3),
  ...pair('mirror', [0.72, 0.8, 0.57], 0.15),
  ...pair('front_door', [0.58, 0.75, 0.42], 0.4),
  ...pair('cargo_side', [0.56, 0.9, -0.75], 0.6),
  ...pair('taillight', [0.42, 0.65, -1.35], 0.2),
  ...pair('front_wheel', [0.42, 0.3, 0.76], 0.3),
  ...pair('rear_wheel', [0.42, 0.3, -0.76], 0.3),
] as const

// box_truck — body x ±0.75 (skin ±0.65), y 0.15–1.65, z −1.65–1.60; wheels z +1.01 / −0.61;
// mirrors |x|>0.67, y 0.70–0.90, z 0.77–0.87. A cab over z 0.45–1.60 (hood y 0.80→0.70 over
// z 1.10→1.50, windshield y 1.21→0.81 over z 0.94→1.10, roof y 1.40 z 0.45–0.75, one door each
// side with its window at z 0.46–0.99) in front of a box over z −1.60–0.44 (roof y 1.60, sides
// at x 0.65 up to y 1.59). The rear is a separate `door` mesh — a roll-up shutter, x ±0.55,
// y 0.50–1.50 at z −1.50–−1.57 — inside a painted frame; taillights y 0.40–0.49 at z −1.60,
// |x| 0.45–0.65; headlights y 0.60–0.69 at z 1.50. The cab's rear window faces the box wall
// and cannot be tapped, so there is no rear_window.
const BOX_TRUCK_ZONES = [
  ...one('front_bumper', [0, 0.42, 1.5], 0.45),
  ...one('hood', [0, 0.76, 1.3], 0.36),
  ...one('windshield', [0, 1.02, 1.01], 0.32),
  ...one('roof', [0, 1.4, 0.62], 0.3),
  ...one('cargo_roof', [0, 1.6, -0.6], 0.9),
  ...one('cargo_door', [0, 1.0, -1.54], 0.5),
  ...one('rear_bumper', [0, 0.36, -1.62], 0.4),
  ...pair('headlight', [0.42, 0.65, 1.5], 0.2),
  ...pair('front_fender', [0.6, 0.62, 1.25], 0.3),
  ...pair('mirror', [0.72, 0.8, 0.82], 0.15),
  ...pair('front_door', [0.58, 0.8, 0.68], 0.4),
  ...pair('cargo_side', [0.65, 1.05, -0.6], 0.9),
  ...pair('taillight', [0.55, 0.45, -1.6], 0.2),
  ...pair('front_wheel', [0.42, 0.3, 1.01], 0.3),
  ...pair('rear_wheel', [0.42, 0.3, -0.61], 0.3),
] as const

export type ZoneId =
  | (typeof SEDAN_ZONES)[number]['id']
  | (typeof SUV_ZONES)[number]['id']
  | (typeof TRUCK_ZONES)[number]['id']
  | (typeof HATCHBACK_ZONES)[number]['id']
  | (typeof COUPE_ZONES)[number]['id']
  | (typeof VAN_ZONES)[number]['id']
  | (typeof BOX_TRUCK_ZONES)[number]['id']

export type Zone = {
  id: ZoneId
  label: string
  /** point on the body this zone is centred on */
  anchor: V3
  /** tint falloff radius, roughly the panel's reach */
  radius: number
}

export type VehicleSpec = { label: string; zones: readonly Zone[] }

export const VEHICLES = {
  sedan: { label: 'Sedan', zones: SEDAN_ZONES },
  suv: { label: 'SUV', zones: SUV_ZONES },
  truck: { label: 'Pickup', zones: TRUCK_ZONES },
  hatchback: { label: 'Hatchback', zones: HATCHBACK_ZONES },
  coupe: { label: 'Coupe', zones: COUPE_ZONES },
  van: { label: 'Van', zones: VAN_ZONES },
  box_truck: { label: 'Box truck', zones: BOX_TRUCK_ZONES },
} satisfies Record<string, VehicleSpec>

export type Vehicle = keyof typeof VEHICLES

export const VEHICLE_IDS = Object.keys(VEHICLES) as Vehicle[]

/** every zone id across every body — for display and docs; validation is per vehicle */
export const ZONE_IDS: readonly ZoneId[] = [
  ...new Set(VEHICLE_IDS.flatMap((v) => VEHICLES[v].zones.map((z) => z.id))),
]

export const isVehicle = (v: unknown): v is Vehicle => typeof v === 'string' && v in VEHICLES

export const zonesOf = (vehicle: Vehicle): readonly Zone[] => VEHICLES[vehicle].zones

export function zoneById(vehicle: Vehicle, id: string): Zone | undefined {
  return zonesOf(vehicle).find((z) => z.id === id)
}

/**
 * Classify a hit point as the zone whose anchor is closest to it.
 *
 * ponytail: plain nearest-anchor over ~25 points, so a click on a bumper corner can land on
 * the headlight beside it. Per-zone meshes are the upgrade when that gets reported.
 */
export function nearestZone(vehicle: Vehicle, [x, y, z]: V3): Zone {
  const zones = zonesOf(vehicle)
  let best = zones[0]
  let bestD = Infinity
  for (const zone of zones) {
    const [ax, ay, az] = zone.anchor
    const d = (ax - x) ** 2 + (ay - y) ** 2 + (az - z) ** 2
    if (d < bestD) {
      bestD = d
      best = zone
    }
  }
  return best
}
