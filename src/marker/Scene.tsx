import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Billboard, Html, OrbitControls } from '@react-three/drei'
import { useStore } from 'zustand'
import { SEVERITY_COLOR } from '../schema'
import { THEME, type Theme } from '../theme'
import type { MarkerStore } from './store'
import { Car } from './Car'
import { Picker } from './Picker'
import { translate, type Key, type Lang } from '../i18n'
import { ORBIT_TARGET, cameraFor } from './camera'
import { toModel, toWorld } from '../vehicles/bodies'
import type { Lighting } from '../scene/lighting'
import { nearestZone, type V3 } from '../zones'
import { MAX_MARKS, renders } from './damageUniforms'
import { Studio } from './Studio'
import { PHOTO_DRAG, type CardPhoto } from './cards'
import { PhotoCards } from './PhotoCards'

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
 * the host's list. A `dot` is the same pin at a third the size and without its number, for a
 * mark whose damage the paint itself now shows.
 */
function Pin({
  at,
  color,
  label,
  ring,
  dot = false,
  onPick,
}: {
  at: V3
  color: string
  label?: string
  ring?: string
  dot?: boolean
  onPick?: (e: ThreeEvent<PointerEvent>) => void
}) {
  const lift = { polygonOffset: true, polygonOffsetFactor: -4 }
  const tex = useMemo(() => (label && !dot ? digitTexture(label) : null), [label, dot])
  const size = dot ? 0.4 : 1
  return (
    <Billboard position={at}>
      {/* generous invisible tap target — the visible pin is small on a phone */}
      <mesh onPointerDown={onPick}>
        <circleGeometry args={[0.19, 16]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh onPointerDown={onPick}>
        <circleGeometry args={[0.125 * size, 32]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} {...lift} polygonOffsetUnits={-40} />
      </mesh>
      <mesh position-z={0.0005} onPointerDown={onPick}>
        <circleGeometry args={[0.093 * size, 32]} />
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

/**
 * `dots`: a mark the shader draws — one of the first `MAX_MARKS`, of a kind its zone's surface
 * takes (`renders`) — shrinks to a dot; every other pin keeps its number, so a crack on a
 * bumper or a scratch on a windshield, which the paint does not show, never fades from view.
 */
function Markers({ store, accent, dots, onPinPress }: { store: MarkerStore; accent: string; dots: boolean; onPinPress: () => void }) {
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
          dot={dots && i < MAX_MARKS && renders(d, vehicle)}
          ring={i === selected ? accent : undefined}
          onPick={(e) => {
            e.stopPropagation()
            onPinPress()
            store.getState().select(i)
          }}
        />
      ))}
      {pending && <Pin at={toWorld(vehicle, pending.point)} color={accent} />}
    </>
  )
}

/** names the zone under the cursor; hidden while a picker is open so the two never overlap */
function HoverLabel({ store, lang }: { store: MarkerStore; lang: Lang }) {
  const vehicle = useStore(store, (s) => s.vehicle)
  const zone = useStore(store, (s) => (s.pending || s.selected !== null ? null : s.hovered))
  if (!zone) return null
  return (
    <Html position={toWorld(vehicle, zone.anchor)} center zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
      <div className="cm-zone">{translate(lang, `zone.${zone.id}` as Key)}</div>
    </Html>
  )
}

type Orbit = { target: THREE.Vector3 } | null

/** where the camera goes to face a point in metres: `cameraFor`, at the current distance, from where it is now */
function aimAt(camera: THREE.Camera, controls: Orbit, point: V3) {
  const target = controls?.target ?? new THREE.Vector3(...ORBIT_TARGET)
  const distance = camera.position.distanceTo(target)
  return new THREE.Vector3(...cameraFor(point, distance, [target.x, target.y, target.z], [camera.position.x - target.x, camera.position.z - target.z]))
}

/**
 * Eases the camera round to face a damage when its pin is tapped, or a panel when the photo
 * pinned to it is — whatever the store is `facing`. Gives up the moment the user actually drags
 * or zooms — a tap on a pin is not a drag — so it never fights a gesture; and a drag also lets
 * go of `facing`, which is what brings that panel's photo cards back.
 */
function CameraRig({ store }: { store: MarkerStore }) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const controls = useThree((s) => s.controls) as unknown as Orbit
  const goal = useRef<THREE.Vector3 | null>(null)
  const facing = useStore(store, (s) => s.facing)

  useEffect(() => {
    if (facing) goal.current = aimAt(camera, controls, toWorld(store.getState().vehicle, facing.point))
  }, [facing, store, camera, controls])

  useEffect(() => {
    const el = gl.domElement
    let down = false
    const onDown = () => (down = true)
    const onUp = () => (down = false)
    const onMove = () => {
      if (!down) return
      goal.current = null
      if (store.getState().facing) store.setState({ facing: null })
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
  }, [gl, store])

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

/**
 * The photos pinned to this body; tapping one turns the camera to its panel and opens it. The
 * panel the camera has been turned to face — a tapped pin's, a tapped photo's — has its cards
 * stand aside until the customer turns the camera or the selection clears (`facing`): read here
 * in render, never copied into state.
 */
function PinnedPhotos({ store, photos, onOpenPhoto }: { store: MarkerStore; photos: CardPhoto[]; onOpenPhoto?: (photoId: number) => void }) {
  const vehicle = useStore(store, (s) => s.vehicle)
  const faced = useStore(store, (s) => s.facing?.zone ?? null)
  return (
    <PhotoCards
      body={vehicle}
      photos={photos}
      faced={faced}
      onOpen={
        onOpenPhoto &&
        ((photo, zone) => {
          store.getState().face(zone)
          onOpenPhoto(photo.id)
        })
      }
    />
  )
}

/**
 * A photo's thumbnail dragged onto the car says which panel it shows: the drop point is cast
 * into the scene from this camera, the hit on the body goes back to the kit's units, and the
 * nearest zone is the answer. While the drag is over the car the panel under it is tinted, the
 * same tint as a hover. Only a photo's drag is taken — anything else dropped here is not ours.
 */
function PhotoDrop({ store, onTagPhoto }: { store: MarkerStore; onTagPhoto: (photoId: number, zoneId: string) => void }) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    const el = gl.domElement
    const zoneAt = (e: DragEvent) => {
      const car = scene.getObjectByName('car')
      if (!car) return null
      const r = el.getBoundingClientRect()
      const ray = new THREE.Raycaster()
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2), camera)
      const hit = ray.intersectObject(car, true)[0]
      if (!hit) return null
      const { vehicle } = store.getState()
      return nearestZone(vehicle, toModel(vehicle, [hit.point.x, hit.point.y, hit.point.z]))
    }
    const ours = (e: DragEvent) => !!e.dataTransfer?.types.includes(PHOTO_DRAG)
    const over = (e: DragEvent) => {
      if (!ours(e)) return
      e.preventDefault()
      store.getState().hover(zoneAt(e))
    }
    const leave = () => store.getState().hover(null)
    const drop = (e: DragEvent) => {
      if (!ours(e)) return
      e.preventDefault()
      const zone = zoneAt(e)
      store.getState().hover(null)
      if (zone) onTagPhoto(Number(e.dataTransfer!.getData(PHOTO_DRAG)), zone.id)
    }
    el.addEventListener('dragover', over)
    el.addEventListener('dragleave', leave)
    el.addEventListener('drop', drop)
    return () => {
      el.removeEventListener('dragover', over)
      el.removeEventListener('dragleave', leave)
      el.removeEventListener('drop', drop)
    }
  }, [gl, camera, scene, store, onTagPhoto])
  return null
}

export function Scene({
  store,
  modelUrl,
  paint,
  theme,
  idle,
  lang,
  lighting = null,
  dots = false,
  readOnly = false,
  photos,
  onTagPhoto,
  onOpenPhoto,
  onCanvas,
}: {
  store: MarkerStore
  modelUrl?: string
  paint: string
  theme: Theme
  /** turntable until the first touch */
  idle: boolean
  lang: Lang
  /** pins shrink to dots where the paint shows the damage itself; off, they keep their numbers */
  dots?: boolean
  /**
   * The moment's light, the same `Lighting` the map layer takes, so the marked-up car on the
   * review page is lit like the map above it: the sun's direction and colour, the sky's tint,
   * how much of the studio reflects. Null is the studio as it always was.
   */
  lighting?: Lighting | null
  /** a document's copy: nothing can be marked or edited, the wheel scrolls the page; turning it round and tapping a pin or a photo still work */
  readOnly?: boolean
  /** the photos of this vehicle that show one of its panels, as cards beside those panels */
  photos?: CardPhoto[]
  /** a photo's thumbnail was dropped on this panel of the car */
  onTagPhoto?: (photoId: number, zoneId: string) => void
  /** a photo's card was tapped: show it large */
  onOpenPhoto?: (photoId: number) => void
  onCanvas: (canvas: HTMLCanvasElement) => void
}) {
  const t = THEME[theme]
  // the sun in the body's own frame — the map's (east, south, up) is the body's (−left, up, −nose),
  // nose north as `CAR_BASIS` has it — standing eight metres out like the studio's own key light
  const key: V3 = lighting ? [-lighting.sun[0] * 8, lighting.sun[2] * 8, -lighting.sun[1] * 8] : [4, 6.5, 3]
  // A pin's press turns the camera at once, so by the time the button comes up the pin can have
  // turned out from under the pointer. Where the body takes no taps — the desk's copy — that
  // release hits nothing and would read as a tap on empty space, clearing the selection the press
  // just made and bringing the panel's card back over the pin. So the release of a press that
  // landed on a pin is the pin's, wherever it has gone: set by the pin, reset by every press
  // before the scene sees it.
  const pinPressed = useRef(false)
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
      onCreated={({ gl, camera, scene }) => {
        onCanvas(gl.domElement)
        // for the smoke: the store behind this canvas, where a point in the kit's units lands on it,
        // where a photo's card is on it (null until it is in the scene), and which way round the camera stands
        if (import.meta.env.DEV) {
          const pixels = (v: THREE.Vector3) => [((v.x + 1) / 2) * gl.domElement.width, ((1 - v.y) / 2) * gl.domElement.height]
          Object.assign(gl.domElement, {
            __probe: {
              store,
              project: (p: V3) => pixels(new THREE.Vector3(...toWorld(store.getState().vehicle, p)).project(camera)),
              card: (id: number) => {
                const card = scene.getObjectByName(`card:${id}`)
                return card ? pixels(card.getWorldPosition(new THREE.Vector3()).project(camera)) : null
              },
              azimuth: () => Math.atan2(camera.position.x, camera.position.z),
            },
          })
        }
      }}
      onPointerDownCapture={() => (pinPressed.current = false)}
      onPointerMissed={() => {
        if (!pinPressed.current) store.getState().select(null)
      }}
    >
      <Studio theme={theme} lighting={lighting} keyAt={key}>
        <Car store={store} paint={paint} modelUrl={modelUrl} pickable={!readOnly} />
      </Studio>

      <Markers store={store} accent={t.accent} dots={dots} onPinPress={() => (pinPressed.current = true)} />
      {photos && <PinnedPhotos store={store} photos={photos} onOpenPhoto={onOpenPhoto} />}
      {onTagPhoto && <PhotoDrop store={store} onTagPhoto={onTagPhoto} />}
      <HoverLabel store={store} lang={lang} />
      {!readOnly && <Picker store={store} lang={lang} />}
      <CameraRig store={store} />

      <OrbitControls
        makeDefault
        target={ORBIT_TARGET}
        enablePan={false}
        enableZoom={!readOnly}
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
