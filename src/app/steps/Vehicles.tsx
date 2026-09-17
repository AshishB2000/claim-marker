import { useEffect, useState } from 'react'
import { useClaim, insuredOf, othersOf } from '../../claim/store'
import { KIND_INFO, ROLE_COLOR, type ClaimVehicle } from '../../claim/schema'
import { isVehicle, type Vehicle } from '../../zones'
import { BODY_ORDER } from '../../vehicles/bodies'
import { FALLBACK, MAKES, OTHER, YEARS, decodeVin, guessBody, isVin, modelsFor, type Decoded } from '../../vehicles/catalog'
import { namedVehicle, ownerLabel, vehicleName } from '../../claim/describe'
import { policyVehicleLabel, type PrefillVehicle } from '../../claim/prefill'
import { PAINTS, paintId } from '../../vehicles/paint'
import { BodyPreview } from '../../vehicles/BodyPreview'
import { VehiclePhoto } from '../VehiclePhoto'
import { Field, Section } from '../ui'
import { Icon } from '../icons'
import { plural, type Key } from '../../i18n'
import { useLang, useT } from '../../i18n/useT'

const BODIES = BODY_ORDER.filter(isVehicle) as Vehicle[]

/** a hex back to its paint id, so the colour is named from the shared vocabulary; anything else is "custom" */
/** the model list for a make and year, live from the vehicle database with a bundled fallback */
function useModels(make: string, year: number | null) {
  const [state, setState] = useState<{ key: string; models: string[]; offline: boolean }>({ key: '', models: [], offline: false })
  const key = make ? `${make}|${year ?? ''}` : ''

  useEffect(() => {
    if (!make) return
    const ac = new AbortController()
    const wanted = `${make}|${year ?? ''}`
    modelsFor(make, year ?? new Date().getFullYear(), ac.signal)
      .then((models) => {
        if (!ac.signal.aborted) setState({ key: wanted, models, offline: false })
      })
      .catch(() => {
        if (!ac.signal.aborted) setState({ key: wanted, models: FALLBACK[make] ?? [], offline: true })
      })
    return () => ac.abort()
  }, [make, year])

  return { models: state.key === key ? state.models : [], loading: !!key && state.key !== key, offline: state.key === key && state.offline }
}

/** the VIN says a different make, model or year from the one the customer picked; a blank answers to anything */
const disagrees = (v: ClaimVehicle, d: Decoded) =>
  (!!v.make && v.make.toLowerCase() !== d.make.toLowerCase()) ||
  (!!v.model && !!d.model && v.model.toLowerCase() !== d.model.toLowerCase()) ||
  (!!v.year && !!d.year && v.year !== d.year)

/** take the VIN's word: make, model, year, and the shape unless damage is already marked on the current one */
function takeVin(id: string, d: Decoded) {
  const { claim, updateVehicle, setBody } = useClaim.getState()
  const cur = claim.vehicles.find((x) => x.id === id)
  updateVehicle(id, { make: d.make, model: d.model || cur?.model || '', year: d.year ?? cur?.year ?? null })
  if (d.body && cur && cur.damages.length === 0) setBody(id, d.body)
}

function VehicleCard({ vehicle: v }: { vehicle: ClaimVehicle }) {
  const updateVehicle = useClaim((s) => s.updateVehicle)
  const setBody = useClaim((s) => s.setBody)
  const removeVehicle = useClaim((s) => s.removeVehicle)
  const t = useT()
  const lang = useLang()
  const mine = v.role === 'insured'
  const { models, loading, offline } = useModels(v.make, v.year)
  // "Other" turns the model dropdown into a box to type in
  const [typing, setTyping] = useState(false)
  const listed = models.includes(v.model)

  // A full VIN is looked up in the vehicle database and fills in the make, model, year and
  // shape. What the customer already chose is never overwritten: a VIN that says otherwise
  // is pointed out instead, with one tap to take its word. `of` lags behind the key while
  // the lookup runs; a database that cannot be reached says nothing.
  const [vin, setVin] = useState<{ of: string; found: Decoded | null; failed?: boolean }>({ of: '', found: null })
  const vinKey = isVin(v.vin) ? v.vin.trim().toUpperCase() : ''
  useEffect(() => {
    if (!vinKey) return
    const ac = new AbortController()
    decodeVin(vinKey, ac.signal)
      .then((d) => {
        if (ac.signal.aborted) return
        setVin({ of: vinKey, found: d })
        const cur = useClaim.getState().claim.vehicles.find((x) => x.id === v.id)
        if (d && cur && !disagrees(cur, d)) takeVin(v.id, d)
      })
      .catch(() => {
        if (!ac.signal.aborted) setVin({ of: vinKey, found: null, failed: true })
      })
    return () => ac.abort()
  }, [vinKey, v.id])
  const vinNote = !vinKey ? null : vin.of !== vinKey ? 'busy' : vin.failed ? null : !vin.found ? 'unknown' : disagrees(v, vin.found) ? 'differs' : 'done'

  const chooseModel = (model: string) => {
    if (model === OTHER) {
      setTyping(true)
      updateVehicle(v.id, { model: '' })
      return
    }
    setTyping(false)
    updateVehicle(v.id, { model })
    // the closest 3D shape, unless damage has already been marked on the current one
    const body = guessBody(model)
    if (body && body !== v.body && v.damages.length === 0) setBody(v.id, body)
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="grid size-8 place-items-center rounded-lg text-sm font-bold text-white" style={{ background: ROLE_COLOR[v.role] }}>
            {v.id.toUpperCase()}
          </span>
          <div>
            <div className="font-semibold">{ownerLabel(v, 'customer', lang)}</div>
            <div className="text-xs text-slate-500">{t(mine ? 'start.vehicles.onPolicy' : 'start.vehicles.asYouCanTell')}</div>
          </div>
        </div>
        {!mine && (
          <button className="btn btn-ghost btn-sm" onClick={() => removeVehicle(v.id)} aria-label={t('start.vehicles.remove', { id: v.id.toUpperCase() })}>
            <Icon.x /> {t('common.remove')}
          </button>
        )}
      </div>

      <div className="grid gap-5 p-5 sm:grid-cols-[280px_minmax(0,1fr)]">
        <div className="relative h-56 overflow-hidden rounded-xl bg-gradient-to-b from-slate-100 to-slate-200/80 ring-1 ring-slate-900/[0.06] sm:h-full sm:min-h-56">
          {/* the real car in a photograph once make and model are known; the 3D shape until then */}
          <VehiclePhoto vehicle={v} lang={lang} credit contain className="absolute inset-0" fallback={<BodyPreview body={v.body} paint={v.color} className="!absolute inset-0" />} />
          <span className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-slate-600 backdrop-blur">
            <span className="size-2.5 rounded-full ring-1 ring-black/10" style={{ background: v.color }} />
            {namedVehicle(v, lang) || t(`body.${v.body}` as Key)} · {t(`paint.${paintId(v.color)}` as Key)}
          </span>
        </div>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1.1fr_1.4fr_0.8fr]">
            <Field label={t('start.vehicles.make')}>
              <select className="input" aria-label={t('start.vehicles.make')} value={v.make} onChange={(e) => updateVehicle(v.id, { make: e.target.value, model: '' })}>
                <option value="">{t('start.vehicles.select')}</option>
                {MAKES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t(loading ? 'start.vehicles.modelLoading' : offline ? 'start.vehicles.modelOffline' : 'start.vehicles.model')}>
              {typing || (v.model && !listed && !loading && v.make) ? (
                <div className="flex gap-1.5">
                  <input className="input" aria-label={t('start.vehicles.model')} placeholder={t('start.vehicles.typeModel')} value={v.model} onChange={(e) => updateVehicle(v.id, { model: e.target.value })} autoFocus={typing} />
                  <button
                    className="btn btn-ghost btn-sm shrink-0"
                    onClick={() => {
                      setTyping(false)
                      updateVehicle(v.id, { model: '' })
                    }}
                    aria-label={t('start.vehicles.backToList')}
                  >
                    <Icon.x />
                  </button>
                </div>
              ) : (
                <select className="input" aria-label={t('start.vehicles.model')} value={v.model} disabled={!v.make || loading} onChange={(e) => chooseModel(e.target.value)}>
                  <option value="">{t(!v.make ? 'start.vehicles.makeFirst' : loading ? 'start.vehicles.loading' : 'start.vehicles.select')}</option>
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                  {v.make && !loading && <option value={OTHER}>{t('start.vehicles.otherModel')}</option>}
                </select>
              )}
            </Field>
            <Field label={t('start.vehicles.year')}>
              <select className="input" aria-label={t('start.vehicles.year')} value={v.year ?? ''} onChange={(e) => updateVehicle(v.id, { year: e.target.value ? Number(e.target.value) : null })}>
                <option value="">{t('start.vehicles.year')}</option>
                {YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div>
            <span className="label">{t('start.vehicles.shape')}</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('start.vehicles.bodyType')}>
              {BODIES.map((b) => (
                <button key={b} className="chip" role="radio" aria-checked={v.body === b} aria-pressed={v.body === b} onClick={() => setBody(v.id, b)}>
                  {t(`body.${b}` as Key)}
                </button>
              ))}
            </div>
            {v.damages.length > 0 && <p className="mt-1.5 text-xs text-amber-700">{t('start.vehicles.shapeClears')}</p>}
          </div>

          <div>
            <span className="label">{t('start.vehicles.colour')}</span>
            <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label={t('start.vehicles.colour')}>
              {PAINTS.map((p) => (
                <button
                  key={p.id}
                  className="swatch"
                  style={{ background: p.hex }}
                  role="radio"
                  aria-checked={v.color === p.hex}
                  aria-pressed={v.color === p.hex}
                  aria-label={t(`paint.${p.id}` as Key)}
                  title={t(`paint.${p.id}` as Key)}
                  onClick={() => updateVehicle(v.id, { color: p.hex })}
                />
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_0.6fr_1.6fr]">
            <Field label={t('start.vehicles.plate')}>
              <input className="input uppercase" aria-label={t('start.vehicles.plate')} placeholder="ABC 123" value={v.plate} onChange={(e) => updateVehicle(v.id, { plate: e.target.value })} autoComplete="off" />
            </Field>
            <Field label={t('start.vehicles.state')}>
              <input className="input uppercase" aria-label={t('start.vehicles.plateState')} placeholder="NY" maxLength={3} value={v.plateState} onChange={(e) => updateVehicle(v.id, { plateState: e.target.value })} autoComplete="off" />
            </Field>
            <Field label={t(mine ? 'start.vehicles.vinMine' : 'start.vehicles.vinOther')}>
              <div className="relative">
                <input className="input pr-9 uppercase font-mono" aria-label="VIN" placeholder={t('start.vehicles.vinLength')} maxLength={17} value={v.vin} onChange={(e) => updateVehicle(v.id, { vin: e.target.value })} autoComplete="off" />
                {vinNote === 'busy' && (
                  <span className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-400">
                    <Icon.spinner />
                  </span>
                )}
                {vinNote === 'done' && (
                  <span className="absolute top-1/2 right-3 -translate-y-1/2 text-emerald-600">
                    <Icon.check />
                  </span>
                )}
              </div>
              {vinNote === 'done' && <span className="mt-1 block text-xs text-emerald-700">{t('start.vehicles.vinDone')}</span>}
              {vinNote === 'unknown' && <span className="mt-1 block text-xs text-slate-500">{t('start.vehicles.vinUnknown')}</span>}
              {vinNote === 'differs' && vin.found && (
                <span className="mt-1 block text-xs text-amber-800">
                  {t('start.vehicles.vinDiffers', {
                    found: namedVehicle(vin.found, lang),
                    chosen: vehicleName(v, lang),
                  })}{' '}
                  <button className="font-semibold underline underline-offset-2" onClick={() => takeVin(v.id, vin.found!)}>
                    {t('start.vehicles.vinTake')}
                  </button>
                  .
                </span>
              )}
            </Field>
          </div>
        </div>
      </div>
    </div>
  )
}

/** is this card already the policy vehicle: by VIN, else plate, else make and model */
const isPolicyVehicle = (v: ClaimVehicle, p: PrefillVehicle) =>
  p.vin ? v.vin.toUpperCase() === p.vin : p.plate ? v.plate.toUpperCase() === p.plate : !!p.make && v.make === p.make && v.model === (p.model ?? '')

export function Vehicles() {
  const claim = useClaim((s) => s.claim)
  const policy = useClaim((s) => s.policy)
  const pickPolicyVehicle = useClaim((s) => s.pickPolicyVehicle)
  const addVehicle = useClaim((s) => s.addVehicle)
  const removeVehicle = useClaim((s) => s.removeVehicle)
  const mine = insuredOf(claim)
  const others = othersOf(claim)
  const info = KIND_INFO[claim.incident.kind]
  const t = useT()
  const lang = useLang()

  return (
    <div>
      <Section
        title={ownerLabel(mine, 'customer', lang)}
        hint={t(policy.length > 1 ? 'start.vehicles.minePick' : 'start.vehicles.mineHint')}
      >
        {policy.length > 1 && (
          <div className="mb-3 flex flex-wrap gap-2" role="radiogroup" aria-label={t('start.vehicles.whichOfYours')}>
            {policy.map((p, i) => {
              const on = isPolicyVehicle(mine, p)
              return (
                <button key={i} className="seg" role="radio" aria-checked={on} aria-pressed={on} onClick={() => pickPolicyVehicle(i)}>
                  {p.color && <span className="mr-2 inline-block size-3 rounded-full ring-1 ring-black/10" style={{ background: p.color }} />}
                  {policyVehicleLabel(p, lang)}
                </button>
              )
            })}
          </div>
        )}
        <VehicleCard vehicle={mine} />
      </Section>

      {info.others && (
      <Section
        title={
          others.length === 0
            ? t(claim.incident.kind === 'parked' ? 'start.vehicles.sawIt' : 'start.vehicles.anyoneElse')
            : t(plural(others.length, 'start.vehicles.others.one', 'start.vehicles.others.other'))
        }
        hint={t(
          others.length === 0
            ? claim.incident.kind === 'parked'
              ? 'start.vehicles.parkedHint'
              : 'start.vehicles.othersHint'
            : 'start.vehicles.othersMore',
        )}
        action={
          <button className="btn btn-secondary btn-sm" onClick={addVehicle} disabled={claim.vehicles.length >= 6}>
            <Icon.plus /> {t('start.vehicles.add')}
          </button>
        }
      >
        <div className="space-y-4">
          {others.map((v) => (
            <VehicleCard key={v.id} vehicle={v} />
          ))}
          {others.length > 0 && (
            <button className="text-sm text-slate-500 underline-offset-2 hover:underline" onClick={() => others.forEach((v) => removeVehicle(v.id))}>
              {t(claim.incident.kind === 'parked' ? 'start.vehicles.parkedNone' : 'start.vehicles.onlyMine')}
            </button>
          )}
        </div>
      </Section>
      )}
    </div>
  )
}
