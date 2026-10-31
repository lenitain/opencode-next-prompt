import type { OpenCodeClient } from "@opencode/client"
import { debug } from "./debug.ts"
import { parsePrediction } from "./conversation.ts"
import { errorMessage } from "./errors.ts"

export type PredictOptions = {
  timeoutMs: number
}

export type PredictResult = { ok: true; text: string | null } | { ok: false }

export type PredictRequest = {
  sessionID: string
  prompt: string
  /** Agent that supplies the prediction persona, when one is configured. */
  agent?: string
  model?: { providerID: string; id: string; variant?: string }
}

export type Predictor = {
  predict(request: PredictRequest): Promise<PredictResult>
  dispose(): Promise<void>
}

const TITLE = "next-prompt-suggestion"
const DENY_ALL_TOOLS = [{ action: "*", resource: "*", effect: "deny" as const }]
const CLEANUP_TIMEOUT_MS = 5_000

/**
 * One prediction is one call, in a disposable helper session:
 *
 * - `parentID` inherits the active session's exact location, so project-scoped
 *   providers and models resolve; the explicit model is passed for the
 *   configured override.
 * - `permissions` deny every tool, stripping MCP tools, skills, and their
 *   instructions from the request context.
 * - `session.generate` writes no messages, emits no execution events, and does
 *   not touch the main conversation.
 * - A configured `next-prompt` agent supplies the prediction persona instead of
 *   the coding agent's inherited prompt.
 *
 * The helper is removed after the call, including when the request times out
 * and the create resolves late. There is no second attempt: a suggestion that
 * misses the decision point is worthless.
 */
export function createPredictor(client: OpenCodeClient, options: PredictOptions): Predictor {
  let activeAbort: AbortController | undefined
  let runID = 0

  const removeHelper = async (sessionID: string): Promise<void> => {
    try {
      await client.session.remove({ sessionID }, { signal: AbortSignal.timeout(CLEANUP_TIMEOUT_MS) })
    } catch (error) {
      debug("helper cleanup failed", { sessionID, error: errorMessage(error) })
    }
  }

  return {
    async predict({ sessionID, prompt, agent, model }) {
      const run = ++runID
      const controller = new AbortController()
      activeAbort = controller
      let helperID: string | undefined
      let helperRemoved = false
      let timer: ReturnType<typeof setTimeout> | undefined

      const cleanupHelper = (id: string): void => {
        if (helperRemoved) return
        helperRemoved = true
        void removeHelper(id)
      }

      type Outcome = { kind: "text"; text: string } | { kind: "timeout"; result: PredictResult }

      const timeout = new Promise<Outcome>((resolve) => {
        timer = setTimeout(() => {
          controller.abort()
          debug("prediction timed out")
          resolve({ kind: "timeout", result: { ok: false } })
        }, options.timeoutMs)
      })

      const generate = (async () => {
        const created = await client.session.create(
          {
            parentID: sessionID,
            title: TITLE,
            ...(agent ? { agent } : {}),
            ...(model ? { model } : {}),
            permissions: DENY_ALL_TOOLS,
          },
          { signal: controller.signal },
        )
        helperID = created.id
        if (controller.signal.aborted) {
          cleanupHelper(created.id)
          throw new Error("prediction aborted before generate")
        }
        return client.session.generate({ sessionID: created.id, prompt }, { signal: controller.signal })
      })().then((result): Outcome => ({ kind: "text", text: result.text }))

      try {
        const outcome = await Promise.race<Outcome>([generate, timeout])
        if (outcome.kind === "timeout") return outcome.result
        if (run !== runID) return { ok: false }
        return { ok: true, text: parsePrediction(outcome.text) }
      } catch (error) {
        if (run !== runID) return { ok: false }
        debug("prediction failed", errorMessage(error))
        return { ok: false }
      } finally {
        if (timer !== undefined) clearTimeout(timer)
        if (activeAbort === controller) activeAbort = undefined
        if (helperID) cleanupHelper(helperID)
      }
    },

    async dispose() {
      runID += 1
      activeAbort?.abort()
      activeAbort = undefined
    },
  }
}
