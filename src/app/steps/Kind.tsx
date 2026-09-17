import type { ReactNode } from 'react'
import { useClaim } from '../../claim/store'
import { KINDS, type Kind } from '../../claim/schema'
import type { Key } from '../../i18n'
import { useT } from '../../i18n/useT'
import { Icon } from '../icons'

const ICON: Record<Kind, () => ReactNode> = {
  collision: Icon.collision,
  single: Icon.pole,
  parked: Icon.parked,
  theft: Icon.lock,
  vandalism: Icon.spray,
  weather: Icon.cloud,
  glass: Icon.glass,
  fire: Icon.flame,
}

/** the first question, because it decides which of the others are asked */
export function WhatHappened() {
  const kind = useClaim((s) => s.claim.incident.kind)
  const setKind = useClaim((s) => s.setKind)
  const t = useT()
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" role="radiogroup" aria-label={t('start.kind.group')}>
        {KINDS.map((k) => {
          const on = k === kind
          const I = ICON[k]
          return (
            <button
              key={k}
              role="radio"
              aria-checked={on}
              className={`card group flex flex-col items-start gap-3 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md sm:p-5 ${on ? 'ring-2 ring-brand-600' : ''}`}
              onClick={() => setKind(k)}
            >
              <span className={`grid size-11 place-items-center rounded-xl transition [&_svg]:size-6 ${on ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 group-hover:bg-brand-50 group-hover:text-brand-700'}`}>
                <I />
              </span>
              <span>
                <span className="block text-[15px] leading-snug font-semibold sm:text-base">{t(`kind.${k}.label` as Key)}</span>
                <span className="mt-1 block text-xs text-slate-500 sm:text-sm">{t(`kind.${k}.hint` as Key)}</span>
              </span>
            </button>
          )
        })}
      </div>
      <p className="mt-4 text-sm text-slate-500">{t('start.kind.note')}</p>
    </div>
  )
}
