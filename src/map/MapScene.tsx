/**
 * The accident on a real map, or on a drawn ground: MapLibre underneath, a three.js custom
 * layer for the vehicles, and DOM markers for everything a finger has to grab.
 *
 * It is a diagram, so the map stays north-up and top-down: no rotating, no tilting. Every
 * vehicle has one marker, its own footprint at the map's scale, turned to its heading: drag
 * the body to move it, drag the handle ahead of its nose to turn it. Where it came from is
 * drawn by the drag, or tapped onto the map in tap mode, and those points can be dragged.
 * Given `poses`, the 3D cars follow those instead of the vehicles — playback — and the
 * markers step aside until it is over.
 */
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import './worker'
import { GeoJSONSource, Map as MapLibreMap, Marker, NavigationControl, ScaleControl, type LngLatLike } from 'maplibre-gl'
import type { Feature } from 'geojson'
import { bearing, destination, type LngLat } from '../geo'
import { ROLE_COLOR, type ClaimVehicle } from '../claim/schema'
import { SIZE } from '../vehicles/bodies'
import { CarLayer, type CarPose } from './carLayer'
import { styleFor, type MapStyle } from './styles'

export type MapSceneHandle = {
  /** PNG data URL of the map, the cars, and the labels — what the customer is looking at */
  export: () => string
  /** back to the incident at the default zoom */
  recentre: () => void
}

/** what a tap on the map means right now */
export type TapMode = 'none' | 'waypoint' | 'impact'

export type MapSceneProps = {
  center: LngLat
  style: MapStyle
  /** only vehicles with a position are drawn */
  vehicles: ClaimVehicle[]
  impact: LngLat | null
  selected: string | null
  /** false on the review page: no handles, no dragging, no map controls */
  interactive: boolean
  tapMode?: TapMode
  /** a playback frame; while it is set the cars follow it and the markers hide */
  poses?: CarPose[] | null
  onSelect?: (id: string | null) => void
  /** a car was picked up, is being dragged, was let go */
  onGrab?: (id: string) => void
  onDrag?: (id: string, at: LngLat) => void
  onDrop?: (id: string) => void
  /** the handle ahead of the nose was dragged: the car should face this way */
  onTurn?: (id: string, heading: number) => void
  onWaypoint?: (id: string, index: number, at: LngLat) => void
  onImpact?: (at: LngLat) => void
  /** a tap on the map while `tapMode` is not "none" */
  onTap?: (at: LngLat) => void
  className?: string
  ref?: Ref<MapSceneHandle>
}

/** close enough that a sedan is eighty pixels long; the imagery overscales gracefully past 19 */
const ZOOM = 19.9
/** the label floats this far above the car's footprint, in pixels */
const LABEL_GAP = 18

const ll = ([lng, lat]: LngLat): LngLatLike => ({ lng, lat })
const fromLL = (p: { lng: number; lat: number }): LngLat => [p.lng, p.lat]

/** ground metres per screen pixel at this latitude and zoom, for 512 px tiles */
const metresPerPixel = (lat: number, zoom: number) => (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom)

const el = (className: string, color?: string) => {
  const d = document.createElement('div')
  d.className = className
  if (color) d.style.setProperty('--mk-color', color)
  return d
}

/** an arrowhead for the end of a travel path, drawn once and registered with the style */
function arrowImage(): ImageData {
  const c = document.createElement('canvas')
  c.width = c.height = 48
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.moveTo(24, 2)
  ctx.lineTo(44, 44)
  ctx.lineTo(24, 34)
  ctx.lineTo(4, 44)
  ctx.closePath()
  ctx.fill()
  return ctx.getImageData(0, 0, 48, 48)
}

/** the dash pattern marches towards the vehicle: direction of travel as motion, not playback */
const DASH_STEPS: number[][] = [
  [0, 4, 3],
  [0.5, 4, 2.5],
  [1, 4, 2],
  [1.5, 4, 1.5],
  [2, 4, 1],
  [2.5, 4, 0.5],
  [3, 4, 0],
  [0, 0.5, 3, 3.5],
  [0, 1, 3, 3],
  [0, 1.5, 3, 2.5],
  [0, 2, 3, 2],
  [0, 2.5, 3, 1.5],
  [0, 3, 3, 1],
  [0, 3.5, 3, 0.5],
]

type Handles = { car: Marker; tagwrap: HTMLElement; tag: HTMLElement; ways: Marker[] }

/** everything created for one map instance, so the cleanup can tear down exactly that */
type Live = {
  map: MapLibreMap
  cars: CarLayer
  handles: Map<string, Handles>
  impact: Marker | null
  styleReady: boolean
  /** the ground the map was last given, so a re-render does not reload the same style */
  style: MapStyle
}

type Props = Omit<MapSceneProps, 'className' | 'ref'>

/** the footprint's size on screen for this vehicle at the map's zoom, in pixels */
function footprint(v: ClaimVehicle, map: MapLibreMap) {
  const mpp = metresPerPixel(v.position![1], map.getZoom())
  return { w: SIZE[v.body].width / mpp, l: SIZE[v.body].length / mpp }
}

/** size the footprint to the car and keep the label upright above it, whatever way it faces */
function fit(h: Handles, v: ClaimVehicle, map: MapLibreMap) {
  const { w, l } = footprint(v, map)
  const root = h.car.getElement()
  root.style.setProperty('--w', `${w}px`)
  root.style.setProperty('--l', `${l}px`)
  h.tagwrap.style.transform = `rotate(${-v.heading}deg) translateY(${-(Math.max(w, l) / 2 + LABEL_GAP)}px)`
}

export function MapScene({ className, ref, ...props }: MapSceneProps) {
  const container = useRef<HTMLDivElement>(null)
  const live = useRef<Live | null>(null)
  // the latest props, for handlers that were created once; written after render, never during
  const latest = useRef<Props>(props)
  useEffect(() => {
    latest.current = props
  })
  // what the map was created with; it is built once and everything else is an update
  const [init] = useState(() => ({ center: props.center, style: props.style, interactive: props.interactive }))

  // ── the map itself, once ────────────────────────────────────────────
  useEffect(() => {
    const map = new MapLibreMap({
      container: container.current!,
      style: styleFor(init.style, init.center),
      center: ll(init.center),
      zoom: ZOOM,
      pitch: 0,
      bearing: 0,
      maxPitch: 0,
      minZoom: 16,
      maxZoom: 21,
      attributionControl: { compact: true },
      canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
      interactive: init.interactive,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    })
    map.touchZoomRotate.disableRotation()
    map.keyboard.disableRotation()
    if (init.interactive) map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new ScaleControl({ maxWidth: 90, unit: 'metric' }), 'bottom-left')
    const state: Live = { map, cars: new CarLayer(init.center), handles: new Map(), impact: null, styleReady: false, style: init.style }
    live.current = state
    // a handle for poking at the live map from the console; never in production
    if (import.meta.env.DEV) Object.assign(window, { __map: map })

    map.on('style.load', () => {
      map.addImage('cm-arrow', arrowImage(), { sdf: true })
      map.addSource('paths', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource('heads', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'paths-base',
        type: 'line',
        source: 'paths',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 8, 'line-opacity': 0.85 },
      })
      map.addLayer({
        id: 'paths-flow',
        type: 'line',
        source: 'paths',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 3, 'line-opacity': 0.9, 'line-dasharray': DASH_STEPS[0] },
      })
      map.addLayer({
        id: 'heads',
        type: 'symbol',
        source: 'heads',
        layout: {
          'icon-image': 'cm-arrow',
          'icon-size': 0.6,
          'icon-rotate': ['get', 'bearing'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: { 'icon-color': ['get', 'color'] },
      })
      map.addLayer(state.cars)
      state.styleReady = true
      pushGeometry(map, latest.current.vehicles)
      state.cars.setPoses(latest.current.poses ?? posesOf(latest.current.vehicles))
    })

    // the footprints are in metres, so they grow and shrink with the zoom
    map.on('zoom', () => {
      for (const [id, h] of state.handles) {
        const v = latest.current.vehicles.find((x) => x.id === id)
        if (v?.position) fit(h, v, map)
      }
    })

    // direction of travel: the white dashes creep along the line towards the car
    let step = 0
    let last = 0
    let raf = 0
    const flow = (t: number) => {
      if (t - last > 70 && state.styleReady && map.getLayer('paths-flow')) {
        step = (step + 1) % DASH_STEPS.length
        map.setPaintProperty('paths-flow', 'line-dasharray', DASH_STEPS[step])
        last = t
      }
      raf = requestAnimationFrame(flow)
    }
    if (init.interactive) raf = requestAnimationFrame(flow)

    map.on('click', (e) => {
      const p = latest.current
      if (p.tapMode && p.tapMode !== 'none') p.onTap?.(fromLL(e.lngLat))
      else p.onSelect?.(null)
    })

    return () => {
      cancelAnimationFrame(raf)
      for (const h of state.handles.values()) removeHandles(h)
      state.handles.clear()
      state.impact?.remove()
      map.remove()
      live.current = null
    }
  }, [init])

  // by value, not identity: callers rebuild the tuple every render
  const [lng, lat] = props.center

  // ── style switch; a drawn ground is laid out around the incident ────
  // Not gated on isStyleLoaded(): with any GeoJSON source in the style it reports false for
  // as long as the map lives, which silently swallowed every switch.
  useEffect(() => {
    const s = live.current
    if (!s || s.style === props.style) return
    s.style = props.style
    s.styleReady = false
    // a full replacement, not a diff: a diff keeps the paths, heads and cars that were added
    // at runtime and puts the new ground above them, then fires style.load into a map that
    // already has everything the handler adds
    s.map.setStyle(styleFor(props.style, [lng, lat]), { diff: false })
  }, [props.style, lng, lat])

  // ── the location moved: recentre and move the floating origin ───────
  useEffect(() => {
    live.current?.map.jumpTo({ center: { lng, lat } })
    live.current?.cars.setOrigin([lng, lat])
  }, [lng, lat])

  // ── the cursor says the map is waiting for a tap ───────────────────
  const tapMode = props.tapMode ?? 'none'
  useEffect(() => {
    live.current?.map.getContainer().classList.toggle('mk-tap', tapMode !== 'none')
  }, [tapMode])

  // ── vehicles: footprints, labels, turn handles, waypoints, paths ────
  const { vehicles, selected, interactive } = props
  useEffect(() => {
    const s = live.current
    if (!s) return
    const { map, handles } = s
    const seen = new Set<string>()
    for (const v of vehicles) {
      if (!v.position) continue
      seen.add(v.id)
      const color = ROLE_COLOR[v.role]
      let h = handles.get(v.id)
      if (!h) {
        const root = el('mk-car', color)
        root.appendChild(el('mk-body'))
        const turn = el('mk-turn')
        turn.title = 'Drag to turn'
        root.appendChild(turn)
        const tagwrap = el('mk-tagwrap')
        const tag = document.createElement('span')
        tag.className = 'mk-tag'
        tag.style.background = color
        tagwrap.appendChild(tag)
        root.appendChild(tagwrap)

        const car = new Marker({ element: root, draggable: interactive, anchor: 'center', rotationAlignment: 'map', rotation: v.heading })
          .setLngLat(ll(v.position))
          .addTo(map)
        car.on('dragstart', () => latest.current.onGrab?.(v.id))
        car.on('drag', () => latest.current.onDrag?.(v.id, fromLL(car.getLngLat())))
        car.on('dragend', () => latest.current.onDrop?.(v.id))
        root.addEventListener('click', (e) => {
          e.stopPropagation()
          latest.current.onSelect?.(v.id)
        })

        // the turn handle: the marker's own drag must not start, so the mouse and touch
        // events MapLibre listens for stop here, and the pointer does the work
        const swallow = (e: Event) => e.stopPropagation()
        turn.addEventListener('mousedown', swallow)
        turn.addEventListener('touchstart', swallow, { passive: true })
        turn.addEventListener('pointerdown', (e) => {
          if (!latest.current.interactive) return
          e.preventDefault()
          e.stopPropagation()
          turn.setPointerCapture(e.pointerId)
          const move = (ev: PointerEvent) => {
            const at = latest.current.vehicles.find((x) => x.id === v.id)?.position
            if (!at) return
            const c = map.project(ll(at))
            const r = map.getContainer().getBoundingClientRect()
            const dx = ev.clientX - r.left - c.x
            const dy = ev.clientY - r.top - c.y
            latest.current.onTurn?.(v.id, Math.round(((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360))
          }
          const done = () => {
            turn.removeEventListener('pointermove', move)
            turn.removeEventListener('pointerup', done)
            turn.removeEventListener('pointercancel', done)
          }
          turn.addEventListener('pointermove', move)
          turn.addEventListener('pointerup', done)
          turn.addEventListener('pointercancel', done)
        })

        h = { car, tagwrap, tag, ways: [] }
        handles.set(v.id, h)
      }
      const damaged = v.damages.length
      h.tag.textContent = v.id.toUpperCase()
      if (damaged) {
        const n = document.createElement('span')
        n.textContent = `${damaged} damage${damaged === 1 ? '' : 's'}`
        n.style.opacity = '0.85'
        n.style.fontWeight = '500'
        h.tag.appendChild(n)
      }
      h.car.getElement().dataset.selected = String(v.id === selected)
      h.car.setLngLat(ll(v.position))
      h.car.setRotation(v.heading)
      fit(h, v, map)

      // waypoints exist only for the selected vehicle
      const active = interactive && v.id === selected
      const wanted = active ? v.path.length : 0
      while (h.ways.length > wanted) h.ways.pop()!.remove()
      while (h.ways.length < wanted) {
        const index = h.ways.length
        const way = new Marker({ element: el('mk-way', color), draggable: true, anchor: 'center' }).setLngLat(ll(v.path[index])).addTo(map)
        way.on('drag', () => latest.current.onWaypoint?.(v.id, index, fromLL(way.getLngLat())))
        h.ways.push(way)
      }
      h.ways.forEach((w, i) => w.setLngLat(ll(v.path[i])))
    }
    for (const [id, h] of handles) {
      if (!seen.has(id)) {
        removeHandles(h)
        handles.delete(id)
      }
    }

    if (s.styleReady) pushGeometry(map, vehicles)
    s.cars.setPoses(latest.current.poses ?? posesOf(vehicles))
  }, [vehicles, selected, interactive])

  // ── playback: the cars follow the frame, the handles step aside ─────
  const { poses } = props
  useEffect(() => {
    const s = live.current
    if (!s) return
    s.map.getContainer().classList.toggle('mk-playing', !!poses)
    s.cars.setPoses(poses ?? posesOf(latest.current.vehicles))
  }, [poses])

  // ── impact ──────────────────────────────────────────────────────────
  const { impact } = props
  useEffect(() => {
    const s = live.current
    if (!s) return
    if (!impact) {
      s.impact?.remove()
      s.impact = null
      return
    }
    let mk = s.impact
    if (!mk) {
      const e = el('mk-impact')
      e.textContent = '✕'
      e.title = 'Point of impact'
      const marker = new Marker({ element: e, draggable: interactive, anchor: 'center' }).setLngLat(ll(impact)).addTo(s.map)
      marker.on('drag', () => latest.current.onImpact?.(fromLL(marker.getLngLat())))
      s.impact = marker
      mk = marker
    }
    mk.setLngLat(ll(impact))
  }, [impact, interactive])

  useImperativeHandle(
    ref,
    () => ({
      export: () => {
        const s = live.current
        if (!s) return ''
        return compose(s.map, latest.current.vehicles, latest.current.impact)
      },
      recentre: () => live.current?.map.easeTo({ center: ll(latest.current.center), zoom: ZOOM, duration: 700 }),
    }),
    [],
  )

  return <div ref={container} className={className} />
}

function removeHandles(h: Handles) {
  h.car.remove()
  for (const w of h.ways) w.remove()
}

const posesOf = (vehicles: ClaimVehicle[]): CarPose[] =>
  vehicles
    .filter((v) => v.position)
    .map((v) => ({ id: v.id, body: v.body, color: v.color, position: v.position!, heading: v.heading }))

/** the travel paths and their arrowheads, as GeoJSON the style layers draw */
function pushGeometry(map: MapLibreMap, vehicles: ClaimVehicle[]) {
  const paths: Feature[] = []
  const heads: Feature[] = []
  for (const v of vehicles) {
    if (!v.position || v.path.length === 0) continue
    const coords = [...v.path, v.position]
    const color = ROLE_COLOR[v.role]
    paths.push({ type: 'Feature', properties: { color }, geometry: { type: 'LineString', coordinates: coords } })
    const last = coords[coords.length - 2]
    // the head sits short of the car so the body does not hide it
    const at = destination(v.position, bearing(v.position, last), 2.8)
    heads.push({ type: 'Feature', properties: { color, bearing: bearing(last, v.position) }, geometry: { type: 'Point', coordinates: at } })
  }
  const pathSource = map.getSource('paths')
  const headSource = map.getSource('heads')
  if (pathSource instanceof GeoJSONSource) pathSource.setData({ type: 'FeatureCollection', features: paths })
  if (headSource instanceof GeoJSONSource) headSource.setData({ type: 'FeatureCollection', features: heads })
}

/**
 * The exported picture: the map canvas holds the ground, the paths and the 3D cars; the
 * labels and the impact cross are DOM, so they are drawn on top by hand at their projected
 * positions. What comes out is what the customer saw.
 */
function compose(map: MapLibreMap, vehicles: ClaimVehicle[], impact: LngLat | null): string {
  const src = map.getCanvas()
  const dpr = src.width / src.clientWidth || 1
  const out = document.createElement('canvas')
  out.width = src.width
  out.height = src.height
  const ctx = out.getContext('2d')!
  ctx.drawImage(src, 0, 0)
  ctx.scale(dpr, dpr)
  const font = getComputedStyle(document.body).fontFamily
  ctx.font = `600 12px ${font}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const pill = (x: number, y: number, text: string, fill: string) => {
    const w = ctx.measureText(text).width + 18
    ctx.fillStyle = 'rgba(255,255,255,0.95)'
    ctx.beginPath()
    ctx.roundRect(x - w / 2 - 2, y - 13, w + 4, 26, 13)
    ctx.fill()
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.roundRect(x - w / 2, y - 11, w, 22, 11)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.fillText(text, x, y + 0.5)
  }

  for (const v of vehicles) {
    if (!v.position) continue
    const p = map.project(ll(v.position))
    const { w, l } = footprint(v, map)
    const damaged = v.damages.length
    pill(p.x, p.y - (Math.max(w, l) / 2 + LABEL_GAP), damaged ? `${v.id.toUpperCase()} · ${damaged} damage${damaged === 1 ? '' : 's'}` : v.id.toUpperCase(), ROLE_COLOR[v.role])
  }
  if (impact) {
    const p = map.project(ll(impact))
    ctx.fillStyle = 'rgba(255,255,255,0.95)'
    ctx.beginPath()
    ctx.arc(p.x, p.y, 17, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#dc2626'
    ctx.beginPath()
    ctx.arc(p.x, p.y, 14, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = `700 15px ${font}`
    ctx.fillText('✕', p.x, p.y + 1)
  }
  return out.toDataURL('image/png')
}
