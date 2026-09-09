import { Suspense, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Billboard, ContactShadows, Environment, Grid, Html, MeshReflectorMaterial, OrbitControls } from '@react-three/drei'
import { useStore } from 'zustand'
import { SEVERITY_COLOR } from '../schema'
import { THEME, type Theme } from '../theme'
import type { MarkerStore } from './store'
import { Car } from './Car'
import { Picker } from './Picker'
import { ORBIT_TARGET, cameraFor } from './camera'
import { STUDIO } from '../vehicles/BodyPreview'
import { toWorld } from '../vehicles/bodies'
import type { V3 } from '../zones'

/**
 * A digit drawn into a texture, one per label, shared by every pin and every instance.
 * Not drei <Text>, which fetches a font from a CDN, and not <Html>, which would be missing
 * from the exported PNG.
 */
const digits = new Map<string, THREE.CanvasTexture>()
function digitTexture(text: string) {
  let tex = digits.get(text)
  if (tex) return tex
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  ctx.font = '700 40px system-ui, -apple-system, "Segoe UI", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#ffffff'
  ctx.fillText(text, 32, 35)
  tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  digits.set(text, tex)
  return tex
}

/**
 * Camera-facing pin at the exact hit point. polygonOffset lifts it off the bodywork, and the
 * wide white halo is what keeps a severity colour legible on paint of the same hue — an
 * orange dent marker on an orange car is otherwise invisible. The number matches the row in
 * the host's list.
 */
function Pin({
  at,
  color,
  label,
  ring,
  onPick,
}: {
  at: V3
  color: string
  label?: string
  ring?: string
  onPick?: (e: ThreeEvent<PointerEvent>) => void
}) {
  const lift = { polygonOffset: true, polygonOffsetFactor: -4 }
  const tex = useMemo(() => (label ? digitTexture(label) : null), [label])
  return (
    <Billboard position={at}>
      {/* generous invisible tap target — the visible pin is small on a phone */}
      <mesh onPointerDown={onPick}>
        <circleGeometry args={[0.19, 16]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh onPointerDown={onPick}>
        <circleGeometry args={[0.125, 32]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} {...lift} polygonOffsetUnits={-40} />
      </mesh>
      <mesh position-z={0.0005} onPointerDown={onPick}>
        <circleGeometry args={[0.093, 32]} />
        <meshBasicMaterial color={color} toneMapped={false} {...lift} polygonOffsetUnits={-44} />
      </mesh>
      {tex && (
        <mesh position-z={0.001} onPointerDown={onPick}>
          <planeGeometry args={[0.152, 0.152]} />
          <meshBasicMaterial map={tex} transparent depthWrite={false} toneMapped={false} {...lift} polygonOffsetUnits={-48} />
        </mesh>
      )}
      {ring && (
        <mesh position-z={0.0015}>
          <ringGeometry args={[0.15, 0.173, 40]} />
          <meshBasicMaterial color={ring} toneMapped={false} {...lift} polygonOffsetUnits={-52} />
        </mesh>
      )}
    </Billboard>
  )
}

function Markers({ store, accent }: { store: MarkerStore; accent: string }) {
  const vehicle = useStore(store, (s) => s.vehicle)
  const damages = useStore(store, (s) => s.damages)
  const selected = useStore(store, (s) => s.selected)
  const pending = useStore(store, (s) => s.pending)
  return (
    <>
      {damages.map((d, i) => (
        <Pin
          key={i}
          at={toWorld(vehicle, d.point)}
          color={SEVERITY_COLOR[d.severity]}
          label={String(i + 1)}
          ring={i === selected ? accent : undefined}
          onPick={(e) => {
            e.stopPropagation()
            store.getState().select(i)
          }}
        />
      ))}
      {pending && <Pin at={toWorld(vehicle, pending.point)} color={accent} />}
    </>
  )
}

/** names the zone under the cursor; hidden while a picker is open so the two never overlap */
function HoverLabel({ store }: { store: MarkerStore }) {
  const vehicle = useStore(store, (s) => s.vehicle)
  const zone = useStore(store, (s) => (s.pending || s.selected !== null ? null : s.hovered))
  if (!zone) return null
  return (
    <Html position={toWorld(vehicle, zone.anchor)} center zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
      <div className="cm-zone">{zone.label}</div>
    </Html>
  )
}

type Orbit = { target: THREE.Vector3 } | null

/**
 * Eases the camera round to face a damage when its pin is tapped. Gives up the moment the
 * user actually drags or zooms — a tap on a pin is not a drag — so it never fights a gesture.
 */
function CameraRig({ store }: { store: MarkerStore }) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const controls = useThree((s) => s.controls) as unknown as Orbit
  const goal = useRef<THREE.Vector3 | null>(null)
  const selected = useStore(store, (s) => s.selected)

  useEffect(() => {
    if (selected === null) return
    const { damages, vehicle } = store.getState()
    const d = damages[selected]
    if (!d) return
    const target = controls?.target ?? new THREE.Vector3(...ORBIT_TARGET)
    const distance = camera.position.distanceTo(target)
    goal.current = new THREE.Vector3(
      ...cameraFor(toWorld(vehicle, d.point), distance, [target.x, target.y, target.z], [camera.position.x - target.x, camera.position.z - target.z]),
    )
  }, [selected, store, camera, controls])

  useEffect(() => {
    const el = gl.domElement
    let down = false
    const onDown = () => (down = true)
    const onUp = () => (down = false)
    const onMove = () => {
      if (down) goal.current = null
    }
    const onWheel = () => (goal.current = null)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('pointerup', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('wheel', onWheel)
      window.removeEventListener('pointerup', onUp)
    }
  }, [gl])

  useFrame((_, dt) => {
    const g = goal.current
    if (!g) return
    // frame-rate independent ease-out
    camera.position.lerp(g, 1 - Math.exp(-dt * 6))
    camera.lookAt(controls?.target ?? new THREE.Vector3(...ORBIT_TARGET))
    if (camera.position.distanceTo(g) < 0.004) goal.current = null
  })

  return null
}

export function Scene({
  store,
  modelUrl,
  paint,
  theme,
  idle,
  onCanvas,
}: {
  store: MarkerStore
  modelUrl?: string
  paint: string
  theme: Theme
  /** turntable until the first touch */
  idle: boolean
  onCanvas: (canvas: HTMLCanvasElement) => void
}) {
  const t = THEME[theme]
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
      <color attach="background" args={[t.bg]} />

      <Suspense fallback={null}>
        {/* a real photographic studio, served with the page, is what makes paint look like paint */}
        <Environment files={STUDIO} environmentIntensity={0.9} />
        <Car store={store} paint={paint} modelUrl={modelUrl} />
      </Suspense>

      <directionalLight position={[4, 6.5, 3]} intensity={1.1} />
      <directionalLight position={[-5, 3, -4]} intensity={0.3} color="#dce7ff" />

      {/* a polished floor under the car; the grid sits just above it as a measuring surface */}
      {/* wide enough that its edge never enters the frame at any orbit distance */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.004, 0]}>
        <planeGeometry args={[160, 160]} />
        <MeshReflectorMaterial
          blur={[600, 180]}
          resolution={1024}
          mixBlur={1}
          mixStrength={theme === 'dark' ? 6 : 2.2}
          roughness={0.9}
          depthScale={1.1}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.4}
          color={t.bg}
          metalness={0.2}
          mirror={0}
        />
      </mesh>
      <Grid
        position={[0, -0.002, 0]}
        infiniteGrid
        cellSize={1}
        cellThickness={0.7}
        cellColor={t.grid}
        sectionSize={5}
        sectionThickness={1.1}
        sectionColor={t.section}
        fadeDistance={34}
        fadeStrength={1.6}
      />
      <ContactShadows position={[0, 0.001, 0]} opacity={0.5} scale={16} blur={2.6} far={4} resolution={1024} color={t.shadow} />

      <Markers store={store} accent={t.accent} />
      <HoverLabel store={store} />
      <Picker store={store} />
      <CameraRig store={store} />

      <OrbitControls
        makeDefault
        target={ORBIT_TARGET}
        enablePan={false}
        enableDamping
        dampingFactor={0.09}
        rotateSpeed={0.75}
        autoRotate={idle}
        autoRotateSpeed={0.8}
        minDistance={2.8}
        maxDistance={9}
        minPolarAngle={0.15}
        // never let the camera drop below the floor
        maxPolarAngle={Math.PI / 2 - 0.04}
      />
    </Canvas>
  )
}
