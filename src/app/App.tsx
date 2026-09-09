import { useEffect, useState } from 'react'
import { useClaim, STEP_TITLE, stepsFor, type Step } from '../claim/store'
import { KIND_INFO, type Claim } from '../claim/schema'
import { BRAND } from './submit'
import { Icon } from './icons'
import { WhatHappened } from './steps/Kind'
import { Where } from './steps/Where'
import { Vehicles } from './steps/Vehicles'
import { People } from './steps/People'
import { Diagram } from './steps/Diagram'
import { Damage } from './steps/Damage'
import { Review } from './steps/Review'
import { Done } from './steps/Done'

function heading(step: Step, claim: Claim): { title: string; lead: string } {
  const kind = claim.incident.kind
  switch (step) {
    case 'kind':
      return { title: 'What happened?', lead: 'Start with the kind of thing it was.' }
    case 'where':
      return { title: 'Where and when did it happen?', lead: 'Find the spot on the map. The next steps happen right there.' }
    case 'vehicles':
      return KIND_INFO[kind].others
        ? { title: 'Which vehicles were involved?', lead: 'Yours first, then anyone else’s. Closest type and colour is fine.' }
        : { title: 'Which vehicle is it?', lead: 'The one on your policy. Closest type and colour is fine.' }
    case 'people':
      return { title: 'Who was there, and was anyone hurt?', lead: 'Drivers, passengers, witnesses, the police. Only what you know.' }
    case 'scene':
      return kind === 'collision'
        ? { title: 'Show us what happened', lead: 'Put the vehicles where they ended up and draw where they came from.' }
        : kind === 'parked'
          ? { title: 'Show us where it was', lead: 'Put your car where it was parked and, if you saw it, where the other vehicle came from.' }
          : { title: 'Show us what happened', lead: 'Put your car where it ended up, draw where it came from, and tap where it hit.' }
    case 'damage':
      return { title: 'Where is the damage?', lead: 'Tap the car where it is damaged, say how bad it is, and add photos if you have them.' }
    case 'review':
      return { title: 'Check it over', lead: 'This is what we will receive. Edit anything that is not right, then confirm and send.' }
  }
}

/** what has to be true before the customer can leave a step */
function ready(step: Step, claim: Claim): string | null {
  if (step === 'where' && !claim.incident.location) return 'Choose where it happened first'
  return null
}

export function App() {
  const step = useClaim((s) => s.step)
  const claim = useClaim((s) => s.claim)
  const goto = useClaim((s) => s.goto)
  const next = useClaim((s) => s.next)
  const back = useClaim((s) => s.back)
  const reset = useClaim((s) => s.reset)
  const [done, setDone] = useState(!!claim.reference)

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [step, done])

  const steps = stepsFor(claim.incident.kind)
  const index = steps.indexOf(step)
  const blocker = ready(step, claim)
  const { title, lead } = heading(step, claim)

  return (
    <div className="min-h-screen pb-28">
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-brand-600 text-white shadow-[0_6px_16px_-6px_rgba(31,86,230,0.7)]">
              <Icon.car />
            </span>
            <div className="leading-tight">
              <div className="text-[15px] font-semibold">Report an accident</div>
              <div className="text-xs text-slate-500">{BRAND}</div>
            </div>
          </div>
          {!done && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                if (window.confirm('Start over? Everything you have entered will be cleared.')) reset()
              }}
            >
              Start over
            </button>
          )}
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
                        {STEP_TITLE[s]}
                      </span>
                    </button>
                    <div className={`mt-2 h-1 rounded-full ${state === 'todo' ? 'bg-slate-200' : 'bg-brand-600'}`} />
                  </li>
                )
              })}
            </ol>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-5 pt-8">
        {done ? (
          <Done />
        ) : (
          <>
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
          </>
        )}
      </main>

      {!done && step !== 'review' && (
        <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/70 bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-3">
            <button className="btn btn-ghost" onClick={back} disabled={index === 0}>
              <Icon.back /> Back
            </button>
            <div className="flex items-center gap-3">
              {blocker && <span className="hidden text-sm text-slate-500 sm:block">{blocker}</span>}
              <button className="btn btn-primary" onClick={next} disabled={!!blocker}>
                Continue <Icon.next />
              </button>
            </div>
          </div>
        </footer>
      )}
      <p className="mx-auto mt-10 max-w-6xl px-5 text-center text-xs text-slate-400">
        Your progress is saved on this device until you send the report.
      </p>
    </div>
  )
}
