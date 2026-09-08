import { useMemo, useRef, type ComponentRef } from 'react'
import * as THREE from 'three'
import { Billboard, Html, Line } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import type { Point2 } from './layouts'
import { ROLE_COLOR, type ScenarioVehicle } from './schema'
import type { ScenarioStore } from './store'

const Y = 0.04
/** the head sits short of the vehicle so the car does not hide it */
const HEAD_AT = 0.86
/** metres per second the dashes travel; a cue for direction, not a speed */
const FLOW = 3.5

/**
 * Dashes marching towards the vehicle. Direction of travel shown as motion on a static
 * path — nothing about timing enters the document, and the decision against playback in
 * spec-scenario.md stands.
 */
function Flow({ points, color }: { points: THREE.Vector3[]; color: string }) {
  const ref = useRef<ComponentRef<typeof Line>>(null)
  useFrame((_, dt) => {
    const line = ref.current
    if (line) line.material.dashOffset -= dt * FLOW
  })
  return (
    <Line
      ref={ref}
      points={points}
      color="#ffffff"
      lineWidth={0.16}
      worldUnits
      dashed
      dashSize={0.9}
      gapSize={1.3}
      transparent
      opacity={0.9}
      // the colour is the vehicle's own; white dashes on it read as movement, not a second line
      vertexColors={points.map(() => new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.55))}
    />
  )
}

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
  const color = ROLE_COLOR[v.role]
  const curve = useMemo(() => {
    if (v.path.length === 0) return null
    const points = [...v.path, v.position].map(([x, z]) => new THREE.Vector3(x, Y, z))
    const c = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.25)
    return { line: c.getPoints(60), head: c.getPointAt(HEAD_AT), tangent: c.getTangentAt(HEAD_AT) }
  }, [v.path, v.position])
  if (!curve) return null

  return (
    <>
      <Line points={curve.line} color={color} lineWidth={0.34} worldUnits transparent opacity={0.85} />
      <Flow points={curve.line.map((p) => p.clone().setY(Y + 0.01))} color={color} />

      <group position={curve.head} rotation-y={Math.atan2(curve.tangent.x, curve.tangent.z)}>
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
