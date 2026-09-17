/**
 * Every message, gathered from the area files. Each area is owned by the part of the page it
 * translates, so the steps can be translated side by side without two people editing one
 * enormous file; a key defined in two areas is a test failure (`test/i18n.test.ts`).
 */
import * as vocab from './areas/vocab.ts'
import * as shell from './areas/shell.ts'
import * as start from './areas/start.ts'
import * as scene from './areas/scene.ts'
import * as damage from './areas/damage.ts'

export const en = { ...vocab.en, ...shell.en, ...start.en, ...scene.en, ...damage.en } as const
export type Key = keyof typeof en
export const es: Record<Key, string> = { ...vocab.es, ...shell.es, ...start.es, ...scene.es, ...damage.es }

/** for the duplicate-key test: which area each key came from */
export const AREAS = { vocab, shell, start, scene, damage } as const
