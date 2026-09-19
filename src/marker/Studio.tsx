import { Suspense, type ReactNode } from 'react'
import { ContactShadows, Environment, Grid, MeshReflectorMaterial } from '@react-three/drei'
import { THEME, type Theme } from '../theme'
import { STUDIO } from '../vehicles/BodyPreview'
import { studioLight, type Lighting } from '../scene/lighting'
import type { V3 } from '../zones'

/**
 * The studio a body stands in, shared by the damage marker (one car) and the reconstruction
 * (every car): the photographic environment, the key and fill lights, a polished floor with the
 * grid just above it, and soft contact shadows. `children` load under the same `Suspense` as the
 * environment, so the cars never show before the reflections they are lit by.
 *
 * `keyAt` is where the key light stands, in the caller's frame — the two scenes face north
 * different ways (the marker's body frame has its nose north, the reconstruction has north at
 * −z), so each turns the sun into its own. `reach` is how far out, in metres, the floor, the
 * grid and the shadows have to look right: the marker's sixteen, the reconstruction's more.
 */
export function Studio({ theme, lighting, keyAt, reach = 16, children }: { theme: Theme; lighting: Lighting | null; keyAt: V3; reach?: number; children: ReactNode }) {
  const t = THEME[theme]
  // the same sun, floored: this render is the evidence, and a claim filed at night must stay legible
  const studio = lighting ? studioLight(lighting) : { key: 1, environment: 1 }
  return (
    <>
      <color attach="background" args={[t.bg]} />

      <Suspense fallback={null}>
        {/* a real photographic studio, served with the page, is what makes paint look like paint */}
        <Environment files={STUDIO} environmentIntensity={0.9 * studio.environment} />
        {children}
      </Suspense>

      <directionalLight position={keyAt} intensity={1.1 * studio.key} color={lighting?.sunColor ?? '#ffffff'} />
      <directionalLight position={[-5, 3, -4]} intensity={0.3} color={lighting?.sky ?? '#dce7ff'} />
      {lighting && <hemisphereLight args={[lighting.sky, lighting.ground, lighting.skyIntensity]} />}

      {/* a polished floor under the car; the grid sits just above it as a measuring surface */}
      {/* wide enough that its edge never enters the frame at any orbit distance */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.004, 0]}>
        <planeGeometry args={[reach * 10, reach * 10]} />
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
        fadeDistance={reach * 2.125}
        fadeStrength={1.6}
      />
      <ContactShadows position={[0, 0.001, 0]} opacity={0.5} scale={reach} blur={2.6} far={4} resolution={1024} color={t.shadow} />
    </>
  )
}
