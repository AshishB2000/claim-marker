import { Html } from '@react-three/drei'
import { useStore } from 'zustand'
import { SEVERITIES, SEVERITY_COLOR, type Severity } from '../schema'
import { translate, type Key, type Lang } from '../i18n'
import type { MarkerStore } from './store'
import { zoneById } from '../zones'

/**
 * Appears at the tap. Choosing a severity commits the damage and keeps the popover open on
 * it, so the note and delete are one gesture away — without a delete, a mis-tap would be
 * permanent.
 */
export function Picker({ store, lang }: { store: MarkerStore; lang: Lang }) {
  const vehicle = useStore(store, (s) => s.vehicle)
  const pending = useStore(store, (s) => s.pending)
  const selected = useStore(store, (s) => s.selected)
  const damages = useStore(store, (s) => s.damages)

  const editing = !pending && selected !== null ? damages[selected] : undefined
  const anchor = pending?.point ?? editing?.point
  if (!anchor) return null

  const zone = pending?.zone ?? (editing ? zoneById(vehicle, editing.zone) : undefined)
  const close = () => store.getState().select(null)

  const choose = (severity: Severity) => {
    if (pending) store.getState().commit(severity)
    else if (selected !== null) store.getState().edit(selected, { severity })
  }

  return (
    <Html position={anchor} center zIndexRange={[30, 10]} style={{ pointerEvents: 'auto' }}>
      <div className="cm-pop" onPointerDown={(e) => e.stopPropagation()}>
        <div className="cm-pop-head">
          <span>{zone ? translate(lang, `zone.${zone.id}` as Key) : translate(lang, 'scene.doc.damage')}</span>
          <button className="cm-x" onClick={close} aria-label={translate(lang, 'common.close')}>
            ✕
          </button>
        </div>

        <div className="cm-sev">
          {SEVERITIES.map((s) => (
            <button key={s} aria-pressed={editing?.severity === s} onClick={() => choose(s)}>
              <span className="cm-dot" style={{ background: SEVERITY_COLOR[s] }} />
              {translate(lang, `severity.${s}` as Key)}
            </button>
          ))}
        </div>

        {editing && selected !== null && (
          <>
            <textarea
              className="cm-note"
              rows={2}
              placeholder={translate(lang, 'scene.marker.note')}
              value={editing.note}
              onChange={(e) => store.getState().edit(selected, { note: e.target.value })}
            />
            <button className="cm-del" onClick={() => store.getState().remove(selected)}>
              {translate(lang, 'scene.marker.remove')}
            </button>
          </>
        )}
      </div>
    </Html>
  )
}
