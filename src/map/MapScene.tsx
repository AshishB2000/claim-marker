/**
 * The accident on a real map, or on a drawn ground: MapLibre underneath, a three.js custom
 * layer for the vehicles, and DOM markers for everything a finger has to grab.
 *
 * It is a diagram, so the map stays north-up and top-down: no rotating, no tilting. Every
 * vehicle has one marker, its own footprint at the map's scale, turned to its heading: drag
 * the body to move it, drag the handle ahead of its nose to turn it. Where it came from is
 * drawn by the drag, or tapped onto the map in tap mode, and those points can be dragged.
 * Given `poses`, the 3D cars follow those instead of the vehicles — playback — and the
 * markers step aside until it is over. In `mode="cinematic"` the playback also drives the
 * camera: the map is allowed to tilt for exactly that long, chases the customer's car and
 * comes back flat before the markers return, so nothing is ever edited tilted.
 */
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import './worker'
import { GeoJSONSource, Map as MapLibreMap, Marker, NavigationControl, ScaleControl, type ExpressionSpecification, type LngLatLike } from 'maplibre-gl'
import type { Feature, FeatureCollection } from 'geojson'
import { bearing, destination, type LngLat } from '../geo'
import { translate, type Lang } from '../i18n'
import { ROLE_COLOR, type ClaimVehicle } from '../claim/schema'
import { SIZE } from '../vehicles/bodies'
import { CarLayer, shockRing, type CarPose } from './carLayer'
import { MAX_PITCH, cameraAt, ringAt, sharedTimeline, shotAt, shots, timelineOf, type Camera, type PlaybackMode, type Shot, type Timeline } from './playback'
import { damageCount, paintOverlay, recordPlayback, type OverlayLabel } from './record'
import { reducedMotion } from './usePlayback'
import { styleFor, type MapStyle } from './styles'

export type MapSceneHandle = {
  /** PNG data URL of the map, the cars, and the labels — what the customer is looking at */
  export: () => string
  /** back to the incident at the default zoom */
  recentre: () => void
  /**
   * The diagram's playback, recorded as a video: the vehicles' routes into the impact, held
   * there, then handed back exactly as it was — `cinematic` records the camera moves and the
   * ghosts too, and falls back to the flat replay when the viewer asked for less motion. Null
   * when the browser cannot record it or there is nothing to play — never throws.
   */
  record: (mode?: PlaybackMode) => Promise<Blob | null>
  /**
   * Hand the map back flat and idle: any playback running on it is ended, the cars go back to
   * rest, a cinematic camera jumps to the view it was let off at, and this resolves once the
   * map has painted that way.
   * What `export()` and `record()` are worth depends on it — a still taken mid-chase is a
   * tilted frame with a shockwave in it — so the review page's send calls it first.
   */
  stop: () => Promise<void>
}

/** what a tap on the map means right now */
export type TapMode = 'none' | 'waypoint' | 'impact'

export type MapSceneProps = {
  center: LngLat
  style: MapStyle
  /** only vehicles with a position are drawn */
  vehicles: ClaimVehicle[]
  /** the ways around the incident, drawn as a road under the cars; on the two real-map grounds only */
  roads?: FeatureCollection | null
  /**
   * The building footprints around the incident, extruded to the `height` property each one
   * carries. Flat footprints under everything while the map is flat, a city once a cinematic
   * replay tilts the camera; like the road, only on the two real-map grounds.
   */
  buildings?: FeatureCollection | null
  impact: LngLat | null
  selected: string | null
  /** false on the review page: no handles, no dragging, no map controls */
  interactive: boolean
  tapMode?: TapMode
  /** a playback frame; while it is set the cars follow it and the markers hide */
  poses?: CarPose[] | null
  /**
   * How a playback is shown. `diagram` (the default) keeps the map exactly as it is drawn:
   * flat, north-up. `cinematic` opens the camera for as long as `poses` is set — tilted,
   * behind the customer's car, slowed into the impact with a shockwave — driven by `clock`,
   * the playback's own time in ms from `usePlayback`.
   */
  mode?: PlaybackMode
  clock?: number
  /**
   * A second account's vehicles, drawn faintly over the first for the desk's `Compare` view —
   * somebody else's story of the same cars, not something to edit: no markers, no drag or turn
   * handles, no labels, just the body at reduced opacity and its travel path dashed. Absent or
   * empty leaves the map exactly as it is without this prop; the customer's page never passes it.
   */
  ghosts?: ClaimVehicle[] | null
  /** the ghosts at a moment of the same playback; without it they stand where they came to rest */
  ghostPoses?: CarPose[] | null
  /**
   * The vehicle the cinematic camera chases, by id — a ghost's id as readily as one of
   * `vehicles`, which is how the desk swaps to the other driver's car. Unset follows the
   * reporter's own, as `shots` always did.
   */
  follow?: string
  /** the playback running on this map should stop: `export()` and `record()` say so before they take the map over */
  onPlaybackStop?: () => void
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
  /** the language of the words on the map; the claims desk renders this too and stays English */
  lang?: Lang
  className?: string
  ref?: Ref<MapSceneHandle>
}

/** close enough that a sedan is eighty pixels long; the imagery overscales gracefully past 19 */
const ZOOM = 19.9
/** the white flow line along a travel path, and how wide it becomes as a light trail in slow motion */
const FLOW_WIDTH = 3
const TRAIL_WIDTH = 7
/** the label floats this far above the car's footprint, in pixels */
const LABEL_GAP = 18

const ll = ([lng, lat]: LngLat): LngLatLike => ({ lng, lat })
const fromLL = (p: { lng: number; lat: number }): LngLat => [p.lng, p.lat]

/** ground metres per screen pixel at this latitude and zoom, for 512 px tiles */
const metresPerPixel = (lat: number, zoom: number) => (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom)

/** the map's own minZoom/maxZoom, below — the range the road layers' width has to stay correct across */
const ROAD_ZOOM_MIN = 16
const ROAD_ZOOM_MAX = 21

/** a lane's width in metres; OSM's `lanes` tag when the way has one, two lanes otherwise */
const roadMetres: ExpressionSpecification = ['*', ['coalesce', ['get', 'lanes'], 2], 3.5]

/**
 * A road drawn in real metres, not screen pixels. A constant pixel width would read as a
 * hairline at street zoom and swallow the cars zoomed in on them, because the ground one
 * pixel covers halves with every zoom level the map goes up. `interpolate`/`exponential` base
 * 2 on `['zoom']` doubles the same way, so two stops — in pixels-per-metre at the incident's
 * own latitude — reproduce that exact curve at every zoom in between.
 *
 * The `interpolate` has to be the **outermost** expression. MapLibre allows `['zoom']` only as
 * the direct input of a top-level `interpolate` or `step`; wrapping one in an `['*', …]` —
 * which reads more naturally, "the lane width times the scale" — validates as "zoom
 * expressions not supported", and a layer whose paint fails validation is **dropped with an
 * error on the map's event bus and nothing else**. The map then looks exactly as it did, with
 * the source sitting there and no layer drawing it, which is a long afternoon. So the lane
 * count multiplies each stop instead.
 */
function roadLineWidth(lat: number, metres: ExpressionSpecification): ExpressionSpecification {
  const px = (zoom: number) => ['*', metres, 1 / metresPerPixel(lat, zoom)] as ExpressionSpecification
  return ['interpolate', ['exponential', 2], ['zoom'], ROAD_ZOOM_MIN, px(ROAD_ZOOM_MIN), ROAD_ZOOM_MAX, px(ROAD_ZOOM_MAX)]
}

/** the road and the buildings are real things, so they belong only on the two real-map grounds */
const onRealGround = (style: MapStyle): 'visible' | 'none' => (style === 'satellite' || style === 'streets' ? 'visible' : 'none')

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

type Handles = { car: Marker; turn: HTMLElement; tagwrap: HTMLElement; tag: HTMLElement; ways: Marker[] }

/** one cinematic replay, from the moment the camera is let off the leash to the moment it is handed back */
type Cinematic = {
  shots: Shot[]
  /** the id the shot list was built to chase, so a Swap mid-playback re-cuts it */
  follow: string | undefined
  timeline: Timeline
  /** the view the customer left, restored exactly at the end */
  home: Camera
  ring: ReturnType<typeof shockRing>
  /** the light trails: which dash step is showing, and whether they are on */
  step: number
  slow: boolean
}

/** everything created for one map instance, so the cleanup can tear down exactly that */
type Live = {
  map: MapLibreMap
  cars: CarLayer
  handles: Map<string, Handles>
  impact: Marker | null
  styleReady: boolean
  /** the ground the map was last given, so a re-render does not reload the same style */
  style: MapStyle
  /** set while a cinematic replay has the camera */
  cine: Cinematic | null
  /** set while the recorder owns the map: the playback effects keep their hands off it */
  recording: boolean
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
    const state: Live = { map, cars: new CarLayer(init.center), handles: new Map(), impact: null, styleReady: false, style: init.style, cine: null, recording: false }
    live.current = state
    // a handle for poking at the live map from the console; never in production. On its own
    // element too, for a page with more than one map: the desk's compare view has three, and
    // `window.__map` is whichever was made last
    if (import.meta.env.DEV) {
      Object.assign(window, { __map: map })
      Object.assign(container.current!, { __map: map })
    }

    map.on('style.load', () => {
      map.addImage('cm-arrow', arrowImage(), { sdf: true })

      // the road under the cars: a dark casing and a white core, added — hence drawn — before
      // (below) the travel paths, so a path always reads as drawn over the road, never under
      // it. style.load fires again on every ground switch, a full style replacement rather
      // than a diff, so this handler has to pick the right initial visibility and geometry
      // itself each time rather than relying on whatever an effect set on the previous style.
      const groundVisibility = onRealGround(state.style)

      // the city around the crash, added — hence drawn — first of everything this handler
      // adds, so the road, the paths, the markers' cars and the shockwave are all over it.
      // Flat map, flat footprint; it is only a city when the cinematic replay tilts the camera.
      //
      // The grey is light but deliberately short of white: everything the replay draws over it
      // — the shockwave's ring, the travel paths' flow line, the labels — is white, and a city
      // of near-white blocks would swallow all three. At 0.85 over the brightest imagery there
      // is, no channel of this colour reaches 200, so a wall never passes for one of them.
      map.addSource('buildings', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'buildings',
        type: 'fill-extrusion',
        source: 'buildings',
        layout: { visibility: groundVisibility },
        paint: {
          'fill-extrusion-color': '#b4b8bf',
          'fill-extrusion-opacity': 0.85,
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-base': 0,
        },
      })
      pushCollection(map, 'buildings', latest.current.buildings)

      map.addSource('roads', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      const roadLat = init.center[1]
      map.addLayer({
        id: 'roads-casing',
        type: 'line',
        source: 'roads',
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: groundVisibility },
        paint: { 'line-color': '#3a4150', 'line-width': roadLineWidth(roadLat, roadMetres), 'line-opacity': 0.9 },
      })
      map.addLayer({
        id: 'roads-core',
        type: 'line',
        source: 'roads',
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: groundVisibility },
        paint: { 'line-color': '#ffffff', 'line-width': roadLineWidth(roadLat, ['*', roadMetres, 0.6]), 'line-opacity': 0.85 },
      })
      pushCollection(map, 'roads', latest.current.roads)

      // the other account's travel paths: dashed, same colour family, under the first
      // account's own paths and heads so a ghost never reads as the primary story
      map.addSource('ghost-paths', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'ghost-paths',
        type: 'line',
        source: 'ghost-paths',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 6, 'line-opacity': 0.5, 'line-dasharray': [2, 2] },
      })
      pushGhostGeometry(map, latest.current.ghosts ?? [])

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
      state.cars.setGhosts(posesOf(latest.current.ghosts ?? []))
    })

    // the footprints are in metres, so they grow and shrink with the zoom
    map.on('zoom', () => {
      for (const [id, h] of state.handles) {
        const v = latest.current.vehicles.find((x) => x.id === id)
        if (v?.position) fit(h, v, map)
      }
    })

    // direction of travel: the white dashes creep along the line towards the car; the
    // cinematic replay steps them itself, faster, while its light trails are lit
    let step = 0
    let last = 0
    let raf = 0
    const flow = (t: number) => {
      if (t - last > 70 && state.styleReady && !state.cine?.slow && map.getLayer('paths-flow')) {
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

  // ── the road and the buildings are only real on the two real-map grounds ─
  // The style.load handler above already sets the right visibility whenever the style itself
  // reloads (which every ground switch does); this effect is what applies it the rest of the
  // time, so it degrades gracefully if the layers do not exist yet.
  useEffect(() => {
    const s = live.current
    if (!s) return
    const visibility = onRealGround(props.style)
    for (const id of ['buildings', 'roads-casing', 'roads-core']) {
      if (s.map.getLayer(id)) s.map.setLayoutProperty(id, 'visibility', visibility)
    }
  }, [props.style])

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
  const lang = props.lang ?? 'en'
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

        h = { car, turn, tagwrap, tag, ways: [] }
        handles.set(v.id, h)
      }
      const damaged = v.damages.length
      // set on every pass, not at creation: the language can change under an open map
      h.turn.title = translate(lang, 'scene.map.turn')
      h.tag.textContent = v.id.toUpperCase()
      if (damaged) {
        const n = document.createElement('span')
        n.textContent = damageCount(damaged, lang)
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
  }, [vehicles, selected, interactive, lang])

  // ── the road under the cars, from OpenStreetMap ──────────────────────
  // The style.load handler pushes the current roads once when the layers are (re)created;
  // this is what pushes a later change, the same way the vehicles effect above pushes paths.
  const { roads, buildings } = props
  useEffect(() => {
    const s = live.current
    if (s?.styleReady) pushCollection(s.map, 'roads', roads)
  }, [roads])
  useEffect(() => {
    const s = live.current
    if (s?.styleReady) pushCollection(s.map, 'buildings', buildings)
  }, [buildings])

  // ── ghosts: the other account's cars and paths, decoration only ──────
  // The dashed routes are the vehicles' own and are pushed when they change; the bodies follow
  // `ghostPoses` while a playback is running, exactly as the first account's follow `poses`.
  const { ghosts, ghostPoses } = props
  useEffect(() => {
    const s = live.current
    if (!s || s.recording) return
    if (s.styleReady) pushGhostGeometry(s.map, ghosts ?? [])
    s.cars.setGhosts(ghostPoses ?? posesOf(ghosts ?? []))
  }, [ghosts, ghostPoses])

  // ── playback: the cars follow the frame, the handles step aside ─────
  const { poses } = props
  useEffect(() => {
    const s = live.current
    if (!s || s.recording) return
    s.map.getContainer().classList.toggle('mk-playing', !!poses)
    s.cars.setPoses(poses ?? posesOf(latest.current.vehicles))
  }, [poses])

  // ── cinematic playback: the camera opens up, chases, slows into the impact, comes back ─
  // The map is built flat and un-tiltable; it may tilt only between the first cinematic frame
  // and the last, and whatever happens in between — a stop pressed mid-chase, the run ending
  // — it is handed back at exactly the view the customer left, before the markers return.
  const mode = props.mode ?? 'diagram'
  const clock = props.clock ?? 0
  const follow = props.follow
  useEffect(() => {
    const s = live.current
    if (!s || s.recording) return
    const { map, cars } = s
    if (mode !== 'cinematic' || !poses) {
      flatten(s)
      return
    }
    if (!s.cine) {
      const ghosts = latest.current.ghosts ?? []
      const timeline = sharedTimeline(timelineOf(latest.current.vehicles), ghosts.length ? timelineOf(ghosts) : null)
      s.cine = {
        shots: [],
        follow: undefined,
        timeline,
        home: { center: fromLL(map.getCenter()), zoom: map.getZoom(), pitch: 0, bearing: 0 },
        ring: shockRing(),
        step: 0,
        slow: false,
      }
      map.setMaxPitch(MAX_PITCH)
    }
    const c = s.cine
    // built here and not at the start of the run, so "Swap" mid-playback re-cuts the chase onto
    // the other car; the ghosts are in the list because one of them may be the car it follows
    if (c.shots.length === 0 || c.follow !== follow) {
      c.follow = follow
      c.shots = shots([...latest.current.vehicles, ...(latest.current.ghosts ?? [])], c.timeline, follow)
    }
    const cam = cameraAt(c.shots, clock, [...poses, ...(ghostPoses ?? [])], c.home)
    map.jumpTo({ center: ll(cam.center), zoom: cam.zoom, pitch: cam.pitch, bearing: cam.bearing })
    // slow motion: the travel paths brighten into light trails, their dashes racing
    const slow = shotAt(c.shots, clock).rate < 1
    if (map.getLayer('paths-flow')) {
      if (slow !== c.slow) map.setPaintProperty('paths-flow', 'line-width', slow ? TRAIL_WIDTH : FLOW_WIDTH)
      if (slow) {
        c.step = (c.step + 1) % DASH_STEPS.length
        map.setPaintProperty('paths-flow', 'line-dasharray', DASH_STEPS[c.step])
      }
    }
    c.slow = slow
    // the shockwave: a ring out from the impact, decoration the document never sees
    const ring = ringAt(c.timeline, clock)
    const impact = latest.current.impact
    if (ring && impact) {
      c.ring.material.opacity = ring.opacity
      cars.setDecor([{ object: c.ring, at: impact, metres: ring.metres }])
    } else cars.setDecor([])
  }, [mode, clock, poses, ghostPoses, follow])

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
      const marker = new Marker({ element: e, draggable: interactive, anchor: 'center' }).setLngLat(ll(impact)).addTo(s.map)
      marker.on('drag', () => latest.current.onImpact?.(fromLL(marker.getLngLat())))
      s.impact = marker
      mk = marker
    }
    mk.getElement().title = translate(lang, 'scene.impact.title')
    mk.setLngLat(ll(impact))
  }, [impact, interactive, lang])

  useImperativeHandle(
    ref,
    () => ({
      export: () => {
        const s = live.current
        if (!s) return ''
        return compose(s.map, latest.current.vehicles, latest.current.impact, latest.current.lang ?? 'en')
      },
      recentre: () => live.current?.map.easeTo({ center: ll(latest.current.center), zoom: ZOOM, duration: 700 }),
      record: (mode) => {
        const s = live.current
        if (!s) return Promise.resolve(null)
        // whatever the camera was doing, the recorder owns it from here: the effects above step
        // aside for as long as it runs, or they would fight it frame by frame
        flatten(s)
        s.recording = true
        return recordPlayback({
          map: s.map,
          cars: s.cars,
          vehicles: latest.current.vehicles,
          ghosts: latest.current.ghosts ?? [],
          impact: latest.current.impact,
          lang: latest.current.lang ?? 'en',
          mode: mode === 'cinematic' && !reducedMotion() ? 'cinematic' : 'diagram',
          follow: latest.current.follow,
          ring: shockRing(),
        }).finally(() => {
          s.recording = false
        })
      },
      stop: async () => {
        const s = live.current
        if (!s) return
        latest.current.onPlaybackStop?.()
        // a flat "Play it back" leaves the cars mid-route just as surely as a chase leaves the
        // camera tilted; either way the map goes back to rest here rather than on the re-render
        // the stop above will cause, which comes after the caller has taken its picture
        const container = s.map.getContainer()
        const playing = container.classList.contains('mk-playing')
        flatten(s)
        if (!playing) return
        container.classList.remove('mk-playing')
        s.cars.setPoses(posesOf(latest.current.vehicles))
        s.cars.setGhosts(posesOf(latest.current.ghosts ?? []))
        // none of that is on the canvas until the map has painted again; a still taken before
        // then is the frame the playback was on. The timeout is the safety net for a map that
        // will never paint again — a send is never held up by its own picture.
        await new Promise<void>((resolve) => {
          const done = () => resolve()
          setTimeout(done, 300)
          s.map.once('render', done)
          s.map.triggerRepaint()
        })
      },
    }),
    [],
  )

  return <div ref={container} className={className} />
}

/**
 * Hand the camera back: the view the cinematic replay was let off at, flat, north-up, with the
 * tilt locked again and the shockwave gone. True when there was a replay to end. The effect
 * below calls it when the playback stops, and the handle's `stop`/`record` call it because
 * neither a still nor a recording may start on a map mid-chase.
 */
function flatten(s: Live): boolean {
  if (!s.cine) return false
  s.map.jumpTo({ center: ll(s.cine.home.center), zoom: s.cine.home.zoom, pitch: 0, bearing: 0 })
  s.map.setMaxPitch(0)
  s.cars.setDecor([])
  if (s.map.getLayer('paths-flow')) s.map.setPaintProperty('paths-flow', 'line-width', FLOW_WIDTH)
  s.cine = null
  return true
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

/** the road, or the buildings, exactly as the lookup returned them; decoration, never picked */
function pushCollection(map: MapLibreMap, id: string, data: FeatureCollection | null | undefined) {
  const source = map.getSource(id)
  if (source instanceof GeoJSONSource) source.setData(data ?? { type: 'FeatureCollection', features: [] })
}

/** the other account's travel paths — no arrowhead, no flow animation: decoration, never picked */
function pushGhostGeometry(map: MapLibreMap, ghosts: ClaimVehicle[]) {
  const paths: Feature[] = []
  for (const v of ghosts) {
    if (!v.position || v.path.length === 0) continue
    paths.push({ type: 'Feature', properties: { color: ROLE_COLOR[v.role] }, geometry: { type: 'LineString', coordinates: [...v.path, v.position] } })
  }
  const source = map.getSource('ghost-paths')
  if (source instanceof GeoJSONSource) source.setData({ type: 'FeatureCollection', features: paths })
}

/**
 * The exported picture: the map canvas holds the ground, the paths and the 3D cars; the
 * labels and the impact cross are DOM, so they are drawn on top by hand at their projected
 * positions — `paintOverlay`, shared with the recorder in `./record` so the still and the
 * video never disagree about what a label or the cross looks like. What comes out is what the
 * customer saw.
 */
function compose(map: MapLibreMap, vehicles: ClaimVehicle[], impact: LngLat | null, lang: Lang): string {
  const src = map.getCanvas()
  const dpr = src.width / src.clientWidth || 1
  const out = document.createElement('canvas')
  out.width = src.width
  out.height = src.height
  const ctx = out.getContext('2d')!
  ctx.drawImage(src, 0, 0)
  ctx.scale(dpr, dpr)
  const labels: OverlayLabel[] = vehicles
    .filter((v): v is ClaimVehicle & { position: LngLat } => v.position !== null)
    .map((v) => ({ id: v.id, role: v.role, body: v.body, damages: v.damages.length, position: v.position }))
  paintOverlay(ctx, map, labels, impact, lang)
  return out.toDataURL('image/png')
}
