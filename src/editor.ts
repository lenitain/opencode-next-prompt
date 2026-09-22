/**
 * Structural (duck-typed) access to the TUI's focused prompt editor.
 *
 * `instanceof` cannot be used across the plugin/host boundary: the opencode
 * binary bundles its own copy of @opentui/core, while the plugin resolves its
 * own copy from node_modules, so class identity never matches. Instead we
 * recognise editors by the members every edit-buffer renderable exposes.
 *
 * To tell the prompt's multi-line TextareaRenderable apart from the
 * single-line InputRenderable (dialogs, forms — which must never receive the
 * suggestion), we check for the `maxLength` accessor that only
 * InputRenderable defines.
 */

export type TextareaLike = {
  readonly plainText: string
  placeholder: string | null
  readonly isDestroyed: boolean
  insertText(text: string): void
  gotoBufferEnd(options?: { select?: boolean }): void
  getLayoutNode(): { markDirty(): void }
}

/** Returns `editor` when it is a live, writable multi-line textarea; otherwise null. */
export function asPromptTextarea(editor: unknown): TextareaLike | null {
  if (!editor || typeof editor !== "object") return null
  const candidate = editor as Partial<TextareaLike> & { maxLength?: unknown }
  if (candidate.isDestroyed) return null
  if (typeof candidate.plainText !== "string") return null
  if (typeof candidate.insertText !== "function") return null
  if (typeof candidate.gotoBufferEnd !== "function") return null
  if (typeof candidate.getLayoutNode !== "function") return null
  if ("maxLength" in candidate) return null // single-line InputRenderable
  return candidate as TextareaLike
}
