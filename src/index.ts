import { Plugin } from "@opencode/plugin/tui"
import type { Context, KeymapLayer } from "@opencode/plugin/tui/context"
import type { Renderable } from "@opentui/core"
import { createSuggestionStore } from "./state.ts"
import { createPredictor } from "./predict.ts"
import { createPlaceholderController, isShellMode } from "./ui.ts"
import { asPromptTextarea } from "./editor.ts"
import { normalizeOptions } from "./options.ts"
import { resolvePredictionModel } from "./model.ts"
import { buildPrompt, collectConversation, lastTurnKey } from "./conversation.ts"
import { debug } from "./debug.ts"
import { errorMessage } from "./errors.ts"

const RETRY_DELAY_MS = 800
const MIN_HOST_VERSION: readonly [number, number, number] = [2, 0, 22]

type IdleEventType =
  | "session.execution.succeeded"
  | "session.execution.interrupted"
  | "session.execution.failed"
  | "session.compaction.ended"
  | "session.idle"

const opencodeNextPrompt = Plugin.define({
  id: "opencode-next-prompt",
  setup(context: Context) {
    const { options, warnings } = normalizeOptions(context.options)
    for (const warning of warnings) {
      context.ui.toast.show({ variant: "warning", title: "next-prompt", message: warning, duration: 10_000 })
    }
    if (!versionAtLeast(context.app.version, MIN_HOST_VERSION)) {
      context.ui.toast.show({
        variant: "warning",
        title: "next-prompt",
        message: `OpenCode ${context.app.version} is older than 2.0.22; predictions will use a compatibility fallback. Upgrade OpenCode for project-scoped models.`,
        duration: 12_000,
      })
    }

    const store = createSuggestionStore()
    let disposed = false
    let activeSessionID: string | undefined = currentSessionID()
    let inFlightTurnKey: string | undefined
    let completedTurnKey: string | undefined
    let retriedTurnKey: string | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let reportedModelIssue: string | undefined
    let reportedModelWarning: string | undefined

    const placeholder = createPlaceholderController(context, store, () => currentSessionID(), options.acceptKey)
    const predictor = createPredictor(context.client, { timeoutMs: options.timeoutMs })

    function currentSessionID(): string | undefined {
      const route = context.ui.router.current()
      if (route.type !== "session") return undefined
      if (context.ui.tabs.enabled()) {
        const active = context.ui.tabs.list().find((tab) => tab.active)
        if (active) return active.sessionID
      }
      return route.sessionID
    }

    function focusedPrompt() {
      return asPromptTextarea(context.renderer.currentFocusedEditor)
    }

    function promptInputIsEmpty(): boolean {
      const editor = focusedPrompt()
      return editor !== null && editor.plainText === "" && !isShellMode(context, editor)
    }

    function requestPrediction(): void {
      if (disposed) return
      clearRetry()
      void maybePredict().catch((error) => debug("prediction crashed", errorMessage(error)))
    }

    function syncActiveSession(): string | undefined {
      const current = currentSessionID()
      if (current !== activeSessionID) {
        activeSessionID = current
        resetIssues()
        invalidate()
      }
      return current
    }

    function resetIssues(): void {
      reportedModelIssue = undefined
      reportedModelWarning = undefined
    }

    function showModelNotice(message: string, variant: "error" | "warning"): void {
      const previous = variant === "error" ? reportedModelIssue : reportedModelWarning
      if (previous === message) return
      if (variant === "error") reportedModelIssue = message
      else reportedModelWarning = message
      context.ui.toast.show({ variant, title: "next-prompt", message, duration: 8_000 })
    }

    function clearRetry(): void {
      if (retryTimer !== undefined) {
        clearTimeout(retryTimer)
        retryTimer = undefined
      }
    }

    function scheduleRetry(turnKey: string): void {
      if (disposed || retriedTurnKey === turnKey) return
      retriedTurnKey = turnKey
      clearRetry()
      retryTimer = setTimeout(() => {
        retryTimer = undefined
        if (!disposed) requestPrediction()
      }, RETRY_DELAY_MS)
    }

    function invalidate(): void {
      clearRetry()
      store.discard()
      inFlightTurnKey = undefined
      completedTurnKey = undefined
      retriedTurnKey = undefined
      void predictor.dispose()
    }

    async function maybePredict(): Promise<void> {
      if (disposed) return
      const sessionID = syncActiveSession()
      if (!sessionID) {
        debug("skip", "no session route")
        return
      }
      const status = context.data.session.status(sessionID)
      if (status !== "idle") {
        debug("skip", { status })
        return
      }

      const messages = context.data.session.message.list(sessionID)
      const turnKey = lastTurnKey(messages)
      if (!turnKey) {
        debug("skip", "no user message")
        return
      }
      if (turnKey === completedTurnKey || turnKey === inFlightTurnKey) {
        debug("skip", "turn already handled")
        return
      }

      const session = context.data.session.get(sessionID)
      const location = session?.location ?? context.location
      const resolution = resolvePredictionModel({
        spec: options.model,
        variant: options.variant,
        sessionModel: session?.model,
        context,
        location,
      })
      if (resolution.issue) {
        showModelNotice(resolution.issue, "error")
        return
      }
      reportedModelIssue = undefined
      if (resolution.warning) showModelNotice(resolution.warning, "warning")
      else reportedModelWarning = undefined

      const conversation = collectConversation(messages, options.includeToolContext)
      if (conversation.turns.length === 0) {
        debug("skip", "no conversation turns")
        return
      }

      const generation = store.beginPredict(sessionID)
      if (generation === null) {
        debug("skip", "store busy")
        return
      }
      inFlightTurnKey = turnKey
      const model = resolution.model
      const selectedModel = model ? { providerID: model.providerID, id: model.id } : undefined
      try {
        debug("predicting", {
          sessionID,
          model: selectedModel,
          variant: model?.variant,
          source: model?.source,
        })
        const result = await predictor.predict(sessionID, selectedModel, buildPrompt(conversation), model?.variant)
        if (inFlightTurnKey !== turnKey) return
        debug("predict result", { ok: result.ok, length: result.ok ? (result.text?.length ?? 0) : -1 })
        if (result.ok) {
          completedTurnKey = turnKey
          store.commit(generation, sessionID, result.text)
        } else {
          store.discard()
          scheduleRetry(turnKey)
        }
      } catch (error) {
        debug("prediction failed", errorMessage(error))
        if (inFlightTurnKey !== turnKey) return
        store.discard()
        scheduleRetry(turnKey)
      } finally {
        if (inFlightTurnKey === turnKey) inFlightTurnKey = undefined
      }
    }

    function accept(): void {
      const current = store.read()
      if (current.kind !== "ready" || current.sessionID !== currentSessionID()) return
      const editor = focusedPrompt()
      if (!editor) return
      // Same insertion path the host uses for the `tui.prompt.append` event.
      editor.insertText(current.text)
      setTimeout(() => {
        if (disposed || editor.isDestroyed) return
        // OpenTUI 0.6+ removed getLayoutNode() in favor of invalidateIntrinsicSize();
        // fall back to getLayoutNode().markDirty() for OpenCode 2.0.x (OpenTUI 0.5).
        if (typeof editor.invalidateIntrinsicSize === "function") {
          editor.invalidateIntrinsicSize()
        } else {
          editor.getLayoutNode?.().markDirty()
        }
        editor.gotoBufferEnd()
        context.renderer.requestRender()
      }, 0)
    }

    // The accept command itself; registered from the app slot render below
    // (keymap layers need a live solid owner — see the slot comment).
    const acceptLayer = (): KeymapLayer => ({
      priority: 1000,
      // Keep the binding inside the prompt textarea: a ready suggestion must
      // never intercept the right arrow in dialogs, editors, or shell mode.
      target: () => {
        const editor = focusedPrompt()
        if (!editor || isShellMode(context, editor)) return null
        return editor as unknown as Renderable
      },
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

    const unsubscribers: Array<() => void> = []

    const watchIdle = (type: IdleEventType): void => {
      unsubscribers.push(
        context.data.on(type, (event) => {
          // OpenCode 2.0.x's `session.idle` event carries no session id; it is
          // safe to treat it as the focused session. Newer hosts include it.
          const eventSessionID = (event as { data?: { sessionID?: string } }).data?.sessionID
          const current = syncActiveSession()
          if (eventSessionID !== undefined && eventSessionID !== current) return
          if (!current) return
          debug(type)
          if (store.read().kind === "idle") requestPrediction()
        }),
      )
    }

    unsubscribers.push(
      context.data.on("session.status", (event) => {
        if (event.data.sessionID !== syncActiveSession()) return
        const type = event.data.status.type
        debug("session.status event", { type })
        if (type === "busy") invalidate()
        else if (type === "idle" && store.read().kind === "idle") requestPrediction()
      }),
    )

    unsubscribers.push(
      context.data.on("session.execution.started", (event) => {
        if (event.data.sessionID !== syncActiveSession()) return
        debug("execution started")
        // A new turn (or a regenerated reply) invalidates both the suggestion
        // and the in-flight prediction, so a late result cannot win.
        invalidate()
      }),
    )
    for (const type of [
      "session.execution.succeeded",
      "session.execution.interrupted",
      "session.execution.failed",
      "session.compaction.ended",
    ] as const) {
      watchIdle(type)
    }
    watchIdle("session.idle")

    for (const type of ["session.revert.staged", "session.revert.committed"] as const) {
      unsubscribers.push(
        context.data.on(type, (event) => {
          if (event.data.sessionID === syncActiveSession()) invalidate()
        }),
      )
    }

    unsubscribers.push(
      context.data.on("session.revert.cleared", (event) => {
        if (event.data.sessionID !== syncActiveSession()) return
        if (store.read().kind === "idle") requestPrediction()
      }),
    )

    unsubscribers.push(
      context.data.on("session.compaction.started", (event) => {
        if (event.data.sessionID === syncActiveSession()) invalidate()
      }),
    )

    unsubscribers.push(
      context.data.on("session.deleted", (event) => {
        if (event.data.sessionID === currentSessionID() || event.data.sessionID === activeSessionID) invalidate()
      }),
    )

    unsubscribers.push(
      context.data.on("tui.session.select", () => {
        activeSessionID = currentSessionID()
        resetIssues()
        invalidate()
      }),
    )

    return () => {
      disposed = true
      clearRetry()
      for (const off of unsubscribers) off()
      placeholder.dispose()
      disposeSlot()
      store.discard()
      void predictor.dispose()
    }
  },
})

function versionAtLeast(version: string, minimum: readonly [number, number, number]): boolean {
  const match = version.match(/(\d+)\.(\d+)\.(\d+)/)
  if (!match) return true
  const current = [Number(match[1]), Number(match[2]), Number(match[3])]
  for (let index = 0; index < minimum.length; index += 1) {
    const left = current[index] ?? 0
    const right = minimum[index] ?? 0
    if (left !== right) return left > right
  }
  return true
}

export default opencodeNextPrompt
