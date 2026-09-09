import { useEffect, useRef, useState } from 'react'
import { useClaim } from '../../claim/store'
import { assistOn, buildDiagram, writeStatement } from '../../assist/client'
import type { LngLat } from '../../geo'
import { ROLE_COLOR, SURFACES, type ClaimVehicle } from '../../claim/schema'
import { MapScene, type MapSceneHandle, type TapMode } from '../../map/MapScene'
import { SURFACE_LABEL } from '../../map/styles'
import { usePlayback } from '../../map/usePlayback'
import { VEHICLES, zoneById } from '../../zones'
import { paintLabel } from '../../vehicles/paint'
import { Field } from '../ui'
import { Icon } from '../icons'

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']
const facing = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]

const name = (v: ClaimVehicle) => {
  const id = [v.year, v.make, v.model].filter(Boolean).join(' ')
  return `${v.role === 'insured' ? 'Your' : 'Their'} ${paintLabel(v.color).toLowerCase()} ${id || VEHICLES[v.body].label.toLowerCase()}`
}

type Tap = { kind: 'waypoint'; id: string } | { kind: 'impact' } | null

export function Diagram() {
  const claim = useClaim((s) => s.claim)
  const autoDamage = useClaim((s) => s.autoDamage)
  const placeVehicles = useClaim((s) => s.placeVehicles)
  const grabVehicle = useClaim((s) => s.grabVehicle)
  const dragVehicle = useClaim((s) => s.dragVehicle)
  const dropVehicle = useClaim((s) => s.dropVehicle)
  const impactManual = useClaim((s) => s.impactManual)
  const turnVehicle = useClaim((s) => s.turnVehicle)
  const setWaypoint = useClaim((s) => s.setWaypoint)
  const addWaypointAt = useClaim((s) => s.addWaypointAt)
  const clearPath = useClaim((s) => s.clearPath)
  const setImpact = useClaim((s) => s.setImpact)
  const setIncident = useClaim((s) => s.setIncident)

  const [selected, setSelected] = useState<string | null>(claim.vehicles[0]?.id ?? null)
  const [tap, setTap] = useState<Tap>(null)
  // the one-line hint on the map goes once the customer has moved or turned anything
  const [touched, setTouched] = useState(() => claim.vehicles.some((v) => v.path.length > 1))
  const map = useRef<MapSceneHandle>(null)
  const play = usePlayback(claim.vehicles)
  const applyScene = useClaim((s) => s.applyScene)
  // the assistant: which way it is working, what it said, what went wrong
  const [busy, setBusy] = useState<'diagram' | 'describe' | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const draw = async () => {
    setBusy('diagram')
    setFailed(null)
    setSaid(null)
    try {
      const scene = await buildDiagram(useClaim.getState().claim)
      applyScene(scene)
      setTouched(true)
      setSaid(scene.vehicles.length === 0 ? scene.note || 'Nothing in that could be placed on the map. Drag the cars instead.' : scene.note)
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'The assistant could not answer.')
    } finally {
      setBusy(null)
    }
  }

  const write = async () => {
    setBusy('describe')
    setFailed(null)
    setSaid(null)
    try {
      setIncident({ description: await writeStatement(useClaim.getState().claim) })
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'The assistant could not answer.')
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => placeVehicles(), [placeVehicles])

  const loc = claim.incident.location
  if (!loc) return null
  const center: LngLat = [loc.lng, loc.lat]
  const tapMode: TapMode = tap ? tap.kind : 'none'

  const onTap = (at: LngLat) => {
    if (!tap) return
    if (tap.kind === 'impact') {
      setImpact(at)
      setTap(null)
    } else {
      addWaypointAt(tap.id, at)
    }
  }

  const select = (id: string | null) => {
    setSelected(id)
    if (tap?.kind === 'waypoint' && tap.id !== id) setTap(null)
  }

  const banner =
    tap?.kind === 'impact'
      ? 'Tap the map where the vehicles hit'
      : tap?.kind === 'waypoint'
        ? `Tap the map where ${tap.id.toUpperCase()} came from, then tap again for each bend`
        : null

  /** what the diagram says this vehicle was hit on, when it was worked out from the impact */
  const hit = (v: ClaimVehicle) => (autoDamage[v.id] === 'auto' && v.damages[0] ? zoneById(v.body, v.damages[0].zone)?.label : null)

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="card relative overflow-hidden">
        <MapScene
          ref={map}
          center={center}
          style={claim.incident.surface}
          vehicles={claim.vehicles}
          impact={claim.impact}
          selected={selected}
          interactive
          tapMode={tapMode}
          poses={play.poses}
          onSelect={select}
          onGrab={(id) => {
            setTouched(true)
            grabVehicle(id)
          }}
          onDrag={dragVehicle}
          onDrop={dropVehicle}
          onTurn={(id, heading) => {
            setTouched(true)
            turnVehicle(id, heading)
          }}
          onWaypoint={setWaypoint}
          onImpact={setImpact}
          onTap={onTap}
          className="h-[480px] sm:h-[600px]"
        />

        <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-2">
          {banner ? (
            <div className="pointer-events-auto flex items-center gap-2 rounded-xl bg-ink px-3 py-2 text-sm font-medium text-white shadow-lg">
              <span className="size-2 animate-pulse rounded-full bg-emerald-400" />
              {banner}
              <button className="ml-1 rounded-lg bg-white/15 px-2 py-0.5 text-xs hover:bg-white/25" onClick={() => setTap(null)}>
                Done
              </button>
            </div>
          ) : (
            <span />
          )}
          <div className="pointer-events-auto mr-12 flex gap-1.5">
            <button className="chip" onClick={play.playing ? play.stop : play.start} disabled={!play.canPlay} aria-pressed={play.playing}>
              {play.playing ? <Icon.stop /> : <Icon.play />} {play.playing ? 'Stop' : 'Play it back'}
            </button>
            <button className="chip" onClick={() => map.current?.recentre()}>
              <Icon.target /> Recentre
            </button>
          </div>
        </div>

        {!touched && !banner && !play.playing && (
          <div className="pointer-events-none absolute inset-x-0 bottom-9 flex justify-center px-3">
            <div className="rounded-full bg-ink/90 px-3.5 py-1.5 text-center text-xs font-medium text-white shadow-lg backdrop-blur">
              Drag a car along the route it took · drag the arrow ahead of its nose to turn it
            </div>
          </div>
        )}
      </div>

      <aside className="space-y-3">
        <div className="card px-4 py-3">
          <span className="label">Draw it on</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Ground">
            {SURFACES.map((s) => (
              <button key={s} className="chip" role="radio" aria-checked={claim.incident.surface === s} aria-pressed={claim.incident.surface === s} onClick={() => setIncident({ surface: s })}>
                {s === 'satellite' || s === 'streets' ? <Icon.layers /> : null}
                {SURFACE_LABEL[s]}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            A garage, a covered car park or a driveway will not show from above. Draw those on the parking lot or the blank sheet.
          </p>
        </div>

        <div className="card divide-y divide-slate-100">
          <div className="px-4 py-3">
            <h2 className="font-semibold">Where did each vehicle end up?</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Drag a car along the route it took: the line it leaves is its path and it turns to face the way you drag. Drag the arrow ahead of its nose to turn it on the spot.
            </p>
          </div>
          {claim.vehicles.map((v) => {
            const on = v.id === selected
            const panel = hit(v)
            return (
              <div key={v.id} className={on ? 'bg-brand-50/60' : ''}>
                <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => select(on ? null : v.id)} aria-pressed={on}>
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg text-sm font-bold text-white" style={{ background: ROLE_COLOR[v.role] }}>
                    {v.id.toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{name(v)}</span>
                    <span className="block text-xs text-slate-500">
                      Facing {facing(v.heading)}
                      {v.path.length > 0 && ' · path drawn'}
                      {panel && <span className="text-red-700"> · hit on the {panel.toLowerCase()}</span>}
                    </span>
                  </span>
                  <span className={`text-slate-400 transition ${on ? 'rotate-90' : ''}`}>
                    <Icon.next />
                  </span>
                </button>
                {on && (
                  <div className="space-y-4 px-4 pb-4">
                    <div>
                      <div className="mb-1 flex items-baseline justify-between">
                        <span className="label mb-0">Which way was it facing?</span>
                        <span className="text-xs font-medium text-slate-600">{facing(v.heading)}</span>
                      </div>
                      <input
                        type="range"
                        className="range"
                        min={0}
                        max={359}
                        value={Math.round(v.heading)}
                        aria-label={`Facing of vehicle ${v.id.toUpperCase()}`}
                        onChange={(e) => turnVehicle(v.id, Number(e.target.value))}
                      />
                      <div className="mt-1 flex justify-between text-[10px] font-medium tracking-wide text-slate-400">
                        <span>N</span>
                        <span>E</span>
                        <span>S</span>
                        <span>W</span>
                        <span>N</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">Or drag the arrow ahead of the car on the map.</p>
                    </div>
                    <div>
                      <span className="label">Where did it come from?</span>
                      <p className="mb-1.5 text-xs text-slate-500">
                        Dragging the car draws this for you. Drag the white dots to adjust it, or add points by hand.
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          className="btn btn-secondary btn-sm"
                          aria-pressed={tap?.kind === 'waypoint' && tap.id === v.id}
                          onClick={() => setTap(tap?.kind === 'waypoint' && tap.id === v.id ? null : { kind: 'waypoint', id: v.id })}
                        >
                          <Icon.pin /> {tap?.kind === 'waypoint' && tap.id === v.id ? 'Tapping… done' : v.path.length ? 'Add a bend' : 'Tap it on the map'}
                        </button>
                        {v.path.length > 0 && (
                          <button className="btn btn-ghost btn-sm" onClick={() => clearPath(v.id)}>
                            <Icon.x /> Clear path
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="card px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 font-semibold">
                Point of impact
                {claim.impact && !impactManual && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-700 uppercase">Found</span>
                )}
              </h2>
              <p className="mt-0.5 text-sm text-slate-500">
                {claim.impact
                  ? impactManual
                    ? 'This is where you said they hit. Drag the red cross to adjust it.'
                    : 'Marked where the vehicles met, and the panel each one was hit on is marked for the next step. Drag the cross if it is not quite right.'
                  : 'Drag the vehicles together and the cross appears where they meet.'}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <button className="btn btn-ghost btn-sm" aria-pressed={tap?.kind === 'impact'} onClick={() => setTap(tap?.kind === 'impact' ? null : { kind: 'impact' })}>
                <span className="grid size-4 place-items-center rounded-full bg-red-600 text-[9px] font-bold text-white">✕</span>
                {tap?.kind === 'impact' ? 'Tap the map…' : claim.impact ? 'Move it' : 'Place it'}
              </button>
              {claim.impact && (
                <button className="btn btn-ghost btn-sm" onClick={() => setImpact(null)} aria-label="Remove the point of impact">
                  <Icon.x />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="card px-4 py-3">
          <Field label="In your own words, what happened?">
            <textarea
              className="input min-h-28"
              placeholder={
                assistOn
                  ? 'For example: I was going straight through the junction on a green light and the other car turned left across me — then let us draw it.'
                  : 'For example: I was going straight through the junction on a green light and the other car turned left across me.'
              }
              value={claim.incident.description}
              onChange={(e) => {
                setIncident({ description: e.target.value })
                setSaid(null)
              }}
            />
          </Field>
          {assistOn && (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <button className="btn btn-secondary btn-sm" onClick={draw} disabled={!!busy || claim.incident.description.trim().length < 15}>
                  {busy === 'diagram' ? <Icon.spinner /> : <Icon.wand />}
                  {busy === 'diagram' ? 'Drawing…' : 'Draw this on the map'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={write} disabled={!!busy || !claim.vehicles.some((v) => v.position)}>
                  {busy === 'describe' ? <Icon.spinner /> : <Icon.pen />}
                  {busy === 'describe' ? 'Writing…' : 'Write it from the diagram'}
                </button>
              </div>
              {busy && <p className="mt-2 text-xs text-slate-500">This takes a few seconds.</p>}
              {said && !busy && (
                <p className="mt-2 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-900 ring-1 ring-brand-100">
                  {said} Everything is still yours to drag.
                </p>
              )}
              {failed && !busy && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">{failed}</p>}
              <p className="mt-2 text-[11px] text-slate-400">
                Written by AI from what you wrote. Read it over and correct anything that is not right — it goes to us as your account of the accident.
              </p>
            </>
          )}
        </div>
      </aside>
    </div>
  )
}
