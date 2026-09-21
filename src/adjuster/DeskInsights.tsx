/**
 * The inbox read as a whole: arrivals over the last thirty days, what kind, which panels, what
 * hour of the day, the weather and the light, and how long people take to report.
 *
 * Every bar is a button: pressing one holds the list and the map to that slice, pressing it
 * again lets go. The counting is `insights.ts`; this file only draws it, and it draws it with
 * divs and one `polyline` rather than a charting library — a bar is a width and a sparkline is
 * thirty points.
 *
 * The tiles are counted off what the status chips, the dates and the search have already kept,
 * but **never** off the tile that is held — press "Collision" and the other kinds must still be
 * there to press instead.
 */
import { focusLabel, lagLabel, type Bar, type Focus, type Insights as Counts } from './insights'

const held = (focus: Focus | null, by: Focus['by'], id: string) => !!focus && focus.by === by && focus.id === id

/** one counted thing per row: its name, its share of the largest, and how many */
function Bars({ title, bars, by, focus, onFocus }: { title: string; bars: Bar[]; by: Focus['by']; focus: Focus | null; onFocus: (f: Focus | null) => void }) {
  if (bars.length === 0) return null
  const top = bars.slice(0, 8)
  const most = Math.max(...top.map((b) => b.n))
  return (
    <div>
      <h3 className="eyebrow">{title}</h3>
      <ul data-bars={by} className="mt-2 space-y-1">
        {top.map((b) => {
          const on = held(focus, by, b.id)
          return (
            <li key={b.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-xs hover:bg-slate-50"
                aria-pressed={on}
                onClick={() => onFocus(on ? null : { by, id: b.id })}
              >
                <span className={`w-28 shrink-0 truncate ${on ? 'font-semibold text-brand-700' : 'text-slate-600'}`}>{b.label}</span>
                <span className="h-2.5 min-w-0 flex-1 rounded-full bg-slate-100">
                  <span className={`block h-2.5 rounded-full ${on ? 'bg-brand-700' : 'bg-brand-500'}`} style={{ width: `${Math.round((b.n / most) * 100)}%` }} />
                </span>
                <span className="w-6 shrink-0 text-right font-mono tabular-nums text-slate-500">{b.n}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** the twenty-four hours of the day as columns, so the evening peak every insurer has is visible at a glance */
function Hours({ hours, focus, onFocus }: { hours: number[]; focus: Focus | null; onFocus: (f: Focus | null) => void }) {
  const most = Math.max(1, ...hours)
  return (
    <div>
      <h3 className="eyebrow">Hour of the day it happened</h3>
      <div className="mt-2 flex h-20 items-end gap-px">
        {hours.map((n, hour) => {
          const on = held(focus, 'hour', String(hour))
          return (
            <button
              key={hour}
              type="button"
              className="flex h-full flex-1 items-end rounded-sm hover:bg-slate-50 disabled:cursor-default"
              disabled={n === 0}
              aria-pressed={on}
              aria-label={`${String(hour).padStart(2, '0')}:00 — ${n} ${n === 1 ? 'report' : 'reports'}`}
              onClick={() => onFocus(on ? null : { by: 'hour', id: String(hour) })}
            >
              <span className={`w-full rounded-sm ${on ? 'bg-brand-700' : n ? 'bg-brand-500' : 'bg-slate-100'}`} style={{ height: `${Math.max(n ? 8 : 2, Math.round((n / most) * 100))}%` }} />
            </button>
          )
        })}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-400">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </div>
    </div>
  )
}

/** thirty days of arrivals as one line; an empty day is a point on the floor, not a day skipped */
function Arrivals({ days }: { days: Counts['days'] }) {
  const most = Math.max(1, ...days.map((d) => d.n))
  const points = days.map((d, i) => `${(i / (days.length - 1)) * 100},${28 - (d.n / most) * 26}`).join(' ')
  return (
    <div>
      <h3 className="eyebrow">
        Arriving · last 30 days · at most {most} in a day
      </h3>
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="mt-2 h-14 w-full" role="img" aria-label={`Reports arriving each day for thirty days, at most ${most} in a day`}>
        <polyline points={points} fill="none" stroke="#2f6bff" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <div className="flex justify-between font-mono text-[10px] text-slate-400">
        <span>{days[0].day}</span>
        <span>{days[days.length - 1].day}</span>
      </div>
    </div>
  )
}

const Tile = ({ n, of }: { n: string; of: string }) => (
  <div className="rounded-xl bg-slate-50 px-3 py-2">
    <div className="text-lg font-semibold tabular-nums">{n}</div>
    <div className="text-[11px] leading-tight text-slate-500">{of}</div>
  </div>
)

export function DeskInsights({ of, focus, onFocus }: { of: Counts; focus: Focus | null; onFocus: (f: Focus | null) => void }) {
  if (of.total === 0) return <p className="card mb-3 px-4 py-3 text-sm text-slate-500">Nothing to count in this filter yet.</p>
  const share = (n: number) => `${Math.round((n / of.total) * 100)}%`
  return (
    <div data-insights className="card mb-3 space-y-5 p-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile n={String(of.total)} of={of.total === 1 ? 'accident' : 'accidents'} />
        <Tile n={share(of.hurt)} of={`somebody hurt (${of.hurt})`} />
        <Tile n={share(of.notDrivable)} of={`not drivable (${of.notDrivable})`} />
        <Tile n={of.medianLag === null ? '—' : lagLabel(of.medianLag)} of="typical time to report" />
      </div>
      <Arrivals days={of.days} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Bars title="Kind of incident" bars={of.kinds} by="kind" focus={focus} onFocus={onFocus} />
        <Bars title="Panels marked" bars={of.panels} by="panel" focus={focus} onFocus={onFocus} />
        <Bars title="Weather" bars={of.weather} by="weather" focus={focus} onFocus={onFocus} />
        <Bars title="Light" bars={of.light} by="light" focus={focus} onFocus={onFocus} />
      </div>
      <Hours hours={of.hours} focus={focus} onFocus={onFocus} />
      {focus && (
        <button type="button" className="chip" aria-pressed onClick={() => onFocus(null)}>
          Showing {focusLabel(focus, of)} — show everything
        </button>
      )}
    </div>
  )
}
