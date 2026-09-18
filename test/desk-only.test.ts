/**
 * The line between the two screens.
 *
 * `src/claim/plausibility.ts` tells an adjuster what is worth a second look at a finished
 * report. The customer must never see it: they are filling in a form after a crash, and a page
 * that answers "the panel you marked is on the other side from the impact" is a page that
 * argues with someone having a bad day. The rule is easy to state and easy to break by
 * importing one helper in one step, so it is a test rather than a note.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../src', import.meta.url))

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sources(full)
    return /\.tsx?$/.test(name) ? [full] : []
  })
}

const all = sources(root).map((file) => ({ file: file.slice(root.length + 1), text: readFileSync(file, 'utf8') }))
const imports = (text: string, module: string) => new RegExp(`from '[^']*${module}'`).test(text)

describe('what the customer never sees', () => {
  it('is imported by the claims desk and by nothing the customer loads', () => {
    const readers = all.filter((s) => imports(s.text, 'plausibility')).map((s) => s.file)
    expect(readers, 'plausibility.ts is the desk’s, and only the desk’s').toEqual(['adjuster/Compare.tsx', 'adjuster/Desk.tsx'])
  })

  it('is not reachable from any step, the review page or the shared document', () => {
    const customerFacing = all.filter((s) => s.file.startsWith('app/') || s.file.startsWith('i18n/'))
    expect(customerFacing.filter((s) => imports(s.text, 'plausibility')).map((s) => s.file)).toEqual([])
    // and the one component both screens render must not grow a private door to it either
    expect(imports(all.find((s) => s.file === 'app/ReportDocument.tsx')!.text, 'plausibility')).toBe(false)
  })
})
