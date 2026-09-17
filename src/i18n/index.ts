/**
 * The page's language, without a library.
 *
 * Flat keys, `{name}` placeholders, one dictionary per language. English is the source of
 * truth for the keys: `es` is typed `Record<Key, string>`, so a key added in English and
 * forgotten in Spanish fails the build rather than showing an English sentence to someone who
 * asked for Spanish.
 *
 * This module is pure — no store, no DOM — so `src/claim/describe.ts` can translate the
 * sentences it composes and still be imported by anything. Components use `useT()` from
 * `./useT`, which binds the language the store holds and re-renders on a switch.
 *
 * Only the customer's page is translated. The claims desk, the `claim/1` document's enum
 * values and `UNKNOWN_DRIVER` (which is data), the server's messages and `embed.js` stay
 * English: the insurer reads one language.
 */
import { en, es, type Key } from './messages'

export { type Key }

export const LANGS = ['en', 'es'] as const
export type Lang = (typeof LANGS)[number]
export const isLang = (v: unknown): v is Lang => (LANGS as readonly string[]).includes(v as string)

export type Vars = Record<string, string | number>

/** the sentence for a key, with `{name}` placeholders filled; an unknown placeholder stays visible */
export function translate(lang: Lang, key: Key, vars?: Vars): string {
  const s: string = (lang === 'es' ? es : en)[key] ?? en[key]
  return vars ? s.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole)) : s
}

/**
 * Which language to start in: the host's choice when it made one, then the first of the
 * browser's languages this page speaks, then English. `es-MX` and `es-419` both mean Spanish.
 */
export function pickLang(fixed: unknown, languages: readonly string[]): Lang {
  if (isLang(fixed)) return fixed
  for (const tag of languages) {
    const base = tag.toLowerCase().split('-')[0]
    if (isLang(base)) return base
  }
  return 'en'
}

/** one or other key by count — both languages here plural the same way, one and not-one */
export const plural = (count: number, one: Key, other: Key): Key => (count === 1 ? one : other)
