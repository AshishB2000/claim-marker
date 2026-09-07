import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { useStore } from 'zustand'
import { activeZone, type MarkerStore } from './store'
import { nearestZone, type V3, type Zone } from '../zones'
import { MODELS } from '../models'

const TINT = new THREE.Color('#3b82f6')

type Uniforms = {
  uCenter: { value: THREE.Vector3 }
  uRadius: { value: number }
  uTint: { value: THREE.Color }
}

/**
 * The body is a single mesh, so the zone highlight is a radial falloff around the anchor
 * rather than a separate mesh per panel. Patched into the stock material with
 * onBeforeCompile: it hugs the panel, where a decal sphere would float off it.
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
  material.customProgramCacheKey = () => 'claim-marker-tint'
}

/** three.js uniforms are mutable by contract — writing .value is how the GPU sees the new zone */
function applyZone(u: Uniforms, zone: Zone | null) {
  u.uRadius.value = zone ? zone.radius : 0
  if (zone) u.uCenter.value.set(...zone.anchor)
}

export function Car({ store, modelUrl }: { store: MarkerStore; modelUrl?: string }) {
  const vehicle = useStore(store, (s) => s.vehicle)
  const zone = useStore(store, activeZone)
  const { scene } = useGLTF(modelUrl ?? MODELS[vehicle])

  // stable for the life of the widget; never re-set, so it never causes a render
  const [uniforms] = useState<Uniforms>(() => ({
    uCenter: { value: new THREE.Vector3() },
    uRadius: { value: 0 },
    uTint: { value: TINT },
  }))

  // clone scene and materials: useGLTF caches globally, and two widgets must not share uniforms
  const model = useMemo(() => {
    const root = scene.clone(true)
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const mat = (mesh.material as THREE.Material).clone()
      patch(mat, uniforms)
      mesh.material = mat
    })
    return root
  }, [scene, uniforms])

  useEffect(() => applyZone(uniforms, zone), [zone, uniforms])

  useEffect(() => () => {
    model.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) (mesh.material as THREE.Material).dispose()
    })
  }, [model])

  const at = (e: ThreeEvent<PointerEvent>): V3 => [e.point.x, e.point.y, e.point.z]

  return (
    <primitive
      object={model}
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
