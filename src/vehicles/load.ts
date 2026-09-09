/**
 * Loads a Kenney body once and re-authors it so it stops looking like a toy.
 *
 * The kit paints everything from one colour map whose swatches are faint gradients. Sampling
 * that map per triangle and clustering near-identical keys gives a handful of colour groups
 * per body, and each group has a job a real car would recognise: the saturated family and
 * the bluish-grey trim are the **paint** and become a clearcoat, metallic-flake material in
 * the customer's colour, the way modern cars wear body-coloured bumpers; the pale bluish
 * swatch is **glass**, dark and mirror-like from outside; the near-black swatch is **plastic**
 * (wheel arches, grille, underside); the pale warm swatch is a **headlight**, the small red
 * one a **taillight**. On the wheels the darkest group is **rubber** and the rest is **rim**.
 * Edges below 35° are smoothed so the bevels read as curves.
 *
 * One upgraded template per body is cached; `instanceBody` clones it with its own paint
 * material, so two vehicles of the same body in different colours share geometry.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MODELS } from '../models'
import type { Vehicle } from '../zones'

export type Role = 'paint' | 'trim' | 'plastic' | 'glass' | 'headlight' | 'taillight' | 'rubber' | 'rim'

const loader = new GLTFLoader()
const textures = new THREE.TextureLoader()
const templates = new Map<string, Promise<THREE.Group>>()
const cachedTex = new Map<string, Promise<THREE.Texture>>()

function texture(url: string, repeat: number): Promise<THREE.Texture> {
  let p = cachedTex.get(url)
  if (!p) {
    p = textures.loadAsync(url).then((t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.repeat.set(repeat, repeat)
      return t
    })
    cachedTex.set(url, p)
  }
  return p
}

export function loadBody(body: Vehicle, url: string = MODELS[body]): Promise<THREE.Group> {
  let p = templates.get(url)
  if (!p) {
    p = Promise.all([loader.loadAsync(url), texture('/tex/flake_normal.png', 40)]).then(([gltf, flake]) => upgrade(gltf.scene, flake))
    templates.set(url, p)
  }
  return p
}

/** the roles of a mesh's material slots, parallel to `mesh.material` */
const roles = (mesh: THREE.Mesh): Role[] => (mesh.userData.roles as Role[] | undefined) ?? []

/** a fresh copy with its own paint material in `hex` */
export function instanceBody(template: THREE.Group, hex: string): THREE.Group {
  const root = template.clone(true)
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || !Array.isArray(mesh.material)) return
    const r = roles(mesh)
    mesh.material = mesh.material.map((m, i) => (r[i] === 'paint' ? paintMaterial(hex, (m as THREE.MeshPhysicalMaterial).normalMap) : m))
  })
  return root
}

export function paintMaterial(hex: string, flake: THREE.Texture | null = null) {
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(hex),
    roughness: 0.38,
    metalness: 0.28,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1,
  })
  if (flake) {
    m.normalMap = flake
    m.normalScale.set(0.08, 0.08)
  }
  return m
}

/** re-tint an instance already on screen */
export function repaint(root: THREE.Object3D, hex: string) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || !Array.isArray(mesh.material)) return
    const r = roles(mesh)
    mesh.material.forEach((m, i) => {
      if (r[i] === 'paint') (m as THREE.MeshPhysicalMaterial).color.set(hex)
    })
  })
}

export const bodyBounds = (root: THREE.Object3D) => new THREE.Box3().setFromObject(root)

// ── reading the colour map ───────────────────────────────────────────

type Pixels = { data: Uint8ClampedArray; w: number; h: number }
const pixels = new WeakMap<object, Pixels>()

function readTexture(tex: THREE.Texture): Pixels | null {
  const img = tex.image as CanvasImageSource & { width: number; height: number }
  if (!img || !img.width) return null
  let px = pixels.get(img)
  if (px) return px
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0)
  const { data } = ctx.getImageData(0, 0, c.width, c.height)
  px = { data, w: c.width, h: c.height }
  pixels.set(img, px)
  return px
}

const wrap = (t: number) => t - Math.floor(t)

/** packed rgb of the texel under a uv; glTF uv origin is top-left, which is the image's */
function texel(px: Pixels, u: number, v: number): number {
  const x = Math.min(px.w - 1, Math.floor(wrap(u) * px.w))
  const y = Math.min(px.h - 1, Math.floor(wrap(v) * px.h))
  const i = (y * px.w + x) * 4
  return (px.data[i] << 16) | (px.data[i + 1] << 8) | px.data[i + 2]
}

const isWheel = (o: THREE.Object3D) => /wheel/i.test(o.name)

const a = new THREE.Vector3()
const b = new THREE.Vector3()
const c = new THREE.Vector3()

type Tris = { key: number[]; vote: number[]; index: (t: number, k: number) => number; count: number }

/**
 * Per-triangle colour key and voting area for one mesh; null when it has no uv or no texture.
 * Faces pointing down do not vote: the underside is two enormous dark triangles.
 */
function triangles(mesh: THREE.Mesh): Tris | null {
  const geo = mesh.geometry
  const mat = mesh.material as THREE.MeshStandardMaterial
  const uv = geo.attributes.uv as THREE.BufferAttribute | undefined
  const pos = geo.attributes.position as THREE.BufferAttribute
  if (!uv || !pos || Array.isArray(mesh.material) || !mat.map) return null
  const px = readTexture(mat.map)
  if (!px) return null
  const idx = geo.index
  const index = (t: number, k: number) => (idx ? idx.getX(t * 3 + k) : t * 3 + k)
  const count = (idx ? idx.count : pos.count) / 3
  const key: number[] = []
  const vote: number[] = []
  for (let t = 0; t < count; t++) {
    const i0 = index(t, 0)
    key.push(texel(px, uv.getX(i0), uv.getY(i0)))
    a.fromBufferAttribute(pos, i0)
    b.fromBufferAttribute(pos, index(t, 1))
    c.fromBufferAttribute(pos, index(t, 2))
    const n = b.sub(a).cross(c.sub(a))
    const area = n.length() / 2
    vote.push(area > 0 && n.y / (2 * area) < -0.5 ? 0 : area)
  }
  return { key, vote, index, count }
}

// ── colour clusters and what they are ────────────────────────────────

/** how far apart, in 8-bit RGB, two keys can be and still be the same swatch */
const SWATCH = 34

type Cluster = { r: number; g: number; b: number; keys: Set<number>; area: number; tris: number }

const saturation = ({ r, g, b }: Cluster) => {
  const mx = Math.max(r, g, b)
  return mx ? (mx - Math.min(r, g, b)) / mx : 0
}
const lightness = ({ r, g, b }: Cluster) => Math.max(r, g, b) / 255
const hue = ({ r, g, b }: Cluster) => {
  const mx = Math.max(r, g, b)
  const d = mx - Math.min(r, g, b)
  if (d === 0) return 0
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return h * 60
}
const hueApart = (x: Cluster, y: Cluster) => {
  const d = Math.abs(hue(x) - hue(y)) % 360
  return d > 180 ? 360 - d : d
}

function clusters(byColour: Map<number, { area: number; tris: number }>): Cluster[] {
  const out: Cluster[] = []
  for (const [key, { area, tris }] of [...byColour.entries()].sort((x, y) => y[1].area - x[1].area)) {
    const r = (key >> 16) & 255
    const g = (key >> 8) & 255
    const b = key & 255
    let cl = out.find((c) => Math.hypot(c.r - r, c.g - g, c.b - b) < SWATCH)
    if (!cl) {
      cl = { r, g, b, keys: new Set(), area: 0, tris: 0 }
      out.push(cl)
    }
    cl.keys.add(key)
    cl.area += area
    cl.tris += tris
  }
  return out
}

/**
 * The job of every colour on the body. Measured on the kit: the trim (bumpers, sills,
 * mirrors) is the same bluish grey on every body and can out-vote the paint by area, so the
 * paint is the saturated family scored by area × saturation; a second shade of it within 30°
 * of hue is paint too, unless it is tiny, which is how a red taillight stays a taillight on
 * an orange car. The trim is then painted as well: real cars wear body-coloured bumpers.
 */
function bodyRoles(cs: Cluster[]): Map<number, Role> {
  const map = new Map<number, Role>()
  if (cs.length === 0) return map
  const score = (cl: Cluster) => cl.area * (0.5 + saturation(cl))
  let best = cs[0]
  for (const cl of cs) if (score(cl) > score(best)) best = cl
  for (const cl of cs) {
    const s = saturation(cl)
    const l = lightness(cl)
    let role: Role = 'trim'
    if (cl === best) role = 'paint'
    else if (s > 0.3 && saturation(best) > 0.3 && hueApart(cl, best) < 30 && cl.area > best.area * 0.08) role = 'paint'
    else if (s < 0.25 && l < 0.32) role = 'plastic'
    else if (s < 0.3 && l > 0.72 && cl.b >= cl.r) role = 'glass'
    else if (s >= 0.15 && l > 0.75 && hue(cl) > 30 && hue(cl) < 75) role = 'headlight'
    else if (s > 0.5 && (hue(cl) < 20 || hue(cl) > 340)) role = 'taillight'
    else if (s < 0.28 && l >= 0.32 && l <= 0.62) role = 'paint'
    for (const k of cl.keys) map.set(k, role)
  }
  return map
}

/** on a wheel the darkest group is the tyre and everything else is the rim */
function wheelRoles(cs: Cluster[]): Map<number, Role> {
  const map = new Map<number, Role>()
  if (cs.length === 0) return map
  let darkest = cs[0]
  for (const cl of cs) if (lightness(cl) < lightness(darkest)) darkest = cl
  for (const cl of cs) for (const k of cl.keys) map.set(k, cl === darkest ? 'rubber' : 'rim')
  return map
}

// ── materials ────────────────────────────────────────────────────────

function materialFor(role: Role, map: THREE.Texture | null, flake: THREE.Texture): THREE.Material {
  switch (role) {
    case 'paint':
      return paintMaterial('#b9bec6', flake)
    case 'glass':
      return new THREE.MeshPhysicalMaterial({ color: '#131c27', roughness: 0.06, metalness: 0.85, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.4 })
    case 'plastic':
      return new THREE.MeshPhysicalMaterial({ color: '#15171b', roughness: 0.6, metalness: 0.05, clearcoat: 0.25, clearcoatRoughness: 0.4 })
    case 'headlight':
      return new THREE.MeshPhysicalMaterial({ color: '#fff4d2', emissive: '#ffe08a', emissiveIntensity: 0.35, roughness: 0.12, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03 })
    case 'taillight':
      return new THREE.MeshPhysicalMaterial({ color: '#d0202a', emissive: '#6e0a10', emissiveIntensity: 0.4, roughness: 0.15, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03 })
    case 'rubber':
      return new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.92, metalness: 0 })
    case 'rim':
      return new THREE.MeshStandardMaterial({ color: '#cfd3d8', roughness: 0.28, metalness: 0.85 })
    case 'trim':
      return new THREE.MeshPhysicalMaterial({ map, roughness: 0.5, metalness: 0.1, clearcoat: 0.4, clearcoatRoughness: 0.25 })
  }
}

/** edges sharper than this stay sharp; gentler ones are smoothed, so bevels read as curves */
const CREASE = (35 * Math.PI) / 180

/**
 * Split one mesh into one material slot per role and smooth its normals. The geometry is
 * reordered so each role's triangles are contiguous, then de-indexed by the crease pass,
 * which keeps the groups.
 */
function rebuild(mesh: THREE.Mesh, tris: Tris, roleOf: Map<number, Role>, flake: THREE.Texture) {
  const old = mesh.material as THREE.MeshStandardMaterial
  const byRole = new Map<Role, number[]>()
  for (let t = 0; t < tris.count; t++) {
    const role = roleOf.get(tris.key[t]) ?? 'trim'
    let list = byRole.get(role)
    if (!list) {
      list = []
      byRole.set(role, list)
    }
    list.push(tris.index(t, 0), tris.index(t, 1), tris.index(t, 2))
  }
  const order: Role[] = []
  const merged: number[] = []
  const geo = mesh.geometry
  geo.clearGroups()
  for (const [role, list] of byRole) {
    geo.addGroup(merged.length, list.length, order.length)
    order.push(role)
    merged.push(...list)
  }
  const big = merged.some((i) => i > 65535)
  geo.setIndex(new THREE.BufferAttribute(big ? new Uint32Array(merged) : new Uint16Array(merged), 1))
  mesh.geometry = toCreasedNormals(geo, CREASE)
  mesh.material = order.map((role) => materialFor(role, old.map, flake))
  mesh.userData.roles = order
}

function upgrade(scene: THREE.Group, flake: THREE.Texture): THREE.Group {
  const bodies: { mesh: THREE.Mesh; tris: Tris }[] = []
  const wheels: { mesh: THREE.Mesh; tris: Tris }[] = []
  const bodyColours = new Map<number, { area: number; tris: number }>()

  scene.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.frustumCulled = false
    mesh.castShadow = true
    const tris = triangles(mesh)
    if (!tris) return
    if (isWheel(mesh)) {
      wheels.push({ mesh, tris })
      return
    }
    bodies.push({ mesh, tris })
    for (let t = 0; t < tris.count; t++) {
      const e = bodyColours.get(tris.key[t]) ?? { area: 0, tris: 0 }
      e.area += tris.vote[t]
      e.tris++
      bodyColours.set(tris.key[t], e)
    }
  })

  const body = bodyRoles(clusters(bodyColours))
  for (const { mesh, tris } of bodies) rebuild(mesh, tris, body, flake)

  for (const { mesh, tris } of wheels) {
    const colours = new Map<number, { area: number; tris: number }>()
    for (let t = 0; t < tris.count; t++) {
      const e = colours.get(tris.key[t]) ?? { area: 0, tris: 0 }
      e.area += Math.max(tris.vote[t], 1e-6)
      e.tris++
      colours.set(tris.key[t], e)
    }
    rebuild(mesh, tris, wheelRoles(clusters(colours)), flake)
  }

  return scene
}

/** per-colour triangle count and voting area of a body's raw meshes, for tuning the rules */
export async function paintStats(body: Vehicle): Promise<Record<string, { tris: number; area: number }>> {
  const gltf = await loader.loadAsync(MODELS[body])
  const stats: Record<string, { tris: number; area: number }> = {}
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || isWheel(mesh)) return
    const tris = triangles(mesh)
    if (!tris) return
    for (let t = 0; t < tris.count; t++) {
      const k = '#' + tris.key[t].toString(16).padStart(6, '0')
      const s = (stats[k] ??= { tris: 0, area: 0 })
      s.tris++
      s.area += tris.vote[t]
    }
  })
  return stats
}
