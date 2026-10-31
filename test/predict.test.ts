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

function makeClient(options: { hang?: boolean; fail?: boolean } = {}) {
  const removed: string[] = []
  const created: any[] = []
  const generated: any[] = []
  const client = {
    session: {
      create: async (input: any) => {
        created.push(input)
        return { id: `ses_helper_${created.length}` }
      },
      generate: options.hang
        ? () => new Promise<{ text: string }>(() => {})
        : async (input: any) => {
            if (options.fail) throw new Error("boom")
            generated.push(input)
            return { text: "ok" }
          },
      remove: async (input: { sessionID: string }) => {
        removed.push(input.sessionID)
      },
    },
  } as unknown as OpenCodeClient
  return { client, removed, created, generated }
}

test("a prediction runs once in a deny-all helper session and is cleaned up", async () => {
  const { client, removed, created, generated } = makeClient()
  const predictor = createPredictor(client, { timeoutMs: 1_000 })

  const result = await predictor.predict({
    sessionID: "ses_main",
    prompt: "prompt",
    model: { providerID: "acme", id: "fast", variant: "low" },
  })

  expect(result).toEqual({ ok: true, text: "ok" })
  expect(created[0]).toEqual({
    parentID: "ses_main",
    title: "next-prompt-suggestion",
    model: { providerID: "acme", id: "fast", variant: "low" },
    permissions: [{ action: "*", resource: "*", effect: "deny" }],
  })
  expect(generated[0]).toEqual({ sessionID: "ses_helper_1", prompt: "prompt" })
  await waitFor(() => removed.length === 1)
  expect(removed[0]).toBe("ses_helper_1")
})

test("a hanging generate resolves after the timeout and still removes the helper", async () => {
  const { client, removed } = makeClient({ hang: true })
  const predictor = createPredictor(client, { timeoutMs: 20 })

  const result = await predictor.predict({ sessionID: "ses_main", prompt: "prompt" })
  expect(result.ok).toBe(false)
  await waitFor(() => removed.length === 1)
  expect(removed[0]).toBe("ses_helper_1")
})

test("dispose aborts an in-flight prediction and removes the helper", async () => {
  const { client, removed, created } = makeClient({ hang: true })
  const predictor = createPredictor(client, { timeoutMs: 50 })

  const pending = predictor.predict({ sessionID: "ses_main", prompt: "prompt" })
  await waitFor(() => created.length === 1)
  await predictor.dispose()
  const result = await pending

  expect(result.ok).toBe(false)
  await waitFor(() => removed.length === 1)
  expect(removed).toEqual(["ses_helper_1"])
})

test("a failure is not retried and the helper is removed", async () => {
  const { client, removed, generated } = makeClient({ fail: true })
  const predictor = createPredictor(client, { timeoutMs: 1_000 })

  const result = await predictor.predict({ sessionID: "ses_main", prompt: "prompt" })
  expect(result.ok).toBe(false)
  expect(generated.length).toBe(0)
  await waitFor(() => removed.length === 1)
})
