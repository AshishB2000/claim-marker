import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClaimVehicle } from '../claim/schema'
import type { CarPose } from './carLayer'
import { durationOf, posesAt } from './playback'

/** cars pull away and brake rather than teleport */
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)
/** how long the final frame — the moment of impact — is held before the map is handed back */
const HOLD_MS = 700

/**
 * A playback of the scenario: `poses` is null when idle and the frame's poses while playing.
 * Hand it to `MapScene`, which draws those instead of the vehicles and hides the handles.
 */
export function usePlayback(vehicles: ClaimVehicle[]) {
  const [poses, setPoses] = useState<CarPose[] | null>(null)
  const raf = useRef(0)
  const hold = useRef(0)

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current)
    clearTimeout(hold.current)
    setPoses(null)
  }, [])

  const start = useCallback(() => {
    cancelAnimationFrame(raf.current)
    clearTimeout(hold.current)
    const ms = durationOf(vehicles)
    const t0 = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / ms)
      setPoses(posesAt(vehicles, ease(t)))
      if (t < 1) raf.current = requestAnimationFrame(tick)
      else hold.current = window.setTimeout(() => setPoses(null), HOLD_MS)
    }
    raf.current = requestAnimationFrame(tick)
  }, [vehicles])

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current)
      clearTimeout(hold.current)
    },
    [],
  )

  const canPlay = vehicles.some((v) => v.position && v.path.length > 0)
  return { poses, playing: poses !== null, canPlay, start, stop }
}
