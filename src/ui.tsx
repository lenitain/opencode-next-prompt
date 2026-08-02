import type { JSX } from "@opentui/solid"
import type { TuiPluginApi, TuiSlotContext } from "@opencode-ai/plugin/tui"
import type { Accessor } from "solid-js"
import { createEffect, createSignal, onCleanup } from "solid-js"
import { EditBufferRenderable, InputRenderable, TextareaRenderable } from "@opentui/core"
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

export function createInputEmpty(api: TuiPluginApi): Accessor<boolean> {
  const [inputEmpty, setInputEmpty] = createSignal(true)
  const apply = (): void => {
    const editor = api.renderer.currentFocusedEditor
    setInputEmpty(editor === null || (!(editor instanceof InputRenderable) && editor.editBuffer.getText() === ""))
  }
  const offs = new Set<() => void>()
  const subscribe = (editor: EditBufferRenderable | null): void => {
    if (!editor) return
    const handler = (): void => apply()
    editor.editBuffer.on("content-changed", handler)
    editor.editBuffer.on("cursor-changed", handler)
    offs.add(() => {
      editor.editBuffer.off("content-changed", handler)
      editor.editBuffer.off("cursor-changed", handler)
    })
  }
  api.renderer.on("focused_editor", (current) => {
    offs.forEach((off) => off())
    offs.clear()
    subscribe(current)
    apply()
  })
  subscribe(api.renderer.currentFocusedEditor)
  apply()
  return inputEmpty
}

export function renderSuggestionSlot(
  ctx: TuiSlotContext,
  props: PromptSlotProps,
  state: Accessor<SuggestionState>,
  acceptKey: string,
  inputEmpty: Accessor<boolean>,
): JSX.Element {
  const current = state()
  if (current.kind !== "ready" || current.sessionID !== props.session_id || !inputEmpty()) return null
  return <text fg={ctx.theme.current.textMuted}>{`[${displayKey(acceptKey)}] ${current.text}`}</text>
}
