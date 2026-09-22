import type { Context } from "@opencode/plugin/tui/context"
import type { SuggestionStore } from "./state.ts"
import { asPromptTextarea } from "./editor.ts"
import { debug } from "./debug.ts"

const ARROW_KEYS: Record<string, string> = {
  right: "→",
  left: "←",
  up: "↑",
  down: "↓",
}

function displayKey(key: string): string {
  return ARROW_KEYS[key] ?? key
}

/**
 * Renders the suggestion into the prompt textarea's placeholder. There is no
 * slot inside the input in V2, so the controller writes the placeholder
 * directly: it re-applies on store changes, on the renderer's `focused_editor`
 * event, and — because the TUI rewrites the placeholder from its own reactive
 * memo (session switch, resize, shell change) — on every frame while a
 * suggestion is live. `sessionID()` answers which session the prompt edits.
 *
 * Deliberately free of solid-js: a plugin loaded at runtime resolves solid's
 * server build (createEffect would be a no-op) and the plugin's copy of solid
 * is not the TUI's copy anyway, so side effects here must not depend on it.
 *
 * The placeholder is only cleared when it is ours (it starts with the accept
 * key marker), so OpenCode's own placeholder list is left untouched.
 */
export function createPlaceholderController(context: Context, store: SuggestionStore, sessionID: () => string | undefined, acceptKey: string) {
  const marker = ` [${displayKey(acceptKey)}] `

  const apply = (): void => {
    const editor = asPromptTextarea(context.renderer.currentFocusedEditor)
    const current = store.read()
    debug("apply", {
      kind: current.kind,
      want: current.kind === "ready" ? current.sessionID : undefined,
      have: sessionID(),
      editor: editor !== null,
    })
    if (!editor) return
    if (current.kind === "ready" && current.sessionID === sessionID()) {
      const desired = marker + current.text
      // Write only on real changes: the setter is idempotent, which is what
      // lets the frame reconciler below settle after restoring our marker.
      if (editor.placeholder !== desired) editor.placeholder = desired
      return
    }
    if (typeof editor.placeholder === "string" && editor.placeholder.startsWith(marker)) {
      editor.placeholder = null
    }
  }

  // TUI overwrites trigger a render, so reconciling on the next frame
  // restores our marker within one paint; when idle there is nothing to
  // defend, and frames skip the work entirely.
  const onFrame = (): void => {
    if (store.read().kind === "ready") apply()
  }

  let unsubscribe: (() => void) | null = null

  return {
    apply,
    start(): void {
      unsubscribe = store.subscribe(apply)
      context.renderer.on("focused_editor", apply)
      context.renderer.on("frame", onFrame)
    },
    dispose(): void {
      unsubscribe?.()
      unsubscribe = null
      context.renderer.off("focused_editor", apply)
      context.renderer.off("frame", onFrame)
      const editor = asPromptTextarea(context.renderer.currentFocusedEditor)
      if (editor && typeof editor.placeholder === "string" && editor.placeholder.startsWith(marker)) {
        editor.placeholder = null
      }
    },
  }
}

export type PlaceholderController = ReturnType<typeof createPlaceholderController>
