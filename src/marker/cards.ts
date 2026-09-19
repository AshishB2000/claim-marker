/**
 * Photos pinned to the car: a photograph that shows a panel (`Photo.shows`) stands beside that
 * panel in the studio as a small card, with a leader line back to it. This is where the card
 * stands; `PhotoCards.tsx` draws it. Pure, and no value import of three, so the test runs in
 * plain node.
 *
 * The zone's anchor is in the kit's units, like everything `claim-marker/1` stores; the card is
 * placed in metres, in the body's own frame — nose +Z, up +Y, the car's left +X — so the anchor
 * goes through `toWorld` first and the 0.6 m is a real 0.6 m on every body. The outward normal
 * runs from the middle of the body's footprint on the floor — where the kit stands every body,
 * its origin — out through the anchor. Measured from there every normal leans upward, so a card
 * for a wheel or a bumper rises beside it rather than sinking into the floor, and a door's card
 * stands out to its side at about the height of the glass.
 */
import type { Photo } from '../claim/schema'
import { toWorld } from '../vehicles/bodies'
import type { V3, Vehicle, Zone } from '../zones'

/** how far out from its panel a card stands, in metres */
export const CARD_OFFSET = 0.6

/** a drag's data type: the dragged photo's place in `attachments.photos`, dropped on the car to say which panel it shows */
export const PHOTO_DRAG = 'application/x-claim-photo'

/** a photo as a card: `id` is its place in `attachments.photos`, which is what `tagPhoto` takes */
export type CardPhoto = { id: number; dataUrl: string; shows: string }

export function cardPlacement(body: Vehicle, zone: Zone): { position: V3; normal: V3 } {
  const anchor = toWorld(body, zone.anchor)
  const l = Math.hypot(...anchor)
  const normal = anchor.map((n) => n / l) as V3
  return { position: anchor.map((n, i) => n + normal[i] * CARD_OFFSET) as V3, normal }
}

/** the photos of one vehicle that show a panel of it, as cards */
export const cardsOf = (photos: readonly Photo[], of: string): CardPhoto[] =>
  photos.flatMap((p, id) => (p.of === of && p.shows ? [{ id, dataUrl: p.data, shows: p.shows }] : []))
