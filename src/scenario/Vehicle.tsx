import { useMemo } from 'react'
import * as THREE from 'three'
import { Html, useGLTF } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { MODELS } from '../models'
import { VEHICLE_SCALE } from './layouts'
import { ROLE_COLOR, type ScenarioVehicle } from './schema'
import { vehicleLabel, type ScenarioStore } from './store'

/** where the rotation puck floats, just clear of the nose */
const HANDLE_AHEAD = 3.4

export function ScenarioCar({
  store,
  vehicle: v,
  selected,
}: {
  store: ScenarioStore
  vehicle: ScenarioVehicle
  selected: boolean
}) {
  const { scene } = useGLTF(MODELS[v.body])
  // useGLTF caches globally, and several vehicles can share a body
  const model = useMemo(() => {
    const root = scene.clone(true)
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true
    })
    return root
  }, [scene])

  const grab = (e: ThreeEvent<PointerEvent>, kind: 'vehicle' | 'heading') => {
    e.stopPropagation()
    store.getState().startDrag({ kind, id: v.id })
  }

  const color = ROLE_COLOR[v.role]

  return (
    <group position={[v.position[0], 0, v.position[1]]} rotation-y={v.heading}>
      <group scale={VEHICLE_SCALE}>
        <primitive object={model} onPointerDown={(e: ThreeEvent<PointerEvent>) => grab(e, 'vehicle')} />
      </group>

      {selected && (
        <>
          <mesh rotation-x={-Math.PI / 2} position-y={0.03}>
            <ringGeometry args={[2.3, 2.55, 56]} />
            <meshBasicMaterial color={color} toneMapped={false} transparent opacity={0.85} />
          </mesh>
          {/* drag this and the nose turns to point at it — one object, no modes, works on touch */}
          <mesh position={[0, 0.14, HANDLE_AHEAD]} onPointerDown={(e: ThreeEvent<PointerEvent>) => grab(e, 'heading')} castShadow>
            <cylinderGeometry args={[0.5, 0.5, 0.28, 24]} />
            <meshStandardMaterial color={color} roughness={0.45} />
          </mesh>
        </>
      )}

      <Html position={[0, 2.9, 0]} center style={{ pointerEvents: 'none' }} zIndexRange={[15, 5]}>
        <div className="cm-tag" style={{ background: color }}>
          {vehicleLabel(v.id)}
          {v.damages.length > 0 && <span className="cm-tag-n">{v.damages.length}</span>}
        </div>
      </Html>
    </group>
  )
}
