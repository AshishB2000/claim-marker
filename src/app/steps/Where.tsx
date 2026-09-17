import { useEffect, useRef, useState } from 'react'
import { sceneKey, useClaim } from '../../claim/store'
import { LIGHT, ROAD, WEATHER, instantOf, nowLocal, sceneContext, type Conditions } from '../../claim/schema'
import { lookedUpLines } from '../../claim/describe'
import { reversePlace, searchPlaces, type Place } from '../../geocode'
import type { LngLat } from '../../geo'
import type { Key } from '../../i18n'
import { useLang, useT } from '../../i18n/useT'
import { LocationMap } from '../../map/LocationMap'
import { fetchWeather, toConditions, toSceneWeather } from '../../scene/weather'
import { fetchRoad } from '../../scene/road'
import { lightFrom, sunPosition } from '../../scene/sun'
import { Field, Spinner } from '../ui'
import { Icon } from '../icons'

/** who the lookup names as its source in the document; the two keyless providers it asks */
const SOURCE = 'open-meteo+osm'

export function Where() {
  const incident = useClaim((s) => s.claim.incident)
  const setIncident = useClaim((s) => s.setIncident)
  const setConditions = useClaim((s) => s.setConditions)
  const setLocation = useClaim((s) => s.setLocation)
  const contextKey = useClaim((s) => s.contextKey)
  const sceneLookedUp = useClaim((s) => s.sceneLookedUp)
  const t = useT()
  const lang = useLang()
  const weatherSelect = useRef<HTMLSelectElement>(null)
  // "That's right" is an acknowledgement, not an answer: it puts the card's buttons to bed and
  // changes nothing in the document, because the values are already in the selects below it.
  // Held as the place-and-hour it was said about, so a new place asks again.
  const [acknowledged, setAcknowledged] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Place[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState<'search' | 'locate' | null>(null)
  const [error, setError] = useState<Key | null>(null)
  const abort = useRef<AbortController | null>(null)
  // the address a result put into the box; searching it again would only reopen the list
  const picked = useRef<string | null>(null)

  const center: LngLat | null = incident.location ? [incident.location.lng, incident.location.lat] : null
  // only biases the ranking; a new location must not re-run the search, so it is read, not depended on
  const bias = useRef(center)
  useEffect(() => {
    bias.current = center
  })

  // suggestions as you type, one request in flight at a time
  useEffect(() => {
    const q = query.trim()
    if (q.length < 3 || query === picked.current) return
    const t = window.setTimeout(async () => {
      abort.current?.abort()
      const ac = new AbortController()
      abort.current = ac
      setBusy('search')
      try {
        const places = await searchPlaces(q, bias.current, ac.signal)
        if (!ac.signal.aborted) {
          setResults(places)
          setActive(0)
          setOpen(true)
          setError(null)
        }
      } catch {
        if (!ac.signal.aborted) setError('start.where.searchDown')
      } finally {
        if (!ac.signal.aborted) setBusy(null)
      }
    }, 280)
    return () => window.clearTimeout(t)
  }, [query])

  /**
   * The place and hour the looked-up scene belongs to. It not matching the one the store has an
   * answer for is what "still looking" means — derived, so there is no second flag to keep in
   * step with the fetch, and so a draft reopened tomorrow asks again rather than showing a
   * cached answer it cannot date.
   */
  const key = sceneKey(incident)
  const looking = key !== null && key !== contextKey

  // the weather at that hour, where the sun was, and the road — from the place and the time
  // alone. Every one of them may fail; the step then behaves exactly as it did before any of
  // this existed, which is why nothing here throws and nothing here blocks.
  useEffect(() => {
    const loc = incident.location
    if (!key || !loc || key === contextKey) return
    const ac = new AbortController()
    const at: LngLat = [loc.lng, loc.lat]
    const when = incident.at
    void (async () => {
      const [w, r] = await Promise.all([fetchWeather(at, when, ac.signal), fetchRoad(at, ac.signal)])
      if (ac.signal.aborted) return
      // Open-Meteo resolves the zone for the coordinates, which is the only thing on the page
      // that can: without it `at` is a wall clock and the sun cannot be placed at all
      const utcOffset = w?.utcOffsetMinutes ?? null
      const instant = instantOf(when, utcOffset)
      const sun = instant !== null ? sunPosition(instant, at) : null
      // only what actually came back: an empty string is an answer ("not given"), and handing
      // one to the store would mark a select as filled-by-us and then leave it blank
      const fill: Partial<Conditions> = {}
      if (w) {
        const c = toConditions(w)
        fill.weather = c.weather
        fill.road = c.road
      }
      if (sun) fill.light = lightFrom(sun.altitude, r?.road.lit ?? null)
      const context = sceneContext({
        weather: w ? toSceneWeather(w) : null,
        sun,
        road: r?.road ?? null,
        source: SOURCE,
        fetchedAt: new Date().toISOString(),
      })
      sceneLookedUp(key, context, utcOffset, fill, r?.ways ?? null)
    })()
    return () => ac.abort()
  }, [key, contextKey, incident.location, incident.at, sceneLookedUp])

  const looked = incident.context ? lookedUpLines(incident.context, incident.conditions, lang) : []

  const choose = (p: Place) => {
    setLocation({ lng: p.lng, lat: p.lat, address: p.address })
    picked.current = p.address
    setQuery(p.address)
    setOpen(false)
    setError(null)
  }

  const locate = () => {
    if (!navigator.geolocation) return setError('start.where.noGeo')
    setBusy('locate')
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const at: LngLat = [coords.longitude, coords.latitude]
        const place = await reversePlace(at).catch(() => null)
        setLocation({ lng: at[0], lat: at[1], address: place?.address ?? `${at[1].toFixed(5)}, ${at[0].toFixed(5)}` })
        picked.current = place?.address ?? ''
        setQuery(place?.address ?? '')
        setBusy(null)
        setError(null)
      },
      () => {
        setBusy(null)
        setError('start.where.locateFailed')
      },
      { enableHighAccuracy: true, timeout: 12_000 },
    )
  }

  // the pin was dragged, or the map tapped: keep the coordinates exactly, find the address if we can
  const dragged = async (at: LngLat) => {
    const place = await reversePlace(at).catch(() => null)
    // a spot with no address — a track, a field, the middle of a car park — is still a spot
    setLocation({ lng: at[0], lat: at[1], address: place?.address ?? incident.location?.address ?? `${at[1].toFixed(5)}, ${at[0].toFixed(5)}` })
    if (place) {
      picked.current = place.address
      setQuery(place.address)
    }
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + results.length) % results.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(results[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-[auto_1fr]">
      <div className="space-y-5 lg:col-start-1">
        <div className="relative">
          <span className="label">{t('start.where.label')}</span>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-slate-400">
              <Icon.pin />
            </span>
            <input
              className="input pl-10"
              placeholder={t('start.where.placeholder')}
              value={query}
              onChange={(e) => {
                picked.current = null
                setQuery(e.target.value)
                if (e.target.value.trim().length < 3) setResults([])
                setOpen(true)
              }}
              onFocus={() => results.length && setOpen(true)}
              onBlur={() => window.setTimeout(() => setOpen(false), 150)}
              onKeyDown={onKey}
              autoComplete="off"
              role="combobox"
              aria-expanded={open}
              aria-controls="place-results"
              aria-label={t('start.where.label')}
            />
            {busy === 'search' && (
              <span className="absolute top-1/2 right-3 -translate-y-1/2">
                <Spinner />
              </span>
            )}
          </div>
          {open && results.length > 0 && (
            <ul id="place-results" role="listbox" className="card absolute z-20 mt-2 w-full overflow-hidden py-1">
              {results.map((p, i) => (
                <li
                  key={p.address}
                  role="option"
                  aria-selected={i === active}
                  className={`cursor-pointer px-4 py-2.5 ${i === active ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(p)}
                >
                  <div className="text-[15px] font-medium">{p.name}</div>
                  <div className="truncate text-xs text-slate-500">{p.address}</div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button className="btn btn-secondary w-full" onClick={locate} disabled={busy === 'locate'}>
          {busy === 'locate' ? <Icon.spinner /> : <Icon.locate />}
          {busy === 'locate' ? t('start.where.finding') : t('start.where.useLocation')}
        </button>

        {error && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">{t(error)}</p>}

        {incident.location && (
          <div className="rounded-xl bg-brand-50 px-4 py-3 text-sm ring-1 ring-brand-100">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 text-brand-600">
                <Icon.check />
              </span>
              <div>
                <div className="font-medium">{incident.location.address}</div>
                <div className="mt-0.5 text-xs text-slate-500">{t('start.where.dragPin')}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="relative lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <LocationMap center={center} onDrag={dragged} className="card h-[320px] overflow-hidden sm:h-[420px] lg:h-full lg:min-h-[520px]" />
        {!center && (
          <div className="pointer-events-none absolute inset-x-0 bottom-9 flex justify-center px-4">
            <div className="rounded-full bg-ink/90 px-4 py-2 text-center text-xs font-medium text-white shadow-lg backdrop-blur">
              {t('start.where.tapHint')}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-5 lg:col-start-1">
        <Field label={t('start.where.when')}>
          <input
            type="datetime-local"
            className="input"
            value={incident.at}
            max={nowLocal()}
            onChange={(e) => setIncident({ at: e.target.value })}
          />
        </Field>

        {incident.location && (looking || looked.length > 0) && (
          <div data-looked className="rounded-xl bg-slate-50 px-4 py-3 text-sm ring-1 ring-slate-200">
            <div className="font-medium">{t('start.where.looked.title')}</div>
            {looking ? (
              <p className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
                <Spinner /> {t('start.where.looked.busy')}
              </p>
            ) : (
              <>
                <ul data-looked-lines className="mt-1.5 space-y-0.5 text-slate-700">
                  {looked.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p className="mt-1.5 text-xs text-slate-500">{t('start.where.looked.lead')}</p>
                {acknowledged !== key && (
                  <div className="mt-2.5 flex gap-2">
                    <button className="btn btn-secondary btn-sm" onClick={() => setAcknowledged(key)}>
                      {t('start.where.looked.right')}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => weatherSelect.current?.focus()}>
                      {t('start.where.looked.wrong')}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div>
          <span className="label">{t('start.where.conditions')}</span>
          <div className="grid grid-cols-3 gap-2">
            <select
              ref={weatherSelect}
              className="input"
              aria-label={t('start.where.weather')}
              value={incident.conditions.weather}
              onChange={(e) => setConditions({ weather: e.target.value as typeof incident.conditions.weather })}
            >
              <option value="">{t('start.where.pickWeather')}</option>
              {WEATHER.map((w) => (
                <option key={w} value={w}>
                  {t(`weather.${w}` as Key)}
                </option>
              ))}
            </select>
            <select
              className="input"
              aria-label={t('start.where.road')}
              value={incident.conditions.road}
              onChange={(e) => setConditions({ road: e.target.value as typeof incident.conditions.road })}
            >
              <option value="">{t('start.where.pickRoad')}</option>
              {ROAD.map((r) => (
                <option key={r} value={r}>
                  {t(`road.${r}` as Key)}
                </option>
              ))}
            </select>
            <select
              className="input"
              aria-label={t('start.where.light')}
              value={incident.conditions.light}
              onChange={(e) => setConditions({ light: e.target.value as typeof incident.conditions.light })}
            >
              <option value="">{t('start.where.pickLight')}</option>
              {LIGHT.map((l) => (
                <option key={l} value={l}>
                  {t(`light.${l}` as Key)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  )
}
