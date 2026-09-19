import { useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type Ref } from 'react'
import { useStore } from 'zustand'
import { emptyValue, parse, type ClaimValue } from '../schema'
import { createMarkerStore } from './store'
import { translate, type Lang } from '../i18n'
import { injectStyle } from '../style'
import { themeClass, type Theme } from '../theme'
import { Scene } from './Scene'
import type { Lighting } from '../scene/lighting'
import type { Vehicle } from '../zones'
import type { CardPhoto } from './cards'

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
  /** the body's paint, as #rrggbb */
  paint?: string
  /** `light` (default) or `dark`; finer control is the `--cm-*` custom properties */
  theme?: Theme
  /** the language of the marker's own words; English unless the page says otherwise */
  lang?: Lang
  /** the moment's light, as the map layer has it; absent or null is the plain studio */
  lighting?: Lighting | null
  /** pins shrink to dots where the paint shows the damage itself (the customer's marker); off, they keep their numbers (the desk's) */
  dots?: boolean
  /** the before/after slider and the severity map over the canvas; view state only, never in the document */
  tools?: boolean
  /** a document's copy (the desk's): nothing can be marked or edited and the wheel scrolls the page, but it still turns round, and a pin or a photo still takes a tap */
  readOnly?: boolean
  /** this vehicle's photos that show one of its panels (`cardsOf`), each a card standing out from that panel */
  photos?: CardPhoto[]
  /** a photo's thumbnail (dragged with `PHOTO_DRAG`) was dropped on this panel of the car */
  onTagPhoto?: (photoId: number, zoneId: string) => void
  /** a photo's card was tapped: the camera turns to its panel, and the host shows the photo large */
  onOpenPhoto?: (photoId: number) => void
  className?: string
  style?: CSSProperties
  ref?: Ref<DamageMarkerHandle>
}

function Hint({ store, lang }: { store: ReturnType<typeof createMarkerStore>; lang: Lang }) {
  const empty = useStore(store, (s) => s.damages.length === 0 && !s.pending)
  return empty ? <div className="cm-hint">{translate(lang, 'scene.marker.hint')}</div> : null
}

/** before/after, and the severity map — shown once there is a mark to blend */
function Tools({ store, lang }: { store: ReturnType<typeof createMarkerStore>; lang: Lang }) {
  const any = useStore(store, (s) => s.damages.length > 0)
  const strength = useStore(store, (s) => s.strength)
  const heatmap = useStore(store, (s) => s.heatmap)
  if (!any) return null
  return (
    <div className="cm-tools" onPointerDown={(e) => e.stopPropagation()}>
      <label className="cm-tool">
        <span>{translate(lang, 'scene.marker.strength')}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={strength}
          aria-label={translate(lang, 'scene.marker.strength')}
          onChange={(e) => store.getState().setStrength(Number(e.target.value))}
        />
      </label>
      <button className="cm-tool" aria-pressed={heatmap} onClick={() => store.getState().setHeatmap(!heatmap)}>
        {translate(lang, 'scene.marker.heatmap')}
      </button>
    </div>
  )
}

export function DamageMarker({
  vehicle = 'sedan',
  value,
  onChange,
  modelUrl,
  paint = '#b9bec6',
  theme = 'light',
  lang = 'en',
  lighting = null,
  dots = false,
  tools = true,
  readOnly = false,
  photos,
  onTagPhoto,
  onOpenPhoto,
  className,
  style,
  ref,
}: DamageMarkerProps) {
  injectStyle()

  // built once: `value` and `vehicle` seed it, later changes arrive through the effects below
  const [store] = useState(() => createMarkerStore(value ?? emptyValue(vehicle)))
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  // slow turntable until the first touch, which is also the hint that it can be rotated
  const [idle, setIdle] = useState(true)

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
    <div className={themeClass(theme, className)} style={style} onPointerDownCapture={() => setIdle(false)}>
      <Scene
        store={store}
        modelUrl={modelUrl}
        paint={paint}
        theme={theme}
        idle={idle}
        lang={lang}
        lighting={lighting}
        dots={dots}
        readOnly={readOnly}
        photos={photos}
        onTagPhoto={onTagPhoto}
        onOpenPhoto={onOpenPhoto}
        onCanvas={setCanvas}
      />
      {!readOnly && <Hint store={store} lang={lang} />}
      {tools && <Tools store={store} lang={lang} />}
    </div>
  )
}
