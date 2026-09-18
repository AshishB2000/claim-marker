import { Fragment, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useClaim, type Step } from '../claim/store'
import { KIND_INFO, ROLE_COLOR, newPerson, type Claim, type ClaimVehicle, type Person } from '../claim/schema'
import {
  cap,
  conditionLabels,
  contactLine,
  driverName,
  driverShort,
  gaps,
  glareLine,
  lookedUpLines,
  ownerLabel,
  personLine,
  vehicleName,
  vehicleOf,
  yesNo,
  type Voice,
} from '../claim/describe'
import type { LngLat } from '../geo'
import { plural, translate, type Key, type Lang, type Vars } from '../i18n'
import { MapScene, type MapSceneHandle } from '../map/MapScene'
import { DamageMarker, type DamageMarkerHandle } from '../marker/DamageMarker'
import { SCHEMA, SEVERITY_COLOR } from '../schema'
import { PAINTS } from '../vehicles/paint'
import { Icon } from './icons'
import { VehiclePhoto } from './VehiclePhoto'
import { MarkPhotos } from './MarkPhotos'
import { PlainViewChip } from './PlainView'
import { usePlayback } from '../map/usePlayback'
import type { Lighting } from '../scene/lighting'

// ── the pieces the document is written in ────────────────────────────

function Edit({ step, lang, children }: { step: Step; lang: Lang; children?: ReactNode }) {
  const goto = useClaim((s) => s.goto)
  return (
    <button className="text-xs font-semibold text-brand-700 underline-offset-2 hover:underline print:hidden" onClick={() => goto(step)}>
      {children ?? translate(lang, 'common.change')}
    </button>
  )
}

/** one section of the document: an eyebrow, a way back to the step it came from, the content */
function Part({ title, edit, children }: { title: string; edit?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-slate-100 px-6 py-5 last:border-b-0">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h3 className="eyebrow">{title}</h3>
        {edit}
      </div>
      {children}
    </section>
  )
}

const NotGiven = ({ lang }: { lang: Lang }) => <span className="text-slate-400">{translate(lang, 'common.notGiven')}</span>
const given = (s: string | null | undefined, lang: Lang): ReactNode => (s ? s : <NotGiven lang={lang} />)
const mono = (s: string | null | undefined, lang: Lang): ReactNode => (s ? <span className="font-mono text-[13px]">{s}</span> : <NotGiven lang={lang} />)
/** which swatch a stored hex is, so the colour is named in the reader's language */
const paintId = (hex: string) => PAINTS.find((p) => p.hex === hex.toLowerCase())?.id ?? 'custom'

/** a yes/no answered as words, or not answered */
const answered = (v: boolean | null, yes: string, no: string): string | null => (v === null ? null : v ? yes : no)

/** label / value pairs, the way a form reads back */
function Rows({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
      {items.map(([k, v]) => (
        <Fragment key={k}>
          <dt className="text-slate-500">{k}</dt>
          <dd className="min-w-0 text-ink">{v}</dd>
        </Fragment>
      ))}
    </dl>
  )
}

function Tag({ v }: { v: ClaimVehicle }) {
  return (
    <span className="grid size-6 shrink-0 place-items-center rounded-md text-[11px] font-bold text-white" style={{ background: ROLE_COLOR[v.role] }}>
      {v.id.toUpperCase()}
    </span>
  )
}

const when = (at: string, lang: Lang) => {
  const d = new Date(at)
  // English follows the reader's own locale, as it always did; Spanish is asked for by name
  return Number.isNaN(d.getTime()) ? at : d.toLocaleString(lang === 'es' ? 'es' : undefined, { dateStyle: 'full', timeStyle: 'short' })
}

/** the marks on one vehicle, numbered as they are on the car */
function Marks({ v, photos, lang }: { v: ClaimVehicle; photos: Claim['attachments']['photos']; lang: Lang }) {
  return (
    <ol className="space-y-1.5 text-sm">
      {v.damages.map((d, i) => (
        <li key={i} className="flex items-start gap-2.5">
          <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white" style={{ background: SEVERITY_COLOR[d.severity] }}>
            {i + 1}
          </span>
          <span>
            <span className="font-medium">{translate(lang, `zone.${d.zone}` as Key)}</span>
            <span className="text-slate-500"> — {translate(lang, `severity.${d.severity}` as Key)}</span>
            {d.note && <span className="block text-slate-600">“{d.note}”</span>}
            <MarkPhotos photos={photos} of={v.id} zone={d.zone} lang={lang} />
          </span>
        </li>
      ))}
    </ol>
  )
}

function Hurt({ p, lang }: { p: Person; lang: Lang }) {
  if (!p.injured) return null
  return (
    <span className="mt-0.5 block text-red-700">
      <span className="font-semibold">{translate(lang, 'scene.doc.hurtLabel')}</span>
      {p.injury && ` — ${p.injury}`}
    </span>
  )
}

/** one video frame, at the recorder's own rate */
const FRAME_S = 1 / 30

/**
 * The video the customer's browser recorded at send time — what actually went out, not the
 * live playback above it — with a scrubber an adjuster can step frame by frame, because
 * "was the red car already moving" is a question `controls` alone answers badly.
 */
function ReplayVideo({ src, lang }: { src: string; lang: Lang }) {
  const t = (key: Key, vars?: Vars) => translate(lang, key, vars)
  const video = useRef<HTMLVideoElement>(null)
  const [time, setTime] = useState(0)

  useEffect(() => {
    const v = video.current
    if (!v) return
    // A MediaRecorder webm reports `duration === Infinity` until the browser has demuxed all
    // the way to the end — which normal playback of a short clip never does on its own.
    // Seeking to a point far past the end forces it to do that work; seeking back to 0 then
    // leaves the scrubber at the start with a real length to step through.
    const onLoaded = () => {
      if (v.duration !== Infinity) return
      const onSeeked = () => {
        v.currentTime = 0
        v.removeEventListener('seeked', onSeeked)
      }
      v.addEventListener('seeked', onSeeked)
      v.currentTime = 1e9
    }
    v.addEventListener('loadedmetadata', onLoaded)
    return () => v.removeEventListener('loadedmetadata', onLoaded)
  }, [])

  const step = (frames: number) => {
    const v = video.current
    if (!v) return
    v.pause()
    const end = Number.isFinite(v.duration) ? v.duration : Infinity
    v.currentTime = Math.min(Math.max(0, v.currentTime + frames * FRAME_S), end)
  }

  return (
    <div className="mt-4">
      <div className="mb-1.5 text-xs font-semibold text-slate-500">{t('scene.doc.replay.heading')}</div>
      <video
        ref={video}
        src={src}
        controls
        muted
        playsInline
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        className="w-full rounded-xl bg-black ring-1 ring-slate-900/10"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2 print:hidden">
        <button type="button" className="chip" onClick={() => step(-1)}>
          <Icon.back /> {t('scene.doc.replay.stepBack')}
        </button>
        <button type="button" className="chip" onClick={() => step(1)}>
          <Icon.next /> {t('scene.doc.replay.stepForward')}
        </button>
        <span className="font-mono text-xs text-slate-500 tabular-nums">{t('scene.doc.replay.time', { time: time.toFixed(1) })}</span>
      </div>
    </div>
  )
}

// ── the document ─────────────────────────────────────────────────────

export type ReportDocumentProps = {
  claim: Claim
  /** the customer's own review: links back to each step, and a draft badge with what is still worth adding */
  edit?: boolean
  /** the live scenes, for the review page to export at send time */
  mapRef?: RefObject<MapSceneHandle | null>
  markers?: RefObject<Map<string, DamageMarkerHandle>>
  /** what an adjuster sees instead of the draft badge */
  badge?: ReactNode
  /** who is reading: the customer ("your Camry") or the claims desk ("the policyholder's", or "the other driver's" in theirs) */
  voice?: Voice
  /** which language to read it in; the claims desk renders this too and always stays English */
  lang?: Lang
  /**
   * The moment's light for the map and the marked-up cars, from `lightingFor(incident.context)`
   * — the customer's page passes null while "Plain view" is on, the desk the receipt's own.
   * Absent is the fixed light both scenes have always had.
   */
  lighting?: Lighting | null
}

/**
 * The report as it will be read: one card with a header, then sections in one style. The
 * customer reads it on the review step with a way back into every section; the insurer
 * reads the same component on the claims desk with none.
 */
export function ReportDocument({ claim, edit = false, mapRef, markers, badge, voice = 'customer', lang = 'en', lighting = null }: ReportDocumentProps) {
  const t = (key: Key, vars?: Vars) => translate(lang, key, vars)
  const ownMarkers = useRef(new Map<string, DamageMarkerHandle>())
  const marks = markers ?? ownMarkers
  const play = usePlayback(claim.vehicles)

  const loc = claim.incident.location
  const ctx = claim.incident.context
  const center: LngLat | null = loc ? [loc.lng, loc.lat] : null
  const info = KIND_INFO[claim.incident.kind]
  const mine = claim.vehicles.find((v) => v.role === 'insured') ?? claim.vehicles[0]
  const conditions = conditionLabels(claim.incident.conditions, lang)
  const damaged = claim.vehicles.filter((v) => v.damages.length > 0)
  const photos = claim.attachments.photos
  const hurt = claim.people.filter((p) => p.injured)
  const driverOf = (v: ClaimVehicle) => claim.people.find((p) => p.role === 'driver' && p.vehicle === v.id)
  const inVehicle = (v: ClaimVehicle) => claim.people.filter((p) => p.vehicle === v.id && p.role !== 'driver')
  const outside = claim.people.filter((p) => !p.vehicle)
  const cond = mine?.condition
  const missing = edit ? gaps(claim, lang) : []
  const change = (step: Step) => (edit ? <Edit step={step} lang={lang} /> : undefined)

  return (
    <article className="card overflow-hidden">
      {/* ── the header: what, where, when ───────────────────────── */}
      <header className="border-b border-slate-100 bg-gradient-to-b from-slate-50 to-white px-6 py-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="eyebrow">
              {t('scene.doc.title')}
              {claim.reference && !edit ? ` · ${claim.reference}` : ''}
            </div>
            <h2 className="mt-1 flex flex-wrap items-baseline gap-3 text-2xl font-semibold tracking-tight">
              {t(`kind.${claim.incident.kind}.label` as Key)}
              {change('kind')}
            </h2>
          </div>
          {edit ? <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">{t('scene.doc.draft')}</span> : badge}
        </div>
        <div className="mt-5 grid gap-x-10 gap-y-3 sm:grid-cols-2">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-slate-400">
              <Icon.pin />
            </span>
            <div>
              <div className="text-sm font-medium">{loc?.address ?? <NotGiven lang={lang} />}</div>
              <div className="mt-0.5 text-xs text-slate-500">
                {t('scene.doc.where')}
                {edit && <> · {change('where')}</>}
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-slate-400">
              <Icon.target />
            </span>
            <div>
              <div className="text-sm font-medium">{when(claim.incident.at, lang)}</div>
              <div className="mt-0.5 text-xs text-slate-500">
                {conditions.length ? conditions.join(' · ') : t('scene.doc.noConditions')}
                {edit && <> · {change('where')}</>}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ── what an adjuster would ring up to ask ────────────────── */}
      {edit &&
        (missing.length > 0 ? (
          <div className="border-b border-slate-100 bg-amber-50/60 px-6 py-4">
            <div className="text-sm font-semibold text-amber-900">{t('scene.doc.gapsTitle')}</div>
            <p className="mt-0.5 text-xs text-amber-800/80">{t('scene.doc.gapsLead')}</p>
            <ul className="mt-2 grid gap-x-6 gap-y-1 text-sm text-amber-900 sm:grid-cols-2">
              {missing.map((g) => (
                <li key={g.text} className="flex items-start gap-2">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" />
                  <span>
                    {g.text}
                    {g.step !== 'review' && (
                      <>
                        {' '}
                        ·{' '}
                        <Edit step={g.step} lang={lang}>
                          {t('scene.doc.gapsAdd')}
                        </Edit>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex items-center gap-2 border-b border-slate-100 bg-emerald-50/60 px-6 py-3 text-sm font-medium text-emerald-800">
            <Icon.check /> {t('scene.doc.complete')}
          </div>
        ))}

      {/* ── what the record said about the place and the hour: provenance, not an answer ── */}
      {ctx && (
        <Part title={t('start.where.looked.title')}>
          <p className="mb-2 text-xs text-slate-500">{t('start.where.looked.source')}</p>
          <ul className="space-y-1.5 text-sm text-ink">
            {lookedUpLines(ctx, lang).map((line, i) => (
              <li key={i}>{line}</li>
            ))}
            {voice !== 'customer' &&
              claim.vehicles
                .filter((v) => v.position)
                .map((v) => {
                  const glare = glareLine(ctx, v.heading, lang)
                  return glare ? (
                    <li key={v.id} className="flex items-center gap-2">
                      <Tag v={v} />
                      <span>{glare}</span>
                    </li>
                  ) : null
                })}
          </ul>
        </Part>
      )}

      {/* ── vehicles ────────────────────────────────────────────── */}
      <Part title={t('scene.doc.vehicles')} edit={change('vehicles')}>
        <div className="divide-y divide-slate-100">
          {claim.vehicles.map((v) => {
            const d = driverOf(v)
            const driver = driverName(d, voice, lang)
            const rows: [string, ReactNode][] = [
              [t('scene.doc.colour'), t(`paint.${paintId(v.color)}` as Key)],
              [t('scene.doc.plate'), given(v.plate ? `${v.plate}${v.plateState ? ` (${v.plateState})` : ''}` : null, lang)],
              [t('scene.doc.vin'), mono(v.vin, lang)],
            ]
            if (v.role !== 'insured') {
              rows.push(
                [t('scene.doc.driver'), given(driver ? `${driver}${d && contactLine(d, lang) ? ` · ${contactLine(d, lang)}` : ''}` : null, lang)],
                [t('scene.doc.insurer'), given(v.insurer ? `${v.insurer}${v.policy ? t('scene.doc.policySuffix', { policy: v.policy }) : ''}` : null, lang)],
                [t('scene.doc.owner'), v.owner || t('scene.doc.ownerDriver')],
              )
            }
            rows.push([
              t('scene.doc.damage'),
              v.damages.length ? t(plural(v.damages.length, 'scene.doc.panels.one', 'scene.doc.panels.other'), { n: v.damages.length }) : t('scene.doc.noPanels'),
            ])
            return (
              <div key={v.id} className="flex gap-4 py-4 first:pt-0 last:pb-0">
                <VehiclePhoto
                  vehicle={v}
                  className="h-20 w-28 shrink-0 overflow-hidden rounded-lg ring-1 ring-slate-900/10"
                  fallback={
                    <div className="grid h-20 w-28 shrink-0 place-items-center rounded-lg bg-slate-100">
                      <span className="size-7 rounded-full ring-2 ring-white" style={{ background: v.color }} />
                    </div>
                  }
                />
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Tag v={v} />
                    <span className="font-semibold">{vehicleName(v, lang)}</span>
                    <span className="text-xs text-slate-500">{ownerLabel(v, voice, lang)}</span>
                  </div>
                  <Rows items={rows} />
                </div>
              </div>
            )
          })}
        </div>
      </Part>

      {/* ── people ──────────────────────────────────────────────── */}
      <Part title={t('step.people')} edit={change('people')}>
        <div className="mb-3">
          {hurt.length ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 ring-1 ring-red-200">
              {t(plural(hurt.length, 'scene.doc.hurt.one', 'scene.doc.hurt.other'), { n: hurt.length })}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
              <Icon.check /> {t('scene.doc.noneHurt')}
            </span>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {claim.vehicles.map((v) => {
            const d = driverOf(v)
            const others = inVehicle(v)
            return (
              <div key={v.id} className="rounded-xl bg-slate-50 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Tag v={v} />
                  {t('scene.doc.inVehicle', { vehicle: vehicleOf(v, voice, lang) })}
                </div>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 text-slate-400">
                      <Icon.person />
                    </span>
                    <span>
                      {d ? (
                        <>
                          {driverShort(d, voice, lang)}
                          {contactLine(d, lang) && <span className="block text-xs text-slate-500">{contactLine(d, lang)}</span>}
                          <Hurt p={d} lang={lang} />
                        </>
                      ) : v.role === 'insured' ? (
                        driverShort({ ...newPerson('driver', v.id), self: true }, voice, lang)
                      ) : (
                        <span className="text-slate-400">{t('scene.doc.noDriver')}</span>
                      )}
                    </span>
                  </li>
                  {others.map((p) => (
                    <li key={p.name + p.phone} className="flex items-start gap-2">
                      <span className="mt-0.5 text-slate-400">
                        <Icon.person />
                      </span>
                      <span>
                        {t('scene.doc.passengerRow', { name: p.name || t('scene.doc.aPassenger') })}
                        {p.phone && <span className="block text-xs text-slate-500">{p.phone}</span>}
                        <Hurt p={p} lang={lang} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
          {outside.length > 0 && (
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="mb-2 text-sm font-semibold">{t('scene.doc.outside')}</div>
              <ul className="space-y-2 text-sm">
                {outside.map((p, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-0.5 text-slate-400">
                      <Icon.person />
                    </span>
                    <span>
                      {personLine(p, claim.vehicles, voice, lang)}
                      {contactLine(p, lang) && <span className="block text-xs text-slate-500">{contactLine(p, lang)}</span>}
                      <Hurt p={p} lang={lang} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="mt-4 rounded-xl bg-slate-50 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <span className="text-slate-400">
              <Icon.shield />
            </span>
            {t('scene.doc.police')}
          </div>
          {claim.police.called === null ? (
            <p className="text-sm text-slate-400">{t('scene.doc.policeUnknown')}</p>
          ) : claim.police.called === false ? (
            <p className="text-sm">{t('scene.doc.policeNo')}</p>
          ) : (
            <Rows
              items={[
                [t('scene.doc.department'), given(claim.police.department, lang)],
                [t('scene.doc.reportNumber'), mono(claim.police.report, lang)],
                [t('scene.doc.tickets'), claim.police.citations || t('scene.doc.noTickets')],
              ]}
            />
          )}
        </div>
      </Part>

      {/* ── what happened ───────────────────────────────────────── */}
      <Part title={t('scene.doc.happened')} edit={change(info.diagram ? 'scene' : 'damage')}>
        {claim.incident.description ? (
          <>
            {/* the desk reads English; this says the words below it were not written in it */}
            {claim.incident.language === 'es' && lang === 'en' && (
              <div className="mb-2 text-xs font-semibold text-slate-500">{t('scene.doc.reportedInSpanish')}</div>
            )}
            <blockquote className="border-l-4 border-brand-200 pl-4 text-[15px] leading-relaxed whitespace-pre-line">{claim.incident.description}</blockquote>
          </>
        ) : (
          <p className="text-sm text-slate-400">{edit ? t('scene.doc.noDescriptionEdit') : t('scene.doc.noDescription')}</p>
        )}
        {center && info.diagram && (
          <figure className="mt-4 overflow-hidden rounded-xl ring-1 ring-slate-900/10">
            <div className="relative">
              <MapScene
                ref={mapRef}
                center={center}
                style={claim.incident.surface}
                vehicles={claim.vehicles}
                impact={claim.impact}
                selected={null}
                lang={lang}
                lighting={lighting}
                interactive={false}
                poses={play.poses}
                mode={play.mode}
                clock={play.clock}
                className="h-[360px]"
              />
              {(play.canPlay || edit) && (
                <div className="absolute top-3 right-3 flex gap-1.5 print:hidden">
                  {play.canPlay && (
                    <button className="chip" onClick={play.playing ? play.stop : () => play.start()} aria-pressed={play.playing}>
                      {play.playing ? <Icon.stop /> : <Icon.play />} {play.playing ? t('scene.play.stop') : t('scene.play.start')}
                    </button>
                  )}
                  {play.canPlay && !play.playing && (
                    <button className="chip" onClick={() => play.start('cinematic')}>
                      <Icon.film /> {t('scene.play.watch')}
                    </button>
                  )}
                  {edit && <PlainViewChip lang={lang} />}
                </div>
              )}
            </div>
            <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-slate-50 px-4 py-2 text-xs text-slate-600">
              {claim.vehicles
                .filter((v) => v.position)
                .map((v) => (
                  <span key={v.id} className="inline-flex items-center gap-1.5">
                    <span className="size-2.5 rounded-sm" style={{ background: ROLE_COLOR[v.role] }} />
                    {v.id.toUpperCase()} · {vehicleOf(v, voice, lang)}
                  </span>
                ))}
              {claim.impact && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="grid size-3.5 place-items-center rounded-full bg-red-600 text-[8px] font-bold text-white">✕</span>
                  {t('scene.doc.whereHit')}
                </span>
              )}
              <span className="ml-auto">{t('scene.doc.routes')}</span>
            </figcaption>
          </figure>
        )}
        {voice !== 'customer' && claim.attachments.replay && <ReplayVideo src={claim.attachments.replay} lang={lang} />}
      </Part>

      {/* ── damage ──────────────────────────────────────────────── */}
      <Part title={t('scene.doc.damage')} edit={change('damage')}>
        {damaged.length === 0 ? (
          <p className="text-sm text-slate-400">{t('scene.doc.noDamage')}</p>
        ) : (
          <div className="space-y-4">
            {damaged.map((v) => (
              <div key={v.id} className="grid gap-4 overflow-hidden rounded-xl ring-1 ring-slate-900/10 sm:grid-cols-[340px_minmax(0,1fr)]">
                <div className="pointer-events-none h-44 bg-slate-100 sm:h-full">
                  <DamageMarker
                    ref={(h) => {
                      if (h) marks.current.set(v.id, h)
                      else marks.current.delete(v.id)
                    }}
                    vehicle={v.body}
                    paint={v.color}
                    lang={lang}
                    lighting={lighting}
                    // the desk may blend the damage away and back; the review page exports this
                    // canvas as evidence at send, so it always shows the marks in full
                    tools={voice !== 'customer'}
                    value={{ schema: SCHEMA, vehicle: v.body, damages: v.damages }}
                  />
                </div>
                <div className="p-4 pt-3 sm:pl-0">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                    <Tag v={v} />
                    {cap(vehicleOf(v, voice, lang))}
                  </div>
                  <Marks v={v} photos={photos} lang={lang} />
                </div>
              </div>
            ))}
          </div>
        )}

        {photos.length > 0 && (
          <div className="mt-5">
            <div className="mb-2 text-sm font-semibold">
              {t('scene.doc.photos')} <span className="font-normal text-slate-500">· {photos.length}</span>
            </div>
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {photos.map((p, i) => (
                <li key={i}>
                  <a href={p.data} target="_blank" rel="noreferrer" className="block">
                    <img src={p.data} alt={p.caption || t('scene.doc.photoAlt', { n: i + 1 })} className="aspect-square w-full rounded-lg object-cover ring-1 ring-slate-900/10" />
                  </a>
                  <span className="mt-1 block truncate text-[11px] text-slate-600">
                    {p.of && <span className="font-semibold">{p.of.toUpperCase()} · </span>}
                    {p.caption || <span className="text-slate-400">{t('scene.doc.noCaption')}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {mine && cond && (
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="mb-2 text-sm font-semibold">
                {t('scene.doc.now', { vehicle: cap(vehicleOf(mine, voice, lang)) })}
              </div>
              <Rows
                items={[
                  [t('scene.doc.drivable'), given(answered(cond.drivable, t('common.yes'), t('common.no')), lang)],
                  [t('scene.doc.airbags'), given(answered(cond.airbags, t('scene.doc.airbagsYes'), t('scene.doc.airbagsNo')), lang)],
                  [t('scene.doc.towed'), given(yesNo(cond.towed, lang), lang)],
                  [t('scene.doc.whereItIs'), given(cond.location, lang)],
                ]}
              />
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="mb-2 text-sm font-semibold">{t('scene.doc.otherProperty')}</div>
              {claim.property.description ? (
                <Rows items={[[t('scene.doc.damaged'), claim.property.description], [t('scene.doc.belongsTo'), given(claim.property.owner, lang)]]} />
              ) : (
                <p className="text-sm text-slate-500">{t('scene.doc.nothingElse')}</p>
              )}
            </div>
          </div>
        )}
      </Part>

      {/* ── who sent it: on the desk only; the customer fills this in below the document ── */}
      {!edit && (
        <Part title={t('scene.doc.reportedBy')}>
          <Rows
            items={[
              [t('scene.doc.name'), given(claim.reporter.name, lang)],
              [t('scene.doc.phone'), given(claim.reporter.phone, lang)],
              [t('scene.doc.email'), given(claim.reporter.email, lang)],
              [t('scene.doc.policy'), mono(claim.reporter.policy, lang)],
              [t('scene.doc.policyholder'), given(yesNo(claim.reporter.policyholder, lang), lang)],
              [
                t('scene.doc.signed'),
                given(
                  claim.attestation.agreed && claim.attestation.name
                    ? `${claim.attestation.name}${claim.attestation.at ? ` · ${when(claim.attestation.at, lang)}` : ''}`
                    : null,
                  lang,
                ),
              ],
            ]}
          />
        </Part>
      )}
    </article>
  )
}
