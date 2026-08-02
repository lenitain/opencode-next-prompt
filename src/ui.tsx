import type { JSX } from "@opentui/solid"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { Accessor } from "solid-js"
import { createEffect, onCleanup } from "solid-js"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import type { SuggestionState } from "./state.ts"

const ARROW_KEYS: Record<string, string> = {
  right: "→",
  left: "←",
  up: "↑",
  down: "↓",
}

function displayKey(key: string): string {
  return ARROW_KEYS[key] ?? key
}

export type PromptSlotProps = {
  session_id: string
}

export function renderSuggestionPlaceholder(
  api: TuiPluginApi,
  props: PromptSlotProps,
  state: Accessor<SuggestionState>,
  acceptKey: string,
): JSX.Element {
  const apply = (): void => {
    const editor = api.renderer.currentFocusedEditor
    if (!editor || editor instanceof InputRenderable || !(editor instanceof TextareaRenderable)) return
    const current = state()
    editor.placeholder =
      current.kind === "ready" && current.sessionID === props.session_id
        ? ` [${displayKey(acceptKey)}] ${current.text}`
        : null
  }
  createEffect(apply)
  api.renderer.on("focused_editor", apply)
  onCleanup(() => {
    api.renderer.off("focused_editor", apply)
  })
  return null
}
