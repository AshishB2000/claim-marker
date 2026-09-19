import { use, useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { LngLat } from '../geo'
import type { Damage } from '../schema'
import { translate, type Lang } from '../i18n'
import type { Lighting } from '../scene/lighting'
import type { V3, Vehicle } from '../zones'
import { instanceBody, loadBody } from '../vehicles/load'
import { PROPORTION } from '../vehicles/bodies'
import { applyDamage, createDamageUniforms, patchInstance } from './damageShader'
import { damageUniforms } from './damageUniforms'
import { placeVehicles, type Placed } from './place'
import { Studio } from './Studio'

/** a vehicle as the scene takes it: a `ClaimVehicle` where it came to rest, or a `CarPose` from a playback */
type Standing = { id: string; body: Vehicle; color: string; position: LngLat | null; heading: number; damages?: Damage[] }
type Stood = Standing & { position: LngLat }
const isStood = (v: Standing): v is Stood => v.position !== null

/** the camera's way in: from the south-east and above, the three-quarter view the marker opens on */
const VIEW = new THREE.Vector3(0.62, 0.55, 0.56).normalize()
const RING = '#dc2626'

/**
 * One car, where it stands: its own body and paint, its own materials, and the real damage
 * patched in — the same shader and the same packing as the marker's car and the map's.
 */
function Body({ v, at }: { v: Stood; at: Placed }) {
  const template = use(loadBody(v.body))
  // one set per car, built once: the caller keys a car by its body, so a new body is a new car
  const [damage] = useState(() => createDamageUniforms(PROPORTION[v.body]))
  const model = useMemo(() => {
    const root = instanceBody(template, v.color)
    patchInstance(root, damage)
    return root
  }, [template, v.color, damage])
  useEffect(() => applyDamage(damage, damageUniforms(v.damages ?? [], v.body)), [damage, v.damages, v.body])
  useEffect(
    () => () => {
      model.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose()
      })
    },
    [model],
  )
  return (
    <group name={`car:${v.id}`} position={at.position} rotation-y={at.rotationY}>
      <primitive object={model} scale={PROPORTION[v.body]} />
    </group>
  )
}

/**
 * The accident in 3D: every vehicle on the diagram stood in the studio where the map put it —
 * in metres from the impact, turned to its heading (`placeVehicles`) — with its own damage in
 * the paint, the impact ringed on the floor, lit by the moment's `lighting` like the map and the
 * marker. Orbit it; nothing in it can be picked or moved, and it is never exported.
 *
 * `vehicles` is where they came to rest, and sets the origin and the framing; `poses`, while a
 * playback runs (`posesAt`, the map's own), is drawn instead, so the cars drive in and meet
 * here too. Each car is a group named `car:<id>` in its body's own metres — nose +Z, left +X —
 * so anything that belongs to a car can stand in that group.
 */
export function Reconstruction({
  vehicles,
  impact,
  poses = null,
  lang,
  lighting = null,
  zoom = true,
  className,
}: {
  vehicles: Standing[]
  impact: LngLat | null
  /** a playback's frame, drawn instead of `vehicles`; null is the scene at rest */
  poses?: Standing[] | null
  lang: Lang
  lighting?: Lighting | null
  /** the wheel zooms; off where the canvas sits in a page the wheel should scroll */
  zoom?: boolean
  className?: string
}) {
  const rest = vehicles.filter(isStood)
  // the impact is the origin; without one, the middle of where the cars came to rest — never
  // the poses', or a playback would drag the floor along with the cars
  const origin: LngLat | null =
    impact ?? (rest.length ? [rest.reduce((s, v) => s + v.position[0], 0) / rest.length, rest.reduce((s, v) => s + v.position[1], 0) / rest.length] : null)
  const shown = (poses ?? vehicles).filter(isStood)
  const placed = origin ? placeVehicles(shown, origin) : []

  // framed once, from where they came to rest: every car in view, however far from the impact
  const [view] = useState(() => {
    const far = origin ? Math.max(0, ...placeVehicles(rest, origin).map((p) => Math.hypot(p.position[0], p.position[2]))) : 0
    const radius = Math.max(7, far + 3.5)
    return { radius, distance: radius * 2.4 }
  })
  // the sun in this frame — the map's (east, south, up) is the studio's (x, z, y) — eight metres out
  const key: V3 = lighting ? [lighting.sun[0] * 8, lighting.sun[2] * 8, lighting.sun[1] * 8] : [4, 6.5, 3]

  return (
    <div data-reconstruction className={className} role="img" aria-label={translate(lang, 'scene.reconstruction.label')}>
      <Canvas
        // drawn when something changes — a drag, a playback frame, a car arriving — not sixty times a second on a page that is read
        frameloop="demand"
        dpr={[1, 2]}
        camera={{ position: VIEW.clone().multiplyScalar(view.distance).toArray(), fov: 35, near: 0.1, far: view.distance * 8 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace }}
        onCreated={({ gl, camera, scene }) => {
          // for the smoke: where a car stands on this canvas, in its pixels
          if (import.meta.env.DEV)
            Object.assign(gl.domElement, {
              __probe: {
                project: (id: string) => {
                  const car = scene.getObjectByName(`car:${id}`)
                  if (!car) return null
                  const v = car.getWorldPosition(new THREE.Vector3()).setY(0.7).project(camera)
                  return [((v.x + 1) / 2) * gl.domElement.width, ((1 - v.y) / 2) * gl.domElement.height]
                },
              },
            })
        }}
      >
        <Studio theme="light" lighting={lighting} keyAt={key} reach={view.radius * 2.4}>
          {shown.map((v, i) => (
            <Body key={`${v.id}:${v.body}`} v={v} at={placed[i]} />
          ))}
        </Studio>

        {impact && (
          // the impact, flat on the floor where the diagram's cross is, wide enough to show round the cars that meet on it
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, 0]}>
            <ringGeometry args={[1.3, 1.6, 64]} />
            <meshBasicMaterial color={RING} toneMapped={false} transparent opacity={0.85} depthWrite={false} />
          </mesh>
        )}

        <OrbitControls
          makeDefault
          target={[0, 0.6, 0]}
          enablePan={false}
          enableZoom={zoom}
          enableDamping
          dampingFactor={0.09}
          rotateSpeed={0.75}
          minDistance={view.distance * 0.35}
          maxDistance={view.distance * 2}
          minPolarAngle={0.15}
          // never let the camera drop below the floor
          maxPolarAngle={Math.PI / 2 - 0.04}
        />
      </Canvas>
    </div>
  )
}
