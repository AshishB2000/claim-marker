/**
 * The small map on the first step: it flies to whatever the search found and lets the
 * customer drag the pin to the exact spot, which is often more precise than any address.
 */
import { useEffect, useRef, useState } from 'react'
import './worker'
import { Map as MapLibreMap, Marker, NavigationControl } from 'maplibre-gl'
import type { LngLat } from '../geo'
import { STREETS } from './styles'

export function LocationMap({
  center,
  onDrag,
  className,
}: {
  /** null before a place is chosen: a world view, no pin */
  center: LngLat | null
  onDrag: (at: LngLat) => void
  className?: string
}) {
  const container = useRef<HTMLDivElement>(null)
  const live = useRef<{ map: MapLibreMap; pin: Marker | null } | null>(null)
  const onDragRef = useRef(onDrag)
  useEffect(() => {
    onDragRef.current = onDrag
  })
  const [init] = useState(() => ({ center }))

  useEffect(() => {
    const map = new MapLibreMap({
      container: container.current!,
      style: STREETS,
      center: init.center ? { lng: init.center[0], lat: init.center[1] } : { lng: -20, lat: 30 },
      zoom: init.center ? 17 : 1.4,
      pitch: 0,
      attributionControl: { compact: true },
      // so scripts/smoke.mjs can read the pixels back and prove the tiles painted
      canvasContextAttributes: { preserveDrawingBuffer: true },
      dragRotate: false,
      touchPitch: false,
    })
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    const state = { map, pin: null as Marker | null }
    live.current = state
    return () => {
      state.pin?.remove()
      map.remove()
      live.current = null
    }
  }, [init])

  useEffect(() => {
    const s = live.current
    if (!s) return
    if (!center) {
      s.pin?.remove()
      s.pin = null
      return
    }
    const at = { lng: center[0], lat: center[1] }
    if (!s.pin) {
      const e = document.createElement('div')
      e.className = 'mk-pin'
      const pin = new Marker({ element: e, draggable: true, anchor: 'bottom' }).setLngLat(at).addTo(s.map)
      pin.on('dragend', () => {
        const p = pin.getLngLat()
        onDragRef.current([p.lng, p.lat])
      })
      s.pin = pin
      s.map.flyTo({ center: at, zoom: 17.5, duration: 1400, essential: true })
      return
    }
    const was = s.pin.getLngLat()
    if (Math.abs(was.lng - at.lng) > 1e-9 || Math.abs(was.lat - at.lat) > 1e-9) {
      s.pin.setLngLat(at)
      s.map.flyTo({ center: at, zoom: Math.max(s.map.getZoom(), 17.5), duration: 1200, essential: true })
    }
  }, [center])

  return <div ref={container} className={className} />
}
