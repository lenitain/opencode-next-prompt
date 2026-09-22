import { test, expect } from "bun:test"
import type { Context } from "@opencode/plugin/tui/context"
import plugin from "../src/index.tsx"

type Handler = (event: { type: string; data?: unknown }) => void
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Surface errors that maybePredict's catch would otherwise swallow.
;(globalThis as { NEXT_PROMPT_DEBUG?: boolean }).NEXT_PROMPT_DEBUG = true

const SESSION_ID = "ses_test"
const SUGGESTION = "跑一下测试确认修复"

/**
 * A structural TextareaRenderable lookalike. Deliberately NOT built on
 * @opentui/core's prototype: the plugin runs against editor objects created
 * by the opencode binary's own copy of @opentui/core, where instanceof against
 * the plugin's copy never matches, so the plugin must go by structure alone.
 */
function makeTextarea() {
  const el: Record<string, any> = {
    plainText: "",
    placeholder: undefined,
    isDestroyed: false,
    inserted: [] as string[],
    insertText(value: string) {
      el.inserted.push(value)
      el.plainText += value
    },
    getLayoutNode: () => ({ markDirty() {} }),
    gotoBufferEnd() {},
  }
  return el
}

/** An InputRenderable lookalike: single-line fields carry a maxLength accessor. */
function makeSingleLineInput() {
  const el = makeTextarea()
  el.placeholder = null
  el.maxLength = 120
  return el
}

function createFixture(options: Record<string, unknown> = {}) {
  const subscribed = new Map<string, Handler[]>()
  const listeners: Array<(event: { details: { type: string; data?: unknown } }) => void> = []
  const rendererHandlers = new Map<string, Array<(...args: any[]) => void>>()
  const toasts: any[] = []
  const generateCalls: any[] = []
  const layers: Array<() => any> = []
  const editor = makeTextarea()
  let focused: any = editor
  let slotClaim: any
  let slotDisposed = false
  let sessionStatus = "idle"

  const messages: any[] = [
    { id: "msg_u1", type: "user", text: "修复登录问题" },
    {
      id: "msg_a1",
      type: "assistant",
      content: [{ type: "text", text: "已经修好了，原因是时区判断写反了。" }],
    },
  ]

  const context = {
    options,
    location: { directory: "/tmp/e2e" },
    renderer: {
      get currentFocusedEditor() {
        return focused
      },
      on(type: string, handler: (...args: any[]) => void) {
        const list = rendererHandlers.get(type) ?? []
        list.push(handler)
        rendererHandlers.set(type, list)
      },
      off(type: string, handler: (...args: any[]) => void) {
        const current = rendererHandlers.get(type) ?? []
        const index = current.indexOf(handler)
        if (index >= 0) current.splice(index, 1)
      },
      requestRender() {},
    },
    client: {
      generate: {
        text: async (input: any) => {
          generateCalls.push(input)
          return { text: SUGGESTION }
        },
      },
    },
    data: {
      on(type: string, handler: Handler) {
        const list = subscribed.get(type) ?? []
        list.push(handler)
        subscribed.set(type, list)
        return () => {
          const current = subscribed.get(type) ?? []
          const index = current.indexOf(handler)
          if (index >= 0) current.splice(index, 1)
        }
      },
      listen(handler: (event: { details: { type: string; data?: unknown } }) => void) {
        listeners.push(handler)
        return () => {
          const index = listeners.indexOf(handler)
          if (index >= 0) listeners.splice(index, 1)
        }
      },
      session: {
        status: () => sessionStatus,
        message: { list: () => messages },
        get: () => ({ id: SESSION_ID, model: { providerID: "acme", id: "fast" } }),
      },
      location: {
        model: {
          list: () => [{ providerID: "acme", modelID: "fast", variants: [{ id: "high" }, { id: "low" }] }],
        },
        provider: { list: () => [{ id: "acme" }] },
      },
    },
    ui: {
      router: { current: () => ({ type: "session", sessionID: SESSION_ID }) },
      toast: { show: (toast: any) => toasts.push(toast) },
      slot: (claim: any) => {
        slotClaim = claim
        return () => {
          slotDisposed = true
        }
      },
    },
    keymap: {
      layer: (factory: () => any) => {
        layers.push(factory)
      },
    },
  } as unknown as Context

  return {
    context,
    editor,
    toasts,
    generateCalls,
    layers,
    subscribed,
    get slotClaim() {
      return slotClaim
    },
    get slotDisposed() {
      return slotDisposed
    },
    get sessionStatus() {
      return sessionStatus
    },
    set sessionStatus(value: string) {
      sessionStatus = value
    },
    get focused() {
      return focused
    },
    set focused(value: any) {
      focused = value
    },
    fire(type: string, data: unknown) {
      for (const handler of subscribed.get(type) ?? []) handler({ type, data })
      for (const listener of listeners) listener({ details: { type, data } })
    },
    fireRenderer(type: string, ...args: unknown[]) {
      for (const handler of rendererHandlers.get(type) ?? []) handler(...args)
    },
    renderSlot() {
      slotClaim.render({})
    },
  }
}

const idleEvent = { sessionID: SESSION_ID, status: { type: "idle" } }
const busyEvent = { sessionID: SESSION_ID, status: { type: "busy" } }

test("idle triggers prediction, placeholder shows, accept key fills, busy clears", async () => {
  const fixture = createFixture()
  const cleanup = await plugin.setup(fixture.context)

  // always-mounted app slot (keymap layer's owner; one instance per TUI)
  expect(fixture.slotClaim.append).toBe("app")

  // initial render: no suggestion yet, placeholder untouched
  fixture.renderSlot()
  await sleep(10)
  expect(fixture.editor.placeholder).toBeUndefined()

  // assistant finished → session idle → prediction runs
  fixture.fire("session.status", busyEvent)
  fixture.fire("session.status", idleEvent)
  await sleep(30)

  expect(fixture.generateCalls.length).toBe(1)
  const call = fixture.generateCalls[0]
  // session model + auto-picked lowest variant
  expect(call.model).toEqual({ providerID: "acme", id: "fast", variant: "low" })
  // conversation context rendered into the prompt
  expect(call.prompt).toContain("user: 修复登录问题")
  expect(call.prompt).toContain("assistant: 已经修好了，原因是时区判断写反了。")
  // suggestion lands in the placeholder with the accept-key marker
  expect(fixture.editor.placeholder).toBe(` [→] ${SUGGESTION}`)

  // keymap layer: command registered with the V2 shape
  const layer = fixture.layers[0]()
  expect(layer.priority).toBe(1000)
  const command = layer.commands.find((item: any) => item.id === "opencode-next-prompt.accept")
  expect(command).toBeDefined()
  expect(command.bind).toBe("right")
  expect(command.enabled()).toBe(true)

  // empty input + → → suggestion inserted, key falls through (false)
  expect(fixture.editor.plainText).toBe("")
  expect(command.run()).toBe(false)
  expect(fixture.editor.inserted).toEqual([SUGGESTION])

  // non-empty input → → keeps cursor behavior, no insertion
  fixture.editor.inserted.length = 0
  fixture.editor.plainText = "x"
  expect(command.run()).toBe(false)
  expect(fixture.editor.inserted).toEqual([])

  // busy (user submitted) → suggestion discarded, our placeholder cleared
  fixture.editor.plainText = ""
  fixture.fire("session.status", busyEvent)
  expect(fixture.editor.placeholder).toBeNull()

  // cleanup unsubscribes everything and disposes the slot
  if (typeof cleanup === "function") await cleanup()
  expect(fixture.slotDisposed).toBe(true)
  for (const handlers of fixture.subscribed.values()) expect(handlers.length).toBe(0)
})

test("unknown configured model → one error toast, no prediction call", async () => {
  const fixture = createFixture({ model: "acme/missing" })
  await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.status", idleEvent)
  await sleep(30)
  fixture.fire("session.status", idleEvent)
  await sleep(30)

  expect(fixture.generateCalls.length).toBe(0)
  expect(fixture.toasts.length).toBe(1)
  expect(fixture.toasts[0].message).toContain('model "missing" not found on provider "acme"')
  expect(fixture.toasts[0].variant).toBe("error")
})

test("revert of the current session invalidates the suggestion; other sessions do not", async () => {
  const fixture = createFixture()
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.status", idleEvent)
  await sleep(30)
  expect(fixture.editor.placeholder).toBe(` [→] ${SUGGESTION}`)

  // another session's revert must not touch our state
  fixture.fire("session.revert.committed", { sessionID: "ses_other", to: "msg_u1" })
  expect(fixture.editor.placeholder).toBe(` [→] ${SUGGESTION}`)

  // our session's revert invalidates and clears the placeholder
  fixture.fire("session.revert.committed", { sessionID: SESSION_ID, to: "msg_u1" })
  expect(fixture.editor.placeholder).toBeNull()
  const layer = fixture.layers[0]()
  const command = layer.commands.find((item: any) => item.id === "opencode-next-prompt.accept")
  expect(command.enabled()).toBe(false)

  if (typeof cleanup === "function") await cleanup()
})

test("generate with the session model rejected → falls back to the server default", async () => {
  const fixture = createFixture()
  const calls: any[] = []
  // Free-tier style gate: explicitly selected models are refused, the
  // server default is not.
  ;(fixture.context.client.generate as any).text = async (input: any) => {
    calls.push(input)
    if (input.model) throw new Error("Error from provider (Console): OpenCode's free tier can only be used from within OpenCode")
    return { text: SUGGESTION }
  }
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.status", idleEvent)
  await sleep(30)

  expect(calls.length).toBe(2)
  expect(calls[0].model).toEqual({ providerID: "acme", id: "fast", variant: "low" })
  expect(calls[1].model).toBeUndefined()
  expect(fixture.editor.placeholder).toBe(` [→] ${SUGGESTION}`)

  if (typeof cleanup === "function") await cleanup()
})

test("TUI's own placeholder overwrite is restored on the next frame", async () => {
  const fixture = createFixture()
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.status", idleEvent)
  await sleep(30)
  expect(fixture.editor.placeholder).toBe(` [→] ${SUGGESTION}`)

  // The TUI's placeholder memo overwrites ours (session switch / resize /
  // shell change) — the next frame must restore the marker.
  fixture.editor.placeholder = "Ask anything…"
  fixture.fireRenderer("frame")
  expect(fixture.editor.placeholder).toBe(` [→] ${SUGGESTION}`)

  // Once idle, frames must leave a TUI-owned placeholder alone.
  fixture.fire("session.status", busyEvent)
  expect(fixture.editor.placeholder).toBeNull()
  fixture.editor.placeholder = "Ask anything…"
  fixture.fireRenderer("frame")
  expect(fixture.editor.placeholder).toBe("Ask anything…")

  if (typeof cleanup === "function") await cleanup()
})

test("single-line input focused → hidden and un-accepted; refocus restores the placeholder", async () => {
  const fixture = createFixture()
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.status", idleEvent)
  await sleep(30)
  expect(fixture.editor.placeholder).toBe(` [→] ${SUGGESTION}`)

  const layer = fixture.layers[0]()
  const command = layer.commands.find((item: any) => item.id === "opencode-next-prompt.accept")

  // focus moves to a single-line Input (dialog/form field): never receive it
  const input = makeSingleLineInput()
  fixture.focused = input
  fixture.fireRenderer("focused_editor", input, fixture.editor)
  expect(input.placeholder).toBeNull()
  expect(command.run()).toBe(false)
  expect(input.inserted).toEqual([])

  // focus returns to the prompt textarea → our placeholder comes back
  fixture.focused = fixture.editor
  fixture.fireRenderer("focused_editor", fixture.editor, input)
  expect(fixture.editor.placeholder).toBe(` [→] ${SUGGESTION}`)

  if (typeof cleanup === "function") await cleanup()
  // dispose clears our marker from the focused textarea
  expect(fixture.editor.placeholder).toBeNull()
})
