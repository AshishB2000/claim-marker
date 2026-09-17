/**
 * Every message, gathered from the area files. Each area is owned by the part of the page it
 * translates, so the steps can be translated side by side without two people editing one
 * enormous file; a key defined in two areas is a test failure (`test/i18n.test.ts`).
 */
import * as vocab from './areas/vocab'
import * as shell from './areas/shell'
import * as start from './areas/start'
import * as scene from './areas/scene'
import * as damage from './areas/damage'

export const en = { ...vocab.en, ...shell.en, ...start.en, ...scene.en, ...damage.en } as const
export type Key = keyof typeof en
export const es: Record<Key, string> = { ...vocab.es, ...shell.es, ...start.es, ...scene.es, ...damage.es }

/** for the duplicate-key test: which area each key came from */
export const AREAS = { vocab, shell, start, scene, damage } as const
