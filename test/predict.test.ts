import { test, expect } from "bun:test"
import type { OpenCodeClient } from "@opencode/client"
import { createPredictor } from "../src/predict.ts"

;(globalThis as { NEXT_PROMPT_DEBUG?: boolean }).NEXT_PROMPT_DEBUG = false

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out")
    await sleep(5)
  }
}

function makeClient(options: { hang?: boolean } = {}) {
  const removed: string[] = []
  const created = { count: 0 }
  const client = {
    session: {
      create: async () => {
        created.count += 1
        return { id: `ses_helper_${created.count}` }
      },
      generate: options.hang ? () => new Promise<{ text: string }>(() => {}) : async () => ({ text: "ok" }),
      remove: async (input: { sessionID: string }) => {
        removed.push(input.sessionID)
      },
    },
  } as unknown as OpenCodeClient
  return { client, removed, created }
}

test("a hanging generate resolves after the timeout and still removes the helper", async () => {
  const { client, removed } = makeClient({ hang: true })
  const predictor = createPredictor(client, { timeoutMs: 20 })

  const result = await predictor.predict("ses_main", undefined, "prompt")
  expect(result.ok).toBe(false)
  await waitFor(() => removed.length === 1)
  expect(removed[0]).toBe("ses_helper_1")
})

test("dispose aborts an in-flight prediction and removes the helper", async () => {
  const { client, removed, created } = makeClient({ hang: true })
  const predictor = createPredictor(client, { timeoutMs: 50 })

  const pending = predictor.predict("ses_main", undefined, "prompt")
  await waitFor(() => created.count === 1)
  await predictor.dispose()
  const result = await pending

  expect(result.ok).toBe(false)
  await waitFor(() => removed.length === 1)
  expect(removed).toEqual(["ses_helper_1"])
})
