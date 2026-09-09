/**
 * A body turning slowly in the chosen colour, for the vehicle cards. One small canvas per
 * card; the body picker beside it is plain buttons, because a WebGL context per body type
 * per vehicle would run a phone out of contexts.
 */
import { Suspense, use, useMemo } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { ContactShadows, Environment, OrbitControls } from '@react-three/drei'
import type { Vehicle } from '../zones'
import { bodyBounds, instanceBody, loadBody } from './load'
import { PROPORTION, SIZE } from './bodies'

/** a small photographic studio, CC0 from Poly Haven; what the paint and glass reflect */
export const STUDIO = '/hdr/studio_small_09.hdr'

function Body({ body, paint }: { body: Vehicle; paint: string }) {
  const template = use(loadBody(body))
  const model = useMemo(() => instanceBody(template, paint), [template, paint])
  // stretched to the real dimensions of its class, then fitted to the same frame whatever
  // its length, so a box truck and a coupe are both fully in shot
  const scale = useMemo(() => {
    const p = PROPORTION[body]
    const fit = 4.4 / SIZE[body].length
    return [p[0] * fit, p[1] * fit, p[2] * fit] as [number, number, number]
  }, [body])
  const lift = useMemo(() => bodyBounds(template).min.y * PROPORTION[body][1] * (4.4 / SIZE[body].length), [template, body])
  return <primitive object={model} scale={scale} position-y={-lift} />
}

export function BodyPreview({ body, paint, className }: { body: Vehicle; paint: string; className?: string }) {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [3.4, 1.55, 3.7], fov: 32, near: 0.1, far: 50 }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace }}
      className={className}
    >
      <Suspense fallback={null}>
        <Environment files={STUDIO} environmentIntensity={0.9} />
        <Body body={body} paint={paint} />
      </Suspense>
      <directionalLight position={[4, 6.5, 3]} intensity={1.2} />
      <ContactShadows position={[0, 0.001, 0]} opacity={0.5} scale={8} blur={2.2} far={2} resolution={512} color="#1e293b" />
      <OrbitControls
        target={[0, 0.62, 0]}
        autoRotate
        autoRotateSpeed={1.1}
        enableZoom={false}
        enablePan={false}
        enableRotate={false}
        minPolarAngle={1.18}
        maxPolarAngle={1.18}
      />
    </Canvas>
  )
}
