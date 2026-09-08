import { Suspense, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Billboard, ContactShadows, Environment, Grid, Html, Lightformer, OrbitControls } from '@react-three/drei'
import { useStore } from 'zustand'
import { SEVERITY_COLOR } from '../schema'
import { THEME, type Theme } from '../theme'
import type { MarkerStore } from './store'
import { Car } from './Car'
import { Picker } from './Picker'
import { ORBIT_TARGET, cameraFor } from './camera'
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
        <circleGeometry args={[0.12, 16]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh onPointerDown={onPick}>
        <circleGeometry args={[0.078, 32]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} {...lift} polygonOffsetUnits={-40} />
      </mesh>
      <mesh position-z={0.0005} onPointerDown={onPick}>
        <circleGeometry args={[0.058, 32]} />
        <meshBasicMaterial color={color} toneMapped={false} {...lift} polygonOffsetUnits={-44} />
      </mesh>
      {tex && (
        <mesh position-z={0.001} onPointerDown={onPick}>
          <planeGeometry args={[0.095, 0.095]} />
          <meshBasicMaterial map={tex} transparent depthWrite={false} toneMapped={false} {...lift} polygonOffsetUnits={-48} />
        </mesh>
      )}
      {ring && (
        <mesh position-z={0.0015}>
          <ringGeometry args={[0.094, 0.108, 40]} />
          <meshBasicMaterial color={ring} toneMapped={false} {...lift} polygonOffsetUnits={-52} />
        </mesh>
      )}
    </Billboard>
  )
}

function Markers({ store, accent }: { store: MarkerStore; accent: string }) {
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
          label={String(i + 1)}
          ring={i === selected ? accent : undefined}
          onPick={(e) => {
            e.stopPropagation()
            store.getState().select(i)
          }}
        />
      ))}
      {pending && <Pin at={pending.point} color={accent} />}
    </>
  )
}

/** names the zone under the cursor; hidden while a picker is open so the two never overlap */
function HoverLabel({ store }: { store: MarkerStore }) {
  const zone = useStore(store, (s) => (s.pending || s.selected !== null ? null : s.hovered))
  if (!zone) return null
  return (
    <Html position={zone.anchor} center zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
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
    const d = store.getState().damages[selected]
    if (!d) return
    const target = controls?.target ?? new THREE.Vector3(...ORBIT_TARGET)
    const distance = camera.position.distanceTo(target)
    goal.current = new THREE.Vector3(
      ...cameraFor(d.point, distance, [target.x, target.y, target.z], [camera.position.x - target.x, camera.position.z - target.z]),
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
  theme,
  idle,
  onCanvas,
}: {
  store: MarkerStore
  modelUrl?: string
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

      {/* a measuring surface to stand on, fading out well inside the frame */}
      <Grid
        position={[0, -0.002, 0]}
        infiniteGrid
        cellSize={0.5}
        cellThickness={0.7}
        cellColor={t.grid}
        sectionSize={2.5}
        sectionThickness={1.1}
        sectionColor={t.section}
        fadeDistance={7.5}
        fadeStrength={1.6}
      />
      <ContactShadows position={[0, 0.001, 0]} opacity={0.5} scale={9} blur={2.6} far={2.2} resolution={1024} color={t.shadow} />

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
