// Local-directory entrypoint for OpenCode (cli.json "plugins" with an absolute
// path resolves <dir>/tui directly, bypassing package.json "exports").
// Published installs use the "./tui" export in package.json instead.
export { default } from "./dist/index.js"
