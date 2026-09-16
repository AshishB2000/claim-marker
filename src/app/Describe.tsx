import { useEffect, useRef, useState } from 'react'
import { useClaim } from '../claim/store'
import { Field } from './ui'
import { Icon } from './icons'

/** the browser's own speech recognition, where it has one (Chrome, Safari, Edge); no key, nothing leaves the page but the audio to the browser's own service */
type Recognizer = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start: () => void
  stop: () => void
}
const Speech = (globalThis as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer }).SpeechRecognition ??
  (globalThis as { webkitSpeechRecognition?: new () => Recognizer }).webkitSpeechRecognition

/**
 * "In your own words, what happened?" — typed, or spoken into the box on a phone at the
 * roadside. Dictation appends to whatever is already there, so a sentence can be typed,
 * then said, then corrected.
 */
export function Describe({ placeholder, children }: { placeholder: string; children?: React.ReactNode }) {
  const description = useClaim((s) => s.claim.incident.description)
  const setIncident = useClaim((s) => s.setIncident)
  const [listening, setListening] = useState(false)
  const rec = useRef<Recognizer | null>(null)
  // what was in the box when dictation began; the live transcript is appended to it
  const base = useRef('')

  useEffect(() => () => rec.current?.stop(), [])

  const toggle = () => {
    if (listening) {
      rec.current?.stop()
      return
    }
    if (!Speech) return
    const r = new Speech()
    r.lang = navigator.language || 'en-US'
    r.continuous = true
    r.interimResults = true
    base.current = useClaim.getState().claim.incident.description.replace(/\s+$/, '')
    r.onresult = (e) => {
      let said = ''
      for (let i = 0; i < e.results.length; i++) said += e.results[i][0].transcript
      said = said.trim()
      setIncident({ description: base.current ? `${base.current} ${said}` : said })
    }
    r.onend = () => {
      setListening(false)
      rec.current = null
    }
    r.onerror = r.onend
    rec.current = r
    setListening(true)
    r.start()
  }

  return (
    <div>
      <Field label="In your own words, what happened?">
        <textarea className="input min-h-28" placeholder={placeholder} value={description} onChange={(e) => setIncident({ description: e.target.value })} />
      </Field>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {Speech && (
          <button className={`btn btn-sm ${listening ? 'bg-red-600 text-white hover:bg-red-500' : 'btn-secondary'}`} onClick={toggle} aria-pressed={listening}>
            {listening ? <span className="size-2 animate-pulse rounded-full bg-white" /> : <Icon.mic />}
            {listening ? 'Listening… tap to stop' : 'Say it instead'}
          </button>
        )}
        {children}
      </div>
    </div>
  )
}
