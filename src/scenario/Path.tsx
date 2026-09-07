import * as THREE from 'three'
import { Line } from '@react-three/drei'
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

export function ImpactMark({ store, at }: { store: ScenarioStore; at: Point2 }) {
  const grab = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    store.getState().startDrag({ kind: 'impact' })
  }
  return (
    <group position={[at[0], 0.06, at[1]]} onPointerDown={grab}>
      {/* generous invisible grab area */}
      <mesh rotation-x={-Math.PI / 2}>
        <circleGeometry args={[2, 20]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {[Math.PI / 4, -Math.PI / 4].map((rot, i) => (
        <group key={i} rotation-y={rot}>
          <mesh rotation-x={-Math.PI / 2}>
            <planeGeometry args={[0.55, 3.4]} />
            <meshBasicMaterial color="#dc2626" toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  )
}
