/**
 * The vehicles, drawn by three.js inside MapLibre's own WebGL context as a custom layer.
 * MapLibre supplies the projection matrix every frame, so tilting and rotating the map keeps
 * the cars standing on the ground, and because it is the map's canvas, the review page can
 * export the map and the cars in one PNG.
 *
 * The layer is purely visual. Grabbing, turning and routing a vehicle happen through DOM
 * markers in MapScene, which already project correctly under pitch and work on touch;
 * raycasting into a custom layer would mean inverting the map's projection by hand.
 */
import * as THREE from 'three'
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from 'maplibre-gl'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { LngLat } from '../geo'
import type { Vehicle } from '../zones'
import { instanceBody, loadBody, repaint } from '../vehicles/load'
import { PROPORTION, SIZE } from '../vehicles/bodies'
import { eyeFrom, mercator, vehicleMatrix } from './transform'

export type CarPose = { id: string; body: Vehicle; color: string; position: LngLat; heading: number }

type Car = { root: THREE.Group; body: Vehicle; color: string }

/** a soft dark disc under each car — there is no ground mesh for a real shadow to land on */
function shadowBlob(width: number, length: number): THREE.Mesh {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 64)
  g.addColorStop(0, 'rgba(0,0,0,0.55)')
  g.addColorStop(0.55, 'rgba(0,0,0,0.28)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  const tex = new THREE.CanvasTexture(c)
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 1.6, length * 1.35),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  )
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = 0.012
  mesh.frustumCulled = false
  mesh.renderOrder = -1
  return mesh
}

const rewound = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>()

/**
 * The same geometry wound the other way. MapLibre's projection mirrors window-space winding
 * (mercator y runs south, clip y runs up) and three.js only compensates for the model matrix,
 * so with the kit's geometry as-is it culls every outer face and lights the inner ones with
 * inverted normals: a red car renders grey. Reversing each triangle once, and caching the
 * result per body, puts culling and normals right without touching the studio scenes.
 */
function reverseWinding(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  let out = rewound.get(geo)
  if (out) return out
  out = geo.clone()
  const idx = out.index
  if (idx) {
    const a = idx.array
    for (let i = 0; i + 2 < a.length; i += 3) {
      const t = a[i + 1]
      a[i + 1] = a[i + 2]
      a[i + 2] = t
    }
    idx.needsUpdate = true
  } else {
    for (const attr of Object.values(out.attributes) as THREE.BufferAttribute[]) {
      const n = attr.itemSize
      const arr = attr.array
      for (let i = 0; i + 2 < attr.count; i += 3) {
        for (let k = 0; k < n; k++) {
          const j1 = (i + 1) * n + k
          const j2 = (i + 2) * n + k
          const t = arr[j1]
          arr[j1] = arr[j2]
          arr[j2] = t
        }
      }
      attr.needsUpdate = true
    }
  }
  rewound.set(geo, out)
  return out
}

export class CarLayer implements CustomLayerInterface {
  id = 'cars'
  type = 'custom' as const
  renderingMode = '3d' as const

  private map: MapLibreMap | null = null
  private renderer: THREE.WebGLRenderer | null = null
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.Camera()
  private readonly cars = new Map<string, Car>()
  private poses: CarPose[] = []
  private origin: LngLat
  private readonly shift = new THREE.Matrix4()
  private readonly proj = new THREE.Matrix4()
  private readonly eye = new THREE.Vector3()

  constructor(origin: LngLat) {
    this.origin = origin
    // kept modest: with the room environment on top, brighter lights pushed red paint to
    // pink and black to grey through the tone mapper — measured on the map, not guessed
    const sun = new THREE.DirectionalLight('#ffffff', 1.5)
    sun.position.set(0.45, -0.6, 1) // from the east-north-east, high
    const sky = new THREE.HemisphereLight('#dfe8f5', '#6b6f78', 0.45)
    sky.position.set(0, 0, 1) // the map's up is +z, not three's +y
    this.scene.add(sun, sky)
    this.scene.environmentRotation.x = Math.PI / 2
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext) {
    this.map = map
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true })
    this.renderer.autoClear = false
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    // seen from above, a clearcoat roof mirrors the room's ceiling light and reads white
    // whatever its paint; the reflections are kept faint on the map and strong in the studio
    this.scene.environmentIntensity = 0.3
    pmrem.dispose()
    void this.sync()
  }

  onRemove() {
    this.map = null
    this.renderer = null
  }

  /** the point the cars are positioned relative to; the layer folds it into the projection */
  setOrigin(origin: LngLat) {
    this.origin = origin
    for (const [id, car] of this.cars) {
      const pose = this.poses.find((p) => p.id === id)
      if (pose) vehicleMatrix(pose.position, pose.heading, 1, this.origin, car.root.matrix)
    }
    this.map?.triggerRepaint()
  }

  setPoses(poses: CarPose[]) {
    this.poses = poses
    void this.sync()
  }

  private async sync() {
    for (const [id, car] of this.cars) {
      const pose = this.poses.find((p) => p.id === id)
      if (!pose || pose.body !== car.body) {
        this.scene.remove(car.root)
        this.cars.delete(id)
      }
    }
    for (const pose of this.poses) {
      let car = this.cars.get(pose.id)
      if (!car) {
        const template = await loadBody(pose.body)
        // the world may have moved on during the load
        if (this.cars.has(pose.id) || !this.poses.some((p) => p.id === pose.id && p.body === pose.body)) continue
        const inner = instanceBody(template, pose.color)
        inner.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (!mesh.isMesh) return
          mesh.geometry = reverseWinding(mesh.geometry)
          for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            if ((m as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) (m as THREE.MeshPhysicalMaterial).envMapIntensity = 0.4
          }
        })
        // the body is stretched to the real dimensions of its class, so from here on one
        // scene unit is one metre and the placement matrix carries no scale of its own
        inner.scale.set(...PROPORTION[pose.body])
        const size = SIZE[pose.body]
        const root = new THREE.Group()
        root.add(inner, shadowBlob(size.width, size.length))
        root.matrixAutoUpdate = false
        this.scene.add(root)
        car = { root, body: pose.body, color: pose.color }
        this.cars.set(pose.id, car)
      } else if (car.color !== pose.color) {
        repaint(car.root, pose.color)
        car.color = pose.color
      }
      vehicleMatrix(pose.position, pose.heading, 1, this.origin, car.root.matrix)
    }
    this.map?.triggerRepaint()
  }

  render(_gl: WebGL2RenderingContext, options: CustomRenderMethodInput) {
    if (!this.renderer) return
    const o = mercator(this.origin)
    this.proj.fromArray(options.defaultProjectionData.mainMatrix as unknown as ArrayLike<number>)
    // the three camera stands where the map's camera is, relative to the floating origin, so
    // view-dependent shading is right; the projection carries the same offset back out, so
    // projection · view · model is still the map's matrix times the model's
    eyeFrom(this.proj, this.eye)
    this.camera.position.set(this.eye.x - o.x, this.eye.y - o.y, this.eye.z)
    this.camera.updateMatrixWorld(true)
    this.camera.projectionMatrix.multiplyMatrices(this.proj, this.shift.makeTranslation(this.eye.x, this.eye.y, this.eye.z))
    this.renderer.resetState()
    this.renderer.render(this.scene, this.camera)
  }
}
