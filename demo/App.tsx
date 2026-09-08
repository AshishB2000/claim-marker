import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  DamageMarker,
  ROLE_COLOR,
  ROLE_LABEL,
  ScenarioBuilder,
  SEVERITIES,
  SEVERITY_COLOR,
  VEHICLES,
  VEHICLE_IDS,
  emptyScenario,
  emptyValue,
  seedVehicles,
  zoneById,
} from '../src'
import type { ClaimValue, DamageMarkerHandle, ScenarioHandle, ScenarioValue, Theme, Vehicle } from '../src'

const DAMAGE_SAMPLE: ClaimValue = {
  schema: 'claim-marker/1',
  vehicle: 'sedan',
  damages: [
    { zone: 'right_front_door', point: [0.65, 0.48, 0.15], severity: 'scratch', note: 'Key mark, full length' },
    { zone: 'front_bumper', point: [0.18, 0.32, 1.24], severity: 'dent', note: '' },
    { zone: 'right_headlight', point: [0.45, 0.58, 1.2], severity: 'crack', note: '' },
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
  return `${prefix}-${at}`
}

const deg = (rad: number) => Math.round((((rad * 180) / Math.PI) % 360 + 360) % 360)
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

type Tab = 'scenario' | 'damage'

export function App() {
  const [tab, setTab] = useState<Tab>('scenario')
  const [theme, setTheme] = useState<Theme>('dark')
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  const marker = useRef<DamageMarkerHandle>(null)
  const scenario = useRef<ScenarioHandle>(null)
  const [damage, setDamage] = useState<ClaimValue>(emptyValue())
  // controlled, so the note field below can write into the document
  const [diagram, setDiagram] = useState<ScenarioValue>({ ...emptyScenario(), vehicles: seedVehicles('intersection') })

  const [snapshot, setSnapshot] = useState<{ tab: Tab; png: string } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const say = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2200)
  }

  const value = tab === 'damage' ? damage : diagram
  const handle = () => (tab === 'damage' ? marker.current! : scenario.current!)

  const onExport = () => {
    const { json, png } = handle().export()
    const name = exportBoth(tab === 'damage' ? 'claim' : 'scenario', json, png)
    say(`Saved ${name}.json and .png`)
  }
  const onSample = () => (tab === 'damage' ? marker.current!.load(DAMAGE_SAMPLE) : scenario.current!.load(SCENARIO_SAMPLE))
  const onClear = () => (tab === 'damage' ? marker.current!.load(emptyValue(damage.vehicle)) : scenario.current!.load(emptyScenario(diagram.layout)))
  const onCopy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(value, null, 2))
    say('JSON copied')
  }
  const onSnapshot = () => setSnapshot({ tab, png: handle().export().png })

  return (
    <div className="page-glow min-h-screen">
      <div className="page-grid pointer-events-none absolute inset-x-0 top-0 h-[520px]" />

      <div className="relative mx-auto max-w-7xl px-6 pt-6 pb-16">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="text-[15px] font-semibold tracking-tight">claim-marker</span>
            <span className="pill">v0.1</span>
          </div>
          <div className="flex items-center gap-2">
            <a href="/demo/vanilla.html" className="btn btn-sm">
              Vanilla mount()
            </a>
            <button
              className="btn btn-sm"
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
              {theme === 'dark' ? 'Light' : 'Dark'}
            </button>
          </div>
        </header>

        <section className="mt-12 mb-8 max-w-3xl">
          <p className="card-title">First notice of loss · embeddable widgets</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
            Show what happened. <span className="gradient-text">In 3D.</span>
          </h1>
          <p className="muted mt-4 text-[15px] leading-relaxed">
            Two drop-in widgets for a claims form. Lay the accident out on a real road, then tap the car where the
            damage is. Each emits a versioned JSON document and a PNG of exactly what the claimant was looking at.
          </p>
          <ul className="mt-5 flex flex-wrap gap-2">
            {['No backend', 'No network at runtime', 'React + vanilla', 'Light + dark', 'claim-scenario/1', 'claim-marker/1', 'MIT'].map(
              (f) => (
                <li key={f} className="pill">
                  <Check /> {f}
                </li>
              ),
            )}
          </ul>
        </section>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-900/5 dark:bg-white/[0.04] dark:ring-white/10">
            <button className="seg" aria-pressed={tab === 'scenario'} aria-label="Accident scenario" onClick={() => setTab('scenario')}>
              <Step n="01" /> Accident scenario
            </button>
            <button className="seg" aria-pressed={tab === 'damage'} aria-label="Damage marker" onClick={() => setTab('damage')}>
              <Step n="02" /> Damage marker
            </button>
          </div>
          <p className="faint text-xs">
            {tab === 'scenario'
              ? 'Drag a car to move it, drag the puck ahead of it to turn it, drag the white dots to reshape its path.'
              : 'Drag to orbit, scroll to zoom, tap a panel to mark it, tap a pin to fly to it.'}
          </p>
        </div>

        <div id="demo" className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="relative h-[600px] overflow-hidden rounded-3xl bg-white shadow-xl ring-1 ring-slate-900/10 dark:bg-[#0b1020] dark:shadow-[0_0_120px_-30px_rgba(59,130,246,0.45)] dark:ring-white/10">
            {tab === 'damage' ? (
              <DamageMarker ref={marker} theme={theme} onChange={setDamage} />
            ) : (
              <ScenarioBuilder ref={scenario} theme={theme} value={diagram} onChange={setDiagram} />
            )}
          </div>

          <aside className="flex flex-col gap-3 lg:h-[600px]">
            <div className="flex gap-2">
              <button className="btn btn-primary flex-1" onClick={onExport}>
                <DownloadIcon /> Export JSON + PNG
              </button>
              <button className="btn" onClick={onSample}>
                Sample
              </button>
              <button className="btn" onClick={onClear}>
                Clear
              </button>
            </div>

            {tab === 'damage' ? (
              <>
                <Card title="Body">
                  <div className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-white/[0.04]">
                    {VEHICLE_IDS.map((b) => (
                      <BodyButton key={b} body={b} on={damage.vehicle === b} onClick={() => marker.current!.load(emptyValue(b))} />
                    ))}
                  </div>
                </Card>
                <DamageList value={damage} />
              </>
            ) : (
              <ScenarioSummary value={diagram} onNote={(note) => setDiagram({ ...diagram, note })} />
            )}

            <Card
              title={value.schema}
              action={
                <div className="flex gap-1">
                  <button className="btn btn-sm" onClick={onSnapshot}>
                    <CameraIcon /> Preview PNG
                  </button>
                  <button className="btn btn-sm" onClick={onCopy}>
                    <CopyIcon /> Copy
                  </button>
                </div>
              }
              className="flex min-h-0 flex-1 flex-col"
            >
              {snapshot && snapshot.tab === tab && (
                <div className="relative mb-2 shrink-0">
                  <img src={snapshot.png} alt="What export() returns" className="h-28 w-full rounded-lg object-cover ring-1 ring-slate-900/10 dark:ring-white/10" />
                  <span className="absolute top-1.5 left-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    export().png · {Math.round(snapshot.png.length / 1024)} kB
                  </span>
                  <button
                    className="absolute top-1.5 right-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] text-white hover:bg-black/80"
                    onClick={() => setSnapshot(null)}
                    aria-label="Close preview"
                  >
                    ✕
                  </button>
                </div>
              )}
              <Json value={value} />
            </Card>
          </aside>
        </div>

        <footer className="faint mt-10 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span>MIT licence</span>
          <span>Vehicles: Kenney Car Kit, CC0</span>
          <span>React 19 · three.js · react-three-fiber · Zustand</span>
          <span className="ml-auto">The widgets inject their own CSS under <code>.cm-</code>; Tailwind is this page only.</span>
        </footer>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-sm text-white shadow-xl dark:bg-white dark:text-slate-900">
          {toast}
        </div>
      )}
    </div>
  )
}

// ── sidebar pieces ───────────────────────────────────────────────────

function Card({ title, action, className, children }: { title: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={`card p-3 ${className ?? ''}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="card-title truncate">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  )
}

function BodyButton({ body, on, onClick }: { body: Vehicle; on: boolean; onClick: () => void }) {
  return (
    <button className="seg flex flex-1 flex-col items-center gap-0.5 py-2" aria-pressed={on} onClick={onClick}>
      <span>{VEHICLES[body].label}</span>
      <span className={`text-[10px] font-normal ${on ? 'text-white/60' : 'faint'}`}>{VEHICLES[body].zones.length} zones</span>
    </button>
  )
}

function DamageList({ value }: { value: ClaimValue }) {
  return (
    <Card title={plural(value.damages.length, 'damage')}>
      {value.damages.length === 0 ? (
        <p className="faint px-2 text-sm">Nothing marked yet. Tap the car, or load the sample.</p>
      ) : (
        <ul>
          {value.damages.map((d, i) => (
            <li key={i} className="row">
              <span
                className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white ring-2 ring-white dark:ring-[#0b1020]"
                style={{ background: SEVERITY_COLOR[d.severity] }}
              >
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 text-sm">
                <span className="font-medium">{zoneById(value.vehicle, d.zone)?.label ?? d.zone}</span>
                <span className="muted"> · {d.severity}</span>
                {d.note && <span className="muted block truncate text-xs">{d.note}</span>}
              </span>
              <span className="faint mt-1 font-mono text-[10px]">{d.point.map((n) => n.toFixed(2)).join(' ')}</span>
            </li>
          ))}
        </ul>
      )}
      <ul className="mt-2 flex gap-3 border-t border-slate-100 px-2 pt-2 dark:border-white/[0.06]">
        {SEVERITIES.map((s) => (
          <li key={s} className="faint flex items-center gap-1.5 text-[11px] capitalize">
            <span className="size-2 rounded-full" style={{ background: SEVERITY_COLOR[s] }} />
            {s}
          </li>
        ))}
      </ul>
    </Card>
  )
}

function ScenarioSummary({ value, onNote }: { value: ScenarioValue; onNote: (note: string) => void }) {
  return (
    <Card title={plural(value.vehicles.length, 'vehicle')}>
      {value.vehicles.length === 0 ? (
        <p className="faint px-2 text-sm">No vehicles. Add one from the diagram, or load the sample.</p>
      ) : (
        <ul>
          {value.vehicles.map((v) => (
            <li key={v.id} className="row items-center">
              <span className="grid size-7 shrink-0 place-items-center rounded-lg text-xs font-bold text-white" style={{ background: ROLE_COLOR[v.role] }}>
                {v.id.toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 text-sm">
                <span className="font-medium">{VEHICLES[v.body].label}</span>
                <span className="muted"> · {ROLE_LABEL[v.role]}</span>
                <span className="muted block text-xs">
                  {plural(v.path.length, 'waypoint')} · {plural(v.damages.length, 'damage')} · heading {deg(v.heading)}°
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="muted mt-1 flex items-center gap-2 px-2 text-xs">
        <span className="grid size-4 place-items-center rounded-full bg-red-600 text-[9px] font-bold text-white">✕</span>
        {value.impact ? `Impact at ${value.impact[0].toFixed(1)}, ${value.impact[1].toFixed(1)} m` : 'No impact point yet'}
      </p>
      <textarea
        className="input mt-2"
        rows={2}
        placeholder="What happened, in a sentence — written into the document's note"
        value={value.note}
        onChange={(e) => onNote(e.target.value)}
      />
    </Card>
  )
}

/**
 * Syntax colouring by wrapping tokens in spans; the <pre>'s textContent stays the exact JSON,
 * which the smoke and screenshot scripts read.
 */
const TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)|\b(true|false|null)\b/g

function Json({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 2)
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1]) {
      out.push(
        <span key={i++} className={m[2] ? 'text-sky-700 dark:text-sky-300' : 'text-emerald-700 dark:text-emerald-300'}>
          {m[1]}
        </span>,
        m[2] ?? '',
      )
    } else if (m[3]) {
      out.push(
        <span key={i++} className="text-amber-700 dark:text-amber-300">
          {m[3]}
        </span>,
      )
    } else {
      out.push(
        <span key={i++} className="text-fuchsia-700 dark:text-fuchsia-300">
          {m[4]}
        </span>,
      )
    }
    last = m.index + m[0].length
  }
  out.push(text.slice(last))
  return (
    <pre className="min-h-40 flex-1 overflow-auto rounded-xl bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-700 ring-1 ring-slate-900/5 dark:bg-black/30 dark:text-slate-300 dark:ring-white/[0.06]">
      {out}
    </pre>
  )
}

// ── icons ────────────────────────────────────────────────────────────

const Step = ({ n }: { n: string }) => <span className="mr-1 font-mono text-[10px] opacity-60">{n}</span>

const Logo = () => (
  <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-500/30">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s-6-5.2-6-10.5a6 6 0 0 1 12 0C18 15.8 12 21 12 21z" />
      <circle cx="12" cy="10.5" r="2.2" fill="currentColor" stroke="none" />
    </svg>
  </span>
)

const icon = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

const Check = () => (
  <svg {...icon} width={11} height={11} strokeWidth={3} className="text-emerald-500">
    <path d="M20 6 9 17l-5-5" />
  </svg>
)
const SunIcon = () => (
  <svg {...icon}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
)
const MoonIcon = () => (
  <svg {...icon}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
)
const DownloadIcon = () => (
  <svg {...icon}>
    <path d="M12 3v12M6 11l6 6 6-6M4 21h16" />
  </svg>
)
const CopyIcon = () => (
  <svg {...icon}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
)
const CameraIcon = () => (
  <svg {...icon}>
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
    <circle cx="12" cy="13" r="3.2" />
  </svg>
)
