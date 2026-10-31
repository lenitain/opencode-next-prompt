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

test("collectConversation keeps the original goal and only the recent turns", () => {
  const messages = [user("u0", "the original goal")]
  for (let index = 0; index < 10; index += 1) {
    messages.push(user(`u${index + 1}`, `user ${index + 1}`))
    messages.push(text(`a${index + 1}`, `assistant ${index + 1}`))
  }

  const conversation = collectConversation(messages, false)
  expect(conversation.goal).toBe("the original goal")
  expect(conversation.turns).toHaveLength(8)
  expect(conversation.turns[0]?.text).toBe("user 7")
  expect(conversation.turns.at(-1)?.text).toBe("assistant 10")

  const prompt = buildPrompt(conversation)
  expect(prompt).toContain("<original-goal>the original goal</original-goal>")
  expect(prompt).toContain('<turn role="user">user 7</turn>')
  expect(prompt).not.toContain("user 1</turn>")
})

test("collectConversation omits a duplicate goal", () => {
  const messages = [user("u1", "goal")]
  for (let index = 0; index < 7; index += 1) messages.push(text(`a${index}`, `answer ${index}`))
  const conversation = collectConversation(messages, false)
  expect(conversation.turns).toHaveLength(8)
  expect(conversation.goal).toBeUndefined()
})

test("collectConversation summarizes only the recent tool parts", () => {
  const messages = [user("u1", "goal"), tool("tool-old", "bash", "completed", { command: "cat huge" }, "OLD OUTPUT")]
  for (let index = 0; index < 8; index += 1) messages.push(text(`a${index}`, `answer ${index}`))
  messages.push(tool("tool-new", "bash", "completed", { command: "ls -la" }, "recent output"))

  const withTools = collectConversation(messages, true)
  const withoutTools = collectConversation(messages, false)
  expect(withTools.goal).toBe("goal")
  expect(withTools.turns.at(-1)?.text).toContain("[tool:bash]")
  expect(withTools.turns.at(-1)?.text).toContain("recent output")
  expect(withTools.turns.join("\n")).not.toContain("OLD OUTPUT")
  expect(withoutTools.turns.join("\n")).not.toContain("[tool:")
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
  expect(parsePrediction("<think>reasoning</think>\nreal answer")).toBe("real answer")
  expect(parsePrediction("\u001b[31mred\u001b[0m\u0007 text")).toBe("red text")
  expect(parsePrediction("")).toBeNull()
})

test("parsePrediction truncates by code point rather than UTF-16 unit", () => {
  const text = "😀".repeat(200)
  const parsed = parsePrediction(text)
  expect(parsed).not.toBeNull()
  expect(Array.from(parsed ?? "")).toHaveLength(170)
  expect(parsed?.endsWith("…") ?? false).toBe(true)
  expect(parsed).not.toContain("\uFFFD")
})
