import { useEffect, useState } from 'react'
import { useClaim, stepsFor, type Step } from '../claim/store'
import { KIND_INFO, type Claim } from '../claim/schema'
import { config, tell } from '../config'
import { LANGS, type Key, type Vars } from '../i18n'
import { useLang, useT } from '../i18n/useT'
import { assistOn } from '../assist/client'
import { useNarrow } from './narrow'
import { Icon } from './icons'
import { WhatHappened } from './steps/Kind'
import { Where } from './steps/Where'
import { Vehicles } from './steps/Vehicles'
import { People } from './steps/People'
import { Diagram } from './steps/Diagram'
import { Damage } from './steps/Damage'
import { Review } from './steps/Review'
import { Done } from './steps/Done'

type T = (key: Key, vars?: Vars) => string

/** which of the headings a step shows: some steps have a second one for a kind with no other party */
function headingKey(step: Step, claim: Claim): string {
  const kind = claim.incident.kind
  if (step === 'vehicles') return KIND_INFO[kind].others ? 'vehicles' : 'vehicles.one'
  if (step === 'scene') return kind === 'collision' ? 'scene.collision' : kind === 'parked' ? 'scene.parked' : 'scene.other'
  return step
}

const heading = (step: Step, claim: Claim, t: T, photoFirst: boolean): { title: string; lead: string } => {
  const id = headingKey(step, claim)
  return {
    title: t(`shell.head.${id}.title` as Key),
    // when the camera leads the damage step, "tap the car" is the wrong first instruction
    lead: step === 'damage' && photoFirst ? t('damage.head.lead') : t(`shell.head.${id}.lead` as Key),
  }
}

/** what has to be true before the customer can leave a step */
function ready(step: Step, claim: Claim, t: T): string | null {
  if (step === 'where' && !claim.incident.location) return t('shell.need.where')
  return null
}

export function App() {
  const step = useClaim((s) => s.step)
  const claim = useClaim((s) => s.claim)
  const goto = useClaim((s) => s.goto)
  const next = useClaim((s) => s.next)
  const back = useClaim((s) => s.back)
  const reset = useClaim((s) => s.reset)
  const setLang = useClaim((s) => s.setLang)
  const lang = useLang()
  const t = useT()
  // the other driver is answering about someone else's accident, and is told so once
  const party = claim.reporter.party === 'other_party'
  // the damage step puts the camera first on a phone with the assistant on, and says so
  const narrow = useNarrow()
  const photoFirst = narrow && assistOn()
  const [done, setDone] = useState(!!claim.reference)

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [step, done])

  const steps = stepsFor(claim.incident.kind)
  const index = steps.indexOf(step)

  // the host page follows along: which step, and how tall the page is so its iframe can fit
  useEffect(() => {
    tell('step', { step: done ? 'done' : step, index: done ? steps.length + 1 : index + 1, count: steps.length })
  }, [step, done, index, steps.length])
  useEffect(() => {
    if (!config.embedded) return
    const ro = new ResizeObserver(() => tell('height', { height: document.documentElement.scrollHeight }))
    ro.observe(document.body)
    return () => ro.disconnect()
  }, [])
  const blocker = ready(step, claim, t)
  const { title, lead } = heading(step, claim, t, photoFirst)

  return (
    <div className={config.embedded ? 'pb-4' : 'min-h-screen pb-28'}>
      <header className={`z-30 border-b border-slate-200/70 bg-white/85 backdrop-blur ${config.embedded ? '' : 'sticky top-0'}`}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-brand-600 text-white shadow-[0_6px_16px_-6px_rgba(31,86,230,0.7)]">
              <Icon.car />
            </span>
            <div className="leading-tight">
              <div className="text-[15px] font-semibold">{t(party ? 'shell.title.party' : 'shell.title')}</div>
              <div className="text-xs text-slate-500">{config.brand}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* the switch is the customer's, unless the host fixed the language for them */}
            {!config.lang && (
              <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5" role="group" aria-label={t('shell.lang.label')}>
                {LANGS.map((l) => (
                  <button
                    key={l}
                    className={`rounded-md px-2 py-1 text-xs font-semibold ${l === lang ? 'bg-white text-ink shadow-sm' : 'text-slate-500 hover:text-ink'}`}
                    aria-label={t(`shell.lang.${l}` as Key)}
                    aria-pressed={l === lang}
                    onClick={() => setLang(l)}
                  >
                    {l.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
            {!done && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  if (window.confirm(t('shell.startOver.confirm'))) reset()
                }}
              >
                {t('shell.startOver')}
              </button>
            )}
          </div>
        </div>
        {!done && (
          <div className="mx-auto max-w-6xl px-5 pb-3">
            <ol className="flex gap-2">
              {steps.map((s, i) => {
                const state = i < index ? 'done' : i === index ? 'current' : 'todo'
                return (
                  <li key={s} className="min-w-0 flex-1">
                    <button
                      className="group flex w-full items-center gap-2 text-left disabled:cursor-default"
                      disabled={state === 'todo'}
                      onClick={() => goto(s)}
                      aria-current={state === 'current' ? 'step' : undefined}
                    >
                      <span
                        className={`grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                          state === 'done'
                            ? 'bg-emerald-500 text-white'
                            : state === 'current'
                              ? 'bg-brand-600 text-white ring-4 ring-brand-100'
                              : 'bg-slate-200 text-slate-500'
                        }`}
                      >
                        {state === 'done' ? <Icon.check /> : i + 1}
                      </span>
                      <span className={`hidden truncate text-xs sm:block ${state === 'current' ? 'font-semibold' : 'text-slate-500'}`}>
                        {t(`step.${s}` as Key)}
                      </span>
                    </button>
                    <div className={`mt-2 h-1 rounded-full ${state === 'todo' ? 'bg-slate-200' : 'bg-brand-600'}`} />
                  </li>
                )
              })}
            </ol>
            <p className="mt-2 text-xs text-slate-500 sm:hidden">
              <span className="font-semibold text-ink">{t('shell.progress', { n: index + 1, count: steps.length })}</span>
              {' · '}
              {t(`step.${step}` as Key)}
            </p>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-5 pt-8">
        {done ? (
          <Done />
        ) : (
          <>
            <div key={step} className="step-enter">
              <div className="mb-6">
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
                <p className="mt-1 text-slate-500">{lead}</p>
              </div>
              {step === 'kind' && <WhatHappened />}
              {step === 'where' && <Where />}
              {step === 'vehicles' && <Vehicles />}
              {step === 'people' && <People />}
              {step === 'scene' && <Diagram />}
              {step === 'damage' && <Damage />}
              {step === 'review' && <Review onSubmitted={() => setDone(true)} />}
            </div>
          </>
        )}
      </main>

      {!done && step !== 'review' && (
        <footer className={`z-30 border-t border-slate-200/70 bg-white/90 backdrop-blur ${config.embedded ? 'mt-8' : 'fixed inset-x-0 bottom-0'}`}>
          {blocker && <p className="pt-2 text-center text-xs text-slate-500 sm:hidden">{blocker}</p>}
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-3">
            <button className="btn btn-ghost" onClick={back} disabled={index === 0}>
              <Icon.back /> {t('common.back')}
            </button>
            <div className="flex items-center gap-3">
              {blocker && <span className="hidden text-sm text-slate-500 sm:block">{blocker}</span>}
              <button className="btn btn-primary" onClick={next} disabled={!!blocker}>
                {t('common.continue')} <Icon.next />
              </button>
            </div>
          </div>
        </footer>
      )}
      {!done && (
        <p className="mx-auto mt-10 max-w-6xl px-5 text-center text-xs text-slate-400">{t('shell.saved')}</p>
      )}
    </div>
  )
}
