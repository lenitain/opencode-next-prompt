import type { ModelRef, OpenCodeClient } from "@opencode/client"
import { debug } from "./debug.ts"

export type ConversationTurn = { id: string; role: "user" | "assistant"; text: string }

export type PredictOptions = {
  timeoutMs: number
  model?: string
}

export type PredictResult = { ok: true; text: string | null } | { ok: false }

const PROMPT = `You are the user in a conversation with an AI coding assistant. The
assistant just finished replying to your latest message.

Write your next message — your natural reaction to what you just read.
Address the assistant directly: a request, a question, or an instruction
(the assistant acts; you never describe doing things yourself). React to
what was said, not to how it was said. One line, natural and brief, in
your language and tone.

If nothing plausible remains to say, reply with exactly: NO_SUGGESTION

Conversation (oldest first):
`

const MAX_PREDICTION_CHARS = 170
const MAX_TURNS = 8
const MAX_TURN_CHARS = 800

export type Predictor = {
  predict(model: ModelRef | undefined, turns: ConversationTurn[], variant?: string): Promise<PredictResult>
  dispose(): Promise<void>
}

/**
 * Prediction runs through the tool-free `generate.text` endpoint: no session
 * is created, so there is nothing to abort or clean up beyond the request
 * itself, which is cancelled by an AbortSignal on timeout.
 *
 * Model fallback: some gates — notably OpenCode's free tier — reject
 * explicitly selected models on this endpoint (503) while letting the server
 * default through, so a failed call with a specified model is retried once
 * without a model instead of failing the whole prediction. Both attempts
 * share one timeout budget.
 */
export function createPredictor(client: OpenCodeClient, options: PredictOptions): Predictor {
  return {
    async predict(model, turns, variant) {
      if (turns.length === 0) return { ok: true, text: null }
      const prompt = PROMPT + renderConversation(turns)
      const ref = resolveModel(options.model, model)
      const deadline = Date.now() + options.timeoutMs

      const attempt = async (spec: { providerID: string; id: string; variant?: string } | undefined): Promise<PredictResult> => {
        const remaining = deadline - Date.now()
        if (remaining <= 0) return { ok: false }
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), remaining)
        try {
          const result = await client.generate.text({ prompt, model: spec }, { signal: controller.signal })
          return { ok: true, text: parsePrediction(result.text) }
        } finally {
          clearTimeout(timer)
        }
      }

      const spec = ref ? { providerID: ref.providerID, id: ref.id, ...(variant ? { variant } : {}) } : undefined
      try {
        return await attempt(spec)
      } catch (error) {
        if (!spec) {
          debug("generate failed", errorMessage(error))
          return { ok: false }
        }
        debug("generate with explicit model failed, retrying with server default", errorMessage(error))
      }
      try {
        return await attempt(undefined)
      } catch (error) {
        debug("generate failed", errorMessage(error))
        return { ok: false }
      }
    },

    async dispose() {
      // Nothing to clean up: predictions do not own a session.
    },
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (error && typeof error === "object") {
    const candidate = (error as { message?: unknown }).message
    if (typeof candidate === "string") return candidate
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }
  return String(error)
}

function resolveModel(
  spec: string | undefined,
  sessionModel: ModelRef | undefined,
): { providerID: string; id: string } | undefined {
  if (!spec) return sessionModel
  const slash = spec.indexOf("/")
  if (slash > 0 && slash < spec.length - 1) {
    return { providerID: spec.slice(0, slash), id: spec.slice(slash + 1) }
  }
  return sessionModel ? { providerID: sessionModel.providerID, id: spec } : undefined
}

function renderConversation(turns: ConversationTurn[]): string {
  if (turns.length === 0) return ""
  const recent = turns.slice(-MAX_TURNS)
  const lines = recent.map((turn) => `${turn.role}: ${truncate(turn.text, MAX_TURN_CHARS)}`)
  const first = turns[0]
  if (turns.length > MAX_TURNS && first?.role === "user" && first.id !== recent[0]?.id) {
    lines.unshift(`user: [original goal] ${truncate(first.text, MAX_TURN_CHARS)}`)
  }
  return lines.join("\n")
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text
}

function parsePrediction(raw: string): string | null {
  const line = raw
    .replace(/<\/?think>[\s\S]*?<\/think>\s*/g, "")
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.length > 0)
  if (!line) return null
  const text = line.replace(/^["'`]+|["'`]+$/g, "")
  if (!text) return null
  const tag = text.toUpperCase().replace(/[\s-]+/g, "_").replace(/[^A-Z_]/g, "")
  if (tag === "NO_SUGGESTION") return null
  return text.length > MAX_PREDICTION_CHARS ? text.slice(0, MAX_PREDICTION_CHARS - 3) + "..." : text
}
