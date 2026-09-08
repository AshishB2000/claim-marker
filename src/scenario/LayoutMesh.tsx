/**
 * Road geometry. Everything here is two primitives — a rotatable Strip and a Dashed line —
 * so a new layout is a small function, not new machinery.
 *
 * Flat surfaces stack on Y to avoid z-fighting: ground 0, grid 0.004, asphalt 0.01, paint 0.02.
 */
import { Grid } from '@react-three/drei'
import { THEME, type Theme, type ThemeColors } from '../theme'
import { BAY, EXT, ROAD, type LayoutId, type Point2 } from './layouts'

// coincident planes z-fight, so crossing roads get their own layer: the E-W carriageway
// visually passes over the N-S one, which is also how an intersection reads
const Y_ROAD = 0.01
const Y_ROAD_OVER = 0.014
const Y_PAINT = 0.022

function Strip({
  w,
  l,
  x = 0,
  z = 0,
  rot = 0,
  color,
  y,
}: {
  w: number
  l: number
  x?: number
  z?: number
  /** Y-rotation in radians; at 0 the length runs along Z */
  rot?: number
  color: string
  y: number
}) {
  return (
    <group position={[x, y, z]} rotation-y={rot}>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[w, l]} />
        <meshStandardMaterial color={color} roughness={0.95} />
      </mesh>
    </group>
  )
}

function Dashed({
  a,
  b,
  paint,
  width = 0.14,
  dash = 1.8,
  gap = 1.8,
}: {
  a: Point2
  b: Point2
  paint: string
  width?: number
  dash?: number
  gap?: number
}) {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const len = Math.hypot(dx, dz)
  const rot = Math.atan2(dx, dz)
  const step = dash + gap
  const n = Math.max(0, Math.floor(len / step))
  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        const t = (i * step + dash / 2) / len
        return <Strip key={i} w={width} l={dash} x={a[0] + dx * t} z={a[1] + dz * t} rot={rot} color={paint} y={Y_PAINT} />
      })}
    </>
  )
}

/** stop line, drawn in one direction's own lane rather than across the whole road */
const Stop = ({ x, z, rot, paint }: { x: number; z: number; rot: number; paint: string }) => (
  <Strip w={ROAD / 2 - 0.3} l={0.4} x={x} z={z} rot={rot} color={paint} y={Y_PAINT} />
)

const H = ROAD / 2

function Intersection({ asphalt, paint }: ThemeColors) {
  return (
    <>
      <Strip w={ROAD} l={EXT * 2} color={asphalt} y={Y_ROAD} />
      <Strip w={EXT * 2} l={ROAD} color={asphalt} y={Y_ROAD_OVER} />
      <Dashed a={[0, -EXT]} b={[0, -H]} paint={paint} />
      <Dashed a={[0, H]} b={[0, EXT]} paint={paint} />
      <Dashed a={[-EXT, 0]} b={[-H, 0]} paint={paint} />
      <Dashed a={[H, 0]} b={[EXT, 0]} paint={paint} />
      {/* right-hand traffic: each approach stops in the half it drives on */}
      <Stop x={H / 2} z={-H - 0.4} rot={0} paint={paint} />
      <Stop x={-H / 2} z={H + 0.4} rot={0} paint={paint} />
      <Stop x={-H - 0.4} z={-H / 2} rot={Math.PI / 2} paint={paint} />
      <Stop x={H + 0.4} z={H / 2} rot={Math.PI / 2} paint={paint} />
    </>
  )
}

function TJunction({ asphalt, paint }: ThemeColors) {
  const leg = EXT - H
  return (
    <>
      <Strip w={EXT * 2} l={ROAD} color={asphalt} y={Y_ROAD_OVER} />
      <Strip w={ROAD} l={leg} z={-(H + leg / 2)} color={asphalt} y={Y_ROAD} />
      <Dashed a={[-EXT, 0]} b={[EXT, 0]} paint={paint} />
      <Dashed a={[0, -EXT]} b={[0, -H]} paint={paint} />
      {/* only the side road gives way */}
      <Stop x={H / 2} z={-H - 0.4} rot={0} paint={paint} />
    </>
  )
}

const Straight = ({ asphalt, paint }: ThemeColors) => (
  <>
    <Strip w={ROAD} l={EXT * 2} color={asphalt} y={Y_ROAD} />
    <Dashed a={[0, -EXT]} b={[0, EXT]} paint={paint} />
  </>
)

function ParkingLot({ asphalt, paint }: ThemeColors) {
  const rowZ = BAY.laneHalf + BAY.depth / 2
  const edges = Array.from({ length: BAY.count + 1 }, (_, i) => (i - BAY.count / 2) * BAY.width)
  return (
    <>
      <Strip w={BAY.count * BAY.width + 2.4} l={(BAY.laneHalf + BAY.depth) * 2} color={asphalt} y={Y_ROAD} />
      {edges.map((x, i) => (
        <group key={i}>
          <Strip w={0.12} l={BAY.depth} x={x} z={rowZ} color={paint} y={Y_PAINT} />
          <Strip w={0.12} l={BAY.depth} x={x} z={-rowZ} color={paint} y={Y_PAINT} />
        </group>
      ))}
      {/* kerb line at the head of each row */}
      <Strip w={BAY.count * BAY.width} l={0.12} z={rowZ + BAY.depth / 2} color={paint} y={Y_PAINT} />
      <Strip w={BAY.count * BAY.width} l={0.12} z={-(rowZ + BAY.depth / 2)} color={paint} y={Y_PAINT} />
    </>
  )
}

const MESHES: Record<LayoutId, (t: ThemeColors) => React.ReactElement> = {
  intersection: Intersection,
  t_junction: TJunction,
  straight: Straight,
  parking_lot: ParkingLot,
}

export function LayoutMesh({ layout, theme }: { layout: LayoutId; theme: Theme }) {
  const t = THEME[theme]
  const Mesh = MESHES[layout]
  return (
    <>
      {/* also the raycast target the ground-plane drag reads */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[240, 240]} />
        <meshStandardMaterial color={t.ground} roughness={1} />
      </mesh>
      {/* a 2 m survey grid on the verges; the asphalt sits above it and covers it */}
      <Grid
        position={[0, 0.004, 0]}
        infiniteGrid
        cellSize={2}
        cellThickness={0.5}
        cellColor={t.grid}
        sectionSize={10}
        sectionThickness={1}
        sectionColor={t.section}
        fadeDistance={95}
        fadeStrength={1.2}
      />
      <Mesh {...t} />
    </>
  )
}
