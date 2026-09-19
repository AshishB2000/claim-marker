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
import type { Damage } from '../schema'
import { instanceBody, loadBody, repaint, roles } from '../vehicles/load'
import { PROPORTION, SIZE } from '../vehicles/bodies'
import { DEFAULT_LIGHTING, type Lighting } from '../scene/lighting'
import { applyDamage, createDamageUniforms, nodeOffset, patchDamage, type DamageUniforms } from '../marker/damageShader'
import { damageUniforms } from '../marker/damageUniforms'
import { eyeFrom, mercator, metresToMercator, vehicleMatrix } from './transform'

/** `damages` are drawn on the body by the same shader as the studio's; absent is an unmarked car */
export type CarPose = { id: string; body: Vehicle; color: string; position: LngLat; heading: number; damages?: Damage[] }

/** something the scene holds besides the cars, standing at `at` with one model unit being `metres` */
export type Decor = { object: THREE.Object3D; at: LngLat; metres: number }

type Car = {
  root: THREE.Group
  body: Vehicle
  color: string
  /** the faked shadow, shown only while there is no sun to cast a real one */
  blob: THREE.Mesh
  /** the headlights, on after dark; a ghost has none */
  lamps: THREE.SpotLight[]
  ghost: boolean
  /** the damage shader's uniforms, shared by every material of this body */
  damage: DamageUniforms
  /** the marks last packed, by reference: the store hands back the same array until they change */
  damages: Damage[] | undefined
}

/** a soft disc of `rgba` fading to nothing at the edge, `metres` across, lying on the ground */
function disc(width: number, length: number, rgba: [number, number, number, number], blending: THREE.Blending = THREE.NormalBlending): THREE.Mesh {
  // untone-mapped so the tint is the tint: ACES turns a warm pool grey
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 64)
  const [r, gg, b, a] = rgba
  g.addColorStop(0, `rgba(${r},${gg},${b},${a})`)
  g.addColorStop(0.55, `rgba(${r},${gg},${b},${a / 2})`)
  g.addColorStop(1, `rgba(${r},${gg},${b},0)`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  const tex = new THREE.CanvasTexture(c)
  // wound like every ground plane: under a placement matrix of determinant −1 three flips the
  // front face, and an unwound plane facing up is culled as a back face — drawn, and never seen
  const mesh = new THREE.Mesh(reverseWinding(new THREE.PlaneGeometry(width, length)), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending, toneMapped: false }))
  mesh.rotation.x = -Math.PI / 2
  mesh.frustumCulled = false
  return mesh
}

/** a soft dark disc under each car, for when there is no sun to throw a real shadow */
function shadowBlob(width: number, length: number): THREE.Mesh {
  const mesh = disc(width * 1.6, length * 1.35, [0, 0, 0, 0.55])
  mesh.position.y = 0.012
  mesh.renderOrder = -1
  return mesh
}

/** the real shadows land here: a plane under everything that shows nothing but shadow */
const SHADOW_OPACITY = 0.35
/** the shadow map covers this far from the incident in every direction, at 2048 texels across */
const SHADOW_M = 60
const SHADOW_MAP = 2048
/** the ground-level planes reach this far; nothing the camera can see ends at their edge */
const GROUND_M = 400

/** the rain: this many streaks, falling through a box this wide and twice this tall around the incident */
const STREAKS = 600
const RAIN_M = 100
const RAIN_HEIGHT_M = 14

/**
 * ponytail: the scene is in mercator units, so a decaying light's 1/d² clamps to its ceiling
 * everywhere inside its throw and only the cutoff shapes the pool — flat with a soft edge,
 * which is what a headlight on wet tarmac looks like anyway. These are tuned to that ceiling.
 */
const LAMP_INTENSITY = 0.15
const STREET_INTENSITY = 0.01

/**
 * Two headlights per car, in the body's own metres frame: at the corners of the nose, aimed at
 * the road nine metres ahead. Lit only after dark, and always then — whether a car faces the
 * camera is not worth a check. `distance` is in scene units, so it is set when the car is placed.
 */
function headlamps(size: { width: number; length: number }): THREE.SpotLight[] {
  return [-1, 1].map((side) => {
    const lamp = new THREE.SpotLight('#fff1cf', LAMP_INTENSITY, 0, 0.55, 0.7, 2)
    lamp.position.set(side * size.width * 0.33, 0.62, size.length / 2 - 0.05)
    lamp.target.position.set(side * size.width * 0.33, 0, size.length / 2 + 9)
    lamp.visible = false
    return lamp
  })
}

/** the rain, or the snow: `STREAKS` short vertical lines scattered through the box, drawn in one call */
function streaks(): THREE.LineSegments {
  const pos = new Float32Array(STREAKS * 6)
  for (let i = 0; i < STREAKS; i++) {
    const x = (Math.random() - 0.5) * RAIN_M
    const y = Math.random() * RAIN_HEIGHT_M * 2
    const z = (Math.random() - 0.5) * RAIN_M
    pos.set([x, y, z, x, y + 0.5, z], i * 6)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ transparent: true, depthWrite: false, fog: false, toneMapped: false }))
  lines.frustumCulled = false
  lines.renderOrder = 1
  lines.visible = false
  return lines
}

/** a plane lying on the ground in the model frame (y up), `GROUND_M` across, lifted by `y` */
function ground(material: THREE.Material, y: number, renderOrder: number): THREE.Mesh {
  const mesh = new THREE.Mesh(reverseWinding(new THREE.PlaneGeometry(GROUND_M, GROUND_M).rotateX(-Math.PI / 2)), material)
  mesh.position.y = y
  mesh.frustumCulled = false
  mesh.renderOrder = renderOrder
  mesh.visible = false
  return mesh
}

/**
 * A flat white ring, one unit across, lying on the ground: the shockwave `MapScene` scales out
 * from the impact during a cinematic replay. Unlit and untone-mapped so it is white, not the
 * grey the tone mapper makes of white; lifted a hair so it does not fight the ground.
 */
export function shockRing(): THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 1, 48).rotateX(-Math.PI / 2).translate(0, 0.02, 0),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
  )
  mesh.frustumCulled = false
  return mesh
}

/**
 * How faint a second account's cars are drawn — present enough to compare against the first,
 * never mistaken for it.
 */
const GHOST_OPACITY = 0.45

/**
 * A car's own materials, every one of them. `instanceBody` gives every car a fresh paint
 * material, but its other roles (glass, plastic, rim, …) come straight from the cached template
 * and are shared by every instance of that body — fading them for a ghost, or patching the
 * damage shader's uniforms into them, would change the policyholder's solid car too, the
 * moment it shares a body with a ghost. So each is cloned once here, then dressed for the map,
 * faded if it is a ghost's, and patched with this car's damage.
 */
function ownMaterials(root: THREE.Object3D, damage: DamageUniforms, ghost: boolean) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const r = roles(mesh)
    const offset = nodeOffset(mesh, root)
    const own = (mats: THREE.Material[]) =>
      mats.map((m, i) => {
        const c = m.clone()
        if ((c as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) (c as THREE.MeshPhysicalMaterial).envMapIntensity = 0.4
        // the shadow pass draws back faces by default, and the kit's bodies are open shells
        // with no floor: from a high sun that is a sliver of door lining and no shadow at all
        c.shadowSide = THREE.DoubleSide
        if (ghost) {
          c.transparent = true
          c.opacity = GHOST_OPACITY
        }
        patchDamage(c, damage, r[i] ?? 'trim', offset)
        return c
      })
    mesh.material = Array.isArray(mesh.material) ? own(mesh.material) : own([mesh.material])[0]
  })
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
  /** a second account's cars — kept in their own map so a ghost sharing a real car's id (both
   * accounts commonly name their own vehicle "a") never collides with it */
  private readonly ghostCars = new Map<string, Car>()
  private poses: CarPose[] = []
  private ghostPoses: CarPose[] = []
  private decor: Decor[] = []
  /** decor whose geometry has already been rewound — once, or a second pass would wind it back */
  private readonly wound = new WeakSet<THREE.Object3D>()
  private origin: LngLat
  private readonly shift = new THREE.Matrix4()
  private readonly proj = new THREE.Matrix4()
  private readonly eye = new THREE.Vector3()

  private readonly sun: THREE.DirectionalLight
  private readonly sky: THREE.HemisphereLight
  private lighting: Lighting = DEFAULT_LIGHTING
  /**
   * Everything the moment adds at ground level, built in a body's own frame (y up, metres) and
   * placed at the incident by the same `vehicleMatrix` as a car — so one scene unit is a
   * metre here too, and the map's mirrored projection is answered once, by `reverseWinding`.
   */
  private readonly moment = new THREE.Group()
  private readonly shadowGround = ground(new THREE.ShadowMaterial({ opacity: SHADOW_OPACITY, depthWrite: false }), 0.004, -2)
  /** a wet road: dark, near-mirror, translucent — the sky and the lamps reflect in it */
  private readonly wet = ground(
    new THREE.MeshStandardMaterial({ color: '#2b3442', roughness: 0.05, metalness: 0.15, transparent: true, opacity: 0.6, depthWrite: false, envMapIntensity: 1.2 }),
    0.002,
    -3,
  )
  /** fog: a white sheet at 30 % over the ground; the cars themselves take `scene.fog` */
  private readonly sheet = ground(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.3, depthWrite: false, fog: false }), 0.001, -4)
  private readonly fog = new THREE.Fog('#d9dde3', 1, 2)
  /** a street-lit road after dark: a warm pool on the ground and a warm light over the cars */
  private readonly pool = disc(36, 36, [255, 180, 90, 0.55], THREE.AdditiveBlending)
  private readonly streetLight = new THREE.PointLight('#ffc27a', STREET_INTENSITY, 0, 2)
  private readonly rain = streaks()
  /** the rain's next frame is already asked for: it falls at about 20 fps, not the display's rate */
  private falling: ReturnType<typeof setTimeout> | null = null

  constructor(origin: LngLat) {
    this.origin = origin
    // kept modest: with the room environment on top, brighter lights pushed red paint to
    // pink and black to grey through the tone mapper — measured on the map, not guessed
    this.sun = new THREE.DirectionalLight('#ffffff', 1.5)
    this.sun.position.set(0.45, -0.6, 1) // from the east-north-east, high
    this.sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP)
    this.sky = new THREE.HemisphereLight('#dfe8f5', '#6b6f78', 0.45)
    this.sky.position.set(0, 0, 1) // the map's up is +z, not three's +y
    this.shadowGround.receiveShadow = true
    this.pool.position.y = 0.003
    this.pool.renderOrder = -2
    this.pool.visible = false
    this.streetLight.position.set(0, 9, 0)
    this.streetLight.visible = false
    this.moment.add(this.sheet, this.wet, this.shadowGround, this.pool, this.streetLight, this.rain)
    this.moment.matrixAutoUpdate = false
    this.scene.add(this.sun, this.sky, this.moment)
    this.scene.environmentRotation.x = Math.PI / 2
    this.fit()
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext) {
    this.map = map
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true })
    this.renderer.autoClear = false
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    // seen from above, a clearcoat roof mirrors the room's ceiling light and reads white
    // whatever its paint; the reflections are kept faint on the map and strong in the studio
    this.scene.environmentIntensity = 0.3 * this.lighting.environment
    pmrem.dispose()
    void this.sync(false)
  }

  onRemove() {
    if (this.falling) clearTimeout(this.falling)
    this.falling = null
    this.map = null
    this.renderer = null
  }

  /** the point the cars are positioned relative to; the layer folds it into the projection */
  setOrigin(origin: LngLat) {
    this.origin = origin
    this.reposition(this.cars, this.poses)
    this.reposition(this.ghostCars, this.ghostPoses)
    for (const d of this.decor) vehicleMatrix(d.at, 0, d.metres, this.origin, d.object.matrix)
    this.fit()
    this.map?.triggerRepaint()
  }

  /**
   * Everything sized in scene units, which are mercator units and so depend on the origin's
   * latitude: where the ground planes stand, how far the sun sits and how much ground its
   * shadow camera covers, the fog's reach, and every lamp's throw. Called for a new origin.
   */
  private fit() {
    const s = metresToMercator(this.origin[1])
    vehicleMatrix(this.origin, 0, 1, this.origin, this.moment.matrix)
    const [x, y, z] = this.lighting.sun
    this.sun.position.set(x, y, z).multiplyScalar(80 * s)
    const cam = this.sun.shadow.camera
    cam.left = cam.bottom = -SHADOW_M * s
    cam.right = cam.top = SHADOW_M * s
    cam.near = 1 * s
    cam.far = 200 * s
    cam.updateProjectionMatrix()
    this.fog.near = 60 * s
    this.fog.far = 260 * s
    this.streetLight.distance = 30 * s
    for (const car of this.cars.values()) this.dress(car, s)
  }

  /**
   * The moment's light, from `lightingFor` — or null for the fixed light the map has always
   * had. Decoration only: the sun's direction, the sky's tint, real shadows when the sun is
   * up, a wet road and rain, snow, fog, headlights and a street-lit pool after dark.
   */
  setLighting(l: Lighting | null) {
    this.lighting = l ?? DEFAULT_LIGHTING
    const { lighting } = this
    this.sun.intensity = lighting.sunIntensity
    this.sun.color.set(lighting.sunColor)
    this.sun.castShadow = lighting.shadows
    this.sky.color.set(lighting.sky)
    this.sky.groundColor.set(lighting.ground)
    this.sky.intensity = lighting.skyIntensity
    this.scene.environmentIntensity = 0.3 * lighting.environment
    this.scene.fog = lighting.fog ? this.fog : null
    this.shadowGround.visible = lighting.shadows
    this.wet.visible = lighting.rain
    this.sheet.visible = lighting.fog
    this.pool.visible = lighting.lit
    this.streetLight.visible = lighting.lit
    const precipitation = lighting.rain || lighting.snow
    this.rain.visible = precipitation
    const m = this.rain.material as THREE.LineBasicMaterial
    m.color.set(lighting.snow ? '#ffffff' : '#b8c6d9')
    m.opacity = lighting.snow ? 0.9 : 0.45
    // snow: the same streaks a quarter as long, falling at a sixth of the rate
    this.rain.scale.y = lighting.snow ? 0.25 : 1
    this.fit()
    this.map?.triggerRepaint()
  }

  /** what this lighting means for one car: the blob or a real shadow, the headlights on or off */
  private dress(car: Car, s = metresToMercator(this.origin[1])) {
    // a ghost casts no real shadow, so it keeps its blob whatever the sun is doing
    car.blob.visible = car.ghost || !this.lighting.shadows
    for (const lamp of car.lamps) {
      lamp.visible = this.lighting.night
      lamp.distance = 14 * s
    }
  }

  private reposition(cars: Map<string, Car>, poses: CarPose[]) {
    for (const [id, car] of cars) {
      const pose = poses.find((p) => p.id === id)
      if (pose) vehicleMatrix(pose.position, pose.heading, 1, this.origin, car.root.matrix)
    }
  }

  setPoses(poses: CarPose[]) {
    this.poses = poses
    void this.sync(false)
  }

  /**
   * The other account's vehicles, drawn by this same layer at {@link GHOST_OPACITY} — sharing
   * the loaded body cache, the scene and the renderer rather than standing up a second
   * `CarLayer`, which would need its own `onAdd` wired into the same GL context for nothing a
   * second pose list does not already give it. `ghostCars` keeps them apart from the real set
   * only so ids do not collide; `sync` below does not otherwise know or care which set it is
   * filling.
   */
  setGhosts(poses: CarPose[]) {
    this.ghostPoses = poses
    void this.sync(true)
  }

  /**
   * Extras the scene holds besides the cars — a shockwave, a building — decoration, never
   * anything the document records. Replaces the previous set, so a caller animating one hands
   * it in again every frame. Each object's geometry is wound the other way once, like a body's,
   * or the map's mirrored projection would cull it.
   */
  setDecor(decor: Decor[]) {
    for (const d of this.decor) this.scene.remove(d.object)
    this.decor = decor
    for (const d of decor) {
      if (!this.wound.has(d.object)) {
        this.wound.add(d.object)
        d.object.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (mesh.isMesh) mesh.geometry = reverseWinding(mesh.geometry)
        })
      }
      d.object.matrixAutoUpdate = false
      vehicleMatrix(d.at, 0, d.metres, this.origin, d.object.matrix)
      this.scene.add(d.object)
    }
    this.map?.triggerRepaint()
  }

  /**
   * `poses()` reads `this.poses`/`this.ghostPoses` live rather than a snapshot, so a `setPoses`
   * or `setGhosts` that lands while a body is still loading is seen by the `continue` guard
   * below — a stale load cannot add a car nobody asked for any more.
   */
  private async sync(ghost: boolean) {
    const cars = ghost ? this.ghostCars : this.cars
    const poses = () => (ghost ? this.ghostPoses : this.poses)
    for (const [id, car] of cars) {
      const pose = poses().find((p) => p.id === id)
      if (!pose || pose.body !== car.body) {
        this.scene.remove(car.root)
        cars.delete(id)
      }
    }
    for (const pose of poses()) {
      let car = cars.get(pose.id)
      if (!car) {
        const template = await loadBody(pose.body)
        // the world may have moved on during the load
        if (cars.has(pose.id) || !poses().some((p) => p.id === pose.id && p.body === pose.body)) continue
        const inner = instanceBody(template, pose.color)
        const damage = createDamageUniforms(PROPORTION[pose.body])
        ownMaterials(inner, damage, ghost)
        inner.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (!mesh.isMesh) return
          mesh.geometry = reverseWinding(mesh.geometry)
          // a real car throws a real shadow on the ground plane; a ghost at half opacity does not
          mesh.castShadow = !ghost
        })
        // the body is stretched to the real dimensions of its class, so from here on one
        // scene unit is one metre and the placement matrix carries no scale of its own
        inner.scale.set(...PROPORTION[pose.body])
        const size = SIZE[pose.body]
        const root = new THREE.Group()
        const blob = shadowBlob(size.width, size.length)
        // the blob has a material of its own (`disc`), so a ghost's fades with its body
        if (ghost) (blob.material as THREE.MeshBasicMaterial).opacity = GHOST_OPACITY
        const lamps = ghost ? [] : headlamps(size)
        root.add(inner, blob, ...lamps, ...lamps.map((lamp) => lamp.target))
        root.matrixAutoUpdate = false
        this.scene.add(root)
        car = { root, body: pose.body, color: pose.color, blob, lamps, ghost, damage, damages: undefined }
        cars.set(pose.id, car)
        this.dress(car)
      } else if (car.color !== pose.color) {
        repaint(car.root, pose.color)
        car.color = pose.color
      }
      if (car.damages !== pose.damages) {
        applyDamage(car.damage, damageUniforms(pose.damages ?? [], pose.body))
        car.damages = pose.damages
      }
      vehicleMatrix(pose.position, pose.heading, 1, this.origin, car.root.matrix)
    }
    this.map?.triggerRepaint()
  }

  render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput) {
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
    if (this.rain.visible) {
      // the box is twice the fall height, so sliding it down by up to one height keeps the
      // visible band full. The next frame is asked for 50 ms on, not every frame: a repaint is
      // the whole map — tiles, lines, the wet plane — and streaks read as falling at 20 fps
      const rate = this.lighting.snow ? 1.5 : 9
      this.rain.position.y = -((performance.now() / 1000) * rate) % (RAIN_HEIGHT_M * this.rain.scale.y)
      if (!this.falling)
        this.falling = setTimeout(() => {
          this.falling = null
          this.map?.triggerRepaint()
        }, 50)
    }
    this.renderer.resetState()
    // the shadow pass renders into its own framebuffer and, coming back, restores the viewport
    // three believes the canvas has — which is the size it was created at, not the size the
    // map has resized it to since. MapLibre restores its own viewport after the layer; this
    // is for three's main pass, which draws straight after the shadow pass with no other reset.
    this.renderer.setViewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
    this.renderer.render(this.scene, this.camera)
  }
}
