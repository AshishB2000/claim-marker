import { useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type Ref } from 'react'
import { useStore } from 'zustand'
import { DamageMarker } from '../marker/DamageMarker'
import { SCHEMA } from '../schema'
import { injectStyle } from '../style'
import { VEHICLES, VEHICLE_IDS, type Vehicle } from '../zones'
import { LAYOUTS, LAYOUT_IDS } from './layouts'
import { ScenarioScene } from './Scene'
import {
  ROLES,
  ROLE_LABEL,
  emptyScenario,
  parseScenario,
  seedVehicles,
  type ScenarioValue,
} from './schema'
import { createScenarioStore, vehicleLabel } from './store'

export type ScenarioExport = {
  json: ScenarioValue
  /** PNG data URL of the current view */
  png: string
}

export type ScenarioHandle = {
  export: () => ScenarioExport
  load: (value: unknown) => void
}

export type ScenarioBuilderProps = {
  /** controlled value; omit for uncontrolled */
  value?: ScenarioValue
  onChange?: (value: ScenarioValue) => void
  className?: string
  style?: CSSProperties
  ref?: Ref<ScenarioHandle>
}

export function ScenarioBuilder({ value, onChange, className, style, ref }: ScenarioBuilderProps) {
  injectStyle()

  const [store] = useState(() =>
    createScenarioStore(value ?? { ...emptyScenario(), vehicles: seedVehicles('intersection') }),
  )
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)

  const layout = useStore(store, (s) => s.layout)
  const vehicles = useStore(store, (s) => s.vehicles)
  const selectedId = useStore(store, (s) => s.selected)
  const markingId = useStore(store, (s) => s.marking)
  const impact = useStore(store, (s) => s.impact)

  const selected = vehicles.find((v) => v.id === selectedId)
  const marking = vehicles.find((v) => v.id === markingId)

  // content comparison, same reasoning as DamageMarker: identity would loop
  const emitted = useRef<string | null>(null)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })

  useEffect(
    () =>
      store.subscribe((s, prev) => {
        if (s.vehicles === prev.vehicles && s.layout === prev.layout && s.impact === prev.impact && s.note === prev.note) {
          return
        }
        const next = s.value()
        emitted.current = JSON.stringify(next)
        onChangeRef.current?.(next)
      }),
    [store],
  )

  useEffect(() => {
    if (!value) return
    const json = JSON.stringify(value)
    if (json === emitted.current) return
    emitted.current = json
    store.getState().load(parseScenario(value).value)
  }, [value, store])

  useImperativeHandle(
    ref,
    () => ({
      export: () => ({ json: store.getState().value(), png: canvas ? canvas.toDataURL('image/png') : '' }),
      load: (input: unknown) => store.getState().load(parseScenario(input).value),
    }),
    [store, canvas],
  )

  const act = store.getState

  const toggleImpact = () => {
    if (impact) return act().setImpact(null)
    // default to between the first two vehicles, which is where it nearly always belongs
    const [a, b] = vehicles
    act().setImpact(
      a && b ? [(a.position[0] + b.position[0]) / 2, (a.position[1] + b.position[1]) / 2] : [0, 0],
    )
  }

  return (
    <div className={className ? `cm-root ${className}` : 'cm-root'} style={style}>
      <ScenarioScene store={store} onCanvas={setCanvas} />

      <div className="cm-bar cm-bar-top">
        <div className="cm-chips">
          {LAYOUT_IDS.map((id) => (
            <button key={id} className="cm-chip" aria-pressed={id === layout} onClick={() => act().setLayout(id)}>
              {LAYOUTS[id].label}
            </button>
          ))}
        </div>
        <button className="cm-chip" aria-pressed={!!impact} onClick={toggleImpact}>
          {impact ? '✕ Impact point' : '+ Impact point'}
        </button>
      </div>

      <div className="cm-bar cm-bar-bottom">
        <div className="cm-chips">
          {vehicles.map((v) => (
            <button
              key={v.id}
              className="cm-chip cm-veh"
              aria-pressed={v.id === selectedId}
              onClick={() => act().select(v.id)}
            >
              <span className={`cm-dot cm-role-${v.role}`} />
              {vehicleLabel(v.id)} · {VEHICLES[v.body].label}
              {v.damages.length > 0 && <span className="cm-tag-n">{v.damages.length}</span>}
            </button>
          ))}
          <button className="cm-chip" onClick={() => act().addVehicle()}>
            + Vehicle
          </button>
        </div>
      </div>

      {selected && (
        <div className="cm-panel">
          <div className="cm-panel-head">
            Vehicle {vehicleLabel(selected.id)}
            <button className="cm-x" aria-label="Deselect" onClick={() => act().select(null)}>
              ✕
            </button>
          </div>

          <label className="cm-field">
            Role
            <select value={selected.role} onChange={(e) => act().setRole(selected.id, e.target.value as (typeof ROLES)[number])}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>

          <label className="cm-field">
            Body
            <select value={selected.body} onChange={(e) => act().setBody(selected.id, e.target.value as Vehicle)}>
              {VEHICLE_IDS.map((b) => (
                <option key={b} value={b}>
                  {VEHICLES[b].label}
                </option>
              ))}
            </select>
          </label>
          {selected.damages.length > 0 && (
            <p className="cm-hintline">Changing the body clears its {selected.damages.length} marked damages.</p>
          )}

          <button className="cm-btn" onClick={() => act().addWaypoint(selected.id)}>
            + Waypoint
          </button>
          <button className="cm-btn cm-btn-primary" onClick={() => act().mark(selected.id)}>
            Mark damage{selected.damages.length > 0 ? ` (${selected.damages.length})` : ''}
          </button>
          <button className="cm-del" onClick={() => act().removeVehicle(selected.id)}>
            Remove vehicle
          </button>
        </div>
      )}

      {marking && (
        <div className="cm-overlay">
          <div className="cm-overlay-head">
            <span>
              Vehicle {vehicleLabel(marking.id)} · {VEHICLES[marking.body].label}
            </span>
            <button className="cm-btn cm-btn-primary" onClick={() => act().mark(null)}>
              Done
            </button>
          </div>
          <div className="cm-overlay-body">
            <DamageMarker
              key={marking.id}
              vehicle={marking.body}
              value={{ schema: SCHEMA, vehicle: marking.body, damages: marking.damages }}
              onChange={(v) => act().setDamages(marking.id, v.damages)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
