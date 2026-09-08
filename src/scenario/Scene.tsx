import { Suspense, useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, OrbitControls } from '@react-three/drei'
import { useStore } from 'zustand'
import { THEME, type Theme } from '../theme'
import { LayoutMesh } from './LayoutMesh'
import { ScenarioCar } from './Vehicle'
import { IMPACT_Y, ImpactMark, TravelPath } from './Path'
import type { Drag, ScenarioStore } from './store'

/** looking down; below this the ground-plane drag gets ambiguous */
const MAX_POLAR = (65 * Math.PI) / 180

/**
 * Aim the drag plane at the height the grabbed handle actually lives on. The impact cross
 * floats above the vehicles, so intersecting y=0 would snap it to the ground point under the
 * cursor the moment it was picked up. A plane is normal·p + constant = 0, so y = h is −h.
 */
function planeAt(plane: THREE.Plane, drag: Drag) {
  plane.constant = drag.kind === 'impact' ? -IMPACT_Y : 0
  return plane
}

/**
 * Drags read the ground plane from the camera ray every frame, rather than from whichever
 * mesh happens to be under the cursor. A fast drag that leaves the road, or crosses another
 * car, still tracks — which per-object pointer handlers do not manage.
 */
function DragDriver({ store }: { store: ScenarioStore }) {
  const { camera, raycaster, gl } = useThree()
  const hit = useMemo(() => new THREE.Vector3(), [])
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), [])
  const ndc = useMemo(() => new THREE.Vector2(), [])

  // Tracked from window rather than r3f's own `pointer`, which only updates while the cursor
  // is over the canvas. The selected-vehicle panel sits on top of the diagram, so dragging a
  // car under it would otherwise freeze the moment the pointer crossed the panel.
  useEffect(() => {
    const track = (e: PointerEvent) => {
      const r = gl.domElement.getBoundingClientRect()
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1))
    }
    const end = () => store.getState().endDrag()
    window.addEventListener('pointerdown', track)
    window.addEventListener('pointermove', track)
    // the pointer can be released anywhere, including outside the window
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointerdown', track)
      window.removeEventListener('pointermove', track)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [gl, ndc, store])

  useFrame(() => {
    const drag = store.getState().drag
    if (!drag) return
    raycaster.setFromCamera(ndc, camera)
    if (raycaster.ray.intersectPlane(planeAt(plane, drag), hit)) store.getState().dragTo(hit.x, hit.z)
  })

  return null
}

export function ScenarioScene({
  store,
  theme,
  onCanvas,
}: {
  store: ScenarioStore
  theme: Theme
  onCanvas: (c: HTMLCanvasElement) => void
}) {
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
      <color attach="background" args={[THEME[theme].bg]} />

      <Suspense fallback={null}>
        {/* local lightformers, not a drei preset: presets fetch an HDRI from a CDN */}
        {/* kept dim on purpose: ambient + key + a bright environment together washed the
            asphalt from #5b636f out to #a7b0bc, which stops reading as road at all */}
        <Environment resolution={256} environmentIntensity={0.55}>
          <Lightformer form="rect" intensity={1.1} color="#ffffff" position={[0, 12, 0]} rotation-x={Math.PI / 2} scale={[30, 20, 1]} />
          <Lightformer form="rect" intensity={0.5} color="#e6efff" position={[-16, 6, -10]} rotation-y={Math.PI / 4} scale={[16, 8, 1]} />
        </Environment>

        <LayoutMesh layout={layout} theme={theme} />

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
