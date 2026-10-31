import { test, expect } from "bun:test"
import { DEFAULT_OPTIONS, normalizeOptions } from "../src/options.ts"

test("normalizeOptions returns defaults for empty input", () => {
  const { options, warnings } = normalizeOptions({})
  expect(options).toEqual(DEFAULT_OPTIONS)
  expect(warnings).toEqual([])
})

test("normalizeOptions trims strings and accepts valid values", () => {
  const { options, warnings } = normalizeOptions({
    acceptKey: " ctrl+n ",
    timeoutMs: 5_000,
    model: " acme/fast ",
    variant: " high ",
    includeToolContext: true,
  })
  expect(options).toEqual({
    acceptKey: "ctrl+n",
    timeoutMs: 5_000,
    model: "acme/fast",
    variant: "high",
    includeToolContext: true,
  })
  expect(warnings).toEqual([])
})

test("normalizeOptions rejects values that would break setup", () => {
  const { options, warnings } = normalizeOptions({
    acceptKey: null,
    timeoutMs: 0,
    model: 42,
    variant: "",
    includeToolContext: "false",
  })
  expect(options).toEqual(DEFAULT_OPTIONS)
  expect(warnings).toHaveLength(4)
  expect(warnings.join("\n")).toContain("acceptKey")
  expect(warnings.join("\n")).toContain("timeoutMs")
  expect(warnings.join("\n")).toContain("includeToolContext")
})

test("normalizeOptions rejects non-key accept values", () => {
  const { options, warnings } = normalizeOptions({ acceptKey: "none" })
  expect(options.acceptKey).toBe("right")
  expect(warnings).toHaveLength(1)
})
