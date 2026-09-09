/**
 * Vite rewrites these at build time — hashed files for the demo, inlined data URIs for the
 * npm build, so the package is self-contained and consumers need no asset setup.
 *
 * ponytail: every body lands in every bundle. A map references all its values, so no
 * bundler can drop the unused ones, and the alternative (per-body exports) would let
 * <DamageMarker vehicle="suv"> silently render a sedan. If the seven inlined models (~1.4 MB
 * before base64) matter to someone, the upgrade is separate `.` and `./scenario` entry
 * points, not a cleverer map.
 */
import type { Vehicle } from './zones'

export const MODELS: Record<Vehicle, string> = {
  sedan: new URL('./models/sedan.glb', import.meta.url).href,
  suv: new URL('./models/suv.glb', import.meta.url).href,
  truck: new URL('./models/truck.glb', import.meta.url).href,
  hatchback: new URL('./models/hatchback.glb', import.meta.url).href,
  coupe: new URL('./models/coupe.glb', import.meta.url).href,
  van: new URL('./models/van.glb', import.meta.url).href,
  box_truck: new URL('./models/box_truck.glb', import.meta.url).href,
}
