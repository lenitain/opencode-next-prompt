import { test, expect } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client"
import { buildPrompt, collectConversation, lastTurnKey, parsePrediction } from "../src/conversation.ts"

function user(id: string, text: string): SessionMessageInfo {
  return { id, type: "user", text, time: { created: 0 } } as unknown as SessionMessageInfo
}

function assistant(id: string, content: unknown[]): SessionMessageInfo {
  return { id, type: "assistant", content, time: { created: 0 } } as unknown as SessionMessageInfo
}

function text(id: string, value: string) {
  return assistant(id, [{ type: "text", text: value }])
}

function tool(id: string, name: string, status: string, input: unknown, output?: string) {
  return assistant(id, [
    {
      type: "tool",
      name,
      state: {
        status,
        input,
        content: output ? [{ type: "text", text: output }] : undefined,
      },
    },
  ])
}

test("collectConversation keeps the latest exchange, trimming older turns", () => {
  const messages = [user("u0", "an old topic")]
  for (let index = 1; index <= 10; index += 1) {
    messages.push(user(`u${index}`, `user ${index}`))
    messages.push(text(`a${index}`, `assistant ${index}`))
  }

  const conversation = collectConversation(messages, false)
  expect(conversation.turns).toHaveLength(8)
  expect(conversation.turns[0]?.text).toBe("user 7")
  expect(conversation.turns.at(-1)?.text).toBe("assistant 10")

  const prompt = buildPrompt(conversation)
  expect(prompt).not.toContain("session-origin")
  expect(prompt).toContain('<turn role="user">user 7</turn>')
  expect(prompt).toContain('<turn role="assistant" latest="true">assistant 10</turn>')
  expect(prompt).not.toContain("user 1</turn>")
})

test("collectConversation keeps a short exchange intact", () => {
  const messages = [user("u1", "goal"), text("a1", "one"), user("u2", "next"), text("a2", "two")]
  const conversation = collectConversation(messages, false)
  expect(conversation.turns).toHaveLength(4)
  expect(conversation.turns[0]?.text).toBe("goal")
})

test("the latest assistant reply always keeps its ending question", () => {
  const long = `${"分析过程。".repeat(600)}\n\n要我先跑测试，还是直接提交？`
  const conversation = collectConversation([user("u1", "fix the login"), text("a1", long)], false)
  expect(conversation.turns.at(-1)?.text).toContain("要我先跑测试，还是直接提交？")

  const prompt = buildPrompt(conversation)
  expect(prompt).toContain("要我先跑测试，还是直接提交？")
})

test("older assistant turns keep only their last prose paragraph", () => {
  const messages = [
    user("u1", "goal"),
    text("a1", "第一段分析\n\n第二段分析\n\n第三段结论"),
    user("u2", "next"),
    text("a2", "latest"),
  ]
  const prompt = buildPrompt(collectConversation(messages, false))
  expect(prompt).toContain("第三段结论")
  expect(prompt).not.toContain("第一段分析")
  expect(prompt).toContain("latest")
})

test("code blocks are collapsed so prose keeps the budget", () => {
  const messages = [
    user("u1", "fix it"),
    text("a1", "改好了：\n\n```ts\nconst a = 1\nconst b = 2\n```\n\n要跑测试吗？"),
  ]
  const prompt = buildPrompt(collectConversation(messages, false))
  expect(prompt).toContain("[code: 2 lines, ts]")
  expect(prompt).not.toContain("const a = 1")
  expect(prompt).toContain("要跑测试吗？")
})

test("the last completed tool is a fact, with detail only when requested", () => {
  const messages = [
    user("u1", "goal"),
    tool("t1", "bash", "completed", { command: "bun test" }, "pass"),
    text("a1", "done"),
  ]

  const bare = buildPrompt(collectConversation(messages, false))
  expect(bare).toContain('<last-tool name="bash" status="completed"/>')
  expect(bare).not.toContain("bun test")

  const detailed = buildPrompt(collectConversation(messages, true))
  expect(detailed).toContain('<last-tool name="bash" status="completed">')
  expect(detailed).toContain("bun test")
  expect(detailed).toContain("pass")
})

test("a failed tool is reported as an error fact", () => {
  const messages = [
    user("u1", "goal"),
    tool("t1", "bash", "error", { command: "bun test" }, "FAIL"),
    text("a1", "the tests fail"),
  ]
  expect(buildPrompt(collectConversation(messages, false))).toContain('name="bash" status="error"')
})

test("collectConversation strips reasoning, escapes XML, and tolerates legacy think tags", () => {
  const messages = [
    user("u1", "fix <login>"),
    assistant("a1", [
      { type: "text", text: "<think>secret</think>done & dusted" },
      { type: "reasoning", text: "hidden reasoning" },
    ]),
  ]
  const conversation = collectConversation(messages, false)
  const prompt = buildPrompt(conversation)
  expect(prompt).toContain('<turn role="user">fix &lt;login&gt;</turn>')
  expect(prompt).toContain("done &amp; dusted")
  expect(prompt).not.toContain("secret")
  expect(prompt).not.toContain("hidden reasoning")
})

test("lastTurnKey changes with the assistant reply and with a new user message", () => {
  expect(lastTurnKey([user("u1", "hi"), text("a1", "hello")])).toBe("u1:a1")
  expect(lastTurnKey([user("u1", "hi"), text("a1", "hello"), text("a2", "again")])).toBe("u1:a2")
  expect(lastTurnKey([user("u1", "hi"), text("a1", "hello"), user("u2", "next")])).toBe("u2:")
  expect(lastTurnKey([text("a1", "orphan")])).toBeUndefined()
})

test("parsePrediction returns one clean line and rejects NO_SUGGESTION", () => {
  expect(parsePrediction("Suggestion: 跑一下测试")).toBe("跑一下测试")
  expect(parsePrediction("- `修复它`")).toBe("修复它")
  expect(parsePrediction("Here is a suggestion:\nnext line")).toBe("next line")
  expect(parsePrediction("NO_SUGGESTION")).toBeNull()
  expect(parsePrediction("no suggestion.")).toBeNull()
  expect(parsePrediction("NO_SUGGESTION because the reply is complete")).toBeNull()
  expect(parsePrediction("<think>reasoning</think>\nreal answer")).toBe("real answer")
  expect(parsePrediction("\u001b[31mred\u001b[0m\u0007 text")).toBe("red text")
  expect(parsePrediction("")).toBeNull()
})

test("parsePrediction cuts at a clause boundary and refuses a fragment", () => {
  const clause = `${"a".repeat(160)}。${"b".repeat(20)}`
  const parsed = parsePrediction(clause)
  expect(parsed).toBe(`${"a".repeat(160)}。`)

  expect(parsePrediction("x".repeat(200))).toBeNull()
  expect(parsePrediction("😀".repeat(200))).toBeNull()
})
