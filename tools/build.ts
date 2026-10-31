import * as ts from "typescript"
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"

const SRC = "src"
const OUT = "dist"

const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  skipLibCheck: true,
  types: ["node"],
}

const files = (await readdir(SRC))
  .filter((file) => (file.endsWith(".ts") || file.endsWith(".tsx")) && !file.endsWith(".d.ts"))
  .sort()
  .map((file) => `${SRC}/${file}`)

if (files.length === 0) throw new Error(`no source files found in ${SRC}`)

function reportDiagnostics(diagnostics: readonly ts.Diagnostic[]): void {
  const host: ts.FormatDiagnosticsHost = {
    getCanonicalFileName: (file) => file,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => "\n",
  }
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, host))
}

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

for (const file of files) {
  const source = await readFile(file, "utf8")
  const { outputText, diagnostics } = ts.transpileModule(source, { compilerOptions, fileName: file })
  if (diagnostics && diagnostics.length > 0) {
    reportDiagnostics(diagnostics)
    process.exit(1)
  }
  const outName = file.replace(/^src\//, "").replace(/\.tsx?$/, ".js")
  const fixed = outputText.replace(/(from\s+["'])(\.\/[^"']+?)\.tsx?(["'])/g, "$1$2.js$3")
  await writeFile(`${OUT}/${outName}`, fixed)
}

const program = ts.createProgram(files, {
  ...compilerOptions,
  allowImportingTsExtensions: true,
  declaration: true,
  emitDeclarationOnly: true,
  outDir: OUT,
})
const emitResult = program.emit()
const diagnostics = [...ts.getPreEmitDiagnostics(program), ...emitResult.diagnostics]
if (diagnostics.length > 0) {
  reportDiagnostics(diagnostics)
  process.exit(1)
}

for (const file of files) {
  const outName = file.replace(/^src\//, "").replace(/\.tsx?$/, ".js")
  const declaration = `${OUT}/${outName.replace(/\.js$/, ".d.ts")}`
  const source = await readFile(declaration, "utf8")
  const fixed = source.replace(/(from\s+["'])(\.\/[^"']+?)\.tsx?(["'])/g, "$1$2.js$3")
  await writeFile(declaration, fixed)
  console.log(`built ${OUT}/${outName}`)
}
