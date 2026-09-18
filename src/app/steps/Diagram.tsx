import { useEffect, useRef, useState } from 'react'
import { useClaim } from '../../claim/store'
import { assistOn, buildDiagram, writeStatement } from '../../assist/client'
import type { LngLat } from '../../geo'
import { ROLE_COLOR, SURFACES, type ClaimVehicle } from '../../claim/schema'
import { cap, compassKey, vehicleOf } from '../../claim/describe'
import type { Key } from '../../i18n'
import { useLang, useT } from '../../i18n/useT'
import { MapScene, type MapSceneHandle, type TapMode } from '../../map/MapScene'
import { usePlayback } from '../../map/usePlayback'
import { alignToRoad } from '../../scene/road'
import { zoneById } from '../../zones'
import { Describe } from '../Describe'
import { Icon } from '../icons'

type Tap = { kind: 'waypoint'; id: string } | { kind: 'impact' } | null
/** a suggestion offered after a drop: turn this vehicle to this bearing to line it up with the road */
type Align = { id: string; bearing: number } | null

/** worth acting on only past a couple of degrees, so a car already lined up gets no chip */
const ALIGN_OFFER_DEGREES = 2

/** the smaller of the two ways round the compass from `a` to `b`, 0–180° */
const angleDiff = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

export function Diagram() {
  const claim = useClaim((s) => s.claim)
  const autoDamage = useClaim((s) => s.autoDamage)
  const roadWays = useClaim((s) => s.roadWays)
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

  const t = useT()
  const lang = useLang()
  const [selected, setSelected] = useState<string | null>(claim.vehicles[0]?.id ?? null)
  const [tap, setTap] = useState<Tap>(null)
  // offered after a drop, never after a slider or the turn handle: those are already a
  // deliberate choice of heading, not a car left wherever the drag happened to end
  const [align, setAlign] = useState<Align>(null)
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
      setSaid(scene.vehicles.length === 0 ? scene.note || t('scene.assist.nothing') : scene.note)
    } catch (e) {
      setFailed(e instanceof Error ? e.message : t('scene.assist.failed'))
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
      setFailed(e instanceof Error ? e.message : t('scene.assist.failed'))
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
    if (align && align.id !== id) setAlign(null)
  }

  /**
   * A drag just ended: if the road under where it landed runs close to the way the car is
   * already facing, offer to square it up exactly. Only the heading is ever touched here —
   * moving the car for the customer would be putting words in their mouth about where it
   * actually stopped, which is theirs to say, not the road's.
   */
  const onDrop = (id: string) => {
    dropVehicle(id)
    const v = useClaim.getState().claim.vehicles.find((x) => x.id === id)
    const bearing = v?.position ? alignToRoad(roadWays, v.position, v.heading) : null
    setAlign(bearing !== null && v && angleDiff(bearing, v.heading) > ALIGN_OFFER_DEGREES ? { id, bearing } : null)
  }

  const banner =
    tap?.kind === 'impact'
      ? t('scene.banner.impact')
      : tap?.kind === 'waypoint'
        ? t('scene.banner.waypoint', { id: tap.id.toUpperCase() })
        : null

  /** what the diagram says this vehicle was hit on, when it was worked out from the impact */
  const hit = (v: ClaimVehicle) => (autoDamage[v.id] === 'auto' && v.damages[0] ? zoneById(v.body, v.damages[0].zone)?.id : null)

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="card relative overflow-hidden">
        <MapScene
          ref={map}
          center={center}
          style={claim.incident.surface}
          vehicles={claim.vehicles}
          roads={roadWays}
          impact={claim.impact}
          selected={selected}
          lang={lang}
          interactive
          tapMode={tapMode}
          poses={play.poses}
          onSelect={select}
          onGrab={(id) => {
            setTouched(true)
            setAlign(null)
            grabVehicle(id)
          }}
          onDrag={dragVehicle}
          onDrop={onDrop}
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
                {t('scene.banner.done')}
              </button>
            </div>
          ) : (
            <span />
          )}
          <div className="pointer-events-auto mr-12 flex gap-1.5">
            <button className="chip" onClick={play.playing ? play.stop : play.start} disabled={!play.canPlay} aria-pressed={play.playing}>
              {play.playing ? <Icon.stop /> : <Icon.play />} {play.playing ? t('scene.play.stop') : t('scene.play.start')}
            </button>
            <button className="chip" onClick={() => map.current?.recentre()}>
              <Icon.target /> {t('scene.recentre')}
            </button>
          </div>
        </div>

        {!touched && !banner && !play.playing && (
          <div className="pointer-events-none absolute inset-x-0 bottom-9 flex justify-center px-3">
            <div className="rounded-full bg-ink/90 px-3.5 py-1.5 text-center text-xs font-medium text-white shadow-lg backdrop-blur">
              {t('scene.dragHint')}
            </div>
          </div>
        )}
      </div>

      <aside className="space-y-3">
        <div className="card px-4 py-3">
          <span className="label">{t('scene.ground.label')}</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('scene.ground.aria')}>
            {SURFACES.map((s) => (
              <button key={s} className="chip" role="radio" aria-checked={claim.incident.surface === s} aria-pressed={claim.incident.surface === s} onClick={() => setIncident({ surface: s })}>
                {s === 'satellite' || s === 'streets' ? <Icon.layers /> : null}
                {t(`surface.${s}` as Key)}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            {t('scene.ground.note')}
          </p>
        </div>

        <div className="card divide-y divide-slate-100">
          <div className="px-4 py-3">
            <h2 className="font-semibold">{t('scene.list.title')}</h2>
            <p className="mt-0.5 text-sm text-slate-500">{t('scene.list.lead')}</p>
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
                    <span className="block truncate text-sm font-medium">{cap(vehicleOf(v, 'customer', lang))}</span>
                    <span className="block text-xs text-slate-500">
                      {t('scene.vehicle.facing', { dir: t(compassKey(v.heading)) })}
                      {v.path.length > 0 && t('scene.vehicle.path')}
                      {panel && <span className="text-red-700">{t('scene.vehicle.hit', { panel: t(`zone.${panel}` as Key).toLowerCase() })}</span>}
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
                        <span className="label mb-0">{t('scene.facing.label')}</span>
                        <span className="text-xs font-medium text-slate-600">{t(compassKey(v.heading))}</span>
                      </div>
                      <input
                        type="range"
                        className="range"
                        min={0}
                        max={359}
                        value={Math.round(v.heading)}
                        aria-label={t('scene.facing.aria', { id: v.id.toUpperCase() })}
                        onChange={(e) => turnVehicle(v.id, Number(e.target.value))}
                      />
                      <div className="mt-1 flex justify-between text-[10px] font-medium tracking-wide text-slate-400">
                        {t('scene.facing.ticks')
                          .split(',')
                          .map((tick, i) => (
                            <span key={i}>{tick}</span>
                          ))}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{t('scene.facing.note')}</p>
                      {align?.id === v.id && (
                        <div className="mt-2 flex items-center gap-1.5">
                          <button
                            className="chip"
                            onClick={() => {
                              turnVehicle(v.id, align.bearing)
                              setAlign(null)
                            }}
                          >
                            <Icon.rotate /> {t('scene.road.align')}
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setAlign(null)} aria-label={t('scene.road.dismiss')}>
                            <Icon.x />
                          </button>
                        </div>
                      )}
                    </div>
                    <div>
                      <span className="label">{t('scene.path.label')}</span>
                      <p className="mb-1.5 text-xs text-slate-500">{t('scene.path.note')}</p>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          className="btn btn-secondary btn-sm"
                          aria-pressed={tap?.kind === 'waypoint' && tap.id === v.id}
                          onClick={() => setTap(tap?.kind === 'waypoint' && tap.id === v.id ? null : { kind: 'waypoint', id: v.id })}
                        >
                          <Icon.pin />{' '}
                          {tap?.kind === 'waypoint' && tap.id === v.id ? t('scene.path.tapping') : v.path.length ? t('scene.path.bend') : t('scene.path.tap')}
                        </button>
                        {v.path.length > 0 && (
                          <button className="btn btn-ghost btn-sm" onClick={() => clearPath(v.id)}>
                            <Icon.x /> {t('scene.path.clear')}
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
              {/* wraps because "ENCONTRADO" is twice the width of "FOUND": the badge drops, the title does not break */}
              <h2 className="flex flex-wrap items-center gap-2 font-semibold">
                {t('scene.impact.title')}
                {claim.impact && !impactManual && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-700 uppercase">
                    {t('scene.impact.found')}
                  </span>
                )}
              </h2>
              <p className="mt-0.5 text-sm text-slate-500">
                {claim.impact ? (impactManual ? t('scene.impact.manual') : t('scene.impact.auto')) : t('scene.impact.none')}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <button className="btn btn-ghost btn-sm" aria-pressed={tap?.kind === 'impact'} onClick={() => setTap(tap?.kind === 'impact' ? null : { kind: 'impact' })}>
                <span className="grid size-4 place-items-center rounded-full bg-red-600 text-[9px] font-bold text-white">✕</span>
                {tap?.kind === 'impact' ? t('scene.impact.tapping') : claim.impact ? t('scene.impact.move') : t('scene.impact.place')}
              </button>
              {claim.impact && (
                <button className="btn btn-ghost btn-sm" onClick={() => setImpact(null)} aria-label={t('scene.impact.remove')}>
                  <Icon.x />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="card px-4 py-3">
          <Describe
            placeholder={assistOn() ? t('scene.describe.placeholderAssist') : t('scene.describe.placeholder')}
          >
            {assistOn() && (
              <>
                <button className="btn btn-secondary btn-sm" onClick={draw} disabled={!!busy || claim.incident.description.trim().length < 15}>
                  {busy === 'diagram' ? <Icon.spinner /> : <Icon.wand />}
                  {busy === 'diagram' ? t('scene.assist.drawing') : t('scene.assist.draw')}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={write} disabled={!!busy || !claim.vehicles.some((v) => v.position)}>
                  {busy === 'describe' ? <Icon.spinner /> : <Icon.pen />}
                  {busy === 'describe' ? t('scene.assist.writing') : t('scene.assist.write')}
                </button>
              </>
            )}
          </Describe>
          {assistOn() && (
            <>
              {busy && <p className="mt-2 text-xs text-slate-500">{t('scene.assist.wait')}</p>}
              {said && !busy && (
                <p className="mt-2 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-900 ring-1 ring-brand-100">
                  {said} {t('scene.assist.yours')}
                </p>
              )}
              {failed && !busy && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">{failed}</p>}
              <p className="mt-2 text-[11px] text-slate-400">{t('scene.assist.disclaimer')}</p>
            </>
          )}
        </div>
      </aside>
    </div>
  )
}
