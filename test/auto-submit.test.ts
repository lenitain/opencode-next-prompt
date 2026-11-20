import { test, expect } from "bun:test"
import { createSuggestionStore } from "../src/state.ts"
import { createAutoSubmit, type AutoSubmitSuggestion } from "../src/auto-submit.ts"

;(globalThis as { NEXT_PROMPT_DEBUG?: boolean }).NEXT_PROMPT_DEBUG = false

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function ready(store: ReturnType<typeof createSuggestionStore>, text = "继续修复测试") {
  const generation = store.beginPredict("ses_main", "turn_1")
  if (generation === null) throw new Error("store was not idle")
  store.settle(generation, "turn_1", text)
}

test("submits a ready suggestion once after the delay", async () => {
  const store = createSuggestionStore()
  const calls: AutoSubmitSuggestion[] = []
  const controller = createAutoSubmit({
    delayMs: 20,
    store,
    submit: (suggestion) => calls.push(suggestion),
  })
  controller.start()

  ready(store)
  await sleep(50)

  expect(calls).toEqual([{ sessionID: "ses_main", turnKey: "turn_1", text: "继续修复测试" }])
  controller.dispose()
})

test("user activity cancels the pending submit but keeps the suggestion", async () => {
  const store = createSuggestionStore()
  const calls: AutoSubmitSuggestion[] = []
  const controller = createAutoSubmit({
    delayMs: 20,
    store,
    submit: (suggestion) => calls.push(suggestion),
  })
  controller.start()

  ready(store)
  controller.cancel("user activity")
  await sleep(50)

  expect(calls).toEqual([])
  expect(store.read().kind).toBe("ready")
  controller.dispose()
})

test("discarding the suggestion cancels the pending submit", async () => {
  const store = createSuggestionStore()
  const calls: AutoSubmitSuggestion[] = []
  const controller = createAutoSubmit({
    delayMs: 20,
    store,
    submit: (suggestion) => calls.push(suggestion),
  })
  controller.start()

  ready(store)
  store.discard()
  await sleep(50)

  expect(calls).toEqual([])
  controller.dispose()
})

test("dispose cancels the pending submit", async () => {
  const store = createSuggestionStore()
  const calls: AutoSubmitSuggestion[] = []
  const controller = createAutoSubmit({
    delayMs: 20,
    store,
    submit: (suggestion) => calls.push(suggestion),
  })
  controller.start()

  ready(store)
  controller.dispose()
  await sleep(50)

  expect(calls).toEqual([])
})
