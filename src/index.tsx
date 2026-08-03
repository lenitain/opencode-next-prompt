import type { TuiPlugin, TuiPluginApi, TuiSlotContext } from "@opencode-ai/plugin/tui"
import type { Model, Provider, Session } from "@opencode-ai/sdk/v2"
import type { JSX } from "@opentui/solid"
import { InputRenderable } from "@opentui/core"
import { createSuggestionStore } from "./state.ts"
import { createPredictor, type ConversationTurn } from "./predict.ts"
import { renderSuggestionPlaceholder } from "./ui.tsx"

const DEFAULT_OPTIONS = {
  acceptKey: "down",
  timeoutMs: 20_000,
  disableTools: true,
  includeToolContext: false,
} as const

type Options = {
  acceptKey: string
  timeoutMs: number
  model?: string
  variant?: string
  disableTools: boolean
  includeToolContext: boolean
}

const RETRY_DELAY_MS = 800

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
          return options.includeToolContext ? summarizeToolPart(part) : ""
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

  let inFlightUserMessageID: string | undefined
  let completedUserMessageID: string | undefined
  let retriedUserMessageID: string | undefined
  let reportedModelIssue: string | undefined

  const predictor = createPredictor(api.client, api.state.path.directory, {
    timeoutMs: options.timeoutMs,
    model: options.model,
    disableTools: options.disableTools,
  })

  const maybePredict = async (): Promise<void> => {
    if (api.lifecycle.signal.aborted) return
    const sessionID = currentSessionID()
    if (!sessionID) return
    if (api.state.session.status(sessionID)?.type !== "idle") return
    const userMessageID = lastUserMessageID(sessionID)
    if (!userMessageID) return
    if (userMessageID === completedUserMessageID || userMessageID === inFlightUserMessageID) return
    const session = api.state.session.get(sessionID)
    const modelRef = resolveModelRef(options.model, session?.model, api.state.provider)
    const modelIssue = checkModelConfig(options.model, modelRef, api.state.provider)
    if (modelIssue) {
      if (reportedModelIssue !== modelIssue) {
        reportedModelIssue = modelIssue
        log(api, "prediction skipped", modelIssue)
        api.ui.toast({ variant: "error", title: "next-prompt", message: modelIssue, duration: 8000 })
      }
      return
    }
    const turns = conversationTurns(sessionID)
    if (turns.length === 0) return
    const generation = store.beginPredict(sessionID)
    if (generation === null) return
    inFlightUserMessageID = userMessageID
    const variant = resolveVariant(options.variant, modelRef)
    try {
      const result = await predictor.predict(session?.model, turns, variant)
      if (inFlightUserMessageID !== userMessageID) return
      if (result.ok) {
        completedUserMessageID = userMessageID
        store.commit(generation, sessionID, result.text)
      } else {
        store.discard()
        scheduleRetry(userMessageID)
      }
    } catch (error) {
      log(api, "prediction failed", errorMessage(error))
      if (inFlightUserMessageID !== userMessageID) return
      store.discard()
      scheduleRetry(userMessageID)
    } finally {
      if (inFlightUserMessageID === userMessageID) inFlightUserMessageID = undefined
    }
  }

  const scheduleRetry = (userMessageID: string): void => {
    if (retriedUserMessageID === userMessageID) return
    retriedUserMessageID = userMessageID
    setTimeout(() => void maybePredict(), RETRY_DELAY_MS)
  }

  const invalidate = (): void => {
    store.discard()
    inFlightUserMessageID = undefined
    completedUserMessageID = undefined
    retriedUserMessageID = undefined
    void predictor.dispose()
  }

  const accept = async (): Promise<void> => {
    const current = store.read()
    if (current.kind !== "ready") return
    try {
      await api.client.tui.appendPrompt({ text: current.text })
    } catch (error) {
      log(api, "append prompt failed", errorMessage(error))
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

  api.event.on("tui.session.select", () => invalidate())

  api.event.on("session.compacted", () => invalidate())

  api.event.on("session.deleted", (event) => {
    if (event.properties.sessionID === currentSessionID()) invalidate()
  })

  api.event.on("message.removed", (event) => {
    if (event.properties.sessionID === currentSessionID()) invalidate()
  })

  api.event.on("message.part.removed", (event) => {
    if (event.properties.sessionID === currentSessionID()) invalidate()
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

  api.slots.register(
    {
      id: "opencode-next-prompt",
      slots: {
        session_prompt_right: (ctx: TuiSlotContext, props: Parameters<typeof renderSuggestionPlaceholder>[1]) =>
          renderSuggestionPlaceholder(api, props, store.read, options.acceptKey),
      },
    } as unknown as Parameters<typeof api.slots.register>[0],
  )
}

function log(api: TuiPluginApi, message: string, extra: unknown): void {
  void api.client.app.log({
    service: "opencode-next-prompt",
    level: "info",
    message,
    extra: { data: extra },
  })
}

type ResolvedModelRef = {
  providerID: string
  modelID: string
  model?: Model
}

function resolveModelRef(
  spec: string | undefined,
  sessionModel: Session["model"] | undefined,
  providers: ReadonlyArray<Provider>,
): ResolvedModelRef | undefined {
  const slash = spec?.indexOf("/") ?? -1
  if (spec && slash > 0 && slash < spec.length - 1) {
    const providerID = spec.slice(0, slash)
    const modelID = spec.slice(slash + 1)
    return { providerID, modelID, model: findModel(providerID, modelID, providers) }
  }
  const providerID = sessionModel?.providerID
  const modelID = spec ?? sessionModel?.id
  if (!providerID || !modelID) return undefined
  return { providerID, modelID, model: findModel(providerID, modelID, providers) }
}

function findModel(providerID: string, modelID: string, providers: ReadonlyArray<Provider>): Model | undefined {
  return providers.find((item) => item.id === providerID)?.models[modelID]
}

function checkModelConfig(
  spec: string | undefined,
  ref: ResolvedModelRef | undefined,
  providers: ReadonlyArray<Provider>,
): string | undefined {
  if (!spec || !ref) return undefined
  const provider = providers.find((item) => item.id === ref.providerID)
  if (!provider) {
    const available = providers.map((item) => item.id).join(", ")
    return `model config error: provider "${ref.providerID}" not found${available ? ` (available providers: ${available})` : ""}`
  }
  if (!ref.model) {
    const available = Object.keys(provider.models).slice(0, 10).join(", ")
    return `model config error: model "${ref.modelID}" not found on provider "${ref.providerID}"${
      available ? ` (available models: ${available}${Object.keys(provider.models).length > 10 ? ", ..." : ""})` : ""
    }`
  }
  return undefined
}

const VARIANT_ORDER = ["none", "low", "min", "medium", "high", "xhigh", "max"]

function resolveVariant(configVariant: string | undefined, ref: ResolvedModelRef | undefined): string | undefined {
  if (configVariant === "default") return undefined
  if (configVariant) return configVariant
  const variants = ref?.model?.variants
  if (!variants) return undefined
  const names = Object.keys(variants)
  if (names.length === 0) return undefined
  const low = names.find((name) => name.toLowerCase() === "low")
  if (low) return low
  return names.toSorted((a, b) => variantRank(a) - variantRank(b))[0]
}

function variantRank(name: string): number {
  const index = VARIANT_ORDER.indexOf(name.toLowerCase())
  return index === -1 ? VARIANT_ORDER.length : index
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (error && typeof error === "object") {
    const candidate = (error as { message?: unknown }).message
    if (typeof candidate === "string") return candidate
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
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
