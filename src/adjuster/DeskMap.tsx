/**
 * Everything that has arrived, where it happened. One MapLibre map on the street basemap with
 * one clustered GeoJSON source: a point per report, coloured by its status, bigger when someone
 * was hurt or the car cannot be driven, ringed when the server has seen something on it before.
 * Tapping a point opens that report; the view it settles on is what "only what's on the map"
 * narrows the list to.
 *
 * Two things here look removable and are not. The clusters are **DOM markers**, not a symbol
 * layer: a count is text, and text on a MapLibre style needs a glyph server — one more host in
 * the served page's CSP for a number a div can hold. And the source's data is set from a ref in
 * the `load` handler as well as from its own effect, because the receipts usually arrive before
 * the style does and the source does not exist until then.
 */
import { useEffect, useRef, useState } from 'react'
import '../map/worker'
import { LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, type GeoJSONSource } from 'maplibre-gl'
import { STREETS } from '../map/styles'
import { pins, type Bounds, type Placed } from './pins'

/** the status colours the inbox rows already wear: brand blue, amber, slate */
const NEW = '#1f56e6'
const REVIEWING = '#d97706'
const CLOSED = '#64748b'
/** the ring on a report the server has seen a photograph, a VIN or a plate of before */
const SEEN_BEFORE = '#dc2626'

const SOURCE = 'claims'

export function DeskMap({
  receipts,
  heat,
  onOpen,
  onBounds,
  className,
}: {
  receipts: Placed[]
  /** the second layer: volume over a region rather than one report at a time */
  heat: boolean
  onOpen: (reference: string) => void
  onBounds: (bounds: Bounds) => void
  className?: string
}) {
  const container = useRef<HTMLDivElement>(null)
  const live = useRef<MapLibreMap | null>(null)
  const latest = useRef(receipts)
  const onOpenRef = useRef(onOpen)
  const onBoundsRef = useRef(onBounds)
  useEffect(() => {
    latest.current = receipts
    onOpenRef.current = onOpen
    onBoundsRef.current = onBounds
  })
  const [init] = useState(() => ({ heat }))

  useEffect(() => {
    const map = new MapLibreMap({
      container: container.current!,
      style: STREETS,
      center: { lng: -20, lat: 30 },
      zoom: 1,
      attributionControl: { compact: true },
      // so scripts/integration-smoke.mjs can read the pixels back and prove the pins painted
      canvasContextAttributes: { preserveDrawingBuffer: true },
      dragRotate: false,
      touchPitch: false,
    })
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    live.current = map

    const clusters = new Map<number, Marker>()
    const report = () => {
      const [[west, south], [east, north]] = map.getBounds().toArray()
      onBoundsRef.current([west, south, east, north])
    }

    map.on('load', () => {
      map.addSource(SOURCE, { type: 'geojson', data: pins(latest.current), cluster: true, clusterRadius: 50, clusterMaxZoom: 14 })
      map.addLayer({
        id: 'heat',
        type: 'heatmap',
        source: SOURCE,
        layout: { visibility: init.heat ? 'visible' : 'none' },
        paint: {
          // a cluster stands for the reports inside it, or the heat thins out as the map zooms out
          'heatmap-weight': ['case', ['has', 'point_count'], ['get', 'point_count'], 1],
          'heatmap-radius': 30,
          'heatmap-opacity': 0.7,
          'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(47,107,255,0)', 0.3, '#bfd3fe', 0.6, '#2f6bff', 1, '#d97706'],
        },
      })
      map.addLayer({
        id: 'pins',
        type: 'circle',
        source: SOURCE,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['match', ['get', 'status'], 'new', NEW, 'reviewing', REVIEWING, CLOSED],
          'circle-radius': ['+', 8, ['case', ['>', ['get', 'hurt'], 0], 4, 0], ['case', ['get', 'notDrivable'], 3, 0]],
          'circle-stroke-width': 2,
          'circle-stroke-color': ['case', ['>', ['get', 'signals'], 0], SEEN_BEFORE, '#ffffff'],
        },
      })
      fit(map, latest.current)
      report()
    })

    map.on('click', 'pins', (e) => {
      const reference = e.features?.[0]?.properties?.reference
      if (typeof reference === 'string') onOpenRef.current(reference)
    })
    map.on('mouseenter', 'pins', () => (map.getCanvas().style.cursor = 'pointer'))
    map.on('mouseleave', 'pins', () => (map.getCanvas().style.cursor = ''))
    map.on('moveend', report)

    // the clusters, as markers: one per cluster in view, removed as the map merges and splits them
    map.on('render', () => {
      if (!map.getLayer('pins')) return
      const seen = new Set<number>()
      for (const f of map.querySourceFeatures(SOURCE)) {
        const id = f.properties?.cluster_id
        if (typeof id !== 'number' || seen.has(id) || f.geometry.type !== 'Point') continue
        seen.add(id)
        const at = f.geometry.coordinates as [number, number]
        const standing = clusters.get(id)
        if (standing) {
          standing.setLngLat(at)
          continue
        }
        const element = document.createElement('button')
        element.className = 'desk-cluster grid size-9 place-items-center rounded-full bg-ink text-xs font-semibold text-white ring-2 ring-white'
        element.textContent = String(f.properties?.point_count ?? '')
        element.setAttribute('aria-label', `${f.properties?.point_count} reports here`)
        element.addEventListener('click', () => {
          const source = map.getSource(SOURCE) as GeoJSONSource | undefined
          source
            ?.getClusterExpansionZoom(id)
            .then((zoom) => map.easeTo({ center: at, zoom }))
            .catch(() => {})
        })
        clusters.set(id, new Marker({ element }).setLngLat(at).addTo(map))
      }
      for (const [id, marker] of clusters) {
        if (seen.has(id)) continue
        marker.remove()
        clusters.delete(id)
      }
    })

    return () => {
      for (const marker of clusters.values()) marker.remove()
      clusters.clear()
      map.remove()
      live.current = null
    }
  }, [init])

  // The desk hands down a fresh array on every render — including the one its own `onBounds`
  // causes — so the map is told only when the points actually change, or `fitBounds` would
  // answer its own `moveend` for ever.
  const key = JSON.stringify(pins(receipts))
  useEffect(() => {
    const map = live.current
    const source = map?.getSource(SOURCE) as GeoJSONSource | undefined
    // before `load` the source is not there yet: the handler above sets it from `latest` instead
    if (!map || !source) return
    source.setData(pins(latest.current))
    fit(map, latest.current)
  }, [key])

  useEffect(() => {
    const map = live.current
    if (map?.getLayer('heat')) map.setLayoutProperty('heat', 'visibility', heat ? 'visible' : 'none')
  }, [heat])

  return <div ref={container} className={className} />
}

/** frame whatever is on the map now; one report is a place rather than a bounding box, so a maximum zoom */
function fit(map: MapLibreMap, receipts: Placed[]) {
  const bounds = new LngLatBounds()
  for (const feature of pins(receipts).features) bounds.extend(feature.geometry.coordinates as [number, number])
  if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 48, maxZoom: 13, duration: 400 })
}
