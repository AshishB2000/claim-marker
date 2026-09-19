import { translate, type Key, type Lang } from '../i18n'
import type { Photo } from '../claim/schema'

/**
 * One photograph, large, over the page: opened by tapping its card on the car, on the damage
 * step and on the desk. A native modal `<dialog>` — Escape, the focus trap and the top layer come
 * with it — closed by its button, Escape or a click on the backdrop. The desk renders it too, so
 * the language is a prop.
 */
export function PhotoLightbox({ photo, lang, onClose }: { photo: Photo; lang: Lang; onClose: () => void }) {
  const panel = photo.shows ? translate(lang, `zone.${photo.shows}` as Key) : ''
  const alt = photo.caption || translate(lang, 'damage.markPhoto.alt')
  return (
    <dialog
      ref={(d) => {
        if (d && !d.open) d.showModal()
      }}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close()
      }}
      aria-label={panel || alt}
      className="m-auto w-[min(92vw,960px)] overflow-hidden rounded-2xl bg-white p-0 shadow-2xl backdrop:bg-slate-900/60"
    >
      <img src={photo.data} alt={alt} className="block max-h-[78vh] w-full bg-slate-900 object-contain" />
      <div className="flex items-center gap-3 px-4 py-3 text-sm">
        <span className="min-w-0 flex-1">
          <span className="font-semibold">{panel}</span>
          {photo.caption && <span className="text-slate-500">{panel && ' · '}{photo.caption}</span>}
        </span>
        <button className="btn btn-secondary btn-sm" autoFocus onClick={(e) => e.currentTarget.closest('dialog')?.close()}>
          {translate(lang, 'common.close')}
        </button>
      </div>
    </dialog>
  )
}
