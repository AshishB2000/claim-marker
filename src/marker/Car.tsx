import { use, useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { useStore } from 'zustand'
import { activeZone, type MarkerStore } from './store'
import { nearestZone, type V3, type Vehicle, type Zone } from '../zones'
import { bodyBounds, instanceBody, loadBody } from '../vehicles/load'
import { PROPORTION, radiusToWorld, toModel, toWorld } from '../vehicles/bodies'

const TINT = new THREE.Color('#3b82f6')

type Uniforms = {
  uCenter: { value: THREE.Vector3 }
  uRadius: { value: number }
  uTint: { value: THREE.Color }
}

/**
 * The body is a single mesh, so the zone highlight is a radial falloff around the anchor
 * rather than a separate mesh per panel. Patched into the material with onBeforeCompile:
 * it hugs the panel, where a decal sphere would float off it. Works on the paint material
 * and the trim material alike, since both are physical materials with a map_fragment.
 */
function patch(material: THREE.Material, u: Uniforms) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCenter = u.uCenter
    shader.uniforms.uRadius = u.uRadius
    shader.uniforms.uTint = u.uTint
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCmWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCmWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vCmWorld;\nuniform vec3 uCenter;\nuniform float uRadius;\nuniform vec3 uTint;',
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        if (uRadius > 0.0) {
          // solid core with a soft edge, so it reads as a selected panel and not a gradient
          float cmT = 1.0 - smoothstep(uRadius * 0.72, uRadius, distance(vCmWorld, uCenter));
          diffuseColor.rgb = mix(diffuseColor.rgb, uTint, cmT * 0.62);
        }`,
      )
  }
  material.customProgramCacheKey = () => `claim-marker-tint-${material.type}`
}

/**
 * three.js uniforms are mutable by contract — writing .value is how the GPU sees the new zone.
 * The shader compares against world positions, so the anchor is converted out of the kit's
 * units into metres first.
 */
function applyZone(u: Uniforms, vehicle: Vehicle, zone: Zone | null) {
  u.uRadius.value = zone ? radiusToWorld(vehicle, zone.radius) : 0
  if (zone) u.uCenter.value.set(...toWorld(vehicle, zone.anchor))
}

/**
 * How the camera is placed, as multiples of the body's own length: far enough back that a
 * 6.6 m box truck and a 4.3 m hatchback are both framed the same way. The direction keeps
 * the three-quarter front view the marker has always opened on.
 */
const VIEW_DISTANCE = 1.75
const VIEW_DIRECTION = new THREE.Vector3(0.59, 0.4, 0.7).normalize()

export function Car({ store, paint, modelUrl }: { store: MarkerStore; paint: string; modelUrl?: string }) {
  const vehicle = useStore(store, (s) => s.vehicle)
  const zone = useStore(store, activeZone)
  const template = use(loadBody(vehicle, modelUrl))
  const get = useThree((s) => s.get)

  // stable for the life of the widget; never re-set, so it never causes a render
  const [uniforms] = useState<Uniforms>(() => ({
    uCenter: { value: new THREE.Vector3() },
    uRadius: { value: 0 },
    uTint: { value: TINT },
  }))

  // own materials per instance: the zone tint is a uniform on the material, and two markers
  // on one page must not share it
  const model = useMemo(() => {
    const root = instanceBody(template, paint)
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      const own = mats.map((m) => {
        const c = m.clone()
        patch(c, uniforms)
        return c
      })
      mesh.material = Array.isArray(mesh.material) ? own : own[0]
    })
    return root
  }, [template, uniforms, paint])

  useEffect(() => applyZone(uniforms, vehicle, zone), [zone, vehicle, uniforms])

  // frame the body: everything is in metres now, so the camera stands back a fixed multiple
  // of the vehicle's own length and a box truck fills the canvas no more than a coupe does
  useEffect(() => {
    const size = bodyBounds(template).getSize(new THREE.Vector3()).multiply(new THREE.Vector3(...PROPORTION[vehicle]))
    const distance = size.z * VIEW_DISTANCE
    const { camera, controls } = get()
    camera.position.copy(VIEW_DIRECTION).multiplyScalar(distance)
    const orbit = controls as unknown as { target: THREE.Vector3; minDistance: number; maxDistance: number; update: () => void } | null
    if (orbit) {
      orbit.target.set(0, size.y * 0.45, 0)
      Object.assign(orbit, { minDistance: distance * 0.55, maxDistance: distance * 2.2 })
      orbit.update()
    }
  }, [template, vehicle, get])

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

  // the tap lands in metres; zones and the stored document speak the kit's own units
  const at = (e: ThreeEvent<PointerEvent>): V3 => toModel(vehicle, [e.point.x, e.point.y, e.point.z])

  return (
    <primitive
      object={model}
      scale={PROPORTION[vehicle]}
      onPointerDown={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation()
        store.getState().pick(at(e))
      }}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation()
        const s = store.getState()
        if (s.pending || s.selected !== null) return
        const next = nearestZone(s.vehicle, at(e))
        if (next !== s.hovered) s.hover(next)
      }}
      onPointerOut={() => store.getState().hover(null)}
    />
  )
}
