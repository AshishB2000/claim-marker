import type { Photo } from '../claim/schema'

/**
 * The customer's photographs that show one marked panel, beside the mark in the report. A photo
 * says which panel it shows only when the customer added a mark read off it, so this is empty
 * for every report made without the assistant, and the document reads as it always did.
 */
export function MarkPhotos({ photos, of, zone }: { photos: Photo[]; of: string; zone: string }) {
  const shown = photos.filter((p) => p.of === of && p.shows === zone)
  if (!shown.length) return null
  return (
    <span className="mt-1.5 flex flex-wrap gap-1.5">
      {shown.map((p, i) => (
        <a key={i} href={p.data} target="_blank" rel="noreferrer" className="block">
          <img src={p.data} alt={p.caption || 'Photo of this damage'} className="size-14 rounded-md object-cover ring-1 ring-slate-900/10" />
        </a>
      ))}
    </span>
  )
}
