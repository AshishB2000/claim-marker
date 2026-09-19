import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { Billboard } from '@react-three/drei'
import { toWorld } from '../vehicles/bodies'
import { zoneById, type Vehicle, type Zone } from '../zones'
import { cardPlacement, type CardPhoto } from './cards'

/** the card's side in metres, frame included */
const SIZE = 0.5
/** the texture's side in pixels, and the white frame round the photograph */
const PX = 256
const FRAME = 14
const LEADER = '#64748b'

/**
 * The photograph cropped square into a white frame with a grey edge, so it reads against the
 * pale studio and against paint. A canvas texture, not `Html`: it is in the WebGL frame, so the
 * marker's PNG export carries it. White until the image has decoded, then `loaded` asks for a
 * frame — the reconstruction only draws on demand.
 */
function photoTexture(dataUrl: string, loaded: () => void) {
  const c = document.createElement('canvas')
  c.width = c.height = PX
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, PX, PX)
  ctx.strokeStyle = '#94a3b8'
  ctx.lineWidth = 4
  ctx.strokeRect(2, 2, PX - 4, PX - 4)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const img = new Image()
  img.onload = () => {
    const s = Math.min(img.width, img.height)
    ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, FRAME, FRAME, PX - 2 * FRAME, PX - 2 * FRAME)
    tex.needsUpdate = true
    loaded()
  }
  img.src = dataUrl
  return tex
}

/** the press is the card's, so the body behind it is not picked; a drag that starts on the card still turns the car */
const keep = (e: ThreeEvent<PointerEvent>) => e.stopPropagation()

/**
 * One photo on its panel. A second photo of the same panel sits a little down and to the right of
 * the first, and in front of it, without a second leader. It opens on a click, not the press — a
 * modal opening under a drag would swallow it — and only on a tap that did not move, so letting
 * go of a drag over a card opens nothing.
 */
function Card({ body, zone, photo, stacked, hidden, onOpen }: { body: Vehicle; zone: Zone; photo: CardPhoto; stacked: number; hidden: boolean; onOpen?: () => void }) {
  const invalidate = useThree((s) => s.invalidate)
  const tex = useMemo(() => photoTexture(photo.dataUrl, () => invalidate()), [photo.dataUrl, invalidate])
  useEffect(() => () => tex.dispose(), [tex])
  // placed once per panel, not per render: the reconstruction re-renders on every frame of a playback
  const { position, leader } = useMemo(() => {
    const { position } = cardPlacement(body, zone)
    return { position, leader: new Float32Array([...toWorld(body, zone.anchor), ...position]) }
  }, [body, zone])
  // hidden: not drawn and, with no handlers, not hit — but kept, so its photo is not decoded again
  return (
    <group visible={!hidden}>
      {/* a plain one-pixel line: drei's fat Line is a heavy shader to compile, in every canvas the card is in */}
      {stacked === 0 && (
        <lineSegments key={zone.id}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[leader, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={LEADER} />
        </lineSegments>
      )}
      <Billboard position={position}>
        <mesh
          name={`card:${photo.id}`}
          position={[stacked * 0.08, -stacked * 0.08, stacked * 0.002]}
          onPointerDown={onOpen && keep}
          onClick={
            onOpen &&
            ((e: ThreeEvent<MouseEvent>) => {
              e.stopPropagation()
              // a finger drifts a few pixels in a tap; a drag that turns the car goes further
              if (e.delta <= 8) onOpen()
            })
          }
        >
          <planeGeometry args={[SIZE, SIZE]} />
          <meshBasicMaterial map={tex} toneMapped={false} />
        </mesh>
      </Billboard>
    </group>
  )
}

/**
 * Every photo that shows a panel of this body, as a card standing out from that panel
 * (`cardPlacement`) with a thin leader line back to it. In the body's own metres — the marker's
 * world, or a car's group in the reconstruction. `onOpen`, when given, makes the cards tappable.
 *
 * `faced` is the panel the camera has been turned to face: its cards stand aside — not drawn,
 * taking no taps — because from there a card sits on the line of sight to its own panel, over
 * the pin and the damage the camera was turned to show.
 */
export function PhotoCards({
  body,
  photos,
  faced = null,
  onOpen,
}: {
  body: Vehicle
  photos: CardPhoto[]
  faced?: string | null
  onOpen?: (photo: CardPhoto, zone: Zone) => void
}) {
  return photos.map((photo, i) => {
    const zone = zoneById(body, photo.shows)
    if (!zone) return null
    const stacked = photos.slice(0, i).filter((p) => p.shows === photo.shows).length
    const hidden = photo.shows === faced
    return <Card key={photo.id} body={body} zone={zone} photo={photo} stacked={stacked} hidden={hidden} onOpen={onOpen && !hidden ? () => onOpen(photo, zone) : undefined} />
  })
}
