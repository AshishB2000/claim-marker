import { useEffect, useRef, useState } from 'react'
import { useClaim } from '../../claim/store'
import { LIGHT, LIGHT_LABEL, ROAD, WEATHER, nowLocal } from '../../claim/schema'
import { reversePlace, searchPlaces, type Place } from '../../geocode'
import type { LngLat } from '../../geo'
import { LocationMap } from '../../map/LocationMap'
import { Field, Spinner } from '../ui'
import { Icon } from '../icons'

export function Where() {
  const incident = useClaim((s) => s.claim.incident)
  const setIncident = useClaim((s) => s.setIncident)
  const setLocation = useClaim((s) => s.setLocation)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Place[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState<'search' | 'locate' | null>(null)
  const [error, setError] = useState<string | null>(null)
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
        if (!ac.signal.aborted) setError('Address search is not responding. You can still drop the pin on the map.')
      } finally {
        if (!ac.signal.aborted) setBusy(null)
      }
    }, 280)
    return () => window.clearTimeout(t)
  }, [query])

  const choose = (p: Place) => {
    setLocation({ lng: p.lng, lat: p.lat, address: p.address })
    picked.current = p.address
    setQuery(p.address)
    setOpen(false)
    setError(null)
  }

  const locate = () => {
    if (!navigator.geolocation) return setError('Your browser does not share location. Search for the address instead.')
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
        setError('We could not get your location. Search for the address, or drop the pin on the map.')
      },
      { enableHighAccuracy: true, timeout: 12_000 },
    )
  }

  // the pin was dragged: keep the coordinates exactly, refresh the address if we can
  const dragged = async (at: LngLat) => {
    const place = await reversePlace(at).catch(() => null)
    setLocation({ lng: at[0], lat: at[1], address: place?.address ?? incident.location?.address ?? '' })
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
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="space-y-5">
        <div className="relative">
          <span className="label">Where did it happen?</span>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-slate-400">
              <Icon.pin />
            </span>
            <input
              className="input pl-10"
              placeholder="Street, junction, car park, landmark…"
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
              aria-label="Where did it happen?"
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
          {busy === 'locate' ? 'Finding you…' : "I'm at the scene — use my location"}
        </button>

        {error && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">{error}</p>}

        {incident.location && (
          <div className="rounded-xl bg-brand-50 px-4 py-3 text-sm ring-1 ring-brand-100">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 text-brand-600">
                <Icon.check />
              </span>
              <div>
                <div className="font-medium">{incident.location.address}</div>
                <div className="mt-0.5 text-xs text-slate-500">Drag the pin on the map to the exact spot if it is slightly off.</div>
              </div>
            </div>
          </div>
        )}

        <Field label="When did it happen?">
          <input
            type="datetime-local"
            className="input"
            value={incident.at}
            max={nowLocal()}
            onChange={(e) => setIncident({ at: e.target.value })}
          />
        </Field>

        <div>
          <span className="label">What were the conditions like?</span>
          <div className="grid grid-cols-3 gap-2">
            <select
              className="input"
              aria-label="Weather"
              value={incident.conditions.weather}
              onChange={(e) => setIncident({ conditions: { ...incident.conditions, weather: e.target.value as typeof incident.conditions.weather } })}
            >
              <option value="">Weather…</option>
              {WEATHER.map((w) => (
                <option key={w} value={w} className="capitalize">
                  {w[0].toUpperCase() + w.slice(1)}
                </option>
              ))}
            </select>
            <select
              className="input"
              aria-label="Road"
              value={incident.conditions.road}
              onChange={(e) => setIncident({ conditions: { ...incident.conditions, road: e.target.value as typeof incident.conditions.road } })}
            >
              <option value="">Road…</option>
              {ROAD.map((r) => (
                <option key={r} value={r}>
                  {r[0].toUpperCase() + r.slice(1)}
                </option>
              ))}
            </select>
            <select
              className="input"
              aria-label="Light"
              value={incident.conditions.light}
              onChange={(e) => setIncident({ conditions: { ...incident.conditions, light: e.target.value as typeof incident.conditions.light } })}
            >
              <option value="">Light…</option>
              {LIGHT.map((l) => (
                <option key={l} value={l}>
                  {LIGHT_LABEL[l]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <LocationMap center={center} onDrag={dragged} className="card h-[420px] overflow-hidden lg:h-[520px]" />
    </div>
  )
}
