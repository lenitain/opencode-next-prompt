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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
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
const MARKER = ` [→] ${SUGGESTION}`

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
  const layers: Array<() => any> = []
  const editor = makeTextarea()
  let focused: any = editor
  let slotClaim: any
  let slotDisposed = false
  let sessionStatus = "idle"
  let mode = "base"
  let agents: any[] = []
  let permissions: any[] = []
  let forms: any[] = []
  let queued: any[] = []
  let messages: any[] = [
    { id: "msg_u1", type: "user", text: "修复登录问题" },
    {
      id: "msg_a1",
      type: "assistant",
      content: [{ type: "text", text: "已经修好了，原因是时区判断写反了。" }],
    },
  ]
  let generate: (input: any) => Promise<{ text: string }> = async () => ({ text: SUGGESTION })

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
          return generate(input)
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
        permission: { list: () => permissions },
        form: { list: () => forms },
        pending: { list: () => queued },
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
    sessionCreateCalls,
    sessionRemoveCalls,
    sessionGenerateCalls,
    layers,
    subscribed,
    set agents(value: any[]) {
      agents = value
    },
    set permissions(value: any[]) {
      permissions = value
    },
    set forms(value: any[]) {
      forms = value
    },
    set queued(value: any[]) {
      queued = value
    },
    set messages(value: any[]) {
      messages = value
    },
    set generate(value: (input: any) => Promise<{ text: string }>) {
      generate = value
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

test("idle triggers one prediction in a helper session, shows the placeholder, and accepts", async () => {
  const fixture = createFixture()
  const cleanup = await plugin.setup(fixture.context)

  // always-mounted app slot (keymap layer's owner; one instance per TUI)
  expect(fixture.slotClaim.append).toBe("app")

  // initial render: no suggestion yet, placeholder untouched
  fixture.renderSlot()
  await sleep(10)
  expect(fixture.editor.placeholder).toBeUndefined()

  // assistant finished → session idle → prediction runs exactly once
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
  const call = fixture.sessionGenerateCalls[0]
  expect(call.sessionID).toBe("ses_helper")
  expect(call.prompt).toContain('<turn role="user">修复登录问题</turn>')
  expect(call.prompt).toContain('<turn role="assistant" latest="true">已经修好了，原因是时区判断写反了。</turn>')
  expect(call.prompt).toContain("NO_SUGGESTION")

  // suggestion lands in the placeholder with the accept-key marker
  await waitFor(() => fixture.editor.placeholder === MARKER)
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

  // accepting fills the input; the suggestion stays ready for this turn, so
  // deleting the text reveals it again
  expect(command.enabled()).toBe(true)
  expect(fixture.editor.placeholder).toBe(MARKER)
  fixture.editor.plainText = ""
  expect(fixture.editor.placeholder).toBe(MARKER)
  fixture.fire("session.status", idleEvent)
  await sleep(30)
  expect(fixture.sessionCreateCalls.length).toBe(1)
  expect(fixture.editor.placeholder).toBe(MARKER)

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

test("a draft does not block prediction; clearing reveals the suggestion", async () => {
  const fixture = createFixture()
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.editor.plainText = "半句话"
  fixture.fire("session.status", idleEvent)
  await waitFor(() => fixture.sessionCreateCalls.length === 1)
  await waitFor(() => fixture.editor.placeholder === MARKER)

  fixture.editor.plainText = ""
  expect(fixture.editor.placeholder).toBe(MARKER)

  if (typeof cleanup === "function") await cleanup()
})

test("dialogs and queued messages block the call", async () => {
  const fixture = createFixture()
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.permissions = [{ id: "perm_1" }]
  fixture.fire("session.status", idleEvent)
  await sleep(20)
  expect(fixture.sessionCreateCalls.length).toBe(0)

  fixture.permissions = []
  fixture.forms = [{ id: "form_1" }]
  fixture.fire("session.status", idleEvent)
  await sleep(20)
  expect(fixture.sessionCreateCalls.length).toBe(0)

  fixture.forms = []
  fixture.queued = [{ id: "msg_1" }]
  fixture.fire("session.status", idleEvent)
  await sleep(20)
  expect(fixture.sessionCreateCalls.length).toBe(0)

  fixture.queued = []
  fixture.fire("session.status", idleEvent)
  await waitFor(() => fixture.sessionCreateCalls.length === 1)

  if (typeof cleanup === "function") await cleanup()
})

test("shell mode does not block prediction; leaving it reveals the suggestion", async () => {
  const fixture = createFixture()
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.mode = "shell"
  fixture.fire("session.status", idleEvent)
  await waitFor(() => fixture.sessionCreateCalls.length === 1)
  await sleep(20)
  expect(fixture.editor.placeholder).toBeUndefined()

  fixture.mode = "base"
  fixture.fireRenderer("frame")
  expect(fixture.editor.placeholder).toBe(MARKER)

  if (typeof cleanup === "function") await cleanup()
})

test("typing while a prediction is in flight keeps the result for when the input is cleared", async () => {
  const fixture = createFixture()
  const pending = deferred<{ text: string }>()
  fixture.generate = () => pending.promise
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.status", idleEvent)
  await waitFor(() => fixture.sessionGenerateCalls.length === 1)

  fixture.editor.plainText = "typing"
  pending.resolve({ text: SUGGESTION })
  await waitFor(() => fixture.editor.placeholder === MARKER)
  expect(acceptCommand(fixture).enabled()).toBe(true)

  fixture.editor.plainText = ""
  expect(fixture.editor.placeholder).toBe(MARKER)
  await waitFor(() => fixture.sessionRemoveCalls.length === 1)

  if (typeof cleanup === "function") await cleanup()
})

test("a failed prediction is not retried", async () => {
  const fixture = createFixture()
  fixture.generate = async () => {
    throw new Error("transient")
  }
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.status", idleEvent)
  await waitFor(() => fixture.sessionGenerateCalls.length === 1)
  await sleep(900)

  expect(fixture.sessionGenerateCalls.length).toBe(1)
  expect(fixture.sessionCreateCalls.length).toBe(1)
  expect(fixture.editor.placeholder).toBeUndefined()

  // the failed turn is settled; a repeated idle event does not call again
  fixture.fire("session.status", idleEvent)
  await sleep(30)
  expect(fixture.sessionCreateCalls.length).toBe(1)

  if (typeof cleanup === "function") await cleanup()
})

test("unknown configured model → one error toast, no prediction call", async () => {
  const fixture = createFixture({ model: "acme/missing" })
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.status", idleEvent)
  await waitFor(() => fixture.toasts.length === 1)
  fixture.fire("session.status", idleEvent)
  await sleep(30)

  expect(fixture.sessionCreateCalls.length).toBe(0)
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
  await waitFor(() => fixture.editor.placeholder === MARKER)

  if (typeof cleanup === "function") await cleanup()
})

test("a configured next-prompt agent supplies the model and the prediction persona", async () => {
  const fixture = createFixture()
  fixture.agents = [
    { id: "title", model: { providerID: "acme", id: "lite" } },
    { id: "next-prompt", model: { providerID: "acme", id: "fast" } },
  ]
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.status", idleEvent)
  await waitFor(() => fixture.sessionCreateCalls.length === 1)

  expect(fixture.sessionCreateCalls[0]).toMatchObject({
    agent: "next-prompt",
    model: { providerID: "acme", id: "fast", variant: "low" },
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
  await waitFor(() => fixture.editor.placeholder === MARKER)

  // another session's revert must not touch our state
  fixture.fire("session.revert.committed", { sessionID: "ses_other", to: "msg_u1" })
  expect(fixture.editor.placeholder).toBe(MARKER)

  // our session's revert invalidates and clears the placeholder
  fixture.fire("session.revert.committed", { sessionID: SESSION_ID, to: "msg_u1" })
  expect(fixture.editor.placeholder).toBeNull()
  expect(acceptCommand(fixture).enabled()).toBe(false)

  if (typeof cleanup === "function") await cleanup()
})

test("shell mode keeps the command placeholder and restores the suggestion after leaving shell", async () => {
  const fixture = createFixture()
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.status", idleEvent)
  await waitFor(() => fixture.editor.placeholder === MARKER)

  // User presses `!` to enter shell mode; the prompt edits a command now
  fixture.mode = "shell"
  fixture.editor.placeholder = 'Run a command… "git status"'
  fixture.fireRenderer("frame")
  expect(fixture.editor.placeholder).toBe('Run a command… "git status"')
  expect(acceptCommand(fixture).enabled()).toBe(true)

  const command = acceptCommand(fixture)
  expect(command.run()).toBe(false)
  expect(fixture.editor.inserted).toEqual([])

  // leaving shell mode restores the suggestion on the next frame
  fixture.mode = "base"
  fixture.editor.placeholder = null
  fixture.fireRenderer("frame")
  expect(fixture.editor.placeholder).toBe(MARKER)

  if (typeof cleanup === "function") await cleanup()
})

test("TUI's own placeholder overwrite is restored on the next frame", async () => {
  const fixture = createFixture()
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.status", idleEvent)
  await waitFor(() => fixture.editor.placeholder === MARKER)

  // The TUI's placeholder memo overwrites ours (session switch / resize /
  // shell change) — the next frame must restore the marker.
  fixture.editor.placeholder = "Ask anything…"
  fixture.fireRenderer("frame")
  expect(fixture.editor.placeholder).toBe(MARKER)

  // Once idle, the host's own placeholder is restored, and frames leave it alone.
  fixture.fire("session.status", busyEvent)
  expect(fixture.editor.placeholder).toBe("Ask anything…")
  fixture.editor.placeholder = "Ask anything…"
  fixture.fireRenderer("frame")
  expect(fixture.editor.placeholder).toBe("Ask anything…")

  if (typeof cleanup === "function") await cleanup()
})

test("focus moving to a dialog preserves the suggestion; refocusing shows it", async () => {
  const fixture = createFixture()
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.status", idleEvent)
  await waitFor(() => fixture.editor.placeholder === MARKER)

  // focus moves to a single-line Input (dialog/form field): never receive it
  const input = makeSingleLineInput()
  fixture.focused = input
  fixture.fireRenderer("focused_editor", input, fixture.editor)
  fixture.fireRenderer("frame")

  expect(input.placeholder).toBeNull()
  expect(acceptCommand(fixture).enabled()).toBe(true)

  // focus returns to the prompt textarea → the suggestion is still there
  fixture.focused = fixture.editor
  fixture.fireRenderer("focused_editor", fixture.editor, input)
  expect(fixture.editor.placeholder).toBe(MARKER)

  if (typeof cleanup === "function") await cleanup()
})

test("accept inserts the text and invalidates the editor size", async () => {
  const fixture = createFixture()
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.status", idleEvent)
  await waitFor(() => fixture.editor.placeholder === MARKER)
  const command = acceptCommand(fixture)

  expect(command.run()).toBe(false)
  await sleep(10)
  expect(fixture.editor.invalidatedCount).toBe(1)

  if (typeof cleanup === "function") await cleanup()
})

test("regenerating a reply produces a fresh prediction", async () => {
  const fixture = createFixture()
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.status", idleEvent)
  await waitFor(() => fixture.editor.placeholder === MARKER)
  const before = fixture.sessionCreateCalls.length

  // A regenerated reply emits started → succeeded for the same user message.
  fixture.fire("session.execution.started", { sessionID: SESSION_ID })
  expect(fixture.editor.placeholder).toBeNull()
  fixture.fire("session.execution.succeeded", { sessionID: SESSION_ID })

  await waitFor(() => fixture.sessionCreateCalls.length === before + 1)
  await waitFor(() => fixture.editor.placeholder === MARKER)

  if (typeof cleanup === "function") await cleanup()
})

test("accept refuses a ready suggestion from another session", async () => {
  const fixture = createFixture()
  const cleanup = await plugin.setup(fixture.context)
  fixture.renderSlot()

  fixture.fire("session.status", idleEvent)
  await waitFor(() => fixture.editor.placeholder === MARKER)

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
  await waitFor(() => fixture.editor.placeholder === MARKER)
  const before = fixture.sessionCreateCalls.length

  fixture.fire("session.revert.staged", { sessionID: SESSION_ID, revert: {} })
  expect(fixture.editor.placeholder).toBeNull()
  fixture.fire("session.revert.cleared", { sessionID: SESSION_ID })

  await waitFor(() => fixture.sessionCreateCalls.length === before + 1)
  await waitFor(() => fixture.editor.placeholder === MARKER)

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
