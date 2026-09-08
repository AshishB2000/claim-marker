import { mount, mountScenario, type ClaimValue, type ScenarioValue } from '../src'

const show = (id: string, value: unknown) => (document.getElementById(id)!.textContent = JSON.stringify(value, null, 2))
const on = (id: string, fn: () => void) => (document.getElementById(id)!.onclick = fn)
const brief = (png: string) => `${png.slice(0, 24)}… (${Math.round(png.length / 1024)} kB)`

// ── damage marker ────────────────────────────────────────────────────
const marker = mount(document.getElementById('damage')!, {
  vehicle: 'sedan',
  theme: 'dark',
  onChange: (v) => show('out', v),
})
// mount() returns a usable handle synchronously — this must not throw
show('out', marker.export().json)

const DAMAGE: ClaimValue = {
  schema: 'claim-marker/1',
  vehicle: 'sedan',
  damages: [{ zone: 'roof', point: [0, 1.3, -0.2], severity: 'crack', note: 'Tree branch' }],
}
on('sample', () => marker.load(DAMAGE))
on('export', () => {
  const { json, png } = marker.export()
  show('out', { ...json, png: brief(png) })
})

// ── accident scenario ────────────────────────────────────────────────
const scenario = mountScenario(document.getElementById('scenario')!, {
  theme: 'dark',
  onChange: (v) => show('scn-out', v),
})
show('scn-out', scenario.export().json)

const SCENARIO: ScenarioValue = {
  schema: 'claim-scenario/1',
  layout: 'parking_lot',
  vehicles: [
    { id: 'a', role: 'insured', body: 'truck', position: [2.6, 6], heading: 0, path: [], damages: [] },
    { id: 'b', role: 'other', body: 'suv', position: [-4, 0], heading: Math.PI / 2, path: [[-14, 0]], damages: [] },
  ],
  impact: [0.5, 3],
  note: 'Reversed out of the bay into me',
}
on('scn-sample', () => scenario.load(SCENARIO))
on('scn-export', () => {
  const { json, png } = scenario.export()
  show('scn-out', { ...json, png: brief(png) })
})
