import { appendFileSync, renameSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** Where debug output lands while running inside the real TUI. */
export const DEBUG_LOG_FILE = join(tmpdir(), "opencode-next-prompt.log")
const MAX_DEBUG_LOG_BYTES = 1_000_000

let logFile: string | undefined

/** Overrides the log destination (used by tests). */
export function setDebugLogFile(file: string | undefined): void {
  logFile = file
}

function targetFile(): string {
  return logFile ?? process.env.NEXT_PROMPT_DEBUG_FILE ?? DEBUG_LOG_FILE
}

function stringify(extra: unknown): string {
  if (extra === undefined) return ""
  if (typeof extra === "string") return extra
  try {
    return JSON.stringify(extra)
  } catch {
    return String(extra)
  }
}

function rotateIfNeeded(file: string): void {
  try {
    if (statSync(file).size > MAX_DEBUG_LOG_BYTES) renameSync(file, `${file}.1`)
  } catch {
    // Missing file or a filesystem without rename support: append anyway.
  }
}

/**
 * Debug logging is off by default. Enable with `NEXT_PROMPT_DEBUG=1` (or the
 * globalThis flag used by tests).
 *
 * Output goes to a file: inside the TUI, console.error is captured by the
 * host and never reaches stderr, so a file is the only reliable channel.
 * The file rotates to `.1` once it exceeds 1 MB.
 */
export function debug(message: string, extra?: unknown): void {
  const flag = (globalThis as { NEXT_PROMPT_DEBUG?: boolean }).NEXT_PROMPT_DEBUG || process.env.NEXT_PROMPT_DEBUG
  if (!flag) return
  const file = targetFile()
  const detail = stringify(extra)
  try {
    rotateIfNeeded(file)
    appendFileSync(file, `${new Date().toISOString()} ${message}${detail ? ` ${detail}` : ""}\n`)
  } catch {
    // Never let diagnostics break the plugin.
  }
}
