import type { TuiPlugin, TuiPluginApi, TuiSlotContext } from "@opencode-ai/plugin/tui"
import type { JSX } from "@opentui/solid"
import { InputRenderable } from "@opentui/core"
import { createSuggestionStore } from "./state.ts"
import { createPredictor, type ConversationTurn } from "./predict.ts"
import { createInputEmpty, renderSuggestionPlaceholder, renderSuggestionSlot } from "./ui.tsx"

const DEFAULT_OPTIONS = {
  acceptKey: "right",
  position: "left",
  timeoutMs: 20_000,
} as const

type Options = {
  acceptKey: string
  position: "left" | "right"
  timeoutMs: number
}

const opencodeNextPrompt: TuiPlugin = async (api, rawOptions) => {
  const options: Options = { ...DEFAULT_OPTIONS, ...(rawOptions ?? {}) }

  const store = createSuggestionStore()

  const currentSessionID = (): string | undefined => {
    const route = api.route.current
    if (route.name !== "session") return undefined
    const sessionID = route.params?.sessionID
    return typeof sessionID === "string" ? sessionID : undefined
  }

  const promptInputIsEmpty = (): boolean => {
    const editor = api.renderer.currentFocusedEditor
    if (!editor || editor instanceof InputRenderable) return false
    return editor.editBuffer.getText() === ""
  }

  const conversationTurns = (sessionID: string): ConversationTurn[] => {
    const result: ConversationTurn[] = []
    for (const message of api.state.session.messages(sessionID)) {
      if (message.role !== "user" && message.role !== "assistant") continue
      const text = api.state
        .part(message.id)
        .map((part) => {
          if (part.type === "text" && !part.synthetic && !part.ignored) {
            return part.text.replace(/<think>[\s\S]*?<\/think>\s*/g, "")
          }
          return summarizeToolPart(part)
        })
        .join("\n")
        .trim()
      if (!text) continue
      result.push({ id: message.id, role: message.role, text })
    }
    return result
  }

  const lastUserMessageID = (sessionID: string): string | undefined => {
    for (const message of api.state.session.messages(sessionID).toReversed()) {
      if (message.role === "user") return message.id
    }
    return undefined
  }

  let predictedUserMessageID: string | undefined

  const predictor = createPredictor(api.client, api.state.path.directory, options)

  const maybePredict = async (): Promise<void> => {
    const sessionID = currentSessionID()
    if (!sessionID) return
    const userMessageID = lastUserMessageID(sessionID)
    if (userMessageID && userMessageID === predictedUserMessageID) return
    const turns = conversationTurns(sessionID)
    if (turns.length === 0) return
    const generation = store.beginPredict(sessionID)
    if (generation === null) return
    predictedUserMessageID = userMessageID
    const session = api.state.session.get(sessionID)
    try {
      const text = await predictor.predict(session?.model, turns)
      store.commit(generation, sessionID, text)
    } catch (error) {
      log(api, "prediction failed", error)
      store.discard()
    }
  }

  const accept = async (): Promise<void> => {
    const current = store.read()
    if (current.kind !== "ready") return
    try {
      await api.client.tui.appendPrompt({ text: current.text })
    } catch (error) {
      log(api, "append prompt failed", error)
    }
  }

  api.event.on("session.status", (event) => {
    const { sessionID, status } = event.properties
    if (sessionID !== currentSessionID()) return
    if (status.type === "busy") {
      store.discard()
    } else if (status.type === "idle") {
      if (store.read().kind === "idle") void maybePredict()
    }
  })

  api.event.on("tui.session.select", (event) => {
    store.discard()
    void predictor.dispose()
  })

  api.event.on("session.compacted", () => {
    void predictor.dispose()
  })

  api.lifecycle.onDispose(() => {
    void predictor.dispose()
  })

  api.keymap.registerLayer({
    priority: 1000,
    enabled: () => store.read().kind === "ready",
    commands: [{ name: "next-prompt.accept", run: () => (promptInputIsEmpty() ? void accept() : undefined) }],
    bindings: [
      { key: options.acceptKey, cmd: "next-prompt.accept", preventDefault: false, fallthrough: true },
    ],
  })

  const inputEmpty = options.position === "right" ? createInputEmpty(api) : undefined

  api.slots.register(
    {
      id: "opencode-next-prompt",
      slots: {
        session_prompt_right: (ctx: TuiSlotContext, props: Parameters<typeof renderSuggestionPlaceholder>[1]) =>
          options.position === "right"
            ? renderSuggestionSlot(ctx, props, store.read, options.acceptKey, inputEmpty!)
            : renderSuggestionPlaceholder(api, props, store.read, options.acceptKey),
      },
    } as unknown as Parameters<typeof api.slots.register>[0],
  )
}

function log(api: TuiPluginApi, message: string, extra: unknown): void {
  void api.client.app.log({
    service: "opencode-next-prompt",
    level: "info",
    message,
    extra: { data: JSON.stringify(extra) },
  })
}

const TOOL_SUMMARY_CHARS = 150

function summarizeToolPart(part: {
  type: string
  tool?: string
  state?: { status?: string; input?: unknown; metadata?: { output?: string } }
}): string {
  if (part.type !== "tool" || !part.state || part.state.status === "running") return ""
  const input = JSON.stringify(part.state.input ?? {})
  const output = part.state.metadata?.output ?? ""
  const inputText = input.length > 80 ? input.slice(0, 79) + "…" : input
  const outputText = output.length > TOOL_SUMMARY_CHARS ? output.slice(0, TOOL_SUMMARY_CHARS - 1) + "…" : output
  return `[tool:${part.tool ?? "?"}] ${inputText} → ${outputText || part.state.status || ""}`
}

export default { id: "opencode-next-prompt", tui: opencodeNextPrompt }
