import type { ReactNode } from 'react'
import { Icon } from './icons'

export function Section({ title, hint, action, children }: { title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {hint && <p className="mt-0.5 text-sm text-slate-500">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className ?? ''}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-500">
      <Icon.spinner /> {label}
    </span>
  )
}

/** yes / no as two chips, with a third for "not sure" when `unsure` is given; null is unanswered */
export function YesNo({ value, onChange, unsure, name }: { value: boolean | null; onChange: (v: boolean | null) => void; unsure?: string; name: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={name}>
      <button className="chip" role="radio" aria-checked={value === true} aria-pressed={value === true} onClick={() => onChange(true)}>
        Yes
      </button>
      <button className="chip" role="radio" aria-checked={value === false} aria-pressed={value === false} onClick={() => onChange(false)}>
        No
      </button>
      {unsure && (
        <button className="chip" role="radio" aria-checked={value === null} aria-pressed={value === null} onClick={() => onChange(null)}>
          {unsure}
        </button>
      )}
    </div>
  )
}
