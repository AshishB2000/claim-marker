import { Suspense, useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, OrbitControls } from '@react-three/drei'
import { useStore } from 'zustand'
import { LayoutMesh } from './LayoutMesh'
import { ScenarioCar } from './Vehicle'
import { ImpactMark, TravelPath } from './Path'
import type { ScenarioStore } from './store'

const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

/** looking down; below this the ground-plane drag gets ambiguous */
const MAX_POLAR = (65 * Math.PI) / 180

/**
 * Drags read the ground plane from the camera ray every frame, rather than from whichever
 * mesh happens to be under the cursor. A fast drag that leaves the road, or crosses another
 * car, still tracks — which per-object pointer handlers do not manage.
 */
function DragDriver({ store }: { store: ScenarioStore }) {
  const { camera, raycaster, pointer } = useThree()
  const hit = useMemo(() => new THREE.Vector3(), [])

  useFrame(() => {
    if (!store.getState().drag) return
    raycaster.setFromCamera(pointer, camera)
    if (raycaster.ray.intersectPlane(GROUND, hit)) store.getState().dragTo(hit.x, hit.z)
  })

  // the pointer can be released anywhere, including outside the canvas
  useEffect(() => {
    const end = () => store.getState().endDrag()
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [store])

  return null
}

export function ScenarioScene({ store, onCanvas }: { store: ScenarioStore; onCanvas: (c: HTMLCanvasElement) => void }) {
  const layout = useStore(store, (s) => s.layout)
  const vehicles = useStore(store, (s) => s.vehicles)
  const selected = useStore(store, (s) => s.selected)
  const impact = useStore(store, (s) => s.impact)
  const dragging = useStore(store, (s) => s.drag !== null)

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 22, 22], fov: 40, near: 0.5, far: 400 }}
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
        {/* local lightformers, not a drei preset: presets fetch an HDRI from a CDN */}
        {/* kept dim on purpose: ambient + key + a bright environment together washed the
            asphalt from #5b636f out to #a7b0bc, which stops reading as road at all */}
        <Environment resolution={256} environmentIntensity={0.55}>
          <Lightformer form="rect" intensity={1.1} color="#ffffff" position={[0, 12, 0]} rotation-x={Math.PI / 2} scale={[30, 20, 1]} />
          <Lightformer form="rect" intensity={0.5} color="#e6efff" position={[-16, 6, -10]} rotation-y={Math.PI / 4} scale={[16, 8, 1]} />
        </Environment>

        <LayoutMesh layout={layout} />

        {vehicles.map((v) => (
          <ScenarioCar key={v.id} store={store} vehicle={v} selected={v.id === selected} />
        ))}
      </Suspense>

      {vehicles.map((v) => (
        <TravelPath key={v.id} store={store} vehicle={v} selected={v.id === selected} />
      ))}
      {impact && <ImpactMark store={store} at={impact} />}

      <ambientLight intensity={0.3} />
      <directionalLight
        castShadow
        position={[18, 30, 14]}
        intensity={1.5}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-32}
        shadow-camera-right={32}
        shadow-camera-top={32}
        shadow-camera-bottom={-32}
        shadow-bias={-0.0004}
      />
      <directionalLight position={[-14, 12, -12]} intensity={0.25} color="#dce7ff" />

      <DragDriver store={store} />

      <OrbitControls
        makeDefault
        enabled={!dragging}
        enableDamping
        dampingFactor={0.1}
        minDistance={10}
        maxDistance={80}
        minPolarAngle={0.05}
        maxPolarAngle={MAX_POLAR}
      />
    </Canvas>
  )
}
