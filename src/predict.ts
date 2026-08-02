import type { OpencodeClient, Part } from "@opencode-ai/sdk/v2"

export type ConversationTurn = { id: string; role: "user" | "assistant"; text: string }

export type PredictOptions = {
  timeoutMs: number
}

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

export type Predictor = {
  predict(
    model: { providerID: string; id: string } | undefined,
    turns: ConversationTurn[],
  ): Promise<string | null>
  dispose(): Promise<void>
}

export function createPredictor(
  client: OpencodeClient,
  directory: string | undefined,
  options: PredictOptions,
): Predictor {
  let sessionID: string | undefined
  let predictedTurns = 0
  let predictedLastMessageID: string | undefined
  let accumulatedChars = 0

  const deleteSession = async (): Promise<void> => {
    if (sessionID) {
      await client.session.delete({ sessionID, directory }).catch(() => {})
      sessionID = undefined
      predictedTurns = 0
      predictedLastMessageID = undefined
      accumulatedChars = 0
    }
  }

  return {
    async predict(model, turns) {
      const expectedID = turns[predictedTurns - 1]?.id
      if (predictedLastMessageID && expectedID && expectedID !== predictedLastMessageID) {
        await deleteSession()
      }
      let delta = turns.slice(predictedTurns)
      if (delta.length === 0) return null

      let input = PROMPT + renderConversation(delta)
      if (sessionID && accumulatedChars + input.length > MAX_ACCUMULATED_CHARS) {
        await deleteSession()
        delta = turns
        input = PROMPT + renderConversation(delta)
      }

      if (!sessionID) {
        const created = await client.session.create({ directory, title: TITLE, model })
        if (created.error) throw created.error
        sessionID = created.data.id
      }

      const result = await withTimeout(
        client.session.prompt({ sessionID, directory, parts: [{ type: "text", text: input }] }),
        options.timeoutMs,
      )
      if (result.error) throw result.error
      predictedTurns = turns.length
      predictedLastMessageID = turns.at(-1)?.id
      accumulatedChars += input.length
      return parsePrediction(result.data.parts)
    },

    async dispose() {
      await deleteSession()
    },
  }
}

const MAX_ASSISTANT_MESSAGES = 10
const MAX_ACCUMULATED_CHARS = 80_000

function renderConversation(turns: ConversationTurn[]): string {
  const assistantCount = turns.reduce((count, turn) => count + (turn.role === "assistant" ? 1 : 0), 0)
  const skip = Math.max(0, assistantCount - MAX_ASSISTANT_MESSAGES)
  let skipped = 0
  return turns
    .filter((turn) => {
      if (turn.role !== "assistant" || skipped >= skip) return true
      skipped += 1
      return false
    })
    .map((turn) => `${turn.role}: ${turn.text}`)
    .join("\n")
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

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`prediction timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
