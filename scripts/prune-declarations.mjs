// Run after tsc in `npm run build`. tsc writes a declaration for every module
// in src, but a host can only reach those the entries' declarations import,
// directly or not: package.json's exports admit no deep import. This deletes
// the rest, and any folder they leave empty. scripts/check-dist.mjs fails the
// build if one is left, or if what is kept does not type-check.
import { readdirSync, rmdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { declarationProgram, reachedFiles } from './declarations.mjs'

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const reached = reachedFiles(declarationProgram(dist, 'nodenext'), dist)

let pruned = 0
for (const entry of readdirSync(dist, { recursive: true, withFileTypes: true })) {
  const path = resolve(entry.parentPath, entry.name)
  if (entry.isFile() && entry.name.endsWith('.d.ts') && !reached.has(path)) {
    rmSync(path)
    pruned++
  }
}

/** Delete the folders under `dir` left empty, deepest first. */
function removeEmpty(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const sub = join(dir, entry.name)
    removeEmpty(sub)
    if (readdirSync(sub).length === 0) rmdirSync(sub)
  }
}
removeEmpty(dist)

console.log(`declarations: kept ${reached.size} the entries reach, deleted ${pruned} they do not`)
