import { Plugin } from "@opencode/plugin/tui"
import type { Context, KeymapLayer } from "@opencode/plugin/tui/context"
import type { ModelInfo, ModelRef, ProviderInfo } from "@opencode/client"
import { createSuggestionStore } from "./state.ts"
import { createPredictor, type ConversationTurn } from "./predict.ts"
import { createPlaceholderController } from "./ui.tsx"
import { asPromptTextarea } from "./editor.ts"
import { debug } from "./debug.ts"

const DEFAULT_OPTIONS = {
  acceptKey: "right",
  timeoutMs: 20_000,
  includeToolContext: false,
} as const

type Options = {
  acceptKey: string
  timeoutMs: number
  model?: string
  variant?: string
  includeToolContext: boolean
}

const RETRY_DELAY_MS = 800

const THINK_TAG = /<\/?think>[\s\S]*?<\/think>\s*/g

const opencodeNextPrompt = Plugin.define({
  id: "opencode-next-prompt",
  setup(context: Context) {
    const options: Options = { ...DEFAULT_OPTIONS, ...(context.options as Partial<Options> | undefined) }

    const store = createSuggestionStore()
    // The controller gates on the session the prompt is editing; the router
    // always reports the focused session (per-tab footers cannot diverge
    // from it), and predictions commit against the same source.
    const placeholder = createPlaceholderController(context, store, () => currentSessionID(), options.acceptKey)
    let disposed = false

    const currentSessionID = (): string | undefined => {
      const route = context.ui.router.current()
      if (route.type !== "session") return undefined
      return route.sessionID
    }

    const promptInputIsEmpty = (): boolean => {
      const editor = asPromptTextarea(context.renderer.currentFocusedEditor)
      return editor !== null && editor.plainText === ""
    }

    const conversationTurns = (sessionID: string): ConversationTurn[] => {
      const result: ConversationTurn[] = []
      for (const message of context.data.session.message.list(sessionID)) {
        if (message.type === "user") {
          const text = message.text.replace(THINK_TAG, "").trim()
          if (text) result.push({ id: message.id, role: "user", text })
          continue
        }
        if (message.type !== "assistant") continue
        const text = message.content
          .map((part) => {
            if (part.type === "text") return part.text.replace(THINK_TAG, "")
            return options.includeToolContext ? summarizeToolPart(part) : ""
          })
          .join("\n")
          .trim()
        if (text) result.push({ id: message.id, role: "assistant", text })
      }
      return result
    }

    const lastUserMessageID = (sessionID: string): string | undefined => {
      for (const message of context.data.session.message.list(sessionID).toReversed()) {
        if (message.type === "user") return message.id
      }
      return undefined
    }

    let inFlightUserMessageID: string | undefined
    let completedUserMessageID: string | undefined
    let retriedUserMessageID: string | undefined
    let reportedModelIssue: string | undefined

    const predictor = createPredictor(context.client, {
      timeoutMs: options.timeoutMs,
      model: options.model,
    })

    const maybePredict = async (): Promise<void> => {
      if (disposed) return
      const sessionID = currentSessionID()
      if (!sessionID) {
        debug("skip", "no session route")
        return
      }
      const status = context.data.session.status(sessionID)
      if (status !== "idle") {
        debug("skip", { status })
        return
      }
      const userMessageID = lastUserMessageID(sessionID)
      if (!userMessageID) {
        debug("skip", "no user message")
        return
      }
      if (userMessageID === completedUserMessageID || userMessageID === inFlightUserMessageID) {
        debug("skip", "message already handled")
        return
      }
      const session = context.data.session.get(sessionID)
      const modelRef = resolveModelRef(options.model, session?.model, context)
      const modelIssue = checkModelConfig(options.model, modelRef, context)
      if (modelIssue) {
        if (reportedModelIssue !== modelIssue) {
          reportedModelIssue = modelIssue
          debug("prediction skipped", modelIssue)
          context.ui.toast.show({ variant: "error", title: "next-prompt", message: modelIssue, duration: 8000 })
        }
        return
      }
      const turns = conversationTurns(sessionID)
      if (turns.length === 0) {
        debug("skip", "no conversation turns")
        return
      }
      const generation = store.beginPredict(sessionID)
      if (generation === null) {
        debug("skip", "store busy")
        return
      }
      inFlightUserMessageID = userMessageID
      const variant = resolveVariant(options.variant, modelRef)
      try {
        debug("predicting", { model: session?.model, variant })
        const result = await predictor.predict(session?.model, turns, variant)
        if (inFlightUserMessageID !== userMessageID) return
        debug("predict result", { ok: result.ok, length: result.ok ? (result.text?.length ?? 0) : -1 })
        if (result.ok) {
          completedUserMessageID = userMessageID
          store.commit(generation, sessionID, result.text)
        } else {
          store.discard()
          scheduleRetry(userMessageID)
        }
      } catch (error) {
        debug("prediction failed", errorMessage(error))
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

    const accept = (): void => {
      const current = store.read()
      if (current.kind !== "ready") return
      const editor = asPromptTextarea(context.renderer.currentFocusedEditor)
      if (!editor) return
      // Same insertion path the host uses for the `tui.prompt.append` event.
      editor.insertText(current.text)
      setTimeout(() => {
        if (editor.isDestroyed) return
        editor.getLayoutNode().markDirty()
        editor.gotoBufferEnd()
        context.renderer.requestRender()
      }, 0)
    }

    const unsubscribers: Array<() => void> = []
    unsubscribers.push(
      context.data.on("session.status", (event) => {
        if (event.data.sessionID !== currentSessionID()) return
        const type = event.data.status.type
        debug("session.status event", { type })
        if (type === "busy") {
          store.discard()
        } else if (type === "idle") {
          if (store.read().kind === "idle") void maybePredict()
        }
      }),
    )

    // V2 delivery guarantee: feature-plugins subscribe to execution events,
    // while session.status appears not to reach clients at all. Mirrors the
    // V1 busy/idle pair: started ≈ busy (user submitted), ended ≈ idle.
    unsubscribers.push(
      context.data.on("session.execution.started", (event) => {
        if (event.data.sessionID !== currentSessionID()) return
        debug("execution started")
        store.discard()
      }),
    )
    for (const type of ["session.execution.succeeded", "session.execution.interrupted"] as const) {
      unsubscribers.push(
        context.data.on(type, (event) => {
          if (event.data.sessionID !== currentSessionID()) return
          debug(type)
          if (store.read().kind === "idle") void maybePredict()
        }),
      )
    }

    // Diagnostic: what actually streams. Logs status/execution events plus a
    // capped sample of distinct event types.
    const seenEventTypes = new Set<string>()
    unsubscribers.push(
      context.data.listen(({ details }) => {
        const type = details.type
        if (/^session\.(status|execution|idle|error)/.test(type)) {
          debug("event", type)
          return
        }
        if (seenEventTypes.size < 40 && !seenEventTypes.has(type)) {
          seenEventTypes.add(type)
          debug("event(first-seen)", type)
        }
      }),
    )

    unsubscribers.push(context.data.on("tui.session.select", () => invalidate()))

    // V1's message.removed / message.part.removed: history changed under us.
    unsubscribers.push(
      context.data.on("session.revert.committed", (event) => {
        if (event.data.sessionID === currentSessionID()) invalidate()
      }),
    )

    unsubscribers.push(
      context.data.on("session.deleted", (event) => {
        if (event.data.sessionID === currentSessionID()) invalidate()
      }),
    )

    // The accept command itself; registered from the app slot render below
    // (keymap layers need a live solid owner — see the slot comment).
    const acceptLayer = (): KeymapLayer => ({
      priority: 1000,
      commands: [
        {
          id: "opencode-next-prompt.accept",
          title: "Accept next-prompt suggestion",
          group: "next-prompt",
          enabled: () => store.read().kind === "ready",
          bind: options.acceptKey,
          run: () => {
            debug("accept key", { kind: store.read().kind, empty: promptInputIsEmpty() })
            if (promptInputIsEmpty()) accept()
            // Keep the default key behavior (cursor movement), like V1's fallthrough.
            return false
          },
        },
      ],
    })

    placeholder.start()

    // `context.keymap.layer` resolves through useContext, so it needs an
    // active solid owner under the host's Keymap.Provider. Plugin setup runs
    // outside the component tree (an async reconciliation, owner already
    // dropped), where it would throw "Keymap.Provider is missing" — a slot
    // render runs as a component inside the tree instead. The `app` slot is
    // the mount the built-in /btw plugin uses for its layers: always mounted,
    // exactly one instance, alive for the whole TUI session — so per-tab
    // prompt footers can never duplicate the command registration, and
    // plugin deactivation (disposeSlot → unmount) releases it via the
    // component's own cleanup.
    const disposeSlot = context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(acceptLayer)
        debug("keymap layer registered")
        return null
      },
    })

    return () => {
      disposed = true
      for (const off of unsubscribers) off()
      placeholder.dispose()
      disposeSlot()
      store.discard()
      void predictor.dispose()
    }
  },
})

type ResolvedModelRef = {
  providerID: string
  id: string
  model?: ModelInfo
}

function resolveModelRef(
  spec: string | undefined,
  sessionModel: ModelRef | undefined,
  context: Context,
): ResolvedModelRef | undefined {
  const slash = spec?.indexOf("/") ?? -1
  if (spec && slash > 0 && slash < spec.length - 1) {
    const providerID = spec.slice(0, slash)
    const modelID = spec.slice(slash + 1)
    return { providerID, id: modelID, model: findModel(context, providerID, modelID) }
  }
  const providerID = sessionModel?.providerID
  const modelID = spec ?? sessionModel?.id
  if (!providerID || !modelID) return undefined
  return { providerID, id: modelID, model: findModel(context, providerID, modelID) }
}

function findModel(context: Context, providerID: string, modelID: string): ModelInfo | undefined {
  return context.data.location.model.list()?.find((item) => item.providerID === providerID && item.modelID === modelID)
}

function checkModelConfig(spec: string | undefined, ref: ResolvedModelRef | undefined, context: Context): string | undefined {
  if (!spec || !ref) return undefined
  const providers: ProviderInfo[] | undefined = context.data.location.provider.list()
  if (providers && !providers.some((item) => item.id === ref.providerID)) {
    const available = providers.map((item) => item.id).join(", ")
    return `model config error: provider "${ref.providerID}" not found${available ? ` (available providers: ${available})` : ""}`
  }
  const models = context.data.location.model.list()
  if (models && !models.some((item) => item.providerID === ref.providerID && item.modelID === ref.id)) {
    const available = models
      .filter((item) => item.providerID === ref.providerID)
      .map((item) => item.modelID)
      .slice(0, 10)
      .join(", ")
    const count = models.filter((item) => item.providerID === ref.providerID).length
    return `model config error: model "${ref.id}" not found on provider "${ref.providerID}"${
      available ? ` (available models: ${available}${count > 10 ? ", ..." : ""})` : ""
    }`
  }
  return undefined
}

const VARIANT_ORDER = ["none", "low", "min", "medium", "high", "xhigh", "max"]

function resolveVariant(configVariant: string | undefined, ref: ResolvedModelRef | undefined): string | undefined {
  if (configVariant === "default") return undefined
  if (configVariant) return configVariant
  const variants = ref?.model?.variants
  if (!variants || variants.length === 0) return undefined
  const names = variants.map((item) => item.id)
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

function summarizeToolPart(part: { type: string }): string {
  const tool = part as {
    type: string
    name?: string
    state?: { status?: string; input?: unknown; metadata?: { output?: string } }
  }
  if (tool.type !== "tool" || !tool.state || tool.state.status === "running" || tool.state.status === "streaming")
    return ""
  const input = JSON.stringify(tool.state.input ?? {})
  const output = tool.state.metadata?.output ?? ""
  const inputText = input.length > 80 ? input.slice(0, 79) + "…" : input
  const outputText = output.length > TOOL_SUMMARY_CHARS ? output.slice(0, TOOL_SUMMARY_CHARS - 1) + "…" : output
  return `[tool:${tool.name ?? "?"}] ${inputText} → ${outputText || tool.state.status || ""}`
}

export default opencodeNextPrompt
