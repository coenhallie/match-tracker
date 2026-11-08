/**
 * The shadow root's stylesheet ships without its comments, and is otherwise
 * the stylesheet as written: the same rules, in the same order, with the same
 * declarations (scripts/stripStylesComments.ts, vite.config.ts).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stripStylesComments } from '../../scripts/stripStylesComments'
import { LABEL_FAMILY, familyList } from '../../src/assets/fontFamilies'
import { STYLES } from '../../src/widget/styles'

// From the repository's root, where the tests run.
const SOURCE = readFileSync(resolve('src/widget/styles.ts'), 'utf8')

/** The stylesheet as written, comments and all: the template's text, with its one interpolation filled in. */
function asWritten(): string {
  const start = SOURCE.indexOf('export const STYLES = `') + 'export const STYLES = `'.length
  return SOURCE.slice(start, SOURCE.indexOf('`', start)).replace('${familyList(LABEL_FAMILY)}', familyList(LABEL_FAMILY))
}

/** Every rule a browser reads from `css`, as it reads it back. */
function rules(css: string): string[] {
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(css)
  return [...sheet.cssRules].map((rule) => rule.cssText)
}

describe('the stylesheet without its comments', () => {
  it('has none left', () => {
    expect(asWritten()).toContain('/*')
    expect(STYLES).not.toContain('/*')
    expect(STYLES.length).toBeLessThan(asWritten().length * 0.7)
  })

  it('reads as the same rules as the stylesheet as written', () => {
    const written = rules(asWritten())
    expect(written.length).toBeGreaterThan(20)
    expect(rules(STYLES)).toEqual(written)
  })

  it('takes out only the comments, and the lines they stand alone on', () => {
    const source = [
      'const a = 1 /* not the stylesheet */',
      'export const STYLES = `',
      '/* alone */',
      '.a { color: red; } /* after */',
      '  /* indented,',
      '     two lines */',
      '.b { content: "x"; }',
      '`',
      '/* after the stylesheet */',
    ].join('\n')
    expect(stripStylesComments(source)).toBe(
      [
        'const a = 1 /* not the stylesheet */',
        'export const STYLES = `',
        '.a { color: red; } ',
        '.b { content: "x"; }',
        '`',
        '/* after the stylesheet */',
      ].join('\n'),
    )
  })

  it('fails rather than ship the comments when it cannot find the stylesheet', () => {
    expect(() => stripStylesComments('export const CSS = `/* x */`')).toThrow(/no STYLES template/)
  })
})
