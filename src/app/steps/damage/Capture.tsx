import { useRef, useState, type ReactNode } from 'react'
import { useClaim, othersOf } from '../../../claim/store'
import { MAX_PHOTOS, ROLE_COLOR, type ClaimVehicle } from '../../../claim/schema'
import { vehicleName } from '../../../claim/describe'
import type { Key } from '../../../i18n'
import { useLang, useT } from '../../../i18n/useT'
import { Icon } from '../../icons'
import { CameraGuide } from './CameraGuide'

/** the shots a claims handler wants, in the order they are easiest to take at the roadside */
const SHOTS = [
  { id: 'close', art: Icon.closeUp },
  { id: 'back', art: Icon.stepBack },
  { id: 'side', art: Icon.carSide },
  { id: 'other', art: Icon.plate },
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
  const lang = useLang()
  const t = useT()
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

  // feature-detected once: a phone has getUserMedia and the live guide is worth opening; a
  // laptop webcam pointed at a bumper is not a thing that happens, so a desktop without it
  // falls straight to the hidden file input as it always did
  const [hasCamera] = useState(() => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia)
  // the shot the live guide is open for, or null when it is closed
  const [guide, setGuide] = useState<Shot | null>(null)
  // shown once per visit to this card, the first time the camera fails to open
  const [camDenied, setCamDenied] = useState(false)

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
  // a guided tile opens the live camera sheet when one is possible; otherwise the hidden input,
  // exactly as before
  const shoot = (shot: Shot) => {
    pending.current = shot
    if (hasCamera) setGuide(shot)
    else camera.current?.click()
  }
  // the frame the sheet captured, routed through the same onFiles as the hidden input so the
  // downscaling, the cap of twelve and the photo-first suggestions all behave exactly as they do
  const onGuideShot = (file: File) => {
    const dt = new DataTransfer()
    dt.items.add(file)
    onFiles(dt.files, pending.current === 'other' && other ? other.id : v.id, pending.current)
    setGuide(null)
  }
  // getUserMedia failed (no permission, no camera, an insecure context): fall back to the
  // hidden input for the same tap, and say so once
  const onGuideClose = (failed?: boolean) => {
    setGuide(null)
    if (failed) {
      camera.current?.click()
      setCamDenied(true)
    }
  }

  const inputs = (
    <>
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        aria-label={t('damage.takePhoto')}
        onChange={(e) => onFiles(e.target.files, pending.current === 'other' && other ? other.id : v.id, pending.current)}
      />
      <input ref={files} type="file" accept="image/*" multiple className="hidden" aria-label={t('damage.addPhotos')} onChange={(e) => onFiles(e.target.files)} />
    </>
  )

  const gallery = photos.length > 0 && (
    <ul className={guided ? 'mt-4 grid grid-cols-3 gap-2' : 'mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5'}>
      {photos.map((p, i) => (
        <li key={i} className="group relative">
          <img src={p.data} alt={p.caption || t('damage.photo.alt', { n: i + 1 })} className="aspect-square w-full rounded-lg object-cover ring-1 ring-slate-900/10" />
          {p.of && (
            <span
              className="absolute top-1.5 left-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold text-white"
              style={{ background: ROLE_COLOR[claim.vehicles.find((x) => x.id === p.of)?.role ?? 'other'] }}
            >
              {p.of.toUpperCase()}
            </span>
          )}
          <button className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-white/90 text-slate-700 shadow hover:bg-white" onClick={() => removePhoto(i)} aria-label={t('damage.photo.remove', { n: i + 1 })}>
            <Icon.x />
          </button>
          <input
            className="input mt-1.5 h-8 py-0 text-xs"
            placeholder={t('damage.photo.caption')}
            aria-label={t('damage.photo.captionAria', { n: i + 1 })}
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
          {t(v.role === 'insured' ? 'damage.guided.title.mine' : 'damage.guided.title.other', { name: vehicleName(v, lang) })}
        </h3>
        <p className="mt-0.5 text-sm text-slate-500">{t('damage.guided.lead')}</p>
        {inputs}
        <ul className="mt-4 grid grid-cols-2 gap-3">
          {SHOTS.filter((s) => s.id !== 'other' || other).map((s) => {
            const data = taken[`${v.id}:${s.id}`]
            const shown = data && photos.some((p) => p.data === data) ? data : null
            return (
              <li key={s.id}>
                <Tile label={t(`damage.shot.${s.id}` as Key)} taken={t('damage.tile.taken', { label: t(`damage.shot.${s.id}` as Key) })} done={!!shown} disabled={adding || full} onClick={() => shoot(s.id)}>
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
              {t('damage.guided.choose')}
            </button>
          </li>
        </ul>
        <p className="mt-3 text-xs text-slate-500">
          {adding ? t('damage.adding') : full ? t('damage.full', { n: MAX_PHOTOS }) : t('damage.count', { n: photos.length, max: MAX_PHOTOS })}
        </p>
        {camDenied && <p className="mt-2 text-xs text-amber-700">{t('damage.camera.denied')}</p>}
        {gallery}
        {guide && <CameraGuide shot={guide} body={v.body} onClose={onGuideClose} onShot={onGuideShot} />}
      </div>
    )
  }

  return (
    <div className="card mt-5 p-5">
      <h3 className="font-semibold">{t('damage.photos.title')}</h3>
      <p className="mt-0.5 text-sm text-slate-500">{t('damage.photos.lead')}</p>
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
            <Icon.camera /> {t('damage.takePhoto')}
          </button>
          <button className="btn btn-secondary" onClick={() => files.current?.click()} disabled={adding || full}>
            <Icon.plus /> {t('damage.choosePhotos')}
          </button>
        </div>
        <p className="text-xs text-slate-500">
          {adding
            ? t('damage.adding')
            : full
              ? t('damage.full', { n: MAX_PHOTOS })
              : t('damage.drop.count', { id: v.id.toUpperCase(), n: photos.length, max: MAX_PHOTOS })}
        </p>
      </div>
      {gallery}
    </div>
  )
}

/** one guided shot: a thumb-sized target with the drawing, or the photo once it is taken */
function Tile({ label, taken, done, disabled, onClick, children }: { label: string; taken: string; done: boolean; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      className="relative flex h-full w-full flex-col overflow-hidden rounded-xl bg-white text-left ring-1 ring-slate-300 transition active:scale-[0.98] disabled:opacity-40"
      onClick={onClick}
      disabled={disabled}
      aria-label={done ? taken : label}
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
