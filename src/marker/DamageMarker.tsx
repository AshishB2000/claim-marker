import { useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type Ref } from 'react'
import { useStore } from 'zustand'
import { emptyValue, parse, type ClaimValue } from '../schema'
import { createMarkerStore } from './store'
import { injectStyle } from '../style'
import { Scene } from './Scene'
import type { Vehicle } from '../zones'

export type ExportResult = {
  json: ClaimValue
  /** PNG data URL of the current view, markers included */
  png: string
}

export type DamageMarkerHandle = {
  export: () => ExportResult
  load: (value: unknown) => void
}

export type DamageMarkerProps = {
  vehicle?: Vehicle
  /** controlled value; omit for uncontrolled */
  value?: ClaimValue
  onChange?: (value: ClaimValue) => void
  /** override where the .glb is fetched from, e.g. your own CDN */
  modelUrl?: string
  className?: string
  style?: CSSProperties
  ref?: Ref<DamageMarkerHandle>
}

function Hint({ store }: { store: ReturnType<typeof createMarkerStore> }) {
  const empty = useStore(store, (s) => s.damages.length === 0 && !s.pending)
  return empty ? <div className="cm-hint">Tap the car where the damage is</div> : null
}

export function DamageMarker({
  vehicle = 'sedan',
  value,
  onChange,
  modelUrl,
  className,
  style,
  ref,
}: DamageMarkerProps) {
  injectStyle()

  // built once: `value` and `vehicle` seed it, later changes arrive through the effects below
  const [store] = useState(() => createMarkerStore(value ?? emptyValue(vehicle)))
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)

  // Remember what we last emitted, compared by content rather than identity: a controlled
  // consumer that derives `value` — from a larger form object, say — hands back an equal but
  // freshly built object, and an identity check would reload the store, re-emit, and loop.
  const emitted = useRef<string | null>(null)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })

  useEffect(
    () =>
      store.subscribe((s, prev) => {
        if (s.damages === prev.damages && s.vehicle === prev.vehicle) return
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
    store.getState().load(parse(value).value)
  }, [value, store])

  useImperativeHandle(
    ref,
    () => ({
      export: () => ({
        json: store.getState().value(),
        png: canvas ? canvas.toDataURL('image/png') : '',
      }),
      load: (input: unknown) => store.getState().load(parse(input).value),
    }),
    [store, canvas],
  )

  return (
    <div className={className ? `cm-root ${className}` : 'cm-root'} style={style}>
      <Scene store={store} modelUrl={modelUrl} onCanvas={setCanvas} />
      <Hint store={store} />
    </div>
  )
}
