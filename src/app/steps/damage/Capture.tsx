import { useRef, useState, type ReactNode } from 'react'
import { useClaim, othersOf } from '../../../claim/store'
import { MAX_PHOTOS, ROLE_COLOR, type ClaimVehicle } from '../../../claim/schema'
import { vehicleName, whose } from '../../../claim/describe'
import { Icon } from '../../icons'

/** the shots a claims handler wants, in the order they are easiest to take at the roadside */
const SHOTS = [
  { id: 'close', text: 'The damage, close up', art: Icon.closeUp },
  { id: 'back', text: 'The same, from a step back', art: Icon.stepBack },
  { id: 'side', text: 'The whole side of the car', art: Icon.carSide },
  { id: 'other', text: 'The other vehicle and its plate', art: Icon.plate },
] as const
type Shot = (typeof SHOTS)[number]['id']

/**
 * The photographs. `guided` is the phone's photo-first layout: one big tile per shot, each
 * opening the camera and then showing what it took. Otherwise the card is the one the desktop
 * always had, with its drop zone.
 */
export function Capture({ v, guided = false }: { v: ClaimVehicle; guided?: boolean }) {
  const claim = useClaim((s) => s.claim)
  const addPhotos = useClaim((s) => s.addPhotos)
  const captionPhoto = useClaim((s) => s.captionPhoto)
  const removePhoto = useClaim((s) => s.removePhoto)
  const photos = claim.attachments.photos
  const files = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const [adding, setAdding] = useState(false)
  const [over, setOver] = useState(false)
  // which tile the camera was opened from; set in the click, read when the photo comes back
  const pending = useRef<Shot | null>(null)
  // the photo each tile took, per vehicle, by its data URL: removing it from the list clears the tile
  const [taken, setTaken] = useState<Record<string, string>>({})
  // the other vehicle's shot is filed against the other vehicle, and only asked for from yours
  const other = v.role === 'insured' ? othersOf(claim)[0] : undefined

  const onFiles = async (list: FileList | null, of = v.id, shot: Shot | null = null) => {
    if (!list?.length) return
    setAdding(true)
    const before = useClaim.getState().claim.attachments.photos.length
    try {
      const kept = await addPhotos(list, of)
      const added = useClaim.getState().claim.attachments.photos[before]
      if (shot && kept > 0 && added) setTaken((t) => ({ ...t, [`${v.id}:${shot}`]: added.data }))
    } finally {
      setAdding(false)
      pending.current = null
      if (files.current) files.current.value = ''
      if (camera.current) camera.current.value = ''
    }
  }
  const full = photos.length >= MAX_PHOTOS
  const shoot = (shot: Shot) => {
    pending.current = shot
    camera.current?.click()
  }

  const inputs = (
    <>
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        aria-label="Take a photo"
        onChange={(e) => onFiles(e.target.files, pending.current === 'other' && other ? other.id : v.id, pending.current)}
      />
      <input ref={files} type="file" accept="image/*" multiple className="hidden" aria-label="Add photos" onChange={(e) => onFiles(e.target.files)} />
    </>
  )

  const gallery = photos.length > 0 && (
    <ul className={guided ? 'mt-4 grid grid-cols-3 gap-2' : 'mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5'}>
      {photos.map((p, i) => (
        <li key={i} className="group relative">
          <img src={p.data} alt={p.caption || `Photo ${i + 1}`} className="aspect-square w-full rounded-lg object-cover ring-1 ring-slate-900/10" />
          {p.of && (
            <span
              className="absolute top-1.5 left-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold text-white"
              style={{ background: ROLE_COLOR[claim.vehicles.find((x) => x.id === p.of)?.role ?? 'other'] }}
            >
              {p.of.toUpperCase()}
            </span>
          )}
          <button className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-white/90 text-slate-700 shadow hover:bg-white" onClick={() => removePhoto(i)} aria-label={`Remove photo ${i + 1}`}>
            <Icon.x />
          </button>
          <input
            className="input mt-1.5 h-8 py-0 text-xs"
            placeholder="What it shows"
            aria-label={`Caption for photo ${i + 1}`}
            value={p.caption}
            onChange={(e) => captionPhoto(i, e.target.value)}
          />
        </li>
      ))}
    </ul>
  )

  if (guided) {
    return (
      <div className="card p-5">
        <h3 className="font-semibold">
          Photos of {whose(v)} {vehicleName(v)}
        </h3>
        <p className="mt-0.5 text-sm text-slate-500">Start with the photos. We read the damage from them, and you check what we found.</p>
        {inputs}
        <ul className="mt-4 grid grid-cols-2 gap-3">
          {SHOTS.filter((s) => s.id !== 'other' || other).map((s) => {
            const data = taken[`${v.id}:${s.id}`]
            const shown = data && photos.some((p) => p.data === data) ? data : null
            return (
              <li key={s.id}>
                <Tile label={s.text} done={!!shown} disabled={adding || full} onClick={() => shoot(s.id)}>
                  {shown ? <img src={shown} alt="" className="size-full object-cover" /> : <s.art />}
                </Tile>
              </li>
            )
          })}
          <li className="col-span-2">
            <button
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-ink ring-1 ring-slate-300 transition active:scale-[0.98] disabled:opacity-40"
              onClick={() => files.current?.click()}
              disabled={adding || full}
            >
              <span className="text-brand-600">
                <Icon.gallery />
              </span>
              Choose from your photos
            </button>
          </li>
        </ul>
        <p className="mt-3 text-xs text-slate-500">
          {adding ? 'Adding…' : full ? `That is the most we can take — ${MAX_PHOTOS} photos.` : `${photos.length} of ${MAX_PHOTOS} photos`}
        </p>
        {gallery}
      </div>
    )
  }

  return (
    <div className="card mt-5 p-5">
      <h3 className="font-semibold">Photos</h3>
      <p className="mt-0.5 text-sm text-slate-500">
        The damage up close and from a step back, the other vehicle, its plate, their insurance card, the scene. Photos are the first thing a claims handler looks at.
      </p>
      {inputs}
      <div
        className={`mt-4 flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${over ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-slate-50/60'}`}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          if (!full) onFiles(e.dataTransfer.files)
        }}
      >
        <span className="grid size-12 place-items-center rounded-full bg-white text-brand-600 shadow-sm ring-1 ring-slate-900/10 [&_svg]:size-6">
          {adding ? <Icon.spinner /> : <Icon.camera />}
        </span>
        <div className="flex flex-wrap justify-center gap-2">
          <button className="btn btn-primary" onClick={() => camera.current?.click()} disabled={adding || full}>
            <Icon.camera /> Take a photo
          </button>
          <button className="btn btn-secondary" onClick={() => files.current?.click()} disabled={adding || full}>
            <Icon.plus /> Choose photos
          </button>
        </div>
        <p className="text-xs text-slate-500">
          {adding ? 'Adding…' : full ? `That is the most we can take — ${MAX_PHOTOS} photos.` : `Photos of ${v.id.toUpperCase()} · ${photos.length} of ${MAX_PHOTOS} · or drop them here`}
        </p>
      </div>
      {gallery}
    </div>
  )
}

/** one guided shot: a thumb-sized target with the drawing, or the photo once it is taken */
function Tile({ label, done, disabled, onClick, children }: { label: string; done: boolean; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      className="relative flex h-full w-full flex-col overflow-hidden rounded-xl bg-white text-left ring-1 ring-slate-300 transition active:scale-[0.98] disabled:opacity-40"
      onClick={onClick}
      disabled={disabled}
      aria-label={done ? `${label}, taken — take it again` : label}
    >
      <span className="grid aspect-[4/3] w-full place-items-center bg-slate-50 text-brand-600">{children}</span>
      <span className="px-3 py-2 text-[13px] leading-snug font-medium">{label}</span>
      {done && (
        <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-emerald-600 text-white shadow ring-2 ring-white">
          <Icon.check />
        </span>
      )}
    </button>
  )
}
