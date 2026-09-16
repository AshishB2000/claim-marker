import { useEffect, useState, type ReactNode } from 'react'
import type { ClaimVehicle } from '../claim/schema'
import { photoFor, type Photo } from '../vehicles/photo'

/**
 * A photograph of the vehicle's real make and model, with its credit, or `fallback` while
 * there is none: before a model is chosen, while the lookup runs, or when nothing was found.
 * `contain` shows the whole car over a blurred copy of itself, for a box the photo's shape
 * will not fill; otherwise the photo is cropped to the box, which suits a thumbnail.
 */
export function VehiclePhoto({
  vehicle: v,
  fallback,
  credit,
  contain,
  className,
}: {
  vehicle: ClaimVehicle
  fallback: ReactNode
  credit?: boolean
  contain?: boolean
  className?: string
}) {
  const key = `${v.make}|${v.model}|${v.year ?? ''}|${v.color}`
  const [state, setState] = useState<{ key: string; photo: Photo | null }>({ key: '', photo: null })
  // a picture the browser could not load counts as no picture
  const [broken, setBroken] = useState<string | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    photoFor(v.make, v.model, v.year, v.color, ac.signal)
      .then((photo) => {
        if (!ac.signal.aborted) setState({ key, photo })
      })
      .catch(() => {
        if (!ac.signal.aborted) setState({ key, photo: null })
      })
    return () => ac.abort()
  }, [key, v.make, v.model, v.year, v.color])

  const photo = state.key === key ? state.photo : null
  if (!photo || photo.url === broken) return <>{fallback}</>
  const name = [v.year, v.make, v.model].filter(Boolean).join(' ')
  return (
    <figure className={className}>
      {contain && <img src={photo.url} alt="" aria-hidden className="absolute inset-0 size-full scale-110 object-cover opacity-70 blur-2xl" />}
      <img src={photo.url} alt={name} className={`relative size-full ${contain ? 'object-contain' : 'object-cover'}`} loading="lazy" onError={() => setBroken(photo.url)} />
      {credit && photo.credit && (
        <a
          className="absolute top-2 right-2 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur hover:bg-black/60"
          href={photo.credit.href}
          target="_blank"
          rel="noreferrer"
          title={`${photo.credit.title} — Wikimedia Commons`}
        >
          Photo: Wikimedia Commons
        </a>
      )}
    </figure>
  )
}
