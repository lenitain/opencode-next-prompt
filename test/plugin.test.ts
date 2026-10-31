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
    invalidatedCount: 0,
    insertText(value: string) {
      el.inserted.push(value)
      el.plainText += value
    },
    invalidateIntrinsicSize() {
      el.invalidatedCount += 1
    },
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
  const sessionCreateCalls: any[] = []
  const sessionRemoveCalls: any[] = []
  const sessionGenerateCalls: any[] = []
  const generateTextCalls: any[] = []
  const layers: Array<() => any> = []
  const editor = makeTextarea()
  let focused: any = editor
  let slotClaim: any
  let slotDisposed = false
  let sessionStatus = "idle"
  let agents: any[] = []

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
      session: {
        create: async (input: any) => {
          sessionCreateCalls.push(input)
          return { id: "ses_helper" }
        },
        remove: async (input: any) => {
          sessionRemoveCalls.push(input)
        },
        generate: async (input: any) => {
          sessionGenerateCalls.push(input)
          return { text: SUGGESTION }
        },
      },
      generate: {
        text: async (input: any) => {
          generateTextCalls.push(input)
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
        get: () => ({
          id: SESSION_ID,
          location: { directory: "/tmp/e2e" },
          model: { providerID: "acme", id: "fast", variant: "high" },
        }),
      },
      location: {
        agent: {
          list: () => agents,
        },
        model: {
          list: () => [
            { providerID: "acme", modelID: "fast", variants: [{ id: "high" }, { id: "low" }] },
            { providerID: "acme", modelID: "lite", variants: [{ id: "high" }, { id: "low" }, { id: "minimal" }] },
          ],
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
    generateCalls: sessionGenerateCalls,
    sessionCreateCalls,
    sessionRemoveCalls,
    sessionGenerateCalls,
    generateTextCalls,
    layers,
    subscribed,
    set agents(value: any[]) {
      agents = value
    },
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

  expect(fixture.sessionCreateCalls.length).toBe(1)
  expect(fixture.sessionCreateCalls[0]).toEqual({
    parentID: SESSION_ID,
    title: "next-prompt-suggestion",
    model: { providerID: "acme", id: "fast", variant: "low" },
    permissions: [{ action: "*", resource: "*", effect: "deny" }],
  })
  expect(fixture.sessionGenerateCalls.length).toBe(1)
  expect(fixture.sessionRemoveCalls).toEqual([{ sessionID: "ses_helper" }])
  expect(fixture.generateTextCalls.length).toBe(0)
  const call = fixture.sessionGenerateCalls[0]
  expect(call.sessionID).toBe("ses_helper")
  // tool-suppression instruction + conversation context rendered into the prompt
  expect(call.prompt).toContain("Do not call any tools and do not take any actions.")
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
  expect(fixture.toasts[0].message).toContain('model "missing" not found on provider "acme" (available models: fast, lite)')
  expect(fixture.toasts[0].variant).toBe("error")
})

test("uses agents.title.model or agents['next-prompt'].model from opencode.jsonc with minimal variant", async () => {
  const fixture = createFixture()
  fixture.agents = [
    { id: "title", model: { providerID: "acme", id: "lite" } },
  ]
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.status", idleEvent)
  await sleep(30)

  expect(fixture.sessionCreateCalls.length).toBe(1)
  expect(fixture.sessionCreateCalls[0].model).toEqual({
    providerID: "acme",
    id: "lite",
    variant: "minimal",
  })
  expect(fixture.editor.placeholder).toBe(` [→] ${SUGGESTION}`)

  if (typeof cleanup === "function") await cleanup()
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

test("when session.create is unavailable, custom options.model tries generate.text then falls back to session.generate", async () => {
  const fixture = createFixture({ model: "acme/fast" })
  const generateTextCalls: any[] = []
  const sessionGenerateCalls: any[] = []
  delete (fixture.context.client.session as any).create
  // Project-scoped provider: global generate.text rejects with ModelNotFoundError,
  // while session.generate runs in the project's LocationService and succeeds.
  ;(fixture.context.client.generate as any).text = async (input: any) => {
    generateTextCalls.push(input)
    throw new Error("ModelNotFoundError: acme/fast not found in global config")
  }
  ;(fixture.context.client.session as any).generate = async (input: any) => {
    sessionGenerateCalls.push(input)
    return { text: SUGGESTION }
  }
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.status", idleEvent)
  await sleep(30)

  expect(generateTextCalls.length).toBe(1)
  expect(generateTextCalls[0].model).toEqual({ providerID: "acme", id: "fast", variant: "low" })
  expect(sessionGenerateCalls.length).toBe(1)
  expect(sessionGenerateCalls[0].sessionID).toBe(SESSION_ID)
  expect(fixture.editor.placeholder).toBe(` [→] ${SUGGESTION}`)

  if (typeof cleanup === "function") await cleanup()
})

test("shell mode placeholder is not overwritten and accept key does not insert into shell mode", async () => {
  const fixture = createFixture()
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.status", idleEvent)
  await sleep(30)
  expect(fixture.editor.placeholder).toBe(` [→] ${SUGGESTION}`)

  // User presses `!` to enter shell mode; TUI sets shell placeholder
  fixture.editor.placeholder = 'Run a command… "git status"'
  fixture.fireRenderer("frame")
  expect(fixture.editor.placeholder).toBe('Run a command… "git status"')

  const layer = fixture.layers[0]()
  const command = layer.commands.find((item: any) => item.id === "opencode-next-prompt.accept")
  expect(command.run()).toBe(false)
  expect(fixture.editor.inserted).toEqual([])

  // Leaving shell mode restores suggestion on next frame
  fixture.editor.placeholder = null
  fixture.fireRenderer("frame")
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

test("accept supports both OpenTUI 0.6 invalidateIntrinsicSize and OpenTUI 0.5 getLayoutNode", async () => {
  const fixture = createFixture()
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.status", idleEvent)
  await sleep(30)

  const layer = fixture.layers[0]()
  const command = layer.commands.find((item: any) => item.id === "opencode-next-prompt.accept")

  // OpenTUI 0.6+ path: calls invalidateIntrinsicSize()
  expect(command.run()).toBe(false)
  await sleep(10)
  expect(fixture.editor.invalidatedCount).toBe(1)

  // OpenTUI 0.5 fallback path: calls getLayoutNode().markDirty() when invalidateIntrinsicSize is absent
  let markedDirty = 0
  const legacyEditor: Record<string, any> = {
    plainText: "",
    placeholder: undefined,
    isDestroyed: false,
    inserted: [] as string[],
    insertText(value: string) {
      legacyEditor.inserted.push(value)
      legacyEditor.plainText += value
    },
    getLayoutNode: () => ({
      markDirty() {
        markedDirty += 1
      },
    }),
    gotoBufferEnd() {},
  }
  fixture.focused = legacyEditor
  fixture.fireRenderer("focused_editor", legacyEditor, fixture.editor)
  expect(legacyEditor.placeholder).toBe(` [→] ${SUGGESTION}`)
  expect(command.run()).toBe(false)
  await sleep(10)
  expect(legacyEditor.inserted).toEqual([SUGGESTION])
  expect(markedDirty).toBe(1)

  if (typeof cleanup === "function") await cleanup()
})
