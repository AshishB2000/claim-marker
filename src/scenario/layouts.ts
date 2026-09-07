/**
 * Road layout data. Deliberately free of three.js so the schema and its tests can import it;
 * the geometry that draws these lives in LayoutMesh.tsx.
 *
 * Ground coordinates are [x, z] in metres. Headings are Y-rotation in radians with the nose
 * at +Z when 0, so heading = atan2(dx, dz).
 *
 * Right-hand traffic, which fixes which lane a direction belongs in (right = up × forward):
 * northbound x=+1.8, southbound x=−1.8, eastbound z=−1.8, westbound z=+1.8.
 */

export type Point2 = [number, number]

/** two 3.6 m lanes */
export const ROAD = 7.2
/** how far the roads run from the origin */
export const EXT = 24
/** centre of a lane, offset from the road's centre line */
export const LANE = 1.8

export const N = 0
export const E = Math.PI / 2
export const S = Math.PI
export const W = -Math.PI / 2

/**
 * Kenney's bodies are stylised — the sedan is 2.55 units long by 1.5 wide, a stubbier ratio
 * than a real car. Scaled so the width sits plausibly inside a 3.6 m lane; lengths in the
 * document are therefore indicative rather than survey-grade.
 */
export const VEHICLE_SCALE = 1.35

export type Spawn = { position: Point2; heading: number }

export type Layout = {
  label: string
  /** where the two starting vehicles are put — on the correct side of the road */
  spawns: [Spawn, Spawn]
}

export const LAYOUTS = {
  intersection: {
    label: 'Four-way intersection',
    spawns: [
      { position: [LANE, -8], heading: N },
      { position: [8, LANE], heading: W },
    ],
  },
  t_junction: {
    label: 'T-junction',
    spawns: [
      { position: [-8, -LANE], heading: E },
      { position: [LANE, -9], heading: N },
    ],
  },
  straight: {
    label: 'Straight road',
    spawns: [
      { position: [LANE, -5], heading: N },
      { position: [LANE, 4], heading: N },
    ],
  },
  parking_lot: {
    label: 'Parking lot',
    spawns: [
      { position: [-6, 0], heading: E },
      { position: [2.6, 6.0], heading: N },
    ],
  },
} satisfies Record<string, Layout>

export type LayoutId = keyof typeof LAYOUTS

export const LAYOUT_IDS = Object.keys(LAYOUTS) as LayoutId[]

export const isLayout = (v: unknown): v is LayoutId => typeof v === 'string' && v in LAYOUTS

/** parking bays: 11 either side of a central drive lane */
export const BAY = { count: 11, width: 2.6, depth: 5.2, laneHalf: 3.4 }
export const bayCentres = () =>
  Array.from({ length: BAY.count }, (_, i) => (i - (BAY.count - 1) / 2) * BAY.width)
