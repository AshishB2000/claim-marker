import { createRef } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { DamageMarker, type DamageMarkerHandle, type ExportResult } from './DamageMarker'
import type { ClaimValue } from '../schema'
import type { Vehicle } from '../zones'

export type MountOptions = {
  vehicle?: Vehicle
  value?: ClaimValue
  onChange?: (value: ClaimValue) => void
  modelUrl?: string
}

export type MountedMarker = {
  export: () => ExportResult
  load: (value: unknown) => void
  destroy: () => void
}

/** Entry point for apps that are not React. */
export function mount(el: HTMLElement, options: MountOptions = {}): MountedMarker {
  const root = createRoot(el)
  const ref = createRef<DamageMarkerHandle>()

  // synchronous commit, so the returned handle is usable on the very next line
  flushSync(() => root.render(<DamageMarker ref={ref} {...options} />))

  const handle = () => {
    if (!ref.current) throw new Error('claim-marker: widget is not mounted')
    return ref.current
  }
  return {
    export: () => handle().export(),
    load: (value) => handle().load(value),
    destroy: () => root.unmount(),
  }
}
