import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ClaimVehicle } from '../claim/schema'
import type { CarPose } from './carLayer'
import { HOLD_MS, advance, endOf, frameAt, sharedTimeline, shotAt, shots, timelineOf, type PlaybackMode, type Shot } from './playback'

type Frame = { poses: CarPose[]; ghostPoses: CarPose[] | null; t: number; ms: number; rate: number; mode: PlaybackMode }

/** the customer asked for less motion: the tilt, the chase and the slow-motion stay off, and "Watch it" is "Play it back" */
export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** one empty second account, stable so the memos below do not rebuild every render */
const NO_GHOSTS: ClaimVehicle[] = []

/**
 * A playback of the scenario: `poses` is null when idle and the frame's poses while playing.
 * Hand `poses`, `mode` and `clock` to `MapScene`, which draws those instead of the vehicles,
 * hides the handles, and in cinematic mode drives the camera. The clock is the playback's
 * own, in ms, held in a ref rather than read off `performance.now()`, so it can be seeked and
 * run at a rate; a cinematic run's shot list sets the rate as it goes.
 *
 * `ghosts` is a second account of the same accident — the desk's compare view. It has a
 * `Timeline` of its own, because each side's drive is as long as its own routes, but there is
 * one clock: at any moment both sets are that many milliseconds into their own drive, and the
 * shorter one holds its last pose (`frameAt` clamps) while the longer one keeps going. That is
 * what makes the two impact moments comparable at all — they are two marks on one ruler.
 *
 * `follow` is the car the cinematic camera chases, as `MapScene` is told; the run slows into
 * that car's account's impact (`sharedTimeline`), so the hook needs it to set the rate by the
 * same shot list the camera is cut from — before a run and, after a "Swap", during one.
 */
export function usePlayback(vehicles: ClaimVehicle[], ghosts?: ClaimVehicle[] | null, follow?: string) {
  const [frame, setFrame] = useState<Frame | null>(null)
  const others = ghosts ?? NO_GHOSTS
  const timeline = useMemo(() => timelineOf(vehicles), [vehicles])
  const ghostTimeline = useMemo(() => timelineOf(others), [others])
  const raf = useRef(0)
  const clock = useRef(0)
  /** the rate asked for from outside; a cinematic shot multiplies it */
  const base = useRef(1)
  const run = useRef<{ list: Shot[] | null; end: number } | null>(null)

  /** the clock both accounts share: the longer of the two drives, slowing into the followed account's impact */
  const shared = useMemo(() => sharedTimeline(vehicles, others, follow), [vehicles, others, follow])
  /** the whole clock a scrubber runs across: the longer drive plus the hold on the last frame */
  const duration = shared.ms + HOLD_MS

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current)
    run.current = null
    setFrame(null)
  }, [])

  /** the frame at the clock's current moment, on screen */
  const show = useCallback(
    (rate: number) =>
      setFrame({
        ...frameAt(vehicles, timeline, clock.current),
        ghostPoses: others.length ? frameAt(others, ghostTimeline, clock.current).poses : null,
        ms: clock.current,
        rate,
        mode: run.current?.list ? 'cinematic' : 'diagram',
      }),
    [vehicles, timeline, others, ghostTimeline],
  )

  const start = useCallback(
    (mode: PlaybackMode = 'diagram') => {
      cancelAnimationFrame(raf.current)
      const list = mode === 'cinematic' && !reducedMotion() ? shots([...vehicles, ...others], shared, follow) : null
      const r = { list, end: Math.max(list ? endOf(list) : 0, duration) }
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
    [vehicles, others, shared, follow, duration, show, stop],
  )

  // "Swap" mid-run: the moment moves with the followed car, so the running cinematic list —
  // which sets the rate — is re-cut with it, exactly as `MapScene` re-cuts the camera's. Its end
  // does not move: that is the longer drive's, whichever car is followed.
  useEffect(() => {
    const r = run.current
    if (r?.list) r.list = shots([...vehicles, ...others], shared, follow)
  }, [vehicles, others, shared, follow])

  /**
   * Hold the playback at one moment on its own clock, in ms — the clock `clock` reports, which
   * runs past the drive through the hold, where the shockwave is. The frame loop stops there:
   * a seeked frame stays on screen instead of being overwritten by the next tick, which is
   * what a scrub wants and what lets a test look at a chosen frame rather than race one.
   */
  const seek = useCallback(
    (ms: number) => {
      cancelAnimationFrame(raf.current)
      // the clock `ms` on from zero at rate 1: the same clamp the run itself advances under
      clock.current = advance(0, ms, 1, run.current?.end ?? duration)
      // the rate this moment plays at, slow-motion included, so a held frame reports it as a running one would
      const list = run.current?.list
      show(base.current * (list ? shotAt(list, clock.current).rate : 1))
    },
    [duration, show],
  )

  const setRate = useCallback((rate: number) => {
    base.current = rate
  }, [])

  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  const canPlay = [...vehicles, ...others].some((v) => v.position && v.path.length > 0)
  return {
    poses: frame?.poses ?? null,
    /** the second account at the same moment, or null when there is not one */
    ghostPoses: frame?.ghostPoses ?? null,
    playing: frame !== null,
    canPlay,
    /** how far through the drive, 0–1 */
    t: frame?.t ?? 0,
    /** the same moment on the playback clock, in ms — past the drive during the hold and the camera's return */
    clock: frame?.ms ?? 0,
    rate: frame?.rate ?? 1,
    mode: frame?.mode ?? 'diagram',
    timeline,
    /** the second account's own timeline: its drive, and where its impact falls on the shared clock */
    ghostTimeline,
    /** the whole clock a scrubber runs across: the longer drive plus the hold */
    duration,
    start,
    stop,
    seek,
    setRate,
  }
}
