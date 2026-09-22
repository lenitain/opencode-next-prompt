import * as ts from "typescript"
import { mkdir, readFile, writeFile } from "node:fs/promises"

const FILES = ["src/index.tsx", "src/debug.ts", "src/editor.ts", "src/predict.ts", "src/state.ts", "src/ui.tsx"]
const OUT = "dist"

const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  jsx: ts.JsxEmit.ReactJSX,
  jsxImportSource: "@opentui/solid",
  moduleResolution: ts.ModuleResolutionKind.Bundler,
}

await mkdir(OUT, { recursive: true })

for (const file of FILES) {
  const source = await readFile(file, "utf8")
  const { outputText } = ts.transpileModule(source, { compilerOptions, fileName: file })
  const outName = file.replace(/^src\//, "").replace(/\.tsx?$/, ".js")
  const fixed = outputText.replace(/(from\s+["'])(\.\/[^"']+?)\.tsx?(["'])/g, "$1$2.js$3")
  await writeFile(`${OUT}/${outName}`, fixed)
  console.log(`built ${OUT}/${outName}`)
}

const program = ts.createProgram(FILES, {
  ...compilerOptions,
  allowImportingTsExtensions: true,
  declaration: true,
  emitDeclarationOnly: true,
  outDir: OUT,
})
program.emit()
for (const file of FILES) {
  const outName = file.replace(/^src\//, "").replace(/\.tsx?$/, ".d.ts")
  console.log(`built ${OUT}/${outName}`)
}
