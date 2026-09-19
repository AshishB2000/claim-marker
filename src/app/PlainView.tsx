import { useClaim } from '../claim/store'
import { translate, type Lang } from '../i18n'
import { Icon } from './icons'

/**
 * "Plain view": the map and the marked-up car without the light, the shadows and the weather
 * of the moment. One chip, on the diagram step and on the review page, persisted with the
 * draft; while it is on, every scene on the page is lit as it always was.
 */
export function PlainViewChip({ lang }: { lang: Lang }) {
  const plainView = useClaim((s) => s.plainView)
  const setPlainView = useClaim((s) => s.setPlainView)
  return (
    <button className="chip" onClick={() => setPlainView(!plainView)} aria-pressed={plainView} title={translate(lang, 'scene.plain.title')}>
      <Icon.cloud /> {translate(lang, 'scene.plain')}
    </button>
  )
}
