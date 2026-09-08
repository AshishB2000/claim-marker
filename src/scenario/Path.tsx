import * as THREE from 'three'
import { Billboard, Html, Line } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import type { Point2 } from './layouts'
import { ROLE_COLOR, type ScenarioVehicle } from './schema'
import type { ScenarioStore } from './store'

const Y = 0.04
/** the head sits short of the vehicle so the car does not hide it */
const HEAD_AT = 0.86

/**
 * The approach, drawn through [...path, position] — path is where the vehicle came from and
 * position is where it stopped, kept independent so dragging the car never rewrites its path.
 */
export function TravelPath({
  store,
  vehicle: v,
  selected,
}: {
  store: ScenarioStore
  vehicle: ScenarioVehicle
  selected: boolean
}) {
  if (v.path.length === 0) return null

  const points = [...v.path, v.position].map(([x, z]) => new THREE.Vector3(x, Y, z))
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.25)
  const head = curve.getPointAt(HEAD_AT)
  const tangent = curve.getTangentAt(HEAD_AT)
  const color = ROLE_COLOR[v.role]

  return (
    <>
      <Line points={curve.getPoints(60)} color={color} lineWidth={0.34} worldUnits transparent opacity={0.85} />

      <group position={head} rotation-y={Math.atan2(tangent.x, tangent.z)}>
        <mesh rotation-x={Math.PI / 2}>
          <coneGeometry args={[0.62, 1.5, 18]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
      </group>

      {selected &&
        v.path.map((p, i) => (
          <mesh
            key={i}
            position={[p[0], Y + 0.02, p[1]]}
            rotation-x={-Math.PI / 2}
            onPointerDown={(e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation()
              store.getState().startDrag({ kind: 'waypoint', id: v.id, index: i })
            }}
          >
            <circleGeometry args={[0.62, 22]} />
            <meshBasicMaterial color="#ffffff" toneMapped={false} />
          </mesh>
        ))}
    </>
  )
}

const IMPACT = '#dc2626'

/** how high the badge floats; vehicles stand about 1.8 m tall at scene scale */
export const IMPACT_Y = 3.4

/**
 * The cross floats above the vehicles rather than lying on the road, where the cars it sits
 * between hid it. A leader line and a ground ring keep it tied to the actual point.
 *
 * The badge itself is DOM, not geometry, because the vehicle labels are drei <Html> and so
 * paint over the canvas — no amount of height would put WebGL in front of them. Given a
 * higher zIndexRange it always wins, and `pointerEvents: none` lets the pointer fall through
 * to the invisible disc behind it, so dragging still goes through the normal 3D path.
 */
export function ImpactMark({ store, at }: { store: ScenarioStore; at: Point2 }) {
  const grab = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    store.getState().startDrag({ kind: 'impact' })
  }
  return (
    <group position={[at[0], 0, at[1]]}>
      <mesh rotation-x={-Math.PI / 2} position-y={0.05}>
        <ringGeometry args={[0.5, 0.74, 36]} />
        <meshBasicMaterial color={IMPACT} toneMapped={false} transparent opacity={0.9} />
      </mesh>

      <mesh position-y={IMPACT_Y / 2}>
        <cylinderGeometry args={[0.05, 0.05, IMPACT_Y, 8]} />
        <meshBasicMaterial color={IMPACT} toneMapped={false} transparent opacity={0.75} />
      </mesh>

      <Billboard position={[0, IMPACT_Y, 0]}>
        <mesh onPointerDown={grab}>
          <circleGeometry args={[1.1, 20]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </Billboard>

      <Html position={[0, IMPACT_Y, 0]} center zIndexRange={[30, 25]} style={{ pointerEvents: 'none' }}>
        <div className="cm-impact" title="Point of impact">
          ✕
        </div>
      </Html>
    </group>
  )
}
