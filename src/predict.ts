import type { OpencodeClient, Part } from "@opencode-ai/sdk/v2"

export type ConversationTurn = { id: string; role: "user" | "assistant"; text: string }

export type PredictOptions = {
  timeoutMs: number
  model?: string
  disableTools?: boolean
}

export type PredictResult = { ok: true; text: string | null } | { ok: false }

const TITLE = "next-prompt-suggestion"

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

const DENY_ALL_TOOLS: { permission: string; pattern: string; action: "deny" }[] = [
  { permission: "*", pattern: "*", action: "deny" },
]

export type Predictor = {
  predict(
    model: { providerID: string; id: string } | undefined,
    turns: ConversationTurn[],
    variant?: string,
  ): Promise<PredictResult>
  dispose(): Promise<void>
}

export function createPredictor(
  client: OpencodeClient,
  directory: string | undefined,
  options: PredictOptions,
): Predictor {
  let sessionID: string | undefined

  const deleteSession = async (): Promise<void> => {
    if (sessionID) {
      const current = sessionID
      sessionID = undefined
      await client.session.abort({ sessionID: current, directory }).catch(() => {})
      await client.session.delete({ sessionID: current, directory }).catch(() => {})
    }
  }

  return {
    async predict(model, turns, variant) {
      if (turns.length === 0) return { ok: true, text: null }
      const input = PROMPT + renderConversation(turns)
      const ref = resolveModel(options.model, model)
      const created = await client.session.create({
        directory,
        title: TITLE,
        model: ref ? { id: ref.id, providerID: ref.providerID, ...(variant ? { variant } : {}) } : undefined,
        permission: options.disableTools === false ? undefined : DENY_ALL_TOOLS,
      })
      if (created.error) throw created.error
      sessionID = created.data.id
      const currentSessionID = sessionID
      let text: string | null
      try {
        const result = await withTimeout(
          client.session.prompt({ sessionID, directory, parts: [{ type: "text", text: input }] }),
          options.timeoutMs,
          () => void client.session.abort({ sessionID: currentSessionID, directory }).catch(() => {}),
        )
        if (result.error) throw result.error
        text = parsePrediction(result.data.parts)
      } catch (error) {
        await deleteSession()
        throw error
      }
      await deleteSession()
      return { ok: true, text }
    },

    async dispose() {
      await deleteSession()
    },
  }
}

function resolveModel(
  spec: string | undefined,
  sessionModel: { providerID: string; id: string } | undefined,
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

function parsePrediction(parts: Part[]): string | null {
  const line = parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
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

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout()
      reject(new Error(`prediction timed out after ${ms}ms`))
    }, ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
