import { translate, type Lang } from '../i18n'
import type { Photo } from '../claim/schema'

/**
 * The customer's photographs that show one marked panel, beside the mark in the report. A photo
 * says which panel it shows only when the customer added a mark read off it, so this is empty
 * for every report made without the assistant, and the document reads as it always did.
 *
 * `ReportDocument` renders this, and the claims desk renders that, so the language is a prop
 * and English unless the customer's own page says otherwise.
 */
export function MarkPhotos({ photos, of, zone, lang = 'en' }: { photos: Photo[]; of: string; zone: string; lang?: Lang }) {
  const shown = photos.filter((p) => p.of === of && p.shows === zone)
  if (!shown.length) return null
  return (
    <span className="mt-1.5 flex flex-wrap gap-1.5">
      {shown.map((p, i) => (
        <a key={i} href={p.data} target="_blank" rel="noreferrer" className="block">
          <img src={p.data} alt={p.caption || translate(lang, 'damage.markPhoto.alt')} className="size-14 rounded-md object-cover ring-1 ring-slate-900/10" />
        </a>
      ))}
    </span>
  )
}
