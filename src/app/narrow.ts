import { useSyncExternalStore } from 'react'

const PHONE = '(max-width: 640px)'

const subscribe = (changed: () => void) => {
  const m = window.matchMedia(PHONE)
  m.addEventListener('change', changed)
  return () => m.removeEventListener('change', changed)
}

/**
 * A phone-width screen, followed live so turning a tablet or dragging a window across the line
 * re-lays the step. Read through `useSyncExternalStore` rather than copied into state by an
 * effect, which would render the wrong layout once before correcting it.
 */
export const useNarrow = () => useSyncExternalStore(subscribe, () => window.matchMedia(PHONE).matches)
