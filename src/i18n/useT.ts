import { useCallback } from 'react'
import { useClaim } from '../claim/store'
import { translate, type Key, type Lang, type Vars } from './index'

/** the language the customer is reading in; English until something has chosen */
export const useLang = (): Lang => useClaim((s) => s.lang) ?? 'en'

/** `t(key, vars)` bound to the current language; components re-render when it changes */
export function useT() {
  const lang = useLang()
  return useCallback((key: Key, vars?: Vars) => translate(lang, key, vars), [lang])
}
