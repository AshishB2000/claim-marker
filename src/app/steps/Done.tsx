import { useClaim } from '../../claim/store'
import { toDocument } from '../../claim/schema'
import { Icon } from '../icons'

export function Done() {
  const claim = useClaim((s) => s.claim)
  const reset = useClaim((s) => s.reset)

  const download = () => {
    const doc = toDocument(claim)
    const a = document.createElement('a')
    a.download = `accident-report-${claim.reference}.json`
    a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(doc, null, 2))
    a.click()
  }

  return (
    <div className="mx-auto max-w-xl py-8 text-center">
      <span className="mx-auto grid size-16 place-items-center rounded-full bg-emerald-100 text-emerald-700">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      <h1 className="mt-5 text-3xl font-semibold tracking-tight">Your report is in</h1>
      <p className="mt-2 text-slate-500">Keep this reference. You will need it if you call about the claim.</p>
      <div className="card mx-auto mt-6 inline-block px-8 py-4">
        <div className="eyebrow">Reference</div>
        <div className="mt-1 font-mono text-3xl font-semibold tracking-wider">{claim.reference}</div>
      </div>

      <ol className="mx-auto mt-8 max-w-md space-y-3 text-left text-sm">
        {[
          'A claims handler reviews what you sent — the map, the vehicles and the damage you marked.',
          'If anything is unclear they will contact you, usually within one working day.',
          'You can arrange repairs once the claim is accepted.',
        ].map((t, i) => (
          <li key={i} className="flex gap-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-bold text-white">{i + 1}</span>
            <span className="text-slate-600">{t}</span>
          </li>
        ))}
      </ol>

      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <button className="btn btn-secondary" onClick={download}>
          <Icon.download /> Download a copy
        </button>
        <button className="btn btn-ghost" onClick={reset}>
          Report another accident
        </button>
      </div>
    </div>
  )
}
