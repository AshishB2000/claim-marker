import { createRef } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { ScenarioBuilder, type ScenarioExport, type ScenarioHandle } from './ScenarioBuilder'
import type { ScenarioValue } from './schema'
import type { Theme } from '../theme'

export type MountScenarioOptions = {
  value?: ScenarioValue
  onChange?: (value: ScenarioValue) => void
  theme?: Theme
}

export type MountedScenario = {
  export: () => ScenarioExport
  load: (value: unknown) => void
  destroy: () => void
}

/** Entry point for apps that are not React. */
export function mountScenario(el: HTMLElement, options: MountScenarioOptions = {}): MountedScenario {
  const root = createRoot(el)
  const ref = createRef<ScenarioHandle>()

  // synchronous commit, so the returned handle is usable on the very next line
  flushSync(() => root.render(<ScenarioBuilder ref={ref} {...options} />))

  const handle = () => {
    if (!ref.current) throw new Error('claim-marker: scenario builder is not mounted')
    return ref.current
  }
  return {
    export: () => handle().export(),
    load: (value) => handle().load(value),
    destroy: () => root.unmount(),
  }
}
