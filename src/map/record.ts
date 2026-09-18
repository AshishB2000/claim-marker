/**
 * The diagram's playback, recorded as a short video at send time: the same frames `usePlayback`
 * would show on screen, painted by hand onto an off-screen canvas and captured with
 * `MediaRecorder`. A still says where the cars ended up; the video says the order it happened
 * in — CLAUDE.md's words for why this exists.
 *
 * `MapScene.tsx`'s `compose()` builds the PNG export the same way: draw what `map.getCanvas()`
 * holds, then hand-paint the ID pills and the impact cross, because neither is part of that
 * canvas — both are DOM markers everywhere else on screen. `paintOverlay` below is that one
 * implementation, shared rather than copied; `compose` calls it at the vehicles' resting
 * positions, `recordPlayback` calls it once per frame at the current pose.
 *
 * This module stays free of any *value* import of `maplibre-gl` or `three` (only their types,
 * which `verbatimModuleSyntax` erases) so `test/record.test.ts` can import its pure parts under
 * vitest's plain `node` environment, same as every other pure module here.
 */
import type { Map as MapLibreMap } from 'maplibre-gl'
import { ROLE_COLOR, type ClaimVehicle, type Role } from '../claim/schema'
import type { LngLat } from '../geo'
import { plural, translate, type Lang } from '../i18n'
import { SIZE } from '../vehicles/bodies'
import type { Vehicle } from '../zones'
import type { CarLayer, CarPose, shockRing } from './carLayer'
import {
  HOLD_MS,
  advance,
  MAX_PITCH,
  cameraAt,
  frameAt,
  lengthOf,
  posesAt,
  ringAt,
  routeOf,
  shotAt,
  shots,
  timelineOf,
  wallMsOf,
  type Camera,
  type PlaybackMode,
} from './playback'

export const REC_WIDTH = 960
export const REC_HEIGHT = 540
/** about 1.5 Mbps: plenty for a diagram of flat colour and a moving map tile, not a photo */
const BITRATE = 1_500_000

/**
 * How long the video may be. `MediaRecorder` records **wall** time, and a cinematic playback
 * takes far more of it than the drive does: the overhead, the ease into the chase and above all
 * the slow-motion window, which spends four wall seconds on every second of the clock. So the
 * recorder runs the whole clock at a rate that fits it inside this, rather than recording the
 * first seven seconds of it and cutting the impact off.
 */
export const VIDEO_MS = 7000

/**
 * The rate the recorder's clock runs at: whatever makes a run of `wallMs` fit inside `cap`,
 * and never less than 1 — a short drive is recorded at its own pace, never stretched to fill
 * the ceiling. `wallMs` comes from {@link wallMsOf}, so the slow-motion's cost is in it.
 */
export function recordRate(wallMs: number, cap = VIDEO_MS): number {
  return Math.max(1, wallMs / cap)
}

/** "1 damage" / "3 damages" — the pill's own words, shared with the live tag `MapScene` draws */
export const damageCount = (n: number, lang: Lang): string => translate(lang, plural(n, 'scene.map.damage.one', 'scene.map.damage.other'), { n })

// ── codec choice ──────────────────────────────────────────────────────

/**
 * Tried in this order because Safari is the only browser that records mp4 at all — and does
 * not record webm — while Chrome and Firefox both record webm; vp9 first for its smaller file,
 * vp8 as the fallback for whichever of those two does not have a vp9 encoder built in.
 */
export const MIME_CANDIDATES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']

/** the first codec `isSupported` accepts, or null when none of them are — never throws */
export function pickMimeType(isSupported: (type: string) => boolean): string | null {
  return MIME_CANDIDATES.find(isSupported) ?? null
}

// ── is there anything to play ────────────────────────────────────────

/**
 * Nothing to record: every vehicle that made it onto the map sits exactly where it started, so
 * a "playback" would just hold on one frame for several seconds. `durationOf` cannot say this
 * by itself — it always clamps to at least `MIN_MS`, even for a route with zero length — so
 * this looks at the routes directly instead, the same way `usePlayback`'s own `canPlay` does.
 */
export function hasReplay(vehicles: ClaimVehicle[]): boolean {
  return vehicles.some((v) => {
    const route = routeOf(v)
    return route !== null && lengthOf(route) > 0
  })
}

// ── geometry: fitting the map canvas, the progress bar, the caption ────

export type Rect = { x: number; y: number; width: number; height: number }

/** `srcW`×`srcH` scaled to fit inside `dstW`×`dstH`, centred — "object-fit: contain" by hand */
export function fitContain(srcW: number, srcH: number, dstW: number, dstH: number): Rect {
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) return { x: 0, y: 0, width: 0, height: 0 }
  const scale = Math.min(dstW / srcW, dstH / srcH)
  const width = srcW * scale
  const height = srcH * scale
  return { x: (dstW - width) / 2, y: (dstH - height) / 2, width, height }
}

const BAR_HEIGHT = 4
const CAPTION_GAP = 10

/** the filled part of the thin progress bar along the bottom, `t` (0–1) of the way across */
export function progressBarRect(t: number, width: number, height: number): Rect {
  const clamped = Math.min(1, Math.max(0, t))
  return { x: 0, y: height - BAR_HEIGHT, width: width * clamped, height: BAR_HEIGHT }
}

/** a moment of impact on the bar, as a fraction of the whole clock: a notch this wide, in pixels */
const TICK_WIDTH = 3

/** the baseline the one-line caption sits on, just above the progress bar */
export function captionBaseline(height: number): number {
  return height - BAR_HEIGHT - CAPTION_GAP
}

// ── the pills and the cross, shared with the PNG export ────────────────

/** one vehicle's ID pill, wherever it is right now: a pose's position, or a vehicle's resting one */
export type OverlayLabel = { id: string; role: Role; body: Vehicle; damages: number; position: LngLat }

/** mirrors `MapScene.tsx`'s own `LABEL_GAP`: the pill floats this far above the footprint, in pixels */
const LABEL_GAP = 18
/** mirrors `MapScene.tsx`'s own `metresPerPixel`: ground metres per screen pixel, 512px tiles */
const metresPerPixel = (lat: number, zoom: number) => (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom)

/**
 * The ID pills and the impact cross, hand-painted onto a 2D context that already holds a copy
 * of the map. Positions are projected through `map` itself, so this has to run against the
 * same view the copied pixels came from — before anything moves the camera.
 */
export function paintOverlay(ctx: CanvasRenderingContext2D, map: MapLibreMap, labels: OverlayLabel[], impact: LngLat | null, lang: Lang): void {
  const font = getComputedStyle(document.body).fontFamily
  ctx.font = `600 12px ${font}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const pill = (x: number, y: number, text: string, fill: string) => {
    const w = ctx.measureText(text).width + 18
    ctx.fillStyle = 'rgba(255,255,255,0.95)'
    ctx.beginPath()
    ctx.roundRect(x - w / 2 - 2, y - 13, w + 4, 26, 13)
    ctx.fill()
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.roundRect(x - w / 2, y - 11, w, 22, 11)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.fillText(text, x, y + 0.5)
  }

  for (const l of labels) {
    const p = map.project(l.position)
    const mpp = metresPerPixel(l.position[1], map.getZoom())
    const size = SIZE[l.body]
    const gap = Math.max(size.width / mpp, size.length / mpp) / 2 + LABEL_GAP
    pill(p.x, p.y - gap, l.damages ? `${l.id.toUpperCase()} · ${damageCount(l.damages, lang)}` : l.id.toUpperCase(), ROLE_COLOR[l.role])
  }

  if (impact) {
    const p = map.project(impact)
    ctx.fillStyle = 'rgba(255,255,255,0.95)'
    ctx.beginPath()
    ctx.arc(p.x, p.y, 17, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#dc2626'
    ctx.beginPath()
    ctx.arc(p.x, p.y, 14, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = `700 15px ${font}`
    ctx.fillText('✕', p.x, p.y + 1)
  }
}

const labelsFor = (vehicles: ClaimVehicle[], poses: CarPose[]): OverlayLabel[] => {
  const out: OverlayLabel[] = []
  for (const pose of poses) {
    const v = vehicles.find((x) => x.id === pose.id)
    if (v) out.push({ id: v.id, role: v.role, body: pose.body, damages: v.damages.length, position: pose.position })
  }
  return out
}

const nextFrame = (): Promise<number> => new Promise((resolve) => requestAnimationFrame(resolve))

export type RecordDeps = {
  map: MapLibreMap
  cars: CarLayer
  vehicles: ClaimVehicle[]
  /** a second account of the same accident, drawn as ghosts and driven by the same clock */
  ghosts?: ClaimVehicle[]
  impact: LngLat | null
  lang: Lang
  /** `cinematic` drives the shot list — the camera, the slow-motion, the shockwave; anything else records the flat diagram */
  mode?: PlaybackMode
  /** which vehicle the chase follows; the shot list's own choice otherwise */
  follow?: string
  /** the shockwave, made by the caller: this module holds no three.js, so it cannot make one */
  ring?: ReturnType<typeof shockRing>
  /** swapped in by the test; real callers leave this to `MediaRecorder.isTypeSupported` */
  isTypeSupported?: (type: string) => boolean
}

/**
 * One run of the playback — start to impact, held for {@link HOLD_MS} — as a video `Blob`.
 * Drives the car layer through `cars.setPoses`, exactly the mechanism `usePlayback` drives it
 * through for the on-screen playback, so there is one animation path, not two; the DOM/
 * MediaRecorder side of this is proved by the browser smoke, not a unit test.
 *
 * In `cinematic` mode it also drives the camera, from the same `shots` and `cameraAt` the live
 * playback uses — the map canvas is what is captured, so the tilt, the chase and the shockwave
 * are in the video. The clock runs at {@link recordRate}, because the video has a ceiling in
 * wall time and the cinematic playback does not.
 *
 * Never throws: every reason this can't produce a video — no `MediaRecorder`, no
 * `captureStream`, no codec, nothing to play, anything going wrong mid-recording — resolves to
 * `null` instead, because a report is never held up, or spoiled, by its own replay.
 */
export async function recordPlayback(deps: RecordDeps): Promise<Blob | null> {
  const { map, cars, vehicles, impact, lang } = deps
  const ghosts = deps.ghosts ?? []
  if (!hasReplay([...vehicles, ...ghosts])) return null
  if (typeof MediaRecorder === 'undefined') return null

  const canvas = document.createElement('canvas')
  canvas.width = REC_WIDTH
  canvas.height = REC_HEIGHT
  if (typeof canvas.captureStream !== 'function') return null

  const mimeType = pickMimeType(deps.isTypeSupported ?? MediaRecorder.isTypeSupported)
  if (!mimeType) return null

  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const src = map.getCanvas()
  // computed once: the canvas does not resize while this records, whatever the camera does
  const rect = fitContain(src.clientWidth, src.clientHeight, REC_WIDTH, REC_HEIGHT)
  const scale = src.clientWidth > 0 ? rect.width / src.clientWidth : 0
  const caption = translate(lang, 'scene.replay.caption')

  const timeline = timelineOf(vehicles)
  const ghostTimeline = timelineOf(ghosts)
  // the end of the clock: the longer of the two drives, held. A cinematic run's own end is
  // later than this — it eases the camera back to the overhead — and the video does not need
  // that: the last thing it shows is the impact, not the way home.
  const end = Math.max(timeline.ms, ghosts.length ? ghostTimeline.ms : 0) + HOLD_MS
  const list = deps.mode === 'cinematic' ? shots([...vehicles, ...ghosts], timeline, deps.follow) : null
  const rate = list ? recordRate(wallMsOf(list, end)) : 1
  const centre = map.getCenter()
  const home: Camera = { center: [centre.lng, centre.lat], zoom: map.getZoom(), pitch: 0, bearing: 0 }
  // where each account's impact falls on the shared clock, as notches on the bar
  const ticks = [timeline.impactMs / end, ...(ghosts.length ? [ghostTimeline.impactMs / end] : [])]

  const draw = (poses: CarPose[], t: number) => {
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(0, 0, REC_WIDTH, REC_HEIGHT)
    // ponytail: a rAF tick can land a beat before the map's own WebGL repaint does, so this
    // occasionally redraws the previous frame — invisible at 30fps over a few seconds. Waiting
    // on a map 'render' event instead would be exact, at the cost of a wait that never resolves
    // if the context is lost; upgrade to that only if a captured video ever visibly stutters.
    ctx.drawImage(map.getCanvas(), rect.x, rect.y, rect.width, rect.height)
    ctx.save()
    ctx.translate(rect.x, rect.y)
    ctx.scale(scale, scale)
    paintOverlay(ctx, map, labelsFor(vehicles, poses), impact, lang)
    ctx.restore()

    ctx.fillStyle = 'rgba(255,255,255,0.25)'
    ctx.fillRect(0, REC_HEIGHT - BAR_HEIGHT, REC_WIDTH, BAR_HEIGHT)
    const bar = progressBarRect(t, REC_WIDTH, REC_HEIGHT)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(bar.x, bar.y, bar.width, bar.height)
    // the moment of impact, once per account: where on this bar the two stories met
    ctx.fillStyle = '#dc2626'
    for (const tick of ticks) ctx.fillRect(Math.min(1, Math.max(0, tick)) * (REC_WIDTH - TICK_WIDTH), REC_HEIGHT - BAR_HEIGHT * 2, TICK_WIDTH, BAR_HEIGHT * 2)

    ctx.font = '600 15px system-ui, -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = 'rgba(255,255,255,0.92)'
    ctx.fillText(caption, REC_WIDTH / 2, captionBaseline(REC_HEIGHT))
  }

  const chunks: BlobPart[] = []
  const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType, videoBitsPerSecond: BITRATE })
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  const stopped = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }))
  })

  map.getContainer().classList.add('mk-playing')
  try {
    if (list) map.setMaxPitch(MAX_PITCH)
    cars.setPoses(posesAt(vehicles, 0))
    if (ghosts.length) cars.setGhosts(posesAt(ghosts, 0))
    draw(posesAt(vehicles, 0), 0)
    recorder.start()

    let clock = 0
    let last = performance.now()
    while (clock < end) {
      const now = await nextFrame()
      clock = advance(clock, now - last, (list ? shotAt(list, clock).rate : 1) * rate, end)
      last = now
      const { poses } = frameAt(vehicles, timeline, clock)
      const ghostPoses = ghosts.length ? frameAt(ghosts, ghostTimeline, clock).poses : []
      cars.setPoses(poses)
      if (ghosts.length) cars.setGhosts(ghostPoses)
      if (list) {
        const cam = cameraAt(list, clock, [...poses, ...ghostPoses], home)
        map.jumpTo({ center: cam.center, zoom: cam.zoom, pitch: cam.pitch, bearing: cam.bearing })
        const shock = ringAt(timeline, clock)
        if (shock && impact && deps.ring) {
          deps.ring.material.opacity = shock.opacity
          cars.setDecor([{ object: deps.ring, at: impact, metres: shock.metres }])
        } else cars.setDecor([])
      }
      draw(poses, clock / end)
    }
    recorder.stop()
    return await stopped
  } catch {
    try {
      if (recorder.state !== 'inactive') recorder.stop()
    } catch {
      // already stopped
    }
    return null
  } finally {
    // exactly how the customer left it: cars at rest, the map flat and where it was, the DOM
    // markers back — unless the map was taken down mid-recording (the send won the race and the
    // page moved on), which is no error
    try {
      cars.setDecor([])
      cars.setPoses(posesAt(vehicles, 1))
      if (ghosts.length) cars.setGhosts(posesAt(ghosts, 1))
      if (list) {
        map.setMaxPitch(0)
        map.jumpTo({ center: home.center, zoom: home.zoom, pitch: 0, bearing: 0 })
      }
      map.getContainer().classList.remove('mk-playing')
    } catch {
      // nothing left to restore
    }
  }
}
