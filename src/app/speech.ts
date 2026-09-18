/**
 * The browser's own speech recognition, where it has one (Chrome, Safari, Edge). No key and no
 * service of ours: nothing leaves the page but the audio, to the browser's own recogniser.
 *
 * Shared by the two places a customer can talk instead of type — the statement box
 * (`Describe.tsx`) and "just tell us what happened" (`steps/Intake.tsx`) — so there is one
 * answer to "which recogniser, in which language".
 */
import type { Lang } from '../i18n'

export type Recognizer = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start: () => void
  stop: () => void
}

/** the recogniser's constructor, or undefined in a browser without one (Firefox) */
export const Speech = (globalThis as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer }).SpeechRecognition ??
  (globalThis as { webkitSpeechRecognition?: new () => Recognizer }).webkitSpeechRecognition

/**
 * The tag the recogniser wants is a full one — a bare "es" gets a recogniser nobody chose.
 * The browser's own tag for this language carries the region the customer actually speaks;
 * with none, US Spanish and US English, which is who this page is for.
 */
export const speechTag = (lang: Lang): string => navigator.languages?.find((l) => l.toLowerCase().startsWith(`${lang}-`)) || `${lang}-US`
