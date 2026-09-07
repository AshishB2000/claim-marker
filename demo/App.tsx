import { useRef, useState } from 'react'
import {
  DamageMarker,
  ScenarioBuilder,
  SEVERITY_COLOR,
  emptyScenario,
  emptyValue,
  seedVehicles,
  zoneById,
} from '../src'
import type { ClaimValue, DamageMarkerHandle, ScenarioHandle, ScenarioValue } from '../src'

const DAMAGE_SAMPLE: ClaimValue = {
  schema: 'claim-marker/1',
  vehicle: 'sedan',
  damages: [
    { zone: 'right_front_door', point: [0.65, 0.48, 0.15], severity: 'scratch', note: 'Key mark, full length' },
    { zone: 'front_bumper', point: [0.18, 0.32, 1.24], severity: 'dent', note: '' },
  ],
}

/** the classic disputed claim: other party turns left across a lane going straight on */
const SCENARIO_SAMPLE: ScenarioValue = {
  schema: 'claim-scenario/1',
  layout: 'intersection',
  vehicles: [
    {
      id: 'a',
      role: 'insured',
      body: 'sedan',
      position: [1.8, -2],
      heading: 0,
      path: [
        [1.8, -20],
        [1.8, -10],
      ],
      damages: [{ zone: 'front_bumper', point: [0.18, 0.32, 1.24], severity: 'dent', note: 'Struck the other car side-on' }],
    },
    {
      id: 'b',
      role: 'other',
      body: 'suv',
      position: [0.5, 1],
      heading: -2.4,
      path: [
        [16, 1.8],
        [7, 1.8],
      ],
      damages: [{ zone: 'left_rear_door', point: [-0.65, 0.6, -0.26], severity: 'crack', note: '' }],
    },
  ],
  impact: [1.4, -0.3],
  note: 'Other vehicle turned left across my lane',
}

function download(name: string, href: string) {
  const a = document.createElement('a')
  a.download = name
  a.href = href
  a.click()
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')

function exportBoth(prefix: string, json: unknown, png: string) {
  const at = stamp()
  download(`${prefix}-${at}.json`, 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(json, null, 2)))
  download(`${prefix}-${at}.png`, png)
}

const btn = 'rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50'
const primary = 'flex-1 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700'

export function App() {
  const [tab, setTab] = useState<'damage' | 'scenario'>('scenario')

  const marker = useRef<DamageMarkerHandle>(null)
  const scenario = useRef<ScenarioHandle>(null)
  const [damage, setDamage] = useState<ClaimValue>(emptyValue())
  const [diagram, setDiagram] = useState<ScenarioValue>({
    ...emptyScenario(),
    vehicles: seedVehicles('intersection'),
  })

  const value = tab === 'damage' ? damage : diagram

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <header className="mb-5">
          <h1 className="text-2xl font-semibold tracking-tight">claim-marker</h1>
          <p className="mt-1 text-sm text-slate-500">
            Two embeddable widgets for a first-notice-of-loss form: mark the damage on a 3D car, and lay out how the
            accident happened. Both emit versioned JSON and a PNG.
          </p>
        </header>

        <div className="mb-4 inline-flex rounded-lg bg-white p-1 shadow-sm ring-1 ring-slate-900/5">
          {(['scenario', 'damage'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                tab === t ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t === 'scenario' ? 'Accident scenario' : 'Damage marker'}
            </button>
          ))}
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
          <div className="h-[560px] overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/5">
            {tab === 'damage' ? (
              <DamageMarker ref={marker} onChange={setDamage} />
            ) : (
              <ScenarioBuilder ref={scenario} onChange={setDiagram} />
            )}
          </div>

          <aside className="flex h-[560px] flex-col gap-3">
            <div className="flex gap-2">
              {tab === 'damage' ? (
                <>
                  <button
                    className={primary}
                    onClick={() => {
                      const { json, png } = marker.current!.export()
                      exportBoth('claim', json, png)
                    }}
                  >
                    Export JSON + PNG
                  </button>
                  <button className={btn} onClick={() => marker.current!.load(DAMAGE_SAMPLE)}>
                    Sample
                  </button>
                  <button className={btn} onClick={() => marker.current!.load(emptyValue())}>
                    Clear
                  </button>
                </>
              ) : (
                <>
                  <button
                    className={primary}
                    onClick={() => {
                      const { json, png } = scenario.current!.export()
                      exportBoth('scenario', json, png)
                    }}
                  >
                    Export JSON + PNG
                  </button>
                  <button className={btn} onClick={() => scenario.current!.load(SCENARIO_SAMPLE)}>
                    Sample
                  </button>
                  <button className={btn} onClick={() => scenario.current!.load(emptyScenario())}>
                    Clear
                  </button>
                </>
              )}
            </div>

            {tab === 'damage' ? (
              <DamageList value={damage} />
            ) : (
              <ScenarioList value={diagram} />
            )}

            <pre className="flex-1 overflow-auto rounded-xl bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">
              {JSON.stringify(value, null, 2)}
            </pre>
          </aside>
        </div>
      </div>
    </div>
  )
}

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-900/5">
    <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
    {children}
  </div>
)

function DamageList({ value }: { value: ClaimValue }) {
  return (
    <Card title={`${value.damages.length} damage${value.damages.length === 1 ? '' : 's'}`}>
      {value.damages.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing marked yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {value.damages.map((d, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: SEVERITY_COLOR[d.severity] }} />
              <span className="flex-1">
                {zoneById(value.vehicle, d.zone)?.label ?? d.zone}
                <span className="text-slate-400"> · {d.severity}</span>
                {d.note && <span className="block text-xs text-slate-500">{d.note}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function ScenarioList({ value }: { value: ScenarioValue }) {
  return (
    <Card title={`${value.vehicles.length} vehicle${value.vehicles.length === 1 ? '' : 's'}`}>
      <ul className="space-y-1.5">
        {value.vehicles.map((v) => (
          <li key={v.id} className="text-sm">
            <span className="font-medium">{v.id.toUpperCase()}</span>
            <span className="text-slate-400">
              {' '}
              · {v.role === 'insured' ? 'insured' : 'other party'} · {v.body}
            </span>
            <span className="block text-xs text-slate-500">
              {v.path.length} waypoint{v.path.length === 1 ? '' : 's'} · {v.damages.length} damage
              {v.damages.length === 1 ? '' : 's'}
            </span>
          </li>
        ))}
      </ul>
      {value.impact && <p className="mt-2 text-xs text-slate-500">Impact marked at [{value.impact.join(', ')}]</p>}
    </Card>
  )
}
