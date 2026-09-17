import type { ReactNode } from 'react'
import { useClaim } from '../../../claim/store'
import type { ClaimVehicle } from '../../../claim/schema'
import { SCHEMA, SEVERITIES, SEVERITY_COLOR } from '../../../schema'
import { VEHICLES, zoneById } from '../../../zones'
import { DamageMarker } from '../../../marker/DamageMarker'
import { VehiclePhoto } from '../../VehiclePhoto'

/**
 * The car to mark the damage on, and beside it what is marked so far. `children` go at the foot
 * of the side column, where the desktop layout keeps its photo suggestions; `afterPhotos` heads
 * it for the phone layout, where the photos came first and the car is for what they missed.
 */
export function MarkerPanel({ v, afterPhotos = false, children }: { v: ClaimVehicle; afterPhotos?: boolean; children?: ReactNode }) {
  const autoDamage = useClaim((s) => s.autoDamage)
  const setDamages = useClaim((s) => s.setDamages)

  return (
    <>
      {afterPhotos && (
        <div className="mt-6 mb-3">
          <h3 className="font-semibold">Anything the photos missed?</h3>
          <p className="mt-0.5 text-sm text-slate-500">Tap it on the car.</p>
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="card h-[520px] overflow-hidden sm:h-[580px]">
          <DamageMarker
            key={`${v.id}-${v.body}`}
            vehicle={v.body}
            paint={v.color}
            value={{ schema: SCHEMA, vehicle: v.body, damages: v.damages }}
            onChange={(next) => setDamages(v.id, next.damages)}
          />
        </div>

        <aside className="space-y-4">
          {autoDamage[v.id] === 'auto' && v.damages[0] && (
            <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900 ring-1 ring-emerald-200">
              <span className="font-semibold">Marked for you: {zoneById(v.body, v.damages[0].zone)?.label.toLowerCase()}.</span> Worked out from where the
              vehicles met and which way this one was facing. Tap the number on the car to change or remove it, or tap another panel to add more.
            </div>
          )}
          <div className="card p-4">
            <VehiclePhoto vehicle={v} className="mb-3 h-32 overflow-hidden rounded-lg" fallback={null} />
            <h3 className="font-semibold">
              {v.role === 'insured' ? 'Your' : 'Their'} {[v.year, v.make, v.model].filter(Boolean).join(' ') || VEHICLES[v.body].label.toLowerCase()}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Drag to turn the car round. Tap the panel where the damage is and say how bad it is. Tap a number to change or remove it.
            </p>
            {v.role !== 'insured' && <p className="mt-2 text-xs text-slate-500">Only if you saw it — this part is optional for other vehicles.</p>}
          </div>

          <div className="card p-4">
            <h3 className="eyebrow">{v.damages.length === 0 ? 'Nothing marked yet' : `${v.damages.length} marked`}</h3>
            <ul className="mt-2 space-y-2">
              {v.damages.map((d, i) => (
                <li key={i} className="flex items-start gap-3 text-sm">
                  <span
                    className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white ring-2 ring-white"
                    style={{ background: SEVERITY_COLOR[d.severity] }}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="font-medium">{zoneById(v.body, d.zone)?.label ?? d.zone}</span>
                    <span className="text-slate-500"> · {d.severity}</span>
                    {d.note && <span className="block truncate text-xs text-slate-500">{d.note}</span>}
                  </span>
                </li>
              ))}
            </ul>
            <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-100 pt-3">
              {SEVERITIES.map((s) => (
                <li key={s} className="flex items-center gap-1.5 text-[11px] text-slate-500 capitalize">
                  <span className="size-2 rounded-full" style={{ background: SEVERITY_COLOR[s] }} />
                  {s}
                </li>
              ))}
            </ul>
          </div>

          {children}
        </aside>
      </div>
    </>
  )
}
