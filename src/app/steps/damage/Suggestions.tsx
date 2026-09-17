import { useEffect, useState } from 'react'
import { useClaim } from '../../../claim/store'
import type { ClaimVehicle } from '../../../claim/schema'
import { SEVERITY_COLOR, type Damage as Mark } from '../../../schema'
import type { Key } from '../../../i18n'
import { plural } from '../../../i18n'
import { useT } from '../../../i18n/useT'
import { Icon } from '../../icons'
import { assistOn, damageFromPhotos } from '../../../assist/client'

/** how long the photos must sit still before they are read, so a burst of shots is one request */
const SETTLE_MS = 1200

/** The desktop card: the customer asks for suggestions with a button, and adds the ones they want. */
export function Suggestions({ v }: { v: ClaimVehicle }) {
  const claim = useClaim((s) => s.claim)
  const setDamages = useClaim((s) => s.setDamages)
  const t = useT()
  // keyed on the vehicle, so switching cars does not leave the other one's suggestions up
  const [suggested, setSuggested] = useState<{ id: string; marks: Mark[] } | null>(null)
  const [looking, setLooking] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const ofThis = claim.attachments.photos.filter((p) => p.of === v.id).length
  const marks = suggested?.id === v.id ? suggested.marks : null

  const look = async () => {
    setLooking(true)
    setFailed(null)
    try {
      setSuggested({ id: v.id, marks: await damageFromPhotos(claim, v.id) })
    } catch (e) {
      setFailed(e instanceof Error ? e.message : t('scene.assist.failed'))
    } finally {
      setLooking(false)
    }
  }
  // the customer pressed Add, so this vehicle's damage is now theirs — `setDamages` flips it
  const add = (m: Mark) => {
    setDamages(v.id, [...v.damages, m])
    setSuggested((s) => (s && s.id === v.id ? { id: v.id, marks: s.marks.filter((x) => x !== m) } : s))
  }

  if (!assistOn() || ofThis === 0) return null
  return (
    <div className="card p-4">
      <h3 className="eyebrow">{t('damage.suggest.title')}</h3>
      <p className="mt-1 text-sm text-slate-500">{t(plural(ofThis, 'damage.suggest.lead.one', 'damage.suggest.lead.other'), { n: ofThis })}</p>
      <button className="btn btn-secondary btn-sm mt-3" onClick={look} disabled={looking}>
        {looking ? <Icon.spinner /> : <Icon.wand />}
        {t(looking ? 'damage.suggest.looking' : marks ? 'damage.suggest.again' : 'damage.suggest.button')}
      </button>
      {failed && !looking && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">{failed}</p>}
      {marks && !looking && marks.length === 0 && <p className="mt-2 text-sm text-slate-500">{t('damage.suggest.nothing')}</p>}
      {marks && !looking && marks.length > 0 && (
        <ul className="mt-3 space-y-2">
          {marks.map((m, i) => (
            <li key={`${m.zone}-${i}`} className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: SEVERITY_COLOR[m.severity] }} />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{t(`zone.${m.zone}` as Key)}</span>
                <span className="text-slate-500"> · {t(`severity.${m.severity}` as Key)}</span>
                {m.note && <span className="block text-xs text-slate-500">{m.note}</span>}
              </span>
              <button className="btn btn-ghost btn-sm shrink-0" onClick={() => add(m)} aria-label={t('damage.suggest.add', { panel: t(`zone.${m.zone}` as Key) })}>
                <Icon.plus /> {t('common.add')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-slate-400">{t('damage.suggest.ai')}</p>
    </div>
  )
}

/**
 * The phone card, in photo-first order: no button — the photos are read by themselves once
 * they stop changing, and each panel seen comes back as a card to add or wave away. A failure
 * is one quiet line; the car below still takes a tap, so nothing here can hold the customer up.
 */
export function PhotoSuggestions({ v }: { v: ClaimVehicle }) {
  const photos = useClaim((s) => s.claim.attachments.photos)
  const setDamages = useClaim((s) => s.setDamages)
  const tagPhoto = useClaim((s) => s.tagPhoto)
  const t = useT()
  const mine = photos.filter((p) => p.of === v.id)
  // the vehicle and its photos by size: a new shot, a removed one, or one swapped for another
  // of the same count all read again, and typing a caption or tagging a photo does not
  const key = mine.length ? `${v.id}|${mine.map((p) => p.data.length).join(',')}` : ''
  const [read, setRead] = useState<{ key: string; marks: Mark[]; failed: boolean } | null>(null)

  useEffect(() => {
    if (!key) return
    const ac = new AbortController()
    const timer = setTimeout(() => {
      // the claim as it is when the timer fires, not when the effect ran: it is only the photos we wait on
      damageFromPhotos(useClaim.getState().claim, v.id, ac.signal)
        .then((marks) => {
          if (!ac.signal.aborted) setRead({ key, marks, failed: false })
        })
        .catch(() => {
          if (!ac.signal.aborted) setRead({ key, marks: [], failed: true })
        })
    }, SETTLE_MS)
    return () => {
      clearTimeout(timer)
      ac.abort()
    }
  }, [key, v.id])

  if (!key) return null
  // loading is derived, not stored: an answer for other photos is no answer at all
  const current = read?.key === key ? read : null
  // a panel already on the car is not offered twice
  const marks = current?.marks.filter((m) => !v.damages.some((d) => d.zone === m.zone)) ?? []
  const drop = (m: Mark) => setRead((r) => (r ? { ...r, marks: r.marks.filter((x) => x !== m) } : r))
  // the customer confirmed it: the mark goes on at the zone's own anchor, and the photos it was
  // read off say which panel they show, unless the customer's earlier Add already said so
  const add = (m: Mark) => {
    setDamages(v.id, [...v.damages, m])
    photos.forEach((p, i) => {
      if (p.of === v.id && !p.shows) tagPhoto(i, m.zone)
    })
    drop(m)
  }

  return (
    <section className="card mt-5 p-4" aria-label={t('damage.seen.aria')}>
      <h3 className="eyebrow">{t('damage.seen.title')}</h3>
      {!current && (
        <p className="mt-2 flex items-center gap-2 text-sm text-slate-500">
          <Icon.spinner /> {t('damage.seen.looking')}
        </p>
      )}
      {current?.failed && <p className="mt-2 text-sm text-slate-500">{t('damage.seen.failed')}</p>}
      {current && !current.failed && marks.length === 0 && <p className="mt-2 text-sm text-slate-500">{t('damage.seen.nothing')}</p>}
      {marks.length > 0 && (
        <ul className="mt-3 space-y-3">
          {marks.map((m) => {
            const label = t(`zone.${m.zone}` as Key)
            return (
              <li key={m.zone} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-900/5">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold">{label}</span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-700 capitalize ring-1 ring-slate-900/10">
                    <span className="size-2 rounded-full" style={{ background: SEVERITY_COLOR[m.severity] }} />
                    {t(`severity.${m.severity}` as Key)}
                  </span>
                </div>
                {m.note && <p className="mt-1 text-sm text-slate-600">{m.note}</p>}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button className="btn btn-primary btn-sm" onClick={() => add(m)} aria-label={t('damage.suggest.add', { panel: label })}>
                    <Icon.plus /> {t('common.add')}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => drop(m)} aria-label={t('damage.seen.notThisAria', { panel: label })}>
                    {t('damage.seen.notThis')}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-slate-400">{t('damage.seen.ai')}</p>
    </section>
  )
}
