import { test, expect, afterAll } from "bun:test"
import { rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Context } from "@opencode/plugin/tui/context"
import plugin from "../src/index.ts"
import { setDebugLogFile } from "../src/debug.ts"

type Handler = (event: { type: string; data?: unknown }) => void
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(predicate: () => boolean, timeoutMs = 1_500): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out")
    await sleep(5)
  }
}

const DEBUG_LOG = join(tmpdir(), `opencode-next-prompt-test-${process.pid}.log`)
rmSync(DEBUG_LOG, { force: true })
setDebugLogFile(DEBUG_LOG)

// Surface errors that maybePredict's catch would otherwise swallow.
;(globalThis as { NEXT_PROMPT_DEBUG?: boolean }).NEXT_PROMPT_DEBUG = true

afterAll(() => {
  ;(globalThis as { NEXT_PROMPT_DEBUG?: boolean }).NEXT_PROMPT_DEBUG = false
  rmSync(DEBUG_LOG, { force: true })
  rmSync(`${DEBUG_LOG}.1`, { force: true })
  setDebugLogFile(undefined)
})

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
  let mode = "base"
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
    app: { version: "2.1.4", channel: "stable" },
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
            { providerID: "acme", id: "fast", modelID: "fast-api", variants: [{ id: "high" }, { id: "low" }] },
            {
              providerID: "acme",
              id: "lite",
              modelID: "lite-api",
              variants: [{ id: "high" }, { id: "low" }, { id: "minimal" }],
            },
          ],
        },
        provider: { list: () => [{ id: "acme" }] },
      },
    },
    ui: {
      router: { current: () => ({ type: "session", sessionID: SESSION_ID }) },
      tabs: { enabled: () => false, list: () => [] },
      toast: { show: (toast: any) => toasts.push(toast) },
      slot: (claim: any) => {
        slotClaim = claim
        return () => {
          slotDisposed = true
        }
      },
    },
    keymap: {
      mode: {
        current: () => mode,
        push: () => () => {},
      },
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
    get mode() {
      return mode
    },
    set mode(value: string) {
      mode = value
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

function acceptCommand(fixture: ReturnType<typeof createFixture>) {
  const layer = fixture.layers[0]?.()
  const command = layer?.commands?.find((item: any) => item.id === "opencode-next-prompt.accept")
  if (!command) throw new Error("accept command was not registered")
  return command
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
  await waitFor(() => fixture.sessionCreateCalls.length === 1)

  expect(fixture.sessionCreateCalls[0]).toEqual({
    parentID: SESSION_ID,
    title: "next-prompt-suggestion",
    model: { providerID: "acme", id: "fast", variant: "low" },
    permissions: [{ action: "*", resource: "*", effect: "deny" }],
  })
  expect(fixture.sessionGenerateCalls.length).toBe(1)
  expect(fixture.generateTextCalls.length).toBe(0)
  const call = fixture.sessionGenerateCalls[0]
  expect(call.sessionID).toBe("ses_helper")
  // tool-suppression instruction + delimited conversation context in the prompt
  expect(call.prompt).toContain("Do not call any tools and do not take any actions.")
  expect(call.prompt).toContain('<turn role="user">修复登录问题</turn>')
  expect(call.prompt).toContain('<turn role="assistant">已经修好了，原因是时区判断写反了。</turn>')
  // suggestion lands in the placeholder with the accept-key marker
  await waitFor(() => fixture.editor.placeholder === ` [→] ${SUGGESTION}`)
  await waitFor(() => fixture.sessionRemoveCalls.length === 1)

  // keymap layer: command registered with the V2 shape
  const layer = fixture.layers[0]?.()
  expect(layer.priority).toBe(1000)
  expect(layer.target()).toBe(fixture.editor)
  fixture.mode = "shell"
  expect(layer.target()).toBeNull()
  fixture.mode = "base"
  const command = acceptCommand(fixture)
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
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.status", idleEvent)
  await waitFor(() => fixture.toasts.length === 1)
  fixture.fire("session.status", idleEvent)
  await sleep(30)

  expect(fixture.generateCalls.length).toBe(0)
  expect(fixture.toasts.length).toBe(1)
  expect(fixture.toasts[0].message).toContain(
    'model "missing" not found on provider "acme" (available models: fast, lite)',
  )
  expect(fixture.toasts[0].variant).toBe("error")

  if (typeof cleanup === "function") await cleanup()
})

test("uses agents.title.model from opencode.jsonc with the lowest variant", async () => {
  const fixture = createFixture()
  fixture.agents = [{ id: "title", model: { providerID: "acme", id: "lite" } }]
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.status", idleEvent)
  await waitFor(() => fixture.sessionCreateCalls.length === 1)

  expect(fixture.sessionCreateCalls[0].model).toEqual({
    providerID: "acme",
    id: "lite",
    variant: "minimal",
  })
  await waitFor(() => fixture.editor.placeholder === ` [→] ${SUGGESTION}`)

  if (typeof cleanup === "function") await cleanup()
})

test("prefers agents['next-prompt'].model over agents.title.model", async () => {
  const fixture = createFixture()
  fixture.agents = [
    { id: "title", model: { providerID: "acme", id: "lite" } },
    { id: "next-prompt", model: { providerID: "acme", id: "fast" } },
  ]
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.status", idleEvent)
  await waitFor(() => fixture.sessionCreateCalls.length === 1)

  expect(fixture.sessionCreateCalls[0].model).toEqual({
    providerID: "acme",
    id: "fast",
    variant: "low",
  })

  if (typeof cleanup === "function") await cleanup()
})

test("an invalid title model warns and falls back to the session model", async () => {
  const fixture = createFixture()
  fixture.agents = [{ id: "title", model: { providerID: "acme", id: "missing" } }]
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.status", idleEvent)
  await waitFor(() => fixture.sessionCreateCalls.length === 1)

  expect(fixture.toasts.length).toBe(1)
  expect(fixture.toasts[0].variant).toBe("warning")
  expect(fixture.toasts[0].message).toContain("using the session model (acme/fast)")
  expect(fixture.sessionCreateCalls[0].model).toEqual({ providerID: "acme", id: "fast", variant: "low" })

  if (typeof cleanup === "function") await cleanup()
})

test("revert of the current session invalidates the suggestion; other sessions do not", async () => {
  const fixture = createFixture()
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.status", idleEvent)
  await waitFor(() => fixture.editor.placeholder === ` [→] ${SUGGESTION}`)

  // another session's revert must not touch our state
  fixture.fire("session.revert.committed", { sessionID: "ses_other", to: "msg_u1" })
  expect(fixture.editor.placeholder).toBe(` [→] ${SUGGESTION}`)

  // our session's revert invalidates and clears the placeholder
  fixture.fire("session.revert.committed", { sessionID: SESSION_ID, to: "msg_u1" })
  expect(fixture.editor.placeholder).toBeNull()
  expect(acceptCommand(fixture).enabled()).toBe(false)

  if (typeof cleanup === "function") await cleanup()
})

test("when session.create is unavailable, falls back to session.generate on the active session", async () => {
  const fixture = createFixture({ model: "acme/fast" })
  delete (fixture.context.client.session as any).create
  const response = { text: SUGGESTION }
  ;(fixture.context.client.session as any).generate = async (input: any) => {
    fixture.sessionGenerateCalls.push(input)
    return response
  }
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.status", idleEvent)
  await waitFor(() => fixture.sessionGenerateCalls.length === 1)

  expect(fixture.generateTextCalls.length).toBe(0)
  expect(fixture.sessionGenerateCalls[0].sessionID).toBe(SESSION_ID)
  await waitFor(() => fixture.editor.placeholder === ` [→] ${SUGGESTION}`)

  if (typeof cleanup === "function") await cleanup()
})

test("when the session endpoints are unavailable, falls back to generate.text with the configured model", async () => {
  const fixture = createFixture({ model: "acme/fast" })
  delete (fixture.context.client.session as any).create
  delete (fixture.context.client.session as any).generate
  ;(fixture.context.client.generate as any).text = async (input: any) => {
    fixture.generateTextCalls.push(input)
    return { text: SUGGESTION }
  }
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.status", idleEvent)
  await waitFor(() => fixture.generateTextCalls.length === 1)

  expect(fixture.generateTextCalls[0].model).toEqual({ providerID: "acme", id: "fast", variant: "low" })
  await waitFor(() => fixture.editor.placeholder === ` [→] ${SUGGESTION}`)

  if (typeof cleanup === "function") await cleanup()
})

test("shell mode placeholder is not overwritten and accept key does not insert into shell mode", async () => {
  const fixture = createFixture()
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.status", idleEvent)
  await waitFor(() => fixture.editor.placeholder === ` [→] ${SUGGESTION}`)

  // User presses `!` to enter shell mode; TUI sets shell placeholder
  fixture.editor.placeholder = 'Run a command… "git status"'
  fixture.fireRenderer("frame")
  expect(fixture.editor.placeholder).toBe('Run a command… "git status"')

  const command = acceptCommand(fixture)
  expect(command.run()).toBe(false)
  expect(fixture.editor.inserted).toEqual([])

  // Leaving shell mode restores suggestion on next frame
  fixture.editor.placeholder = null
  fixture.fireRenderer("frame")
  expect(fixture.editor.placeholder).toBe(` [→] ${SUGGESTION}`)

  // Even without the host placeholder, the keymap mode is authoritative.
  fixture.mode = "shell"
  fixture.editor.placeholder = null
  fixture.editor.plainText = ""
  expect(command.run()).toBe(false)
  expect(fixture.editor.inserted).toEqual([])
  fixture.mode = "base"

  if (typeof cleanup === "function") await cleanup()
})

test("TUI's own placeholder overwrite is restored on the next frame", async () => {
  const fixture = createFixture()
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.status", idleEvent)
  await waitFor(() => fixture.editor.placeholder === ` [→] ${SUGGESTION}`)

  // The TUI's placeholder memo overwrites ours (session switch / resize /
  // shell change) — the next frame must restore the marker.
  fixture.editor.placeholder = "Ask anything…"
  fixture.fireRenderer("frame")
  expect(fixture.editor.placeholder).toBe(` [→] ${SUGGESTION}`)

  // Once idle, the host's own placeholder is restored, and frames leave it alone.
  fixture.fire("session.status", busyEvent)
  expect(fixture.editor.placeholder).toBe("Ask anything…")
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
  await waitFor(() => fixture.editor.placeholder === ` [→] ${SUGGESTION}`)

  const command = acceptCommand(fixture)

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
  // dispose restores the host placeholder captured before the suggestion
  expect(fixture.editor.placeholder).toBeNull()
})

test("accept supports both OpenTUI 0.6 invalidateIntrinsicSize and OpenTUI 0.5 getLayoutNode", async () => {
  const fixture = createFixture()
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.status", idleEvent)
  await waitFor(() => fixture.editor.placeholder === ` [→] ${SUGGESTION}`)
  const command = acceptCommand(fixture)

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

test("regenerating a reply produces a fresh prediction", async () => {
  const fixture = createFixture()
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.status", idleEvent)
  await waitFor(() => fixture.editor.placeholder === ` [→] ${SUGGESTION}`)
  const before = fixture.sessionCreateCalls.length

  // A regenerated reply emits started → succeeded for the same user message.
  fixture.fire("session.execution.started", { sessionID: SESSION_ID })
  expect(fixture.editor.placeholder).toBeNull()
  fixture.fire("session.execution.succeeded", { sessionID: SESSION_ID })

  await waitFor(() => fixture.sessionCreateCalls.length === before + 1)
  await waitFor(() => fixture.editor.placeholder === ` [→] ${SUGGESTION}`)

  if (typeof cleanup === "function") await cleanup()
})

test("a pending retry is cancelled by a revert and does not resurrect the suggestion", async () => {
  const fixture = createFixture()
  const failing = async (input: any) => {
    fixture.sessionGenerateCalls.push(input)
    throw new Error("transient")
  }
  ;(fixture.context.client.session as any).generate = failing
  ;(fixture.context.client.generate as any).text = async () => {
    throw new Error("transient")
  }
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.status", idleEvent)
  await waitFor(() => fixture.sessionCreateCalls.length === 1)
  await waitFor(() => fixture.sessionGenerateCalls.length >= 2)
  expect(fixture.editor.placeholder).toBeUndefined()

  fixture.fire("session.revert.committed", { sessionID: SESSION_ID, to: "msg_u1" })
  await sleep(900)

  expect(fixture.sessionCreateCalls.length).toBe(1)
  expect(fixture.editor.placeholder).toBeUndefined()

  if (typeof cleanup === "function") await cleanup()
})

test("accept refuses a ready suggestion from another session", async () => {
  const fixture = createFixture()
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.status", idleEvent)
  await waitFor(() => fixture.editor.placeholder === ` [→] ${SUGGESTION}`)

  // Router moved to another session without a tui.session.select event.
  ;(fixture.context.ui.router as any).current = () => ({ type: "session", sessionID: "ses_other" })
  expect(acceptCommand(fixture).run()).toBe(false)
  expect(fixture.editor.inserted).toEqual([])

  if (typeof cleanup === "function") await cleanup()
})

test("a failed execution still triggers a prediction", async () => {
  const fixture = createFixture()
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.execution.started", { sessionID: SESSION_ID })
  fixture.fire("session.execution.failed", { sessionID: SESSION_ID, error: { message: "boom" } })
  await waitFor(() => fixture.sessionCreateCalls.length === 1)

  if (typeof cleanup === "function") await cleanup()
})

test("cancelling a staged revert asks for a fresh prediction", async () => {
  const fixture = createFixture()
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.status", idleEvent)
  await waitFor(() => fixture.editor.placeholder === ` [→] ${SUGGESTION}`)
  const before = fixture.sessionCreateCalls.length

  fixture.fire("session.revert.staged", { sessionID: SESSION_ID, revert: {} })
  expect(fixture.editor.placeholder).toBeNull()
  fixture.fire("session.revert.cleared", { sessionID: SESSION_ID })

  await waitFor(() => fixture.sessionCreateCalls.length === before + 1)
  await waitFor(() => fixture.editor.placeholder === ` [→] ${SUGGESTION}`)

  if (typeof cleanup === "function") await cleanup()
})

test("an older host version warns once at startup", async () => {
  const fixture = createFixture()
  ;(fixture.context.app as any).version = "2.0.21"
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  expect(fixture.toasts.length).toBe(1)
  expect(fixture.toasts[0].variant).toBe("warning")
  expect(fixture.toasts[0].message).toContain("older than 2.0.22")

  if (typeof cleanup === "function") await cleanup()
})

test("session.idle triggers a prediction when the status event is missing", async () => {
  const fixture = createFixture()
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.idle", { sessionID: SESSION_ID })
  await waitFor(() => fixture.sessionCreateCalls.length === 1)

  if (typeof cleanup === "function") await cleanup()
})

test("session.idle without a session id (OpenCode 2.0.x) uses the focused session", async () => {
  const fixture = createFixture()
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.idle", undefined)
  await waitFor(() => fixture.sessionCreateCalls.length === 1)

  if (typeof cleanup === "function") await cleanup()
})
