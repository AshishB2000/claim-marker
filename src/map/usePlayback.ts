import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ClaimVehicle } from '../claim/schema'
import type { CarPose } from './carLayer'
import { HOLD_MS, advance, endOf, frameAt, seekTo, shotAt, shots, timelineOf, type PlaybackMode, type Shot } from './playback'

type Frame = { poses: CarPose[]; t: number; ms: number; rate: number; mode: PlaybackMode }

/** the customer asked for less motion: the tilt, the chase and the slow-motion stay off, and "Watch it" is "Play it back" */
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * A playback of the scenario: `poses` is null when idle and the frame's poses while playing.
 * Hand `poses`, `mode` and `clock` to `MapScene`, which draws those instead of the vehicles,
 * hides the handles, and in cinematic mode drives the camera. The clock is the playback's
 * own, in ms, held in a ref rather than read off `performance.now()`, so it can be seeked and
 * run at a rate; a cinematic run's shot list sets the rate as it goes.
 */
export function usePlayback(vehicles: ClaimVehicle[]) {
  const [frame, setFrame] = useState<Frame | null>(null)
  const timeline = useMemo(() => timelineOf(vehicles), [vehicles])
  const raf = useRef(0)
  const clock = useRef(0)
  /** the rate asked for from outside; a cinematic shot multiplies it */
  const base = useRef(1)
  const run = useRef<{ list: Shot[] | null; end: number } | null>(null)

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current)
    run.current = null
    setFrame(null)
  }, [])

  /** the frame at the clock's current moment, on screen */
  const show = useCallback(
    (rate: number) => setFrame({ ...frameAt(vehicles, timeline, clock.current), ms: clock.current, rate, mode: run.current?.list ? 'cinematic' : 'diagram' }),
    [vehicles, timeline],
  )

  const start = useCallback(
    (mode: PlaybackMode = 'diagram') => {
      cancelAnimationFrame(raf.current)
      const list = mode === 'cinematic' && !reducedMotion() ? shots(vehicles, timeline) : null
      const r = { list, end: list ? endOf(list) : timeline.ms + HOLD_MS }
      run.current = r
      clock.current = 0
      let last = performance.now()
      const tick = (now: number) => {
        const rate = base.current * (r.list ? shotAt(r.list, clock.current).rate : 1)
        clock.current = advance(clock.current, now - last, rate, r.end)
        last = now
        if (clock.current >= r.end) return stop()
        show(rate)
        raf.current = requestAnimationFrame(tick)
      }
      raf.current = requestAnimationFrame(tick)
    },
    [vehicles, timeline, show, stop],
  )

  /** jump to `t` (0–1) of the drive, mid-run or not */
  const seek = useCallback(
    (t: number) => {
      clock.current = seekTo(t, timeline)
      show(base.current)
    },
    [timeline, show],
  )

  const setRate = useCallback((rate: number) => {
    base.current = rate
  }, [])

  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  const canPlay = vehicles.some((v) => v.position && v.path.length > 0)
  return {
    poses: frame?.poses ?? null,
    playing: frame !== null,
    canPlay,
    /** how far through the drive, 0–1 */
    t: frame?.t ?? 0,
    /** the same moment on the playback clock, in ms — past the drive during the hold and the camera's return */
    clock: frame?.ms ?? 0,
    rate: frame?.rate ?? 1,
    mode: frame?.mode ?? 'diagram',
    timeline,
    start,
    stop,
    seek,
    setRate,
  }
}
