import type { OpenCodeClient } from "@opencode/client"
import { debug } from "./debug.ts"
import { parsePrediction } from "./conversation.ts"
import { errorMessage } from "./errors.ts"

export type PredictOptions = {
  timeoutMs: number
}

export type PredictResult = { ok: true; text: string | null } | { ok: false }

const TITLE = "next-prompt-suggestion"
const DENY_ALL_TOOLS = [{ action: "*", resource: "*", effect: "deny" as const }]
const CLEANUP_TIMEOUT_MS = 5_000

export type Predictor = {
  predict(
    sessionID: string,
    model: { providerID: string; id: string } | undefined,
    prompt: string,
    variant?: string,
  ): Promise<PredictResult>
  dispose(): Promise<void>
}

/**
 * Prediction runs in a lightweight, tool-denied child helper session:
 * - `parentID` inherits the active session's exact `Location`, so project-scoped
 *   providers and models resolve (including workspaces).
 * - `permissions` deny every tool, stripping MCP tools, skills, and their
 *   instructions from the request context.
 * - `session.generate` writes no messages and emits no execution events.
 *
 * The helper is removed in the background. When the helper path fails (an older
 * host, a transient create error), predictions fall back to `session.generate`
 * on the active session and finally to the global `generate.text`; the timeout
 * budget is shared across attempts.
 */
export function createPredictor(client: OpenCodeClient, options: PredictOptions): Predictor {
  let activeHelperCleanup: (() => Promise<void>) | undefined
  let activeAbort: AbortController | undefined
  let runID = 0

  const removeHelperSession = async (id: string): Promise<void> => {
    if (typeof client.session?.remove !== "function") return
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), CLEANUP_TIMEOUT_MS)
    try {
      await client.session.remove({ sessionID: id }, { signal: controller.signal })
    } catch (error) {
      debug("helper session cleanup failed", { sessionID: id, error: errorMessage(error) })
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    async predict(sessionID, model, prompt, variant) {
      const run = ++runID
      const spec = model ? { providerID: model.providerID, id: model.id, ...(variant ? { variant } : {}) } : undefined
      const deadline = Date.now() + options.timeoutMs

      const stale = (): boolean => run !== runID

      /**
       * Race the client call against a real deadline. Aborting the signal is
       * best effort (a transport may ignore it); the race guarantees the UI
       * is never stuck in "predicting" when only the abort is ignored.
       */
      const runWithTimeout = async (
        call: (signal: AbortSignal) => Promise<{ text: string }>,
      ): Promise<PredictResult> => {
        const remaining = deadline - Date.now()
        if (remaining <= 0) return { ok: false }
        const controller = new AbortController()
        activeAbort = controller
        let timer: ReturnType<typeof setTimeout> | undefined
        const timeout = new Promise<PredictResult>((resolve) => {
          timer = setTimeout(() => {
            controller.abort()
            debug("prediction timed out", { remaining })
            resolve({ ok: false })
          }, remaining)
        })
        try {
          return await Promise.race([
            call(controller.signal).then((result) => ({ ok: true as const, text: parsePrediction(result.text) })),
            timeout,
          ])
        } finally {
          if (timer !== undefined) clearTimeout(timer)
          if (activeAbort === controller) activeAbort = undefined
        }
      }

      const hasSessionCreate = typeof client.session?.create === "function"
      const hasSessionGenerate = typeof client.session?.generate === "function"
      const hasGenerateText = typeof client.generate?.text === "function"

      if (hasSessionCreate && hasSessionGenerate) {
        let cleanup: (() => void) | undefined
        try {
          const result = await runWithTimeout(async (signal) => {
            const created = await client.session.create(
              {
                parentID: sessionID,
                title: TITLE,
                ...(spec ? { model: spec } : {}),
                permissions: DENY_ALL_TOOLS,
              },
              { signal },
            )
            let cleaned: Promise<void> | undefined
            const close = () => {
              if (!cleaned) cleaned = removeHelperSession(created.id)
              return cleaned
            }
            cleanup = () => {
              void close()
            }
            activeHelperCleanup = close
            if (signal.aborted) {
              void close()
              throw new Error("prediction aborted before generate")
            }
            return client.session.generate({ sessionID: created.id, prompt }, { signal })
          })
          if (stale()) return { ok: false }
          return result
        } catch (error) {
          debug("helper session failed", errorMessage(error))
          if (stale()) return { ok: false }
        } finally {
          cleanup?.()
        }
      }

      if (hasSessionGenerate) {
        try {
          const result = await runWithTimeout((signal) => client.session.generate({ sessionID, prompt }, { signal }))
          if (stale()) return { ok: false }
          return result
        } catch (error) {
          debug("session.generate failed", errorMessage(error))
          if (stale()) return { ok: false }
        }
      }

      if (hasGenerateText) {
        try {
          const result = await runWithTimeout((signal) =>
            client.generate.text({ prompt, ...(spec ? { model: spec } : {}) }, { signal }),
          )
          if (stale()) return { ok: false }
          return result
        } catch (error) {
          debug("generate.text failed", errorMessage(error))
          if (stale()) return { ok: false }
        }
      }

      debug("no generation endpoint available on client")
      return { ok: false }
    },

    async dispose() {
      runID += 1
      activeAbort?.abort()
      activeAbort = undefined
      const cleanup = activeHelperCleanup
      activeHelperCleanup = undefined
      if (cleanup) await cleanup()
    },
  }
}
