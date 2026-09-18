/**
 * "Just tell us what happened" — one account, spoken or typed, that proposes the whole first
 * screen at once. Everything it produces is a **proposal, never an entry**: the customer sees
 * exactly what was understood, row by row, and ticks off what to keep before any of it lands
 * in the claim. `applyIntake` in the store does the actual filling; this component only reads
 * the account, shows the proposal, and carries the customer's ticks back to it.
 *
 * The dictation button uses the same recogniser as the statement box (`src/app/speech.ts`).
 */
import { useEffect, useRef, useState } from 'react'
import { assistOn, intake } from '../../assist/client'
import type { IntakeDraft } from '../../assist/schema'
import { conditionLabels, namedVehicle, vehicleName } from '../../claim/describe'
import type { ClaimVehicle } from '../../claim/schema'
import { useClaim, type IntakeTake } from '../../claim/store'
import { plural, type Key, type Lang, type Vars } from '../../i18n'
import { useLang, useT } from '../../i18n/useT'
import { PAINTS } from '../../vehicles/paint'
import { Icon } from '../icons'
import { Speech, speechTag, type Recognizer } from '../speech'

type T = (key: Key, vars?: Vars) => string
type DraftVehicle = NonNullable<IntakeDraft['vehicles']>[number]
type DraftPeople = NonNullable<IntakeDraft['people']>

const formatWhen = (at: string, lang: Lang) => {
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? at : d.toLocaleString(lang === 'es' ? 'es' : undefined, { dateStyle: 'long', timeStyle: 'short' })
}

/** the label beside a proposed vehicle's checkbox: named first, then shape and colour, then just which side it is */
const draftVehicleLabel = (dv: DraftVehicle, lang: Lang, t: T): string => {
  const named = namedVehicle(dv, lang)
  if (named) return named
  const hex = dv.color ? PAINTS.find((p) => p.id === dv.color)?.hex : undefined
  if (dv.body && hex) return vehicleName({ body: dv.body, color: hex, make: '', model: '', year: null } as ClaimVehicle, lang)
  return t(dv.role === 'insured' ? 'start.intake.vehicle.insured' : 'start.intake.vehicle.other')
}

/** "who was hurt" as a count, from i18n — never the model's own words about an injury */
const hurtLine = (people: DraftPeople, t: T): string => {
  const n = people.filter((p) => p.injured).length
  return n === 0 ? t('start.intake.hurt.none') : t(plural(n, 'start.intake.hurt.one', 'start.intake.hurt.other'), { n })
}

const allTicked = (draft: IntakeDraft): IntakeTake => ({
  kind: true,
  when: true,
  place: true,
  conditions: true,
  vehicles: (draft.vehicles ?? []).map(() => true),
  people: true,
  police: true,
  property: true,
})

/** one proposed row: a checkbox and what it would fill in, ticked by default */
function IntakeRow({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  )
}

type Result = { draft: IntakeDraft; take: IntakeTake; transcript: string }

export function Intake() {
  const applyIntake = useClaim((s) => s.applyIntake)
  const goto = useClaim((s) => s.goto)
  const lang = useLang()
  const t = useT()

  const [text, setText] = useState('')
  const [listening, setListening] = useState(false)
  const rec = useRef<Recognizer | null>(null)
  const base = useRef('')
  useEffect(() => () => rec.current?.stop(), [])

  const [sending, setSending] = useState(false)
  const [quiet, setQuiet] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  const toggleListen = () => {
    if (listening) {
      rec.current?.stop()
      return
    }
    if (!Speech) return
    const r = new Speech()
    r.lang = speechTag(lang)
    r.continuous = true
    r.interimResults = true
    base.current = text.replace(/\s+$/, '')
    r.onresult = (e) => {
      let said = ''
      for (let i = 0; i < e.results.length; i++) said += e.results[i][0].transcript
      said = said.trim()
      setText(base.current ? `${base.current} ${said}` : said)
    }
    r.onend = () => {
      setListening(false)
      rec.current = null
    }
    r.onerror = r.onend
    rec.current = r
    setListening(true)
    r.start()
  }

  const send = async () => {
    setSending(true)
    setQuiet(null)
    try {
      const draft = await intake(text, lang)
      if (Object.keys(draft).length === 0) setQuiet(t('start.intake.failed'))
      else setResult({ draft, take: allTicked(draft), transcript: text })
    } catch {
      // a failing endpoint falls straight back to the kind cards below, quietly — never a dialog
      setQuiet(t('start.intake.failed'))
    } finally {
      setSending(false)
    }
  }

  const use = () => {
    if (!result) return
    applyIntake(result.draft, result.take, result.transcript)
    setResult(null)
    goto('where')
  }

  if (!assistOn()) return null

  const setTake = (patch: Partial<IntakeTake>) => setResult((r) => (r ? { ...r, take: { ...r.take, ...patch } } : r))
  const setVehicleTake = (i: number, v: boolean) =>
    setResult((r) => (r ? { ...r, take: { ...r.take, vehicles: r.take.vehicles.map((x, j) => (j === i ? v : x)) } } : r))

  return (
    <div className="card mb-5 p-4">
      <h2 className="eyebrow">{t('start.intake.title')}</h2>
      <p className="mt-1 text-sm text-slate-500">{t('start.intake.lead')}</p>

      {!result && (
        <>
          <textarea
            className="input mt-3 min-h-24"
            placeholder={t('start.intake.placeholder')}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {Speech && (
              <button className={`btn btn-sm ${listening ? 'bg-red-600 text-white hover:bg-red-500' : 'btn-secondary'}`} onClick={toggleListen} aria-pressed={listening}>
                {listening ? <span className="size-2 animate-pulse rounded-full bg-white" /> : <Icon.mic />}
                {listening ? t('shell.describe.listening') : t('shell.describe.say')}
              </button>
            )}
            <button className="btn btn-primary btn-sm" onClick={send} disabled={sending || !text.trim()}>
              {sending ? <Icon.spinner /> : <Icon.wand />}
              {sending ? t('start.intake.sending') : t('start.intake.send')}
            </button>
          </div>
          {quiet && <p className="mt-2 text-sm text-slate-500">{quiet}</p>}
        </>
      )}

      {result && (
        <div className="mt-3">
          <h3 className="font-semibold">{t('start.intake.review.title')}</h3>
          <p className="mt-0.5 text-sm text-slate-500">{t('start.intake.review.lead')}</p>
          <div className="mt-3 space-y-1.5">
            {result.draft.kind && (
              <IntakeRow checked={result.take.kind} onChange={(v) => setTake({ kind: v })}>
                {t(`kind.${result.draft.kind}.label` as Key)}
              </IntakeRow>
            )}
            {result.draft.when && (
              <IntakeRow checked={result.take.when} onChange={(v) => setTake({ when: v })}>
                {formatWhen(result.draft.when, lang)}
              </IntakeRow>
            )}
            {result.draft.place && (
              <IntakeRow checked={result.take.place} onChange={(v) => setTake({ place: v })}>
                {t('start.intake.place', { place: result.draft.place })}
              </IntakeRow>
            )}
            {result.draft.vehicles?.map((dv, i) => (
              <IntakeRow key={i} checked={result.take.vehicles[i] ?? false} onChange={(v) => setVehicleTake(i, v)}>
                {draftVehicleLabel(dv, lang, t)}
              </IntakeRow>
            ))}
            {!!result.draft.people?.length && (
              <IntakeRow checked={result.take.people} onChange={(v) => setTake({ people: v })}>
                {hurtLine(result.draft.people, t)}
              </IntakeRow>
            )}
            {result.draft.police && (
              <IntakeRow checked={result.take.police} onChange={(v) => setTake({ police: v })}>
                {t(result.draft.police.called ? 'start.intake.police.yes' : 'start.intake.police.no')}
              </IntakeRow>
            )}
            {result.draft.conditions && (
              <IntakeRow checked={result.take.conditions} onChange={(v) => setTake({ conditions: v })}>
                {conditionLabels(
                  { weather: result.draft.conditions.weather ?? '', road: result.draft.conditions.road ?? '', light: result.draft.conditions.light ?? '' },
                  lang,
                ).join(', ')}
              </IntakeRow>
            )}
            {result.draft.property && (
              <IntakeRow checked={result.take.property} onChange={(v) => setTake({ property: v })}>
                {t('start.intake.property')}
              </IntakeRow>
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <button className="btn btn-primary btn-sm" onClick={use}>
              {t('start.intake.use')}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setResult(null)}>
              {t('start.intake.again')}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">{t('start.intake.ai')}</p>
        </div>
      )}
    </div>
  )
}
