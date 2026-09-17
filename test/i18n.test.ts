import { describe, expect, it } from 'vitest'
import { LANGS, pickLang, plural, translate, type Key } from '../src/i18n'
import { AREAS, en, es } from '../src/i18n/messages'
import { LANGUAGES } from '../src/claim/schema'

/**
 * Words that genuinely are the same in both languages — loanwords and acronyms US Spanish
 * uses as they are. Everything else being different is what proves a key was translated
 * rather than copied across while the file was being filled in.
 */
const SAME_IN_BOTH = ['No', 'SUV', 'Hatchback', 'Beige', 'Van', 'VIN']

const placeholders = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort()

describe('the two dictionaries', () => {
  it('have exactly the same keys', () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort())
  })

  it('fill the same placeholders in both languages', () => {
    for (const key of Object.keys(en) as Key[]) {
      expect(placeholders(es[key]), `placeholders of ${key}`).toEqual(placeholders(en[key]))
    }
  })

  it('say something different in Spanish, except where the word is the same word', () => {
    const copied = (Object.keys(en) as Key[]).filter((k) => es[k] === en[k] && !SAME_IN_BOTH.includes(en[k]))
    expect(copied, 'English left in the Spanish dictionary').toEqual([])
  })

  it('define every key in exactly one area', () => {
    const seen = new Map<string, string>()
    const twice: string[] = []
    for (const [area, mod] of Object.entries(AREAS)) {
      for (const key of Object.keys(mod.en)) {
        if (seen.has(key)) twice.push(`${key} (${seen.get(key)} and ${area})`)
        seen.set(key, area)
      }
    }
    expect(twice).toEqual([])
    expect(seen.size).toBe(Object.keys(en).length)
  })

  it('are the same two languages the document records', () => {
    expect([...LANGUAGES]).toEqual([...LANGS])
  })
})

describe('choosing a language', () => {
  it('takes the host\'s choice first, whatever the browser asks for', () => {
    expect(pickLang('es', ['en-US', 'en'])).toBe('es')
    expect(pickLang('en', ['es-MX'])).toBe('en')
  })

  it('reads the browser\'s list when nothing was fixed, region and all', () => {
    expect(pickLang(null, ['es-MX', 'en-US'])).toBe('es')
    expect(pickLang(null, ['es-419'])).toBe('es')
    expect(pickLang(null, ['ES'])).toBe('es')
    expect(pickLang(null, ['pt-BR', 'es-MX'])).toBe('es')
  })

  it('falls back to English for a language it does not speak, or no answer at all', () => {
    expect(pickLang(null, ['pt-BR'])).toBe('en')
    expect(pickLang(null, [])).toBe('en')
    expect(pickLang('fr', [])).toBe('en')
    // a host that sent nonsense is not a host that chose: the browser still gets its say
    expect(pickLang('klingon', ['es-MX'])).toBe('es')
  })
})

describe('translate', () => {
  it('fills the placeholders it is given', () => {
    expect(translate('en', 'shell.progress', { n: 2, count: 7 })).toBe('Step 2 of 7')
    expect(translate('es', 'shell.progress', { n: 2, count: 7 })).toBe('Paso 2 de 7')
  })

  it('leaves a placeholder it was given nothing for visible, rather than blank', () => {
    expect(translate('en', 'shell.progress', { n: 2 })).toBe('Step 2 of {count}')
    expect(translate('en', 'shell.progress')).toBe('Step {n} of {count}')
  })

  it('picks one key or the other by count', () => {
    expect(plural(1, 'shell.done.next1', 'shell.done.next2')).toBe('shell.done.next1')
    expect(plural(0, 'shell.done.next1', 'shell.done.next2')).toBe('shell.done.next2')
    expect(plural(2, 'shell.done.next1', 'shell.done.next2')).toBe('shell.done.next2')
  })
})
