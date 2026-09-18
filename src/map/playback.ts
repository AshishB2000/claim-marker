/**
 * Playing the scenario back: every vehicle drives its route — the path it was dragged along,
 * ending where it came to rest — and they all arrive together, at the moment of impact.
 * Pure functions over the claim; the frame loop lives in `usePlayback`, the camera driving in
 * `MapScene`. Everything here is on the **playback clock**, milliseconds from the start of the
 * drive: the wall clock only reaches it through `advance`, scaled by the rate.
 *
 * Stays free of any *value* import of `maplibre-gl` or `three`, so `test/playback.test.ts`
 * runs under vitest's plain `node` environment.
 */
import { bearing, destination, distance, type LngLat } from '../geo'
import type { ClaimVehicle } from '../claim/schema'
import type { CarPose } from './carLayer'

/** about 20 km/h: a diagram's pace, not the road's */
export const SPEED = 6
export const MIN_MS = 1500
export const MAX_MS = 6000
/** how long the final frame — the moment of impact — is held before the map is handed back */
export const HOLD_MS = 700

/** cars pull away and brake rather than teleport; one curve for the page, the recorder and the desk's two-account clock */
export const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/** the route in travel order, or null for a vehicle not yet on the map */
export const routeOf = (v: ClaimVehicle): LngLat[] | null => (v.position ? [...v.path, v.position] : null)

export function lengthOf(points: LngLat[]): number {
  let m = 0
  for (let i = 1; i < points.length; i++) m += distance(points[i - 1], points[i])
  return m
}

/** the point `metres` along the route and the way it is heading there; null bearing for a route with no length */
export function along(points: LngLat[], metres: number): { position: LngLat; bearing: number | null } {
  let left = Math.max(0, metres)
  let last: number | null = null
  for (let i = 1; i < points.length; i++) {
    const seg = distance(points[i - 1], points[i])
    if (seg === 0) continue
    last = bearing(points[i - 1], points[i])
    if (left <= seg) return { position: destination(points[i - 1], last, left), bearing: last }
    left -= seg
  }
  return { position: points[points.length - 1], bearing: last }
}

/** the longest route sets the clock, within limits a person will sit through */
export function durationOf(vehicles: ClaimVehicle[]): number {
  const longest = Math.max(0, ...vehicles.map((v) => (routeOf(v) ? lengthOf(routeOf(v)!) : 0)))
  return Math.min(MAX_MS, Math.max(MIN_MS, (longest / SPEED) * 1000))
}

/** the shortest turn from `a` to `b`, `t` of the way round */
export function lerpAngle(a: number, b: number, t: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180
  return (((a + d * t) % 360) + 360) % 360
}

/** where every vehicle is `t` (0–1) of the way through the playback */
export function posesAt(vehicles: ClaimVehicle[], t: number): CarPose[] {
  const out: CarPose[] = []
  for (const v of vehicles) {
    const route = routeOf(v)
    if (!route) continue
    const { position, bearing: b } = along(route, lengthOf(route) * clamp01(t))
    // the nose follows the road, then settles to how the car came to rest over the last stretch
    const heading = b === null ? v.heading : lerpAngle(b, v.heading, clamp01((t - 0.8) / 0.2))
    // the marks ride along: a replay of a dented car is a dented car
    out.push({ id: v.id, body: v.body, color: v.color, position, heading, damages: v.damages })
  }
  return out
}

// ── the timeline ──────────────────────────────────────────────────────

export type Timeline = {
  /** the drive, start to rest, in ms */
  ms: number
  /** the moment of impact as a fraction of the drive (0–1) and on its clock, in ms */
  impactT: number
  impactMs: number
}

/** how many moments of the drive are looked at for the closest approach */
const IMPACT_SAMPLES = 60

/**
 * When the vehicles were closest, as a fraction of the drive: the earliest of sixty moments
 * at which the nearest pair are nearest. A car with no route stands at its resting position,
 * so one route into a parked car works the same as two routes. Two cars that drive to rest
 * touching meet at 1; with fewer than two on the map, or nothing to drive, it is 1 as well.
 */
export function impactTimeOf(vehicles: ClaimVehicle[]): number {
  const placed = vehicles.filter((v) => v.position)
  if (placed.length < 2 || !placed.some((v) => v.path.length > 0)) return 1
  let best = 1
  let nearest = Infinity
  for (let i = 0; i < IMPACT_SAMPLES; i++) {
    const t = i / (IMPACT_SAMPLES - 1)
    const poses = posesAt(vehicles, ease(t))
    for (let a = 0; a < poses.length; a++) {
      for (let b = a + 1; b < poses.length; b++) {
        const d = distance(poses[a].position, poses[b].position)
        if (d < nearest) {
          nearest = d
          best = t
        }
      }
    }
  }
  return best
}

export function timelineOf(vehicles: ClaimVehicle[]): Timeline {
  const ms = durationOf(vehicles)
  const impactT = impactTimeOf(vehicles)
  return { ms, impactT, impactMs: impactT * ms }
}

// ── the clock ─────────────────────────────────────────────────────────

/** the clock `wallMs` later at `rate`, never past `end` and never backwards */
export const advance = (ms: number, wallMs: number, rate: number, end: number): number => Math.min(end, ms + Math.max(0, wallMs) * rate)

/** the frame at a moment on the clock: where every car is, and how far through the drive that is (held at 1 past the end) */
export function frameAt(vehicles: ClaimVehicle[], timeline: Timeline, ms: number): { poses: CarPose[]; t: number } {
  const t = clamp01(ms / timeline.ms)
  return { poses: posesAt(vehicles, ease(t)), t }
}

// ── the shot list ─────────────────────────────────────────────────────

/** flat, as the diagram is drawn, or with the camera opened up: tilted, chasing, slowed into the impact */
export type PlaybackMode = 'diagram' | 'cinematic'

export type Camera = { center: LngLat; zoom: number; pitch: number; bearing: number }

/** the chase: behind this vehicle, tilted, close */
export type Chase = { follow: string; pitch: number; bearing: number; zoom: number }

export type Shot = {
  /** when it begins, on the playback clock */
  at: number
  /** how long the camera takes to get there from the shot before, on the same clock */
  blend: number
  /** the playback rate while it runs */
  rate: number
  /** null is the diagram's own view: overhead, north-up, where the customer left it */
  chase: Chase | null
}

/** the overhead establishes the scene for this long before the camera moves */
export const ESTABLISH_MS = 800
/** how long the camera takes to open up, and to come back */
export const BLEND_MS = 900
/** an early impact shrinks the overhead and the ease to fit before the slow-motion: never below these */
export const MIN_ESTABLISH_MS = 50
export const MIN_BLEND_MS = 250
export const CHASE_PITCH = 55
export const CHASE_ZOOM = 20.5
/** the chase camera's centre sits this far behind the car it follows */
export const BEHIND_M = 4
export const SLOW_RATE = 0.25
export const SLOW_BEFORE_MS = 600
export const SLOW_AFTER_MS = 300
/** the shockwave: how long it rings, and how far out it reaches */
export const RING_MS = 600
export const RING_M = 8

/**
 * The cinematic replay as keyframes: overhead while the eye settles, then behind the
 * customer's own car looking the way it set off, slowed to a quarter into the impact and out
 * of it, held, then back to the diagram.
 *
 * The overhead and the ease into the chase have to be over before the slow-motion begins,
 * `SLOW_BEFORE_MS` ahead of the impact — and a short drive with an early impact has less
 * time than the constants want (`MIN_MS` is shorter than `ESTABLISH_MS + BLEND_MS`). So both
 * shrink in proportion to what there is, the ease to no less than `MIN_BLEND_MS` (a cut is not
 * an ease) and the overhead to no less than `MIN_ESTABLISH_MS`, and the slow-motion keeps its
 * full width around the impact wherever the clock allows: from `MIN_ESTABLISH_MS +
 * MIN_BLEND_MS` at the earliest to `SLOW_AFTER_MS` past the impact. The keyframes come out
 * strictly increasing by construction, so `shotAt` never has a tie to break — two shots on one
 * tick is how the ease, or the slow-motion, silently disappears.
 */
export function shots(vehicles: ClaimVehicle[], timeline: Timeline): Shot[] {
  const mine = vehicles.find((v) => v.role === 'insured' && v.position) ?? vehicles.find((v) => v.position)
  const chase: Chase | null = mine ? { follow: mine.id, pitch: CHASE_PITCH, bearing: posesAt([mine], 0)[0].heading, zoom: CHASE_ZOOM } : null
  // when the slow-motion begins: SLOW_BEFORE_MS ahead of the impact, or as soon as the shortest
  // overhead and ease can be done, whichever is later
  const slowFrom = Math.max(timeline.impactMs - SLOW_BEFORE_MS, MIN_ESTABLISH_MS + MIN_BLEND_MS)
  const fit = Math.min(1, slowFrom / (ESTABLISH_MS + BLEND_MS))
  const blend = Math.max(MIN_BLEND_MS, BLEND_MS * fit)
  const establish = Math.min(ESTABLISH_MS, slowFrom - blend)
  // an impact before the slow-motion can begin is the start of the drive: the window still runs
  const slowTo = Math.max(slowFrom, timeline.impactMs) + SLOW_AFTER_MS
  return [
    { at: 0, blend: 0, rate: 1, chase: null },
    { at: establish, blend, rate: 1, chase },
    { at: slowFrom, blend: 0, rate: SLOW_RATE, chase },
    { at: slowTo, blend: 0, rate: 1, chase },
    { at: timeline.ms + HOLD_MS, blend: BLEND_MS, rate: 1, chase: null },
  ]
}

const indexAt = (list: Shot[], ms: number): number => {
  let i = 0
  for (let k = 1; k < list.length; k++) if (list[k].at <= ms) i = k
  return i
}

/** the shot running at this moment: the last to have begun */
export const shotAt = (list: Shot[], ms: number): Shot => list[indexAt(list, ms)]

/** when the last shot has finished blending in — the end of the playback clock */
export const endOf = (list: Shot[]): number => list[list.length - 1].at + list[list.length - 1].blend

/** a shot's own view: a few metres behind the car it follows, or the diagram's view when there is nothing to follow */
function viewOf(chase: Chase | null, poses: CarPose[], home: Camera): Camera {
  const pose = chase && poses.find((p) => p.id === chase.follow)
  if (!chase || !pose) return home
  return { center: destination(pose.position, pose.heading + 180, BEHIND_M), zoom: chase.zoom, pitch: chase.pitch, bearing: chase.bearing }
}

/** where the camera is at this moment: the running shot's view, blended in from the shot before it */
export function cameraAt(list: Shot[], ms: number, poses: CarPose[], home: Camera): Camera {
  const i = indexAt(list, ms)
  const shot = list[i]
  const to = viewOf(shot.chase, poses, home)
  if (i === 0 || shot.blend <= 0 || ms >= shot.at + shot.blend) return to
  const from = viewOf(list[i - 1].chase, poses, home)
  const u = ease((ms - shot.at) / shot.blend)
  const mix = (a: number, b: number) => a + (b - a) * u
  return {
    center: [mix(from.center[0], to.center[0]), mix(from.center[1], to.center[1])],
    zoom: mix(from.zoom, to.zoom),
    pitch: mix(from.pitch, to.pitch),
    bearing: lerpAngle(from.bearing, to.bearing, u),
  }
}

/** the shockwave at this moment — its radius in metres and how much of it is left — or null when there is none */
export function ringAt(timeline: Timeline, ms: number): { metres: number; opacity: number } | null {
  const u = (ms - timeline.impactMs) / RING_MS
  if (u < 0 || u > 1) return null
  return { metres: RING_M * u, opacity: 1 - u }
}
