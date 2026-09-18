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
import type { CarLayer, CarPose } from './carLayer'
import { HOLD_MS, durationOf, ease, lengthOf, posesAt, routeOf } from './playback'

export const REC_WIDTH = 960
export const REC_HEIGHT = 540
/** about 1.5 Mbps: plenty for a diagram of flat colour and a moving map tile, not a photo */
const BITRATE = 1_500_000

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
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export type RecordDeps = {
  map: MapLibreMap
  cars: CarLayer
  vehicles: ClaimVehicle[]
  impact: LngLat | null
  lang: Lang
  /** swapped in by the test; real callers leave this to `MediaRecorder.isTypeSupported` */
  isTypeSupported?: (type: string) => boolean
}

/**
 * One run of the playback — start to impact, held for {@link HOLD_MS} — as a video `Blob`.
 * Drives the car layer through `cars.setPoses`, exactly the mechanism `usePlayback` drives it
 * through for the on-screen playback, so there is one animation path, not two; the DOM/
 * MediaRecorder side of this is proved by the browser smoke, not a unit test.
 *
 * Never throws: every reason this can't produce a video — no `MediaRecorder`, no
 * `captureStream`, no codec, nothing to play, anything going wrong mid-recording — resolves to
 * `null` instead, because a report is never held up, or spoiled, by its own replay.
 */
export async function recordPlayback(deps: RecordDeps): Promise<Blob | null> {
  const { map, cars, vehicles, impact, lang } = deps
  if (!hasReplay(vehicles)) return null
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
  // computed once: the view does not move while this records, only the cars do
  const rect = fitContain(src.clientWidth, src.clientHeight, REC_WIDTH, REC_HEIGHT)
  const scale = src.clientWidth > 0 ? rect.width / src.clientWidth : 0
  const caption = translate(lang, 'scene.replay.caption')

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
    cars.setPoses(posesAt(vehicles, 0))
    draw(posesAt(vehicles, 0), 0)
    recorder.start()

    const durationMs = durationOf(vehicles)
    const t0 = performance.now()
    let t = 0
    while (t < 1) {
      const now = await nextFrame()
      t = Math.min(1, (now - t0) / durationMs)
      const poses = posesAt(vehicles, ease(t))
      cars.setPoses(poses)
      draw(poses, t)
    }
    await wait(HOLD_MS)
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
    // exactly how the customer left it: cars at rest, the DOM markers back — unless the map was
    // taken down mid-recording (the send won the race and the page moved on), which is no error
    try {
      cars.setPoses(posesAt(vehicles, 1))
      map.getContainer().classList.remove('mk-playing')
    } catch {
      // nothing left to restore
    }
  }
}
