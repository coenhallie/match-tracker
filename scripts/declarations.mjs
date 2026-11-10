// The type declarations dist ships, read as a host's TypeScript reads them:
// from the three entries' declarations, which package.json's exports name,
// following their imports. Shared by scripts/prune-declarations.mjs, which
// deletes the rest, and scripts/check-dist.mjs, which type-checks what ships.
import { join, resolve, sep } from 'node:path'
import ts from 'typescript'

export const ENTRY_DECLARATIONS = ['index.d.ts', 'vue.d.ts', 'banner.d.ts']

/** The module resolutions the README's Bundlers section says the package resolves under. */
export const RESOLUTIONS = {
  bundler: { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler },
  node16: { module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16 },
  nodenext: { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext },
}

/**
 * A program of the entries' declarations under `resolution`, checked as
 * strictly as a host may check them: strict, and with its libraries checked
 * too, Vue's among them.
 */
export function declarationProgram(dist, resolution) {
  return ts.createProgram(
    ENTRY_DECLARATIONS.map((file) => join(dist, file)),
    {
      ...RESOLUTIONS[resolution],
      target: ts.ScriptTarget.ES2022,
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
      types: [],
      strict: true,
      skipLibCheck: false,
      noEmit: true,
    },
  )
}

/** The files in `dist` that `program` reads, as absolute paths. */
export function reachedFiles(program, dist) {
  const root = resolve(dist) + sep
  return new Set(
    program
      .getSourceFiles()
      .map((file) => resolve(file.fileName))
      .filter((file) => file.startsWith(root)),
  )
}

/** `program`'s errors, one formatted line each. */
export function errorsOf(program) {
  return ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) => ts.formatDiagnostic(diagnostic, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => process.cwd(), getNewLine: () => '' }))
}
