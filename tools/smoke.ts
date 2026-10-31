/**
 * Loads the built entrypoint the same way the TUI loader does, catching a
 * broken relative import or a missing default export before publishing.
 */
const loaded = (await import("../dist/index.js")) as { default?: { id?: unknown; setup?: unknown } }

export {}

if (typeof loaded.default?.setup !== "function") {
  throw new Error("dist/index.js does not export a plugin definition with setup()")
}
if (loaded.default.id !== "opencode-next-prompt") {
  throw new Error(`dist/index.js exported an unexpected plugin id: ${String(loaded.default.id)}`)
}

const entryPath = "../tui.js"
const entry = (await import(entryPath)) as typeof loaded
if (typeof entry.default?.setup !== "function") {
  throw new Error("tui.js does not re-export the built plugin")
}

console.log("dist smoke ok")
