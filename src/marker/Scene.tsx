import { Suspense } from 'react'
import * as THREE from 'three'
import { Canvas, type ThreeEvent } from '@react-three/fiber'
import { Billboard, ContactShadows, Environment, Lightformer, OrbitControls } from '@react-three/drei'
import { useStore } from 'zustand'
import { SEVERITY_COLOR } from '../schema'
import type { MarkerStore } from './store'
import { Car } from './Car'
import { Picker } from './Picker'
import type { V3 } from '../zones'

/**
 * Camera-facing pin at the exact hit point. polygonOffset lifts it off the bodywork, and the
 * wide white halo is what keeps a severity colour legible on paint of the same hue — an
 * orange dent marker on an orange car is otherwise invisible.
 */
function Pin({
  at,
  color,
  ringed,
  onPick,
}: {
  at: V3
  color: string
  ringed?: boolean
  onPick?: (e: ThreeEvent<PointerEvent>) => void
}) {
  const lift = { polygonOffset: true, polygonOffsetFactor: -4 }
  return (
    <Billboard position={at}>
      {/* generous invisible tap target — the visible pin is small on a phone */}
      <mesh onPointerDown={onPick}>
        <circleGeometry args={[0.1, 16]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh onPointerDown={onPick}>
        <circleGeometry args={[0.062, 28]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} {...lift} polygonOffsetUnits={-40} />
      </mesh>
      <mesh position-z={0.0005} onPointerDown={onPick}>
        <circleGeometry args={[0.036, 28]} />
        <meshBasicMaterial color={color} toneMapped={false} {...lift} polygonOffsetUnits={-44} />
      </mesh>
      {ringed && (
        <mesh position-z={0.001}>
          <ringGeometry args={[0.076, 0.089, 32]} />
          <meshBasicMaterial color="#2563eb" toneMapped={false} {...lift} polygonOffsetUnits={-48} />
        </mesh>
      )}
    </Billboard>
  )
}

function Markers({ store }: { store: MarkerStore }) {
  const damages = useStore(store, (s) => s.damages)
  const selected = useStore(store, (s) => s.selected)
  const pending = useStore(store, (s) => s.pending)
  return (
    <>
      {damages.map((d, i) => (
        <Pin
          key={i}
          at={d.point}
          color={SEVERITY_COLOR[d.severity]}
          ringed={i === selected}
          onPick={(e) => {
            e.stopPropagation()
            store.getState().select(i)
          }}
        />
      ))}
      {pending && <Pin at={pending.point} color="#2563eb" />}
    </>
  )
}

export function Scene({
  store,
  modelUrl,
  onCanvas,
}: {
  store: MarkerStore
  modelUrl?: string
  onCanvas: (canvas: HTMLCanvasElement) => void
}) {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [2.6, 1.75, 3.1], fov: 35, near: 0.1, far: 60 }}
      // preserveDrawingBuffer is what makes export() able to read the pixels back
      gl={{
        antialias: true,
        preserveDrawingBuffer: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        outputColorSpace: THREE.SRGBColorSpace,
      }}
      onCreated={({ gl }) => onCanvas(gl.domElement)}
      onPointerMissed={() => store.getState().select(null)}
    >
      <color attach="background" args={['#eef2f6']} />

      <Suspense fallback={null}>
        {/* soft studio built from lightformers, not a drei preset: presets fetch an HDRI
            from a CDN at runtime, which has no business inside someone's claims form */}
        <Environment resolution={256}>
          <Lightformer form="rect" intensity={3} color="#ffffff" position={[0, 5, 0]} rotation-x={Math.PI / 2} scale={[8, 5, 1]} />
          <Lightformer form="rect" intensity={1.4} color="#e6efff" position={[-5, 2, -3]} rotation-y={Math.PI / 4} scale={[6, 3, 1]} />
          <Lightformer form="rect" intensity={1.2} color="#fff4e6" position={[5, 2, 3]} rotation-y={-Math.PI / 4} scale={[6, 3, 1]} />
        </Environment>
        <Car store={store} modelUrl={modelUrl} />
      </Suspense>

      <ambientLight intensity={0.55} />
      <directionalLight position={[4, 6.5, 3]} intensity={1.5} />
      <directionalLight position={[-5, 3, -4]} intensity={0.45} color="#dce7ff" />

      <ContactShadows position={[0, 0.001, 0]} opacity={0.42} scale={9} blur={2.6} far={2.2} resolution={1024} color="#1e293b" />

      <Markers store={store} />
      <Picker store={store} />

      <OrbitControls
        makeDefault
        target={[0, 0.62, 0]}
        enablePan={false}
        enableDamping
        dampingFactor={0.09}
        rotateSpeed={0.75}
        minDistance={2.8}
        maxDistance={9}
        minPolarAngle={0.15}
        // never let the camera drop below the floor
        maxPolarAngle={Math.PI / 2 - 0.04}
      />
    </Canvas>
  )
}
