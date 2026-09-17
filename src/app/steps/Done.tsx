import { useClaim } from '../../claim/store'
import { toDocument } from '../../claim/schema'
import { useT } from '../../i18n/useT'
import { Icon } from '../icons'

export function Done() {
  const claim = useClaim((s) => s.claim)
  const delivery = useClaim((s) => s.delivery)
  const reset = useClaim((s) => s.reset)
  const t = useT()
  const queued = delivery === 'queued'

  const download = () => {
    const doc = toDocument(claim)
    const a = document.createElement('a')
    a.download = `accident-report-${claim.reference}.json`
    a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(doc, null, 2))
    a.click()
  }

  return (
    <div className="mx-auto max-w-xl py-8 text-center">
      <span className={`mx-auto grid size-16 place-items-center rounded-full ${queued ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          {queued ? <path d="M12 6v6l4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" /> : <path d="M20 6 9 17l-5-5" />}
        </svg>
      </span>
      <h1 className="mt-5 text-3xl font-semibold tracking-tight">{t(queued ? 'shell.done.queued.title' : 'shell.done.sent.title')}</h1>
      <p className="mt-2 text-slate-500">{t(queued ? 'shell.done.queued.lead' : 'shell.done.sent.lead')}</p>
      <div className="card mx-auto mt-6 inline-block px-8 py-4">
        <div className="eyebrow">{t(queued ? 'shell.done.queued.ref' : 'shell.done.ref')}</div>
        <div className="mt-1 font-mono text-3xl font-semibold tracking-wider">{claim.reference}</div>
      </div>

      <ol className="mx-auto mt-8 max-w-md space-y-3 text-left text-sm">
        {(['shell.done.next1', 'shell.done.next2', 'shell.done.next3'] as const).map((key, i) => (
          <li key={key} className="flex gap-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-bold text-white">{i + 1}</span>
            <span className="text-slate-600">{t(key)}</span>
          </li>
        ))}
      </ol>

      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <button className="btn btn-secondary" onClick={download}>
          <Icon.download /> {t('shell.done.download')}
        </button>
        <button className="btn btn-ghost" onClick={reset}>
          {t('shell.done.again')}
        </button>
      </div>
    </div>
  )
}
