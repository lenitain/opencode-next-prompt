import { appendFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** Where debug output lands while running inside the real TUI. */
export const DEBUG_LOG_FILE = join(tmpdir(), "opencode-next-prompt.log")

function stringify(extra: unknown): string {
  if (extra === undefined) return ""
  if (typeof extra === "string") return extra
  try {
    return JSON.stringify(extra)
  } catch {
    return String(extra)
  }
}

/**
 * Debug logging is off by default. Enable with `NEXT_PROMPT_DEBUG=1` (or the
 * globalThis flag used by tests).
 *
 * Output goes to a file: inside the TUI, console.error is captured by the
 * host and never reaches stderr, so a file is the only reliable channel.
 */
export function debug(message: string, extra?: unknown): void {
  const flag =
    (globalThis as { NEXT_PROMPT_DEBUG?: boolean }).NEXT_PROMPT_DEBUG || process.env.NEXT_PROMPT_DEBUG
  if (!flag) return
  const detail = stringify(extra)
  try {
    appendFileSync(DEBUG_LOG_FILE, `${new Date().toISOString()} ${message}${detail ? ` ${detail}` : ""}\n`)
  } catch {
    // Never let diagnostics break the plugin.
  }
}
