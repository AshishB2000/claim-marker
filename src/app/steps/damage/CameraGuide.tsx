/**
 * A full-screen camera sheet for one guided shot. It opens the phone's own camera through
 * `getUserMedia` — no native file picker chrome, no "choose a photo" detour — frames the shot
 * with a guide drawn over the live video, and samples the frame a few times a second for a
 * quality hint (`src/claim/photoQuality.ts`): hold still, too dark, too bright, step back.
 *
 * The hint is a suggestion, never a gate: the shutter is always enabled once the stream is
 * attached, because a blurry photo of real damage beats no photo at all. `getUserMedia`
 * rejecting (no permission, no camera, an insecure context) closes the sheet the same way a
 * deliberate close does, but tells the caller so it can fall back to the hidden file input and
 * say why — this sheet never renders that message itself, and never sits there dead.
 *
 * The camera-open effect and the Escape handler run once, against the props as they were the
 * moment this sheet opened, not whatever the parent re-renders with while it is up — a store
 * update elsewhere in the app must not tear down and re-request the camera mid-shot. That is
 * why `onClose`/`onShot` are frozen into state on mount rather than depended on directly.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Vehicle } from '../../../zones'
import { hintFor, toGrey, type Hint } from '../../../claim/photoQuality'
import type { Key } from '../../../i18n'
import { useT } from '../../../i18n/useT'
import { Icon } from '../../icons'

export type Shot = 'close' | 'back' | 'side' | 'other'

/** how often the live frame is sampled for a hint — frequent enough to feel live, cheap enough not to fight the video decode */
const SAMPLE_MS = 300
/** the sampled frame's long edge, in px — `photoQuality` only needs enough pixels to judge blur, exposure and flatness, not the real shot */
const SAMPLE_LONG_EDGE = 160

/** the torch flag some phones report on a video track's capabilities; TypeScript's lib.dom does not know it, so it is narrowed here rather than reached for with `any` */
type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean }
type TorchConstraintSet = MediaTrackConstraintSet & { torch?: boolean }

/** the body's side silhouette, for the `side` shot's guide — one file, `src/app/icons.tsx`, owns the paths */
const SIDE_ICON: Record<Vehicle, () => ReactNode> = {
  sedan: Icon.sedanSide,
  hatchback: Icon.hatchbackSide,
  coupe: Icon.coupeSide,
  suv: Icon.suvSide,
  truck: Icon.truckSide,
  van: Icon.vanSide,
  box_truck: Icon.boxTruckSide,
}

/** the guide drawn over the live video: a framing box for close/back/other, the body's own silhouette for side */
function FrameGuide({ shot, body }: { shot: Shot; body: Vehicle }) {
  if (shot === 'side') {
    const Silhouette = SIDE_ICON[body]
    return (
      <div aria-hidden className="pointer-events-none absolute inset-x-[8%] top-[30%] bottom-[24%] text-white/80 [&_svg]:h-full [&_svg]:w-full">
        <Silhouette />
      </div>
    )
  }
  // close: tight on the damage; other: plate-height band low in the frame; back: the roomiest box
  const box = shot === 'close' ? 'inset-x-[18%] top-[26%] h-[42%]' : shot === 'other' ? 'inset-x-[14%] top-[42%] h-[20%]' : 'inset-x-[8%] top-[16%] h-[62%]'
  return <div aria-hidden className={`pointer-events-none absolute rounded-2xl border-2 border-dashed border-white/80 ${box}`} />
}

export function CameraGuide({
  shot,
  body,
  onClose,
  onShot,
}: {
  shot: Shot
  /** the vehicle body being photographed, for the side silhouette; from `src/zones.ts`'s Vehicle union */
  body: Vehicle
  /** `true` only when the sheet is closing itself after `getUserMedia` failed */
  onClose: (failed?: boolean) => void
  onShot: (file: File) => void
}): ReactNode {
  const t = useT()
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sampleCanvas = useRef<HTMLCanvasElement | null>(null)
  const [ready, setReady] = useState(false)
  const [hint, setHint] = useState<Hint | null>(null)
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  // built once, so a re-render of the caller (a store update anywhere in the app) does not
  // read as a new prop and tear the camera down and back up mid-shot
  const [onCloseOnce] = useState(() => onClose)
  const [onShotOnce] = useState(() => onShot)

  useEffect(() => {
    let cancelled = false
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {})
        }
        const caps: TorchCapabilities | undefined = stream.getVideoTracks()[0]?.getCapabilities?.()
        setTorchSupported(!!caps?.torch)
        setReady(true)
      })
      .catch(() => {
        if (!cancelled) onCloseOnce(true)
      })
    return () => {
      cancelled = true
      // every track, on close and on unmount alike — a page that leaves the camera light on
      // after the sheet closes is the kind of thing that ends a pilot
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [onCloseOnce])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseOnce()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCloseOnce])

  // the hint, sampled off a small greyscale copy of the live frame — a setState inside this
  // timer callback is fine; what the lint rules forbid is a synchronous one in the effect body
  useEffect(() => {
    if (!ready) return
    const id = setInterval(() => {
      const video = videoRef.current
      if (!video || !video.videoWidth) return
      const scale = SAMPLE_LONG_EDGE / Math.max(video.videoWidth, video.videoHeight)
      const w = Math.max(1, Math.round(video.videoWidth * scale))
      const h = Math.max(1, Math.round(video.videoHeight * scale))
      const canvas = sampleCanvas.current ?? (sampleCanvas.current = document.createElement('canvas'))
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(video, 0, 0, w, h)
      setHint(hintFor(toGrey(ctx.getImageData(0, 0, w, h).data), w, h))
    }, SAMPLE_MS)
    return () => clearInterval(id)
  }, [ready])

  const toggleTorch = () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    const next = !torchOn
    const constraints: TorchConstraintSet = { torch: next }
    track
      .applyConstraints({ advanced: [constraints] })
      .then(() => setTorchOn(next))
      .catch(() => {})
  }

  const shoot = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(
      (blob) => {
        if (blob) onShotOnce(new File([blob], `${shot}-${Date.now()}.jpg`, { type: 'image/jpeg' }))
      },
      'image/jpeg',
      0.92,
    )
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={t('damage.camera.aria')} className="fixed inset-0 z-50 bg-black">
      <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 size-full object-cover" />
      <FrameGuide shot={shot} body={body} />

      <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent px-3 pt-3 pb-8">
        <div className="flex items-center justify-between gap-3">
          <button className="grid size-10 place-items-center rounded-full bg-black/40 text-white" onClick={() => onCloseOnce()} aria-label={t('damage.camera.close')}>
            <Icon.x />
          </button>
          <p className="text-sm font-semibold text-white">{t('damage.camera.title')}</p>
          {torchSupported ? (
            <button
              className={`grid size-10 place-items-center rounded-full text-white ${torchOn ? 'bg-amber-500' : 'bg-black/40'}`}
              onClick={toggleTorch}
              aria-pressed={torchOn}
              aria-label={t('damage.camera.torch')}
            >
              <Icon.flame />
            </button>
          ) : (
            <span className="size-10" aria-hidden />
          )}
        </div>
        <p className="mt-2 text-center text-xs text-white/80">{t(`damage.shot.${shot}` as Key)}</p>
      </div>

      {(!ready || hint) && (
        <p className="absolute inset-x-0 bottom-28 mx-auto w-fit max-w-[80%] rounded-full bg-black/60 px-4 py-1.5 text-center text-sm text-white">
          {ready ? t(`damage.camera.hint.${hint as Hint}` as Key) : t('damage.camera.ready')}
        </p>
      )}

      <div className="absolute inset-x-0 bottom-8 flex justify-center">
        <button
          className="grid size-16 place-items-center rounded-full bg-white ring-4 ring-white/30 active:scale-95 disabled:opacity-40"
          onClick={shoot}
          // disabled only until there is a frame to capture at all — never on a quality hint,
          // which is advice, not a gate
          disabled={!ready}
          aria-label={t('damage.camera.shutter')}
        >
          <span className="size-12 rounded-full bg-white ring-2 ring-black/10" />
        </button>
      </div>
    </div>
  )
}
