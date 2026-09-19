/**
 * Is this recording a real replay? Shared by `smoke.mjs` (the send-time replay) and
 * `integration-smoke.mjs` (the replay the server unpacks, and the desk's "Save video").
 *
 * Not by its size. A MediaRecorder file's size follows how many distinct frames reached the
 * encoder and how much of its realtime budget it had, and both fall on a loaded machine: a
 * full-length, full-colour replay came out at 45 kB at load 15 and 84 kB at load 8. So the file
 * is decoded in the page and judged on what it shows:
 *
 * - it lasts at least `MIN_SECONDS` — a recording that stopped early, or never ran;
 * - its middle frame has at least `MIN_COLOURS` distinct colours — not a black rectangle, the
 *   failure that matters, since a recorder that captured a canvas before three.js had drawn
 *   anything makes a perfectly valid file of one;
 * - the frames at a quarter and three quarters of the way through differ on at least
 *   `MIN_MOVED` of the sampled pixels — it moves. A replay is the order things happened in; a
 *   still of the diagram for six seconds passes the first two and is worth nothing. A pixel
 *   counts as changed when its channels differ by more than `PIXEL_DELTA` in total, well above
 *   the encoder's own noise on an unchanging picture;
 * - it is at least `MIN_BYTES` — only a floor against an empty or truncated file.
 */
export const MIN_SECONDS = 3
export const MIN_COLOURS = 40
export const MIN_MOVED = 0.05
export const PIXEL_DELTA = 48
export const MIN_BYTES = 8 * 1024

/** decode `src` (a URL the page can load) in `page` and describe it; never throws for a bad file, it reports `error` */
export function readVideo(page, src) {
  return page.evaluate(
    async ({ src, delta }) => {
      const v = document.createElement('video')
      v.muted = true
      v.src = src
      try {
        await new Promise((ok, no) => {
          v.onloadeddata = ok
          v.onerror = () => no(new Error('it does not decode'))
        })
        // a MediaRecorder webm often reports an infinite duration until it has been read to the end
        if (!Number.isFinite(v.duration)) {
          v.currentTime = 1e9
          await new Promise((ok) => (v.ontimeupdate = ok))
        }
        const c = document.createElement('canvas')
        c.width = v.videoWidth
        c.height = v.videoHeight
        const ctx = c.getContext('2d', { willReadFrequently: true })
        const frameAt = async (at) => {
          v.currentTime = at
          await new Promise((ok) => (v.onseeked = ok))
          ctx.drawImage(v, 0, 0)
          return ctx.getImageData(0, 0, c.width, c.height).data
        }
        const STRIDE = 4 * 499
        const middle = await frameAt(v.duration / 2)
        const seen = new Set()
        for (let i = 0; i < middle.length; i += STRIDE) seen.add((middle[i] << 16) | (middle[i + 1] << 8) | middle[i + 2])
        const early = await frameAt(v.duration * 0.25)
        const late = await frameAt(v.duration * 0.75)
        let changed = 0
        let sampled = 0
        for (let i = 0; i < early.length; i += STRIDE) {
          sampled++
          if (Math.abs(early[i] - late[i]) + Math.abs(early[i + 1] - late[i + 1]) + Math.abs(early[i + 2] - late[i + 2]) > delta) changed++
        }
        return { seconds: Math.round(v.duration * 10) / 10, width: c.width, height: c.height, colours: seen.size, moved: changed / sampled }
      } catch (e) {
        return { error: String(e?.message ?? e) }
      }
    },
    { src, delta: PIXEL_DELTA },
  )
}

/** what is wrong with this recording, in words, or null when it is a real replay */
export function videoProblem(video, bytes) {
  const kb = `${Math.round(bytes / 1024)} kB`
  if (video.error) return `it does not decode (${video.error}; ${kb})`
  const said = `${kb}, ${video.seconds} s at ${video.width}×${video.height}, ${video.colours} colours in its middle frame, ${(video.moved * 100).toFixed(1)}% of pixels changed between ¼ and ¾`
  if (bytes < MIN_BYTES) return `it is next to empty (${said})`
  if (video.seconds < MIN_SECONDS) return `it is too short to be the replay (${said})`
  if (video.colours < MIN_COLOURS) return `its middle frame is blank (${said})`
  if (video.moved < MIN_MOVED) return `nothing moves in it (${said})`
  return null
}

/** the one-line description a passing check prints */
export const describeVideo = (video, bytes) =>
  `${Math.round(bytes / 1024)} kB, ${video.seconds} s at ${video.width}×${video.height}, ${video.colours} colours in its middle frame, ${(video.moved * 100).toFixed(0)}% of pixels changed between ¼ and ¾`
