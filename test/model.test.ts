import { test, expect } from "bun:test"
import type { AgentInfo, LocationRef, ModelInfo, ModelRef, ProviderInfo } from "@opencode/client"
import type { Context } from "@opencode/plugin/tui/context"
import { parseSpec, resolvePredictionModel } from "../src/model.ts"

const providers: ProviderInfo[] = [{ id: "acme" } as unknown as ProviderInfo]

const models: ModelInfo[] = [
  {
    id: "fast",
    modelID: "fast-api",
    providerID: "acme",
    variants: [{ id: "high" }, { id: "low" }],
  } as unknown as ModelInfo,
  {
    id: "lite",
    modelID: "lite-api",
    providerID: "acme",
    variants: [{ id: "high" }, { id: "low" }, { id: "minimal" }],
  } as unknown as ModelInfo,
  {
    id: "canonical-id",
    modelID: "api-id",
    canonical: "canonical-slug",
    providerID: "acme",
    variants: [],
  } as unknown as ModelInfo,
]

function makeContext(
  input: {
    agents?: AgentInfo[]
    models?: ModelInfo[] | null
    providers?: ProviderInfo[] | null
  } = {},
): Context {
  const selectedModels = input.models === null ? undefined : (input.models ?? models)
  const selectedProviders = input.providers === null ? undefined : (input.providers ?? providers)
  return {
    data: {
      location: {
        agent: { list: () => input.agents ?? [] },
        model: { list: () => selectedModels },
        provider: { list: () => selectedProviders },
      },
    },
  } as unknown as Context
}

function resolve(input: {
  spec?: string
  variant?: string
  sessionModel?: ModelRef
  agents?: AgentInfo[]
  models?: ModelInfo[] | null
  providers?: ProviderInfo[] | null
}) {
  return resolvePredictionModel({
    spec: input.spec,
    variant: input.variant,
    sessionModel: input.sessionModel,
    context: makeContext(input),
    location: { directory: "/tmp" } as unknown as LocationRef,
  })
}

test("parseSpec accepts provider/model#variant and bare ids", () => {
  expect(parseSpec("acme/fast#low")).toEqual({ providerID: "acme", id: "fast", variant: "low" })
  expect(parseSpec("acme/fast")).toEqual({ providerID: "acme", id: "fast", variant: undefined })
  expect(parseSpec("fast")).toEqual({ id: "fast", variant: undefined })
  expect(parseSpec("acme/")).toEqual({ id: "acme/" })
})

test("options.model resolves a configured model and picks the lowest variant", () => {
  const resolution = resolve({ spec: "acme/lite" })
  expect(resolution.issue).toBeUndefined()
  expect(resolution.model).toEqual({
    providerID: "acme",
    id: "lite",
    variant: "minimal",
    source: "options",
    model: models[1],
  })
})

test("a bare model id uses the session provider, or a unique provider", () => {
  expect(resolve({ spec: "lite", sessionModel: { providerID: "acme", id: "fast" } }).model).toMatchObject({
    providerID: "acme",
    id: "lite",
    variant: "minimal",
  })

  expect(resolve({ spec: "lite" }).model).toMatchObject({ providerID: "acme", id: "lite" })
})

test("options.model accepts modelID and canonical slugs and returns the canonical id", () => {
  expect(resolve({ spec: "acme/api-id" }).model).toMatchObject({ providerID: "acme", id: "canonical-id" })
  expect(resolve({ spec: "acme/canonical-slug" }).model).toMatchObject({ providerID: "acme", id: "canonical-id" })
})

test("options.model reports unknown models, providers, and variants", () => {
  expect(resolve({ spec: "acme/missing" }).issue).toContain('model "missing" not found')
  expect(resolve({ spec: "other/fast" }).issue).toContain('provider "other" not found')
  expect(resolve({ spec: "acme/fast#ultra" }).issue).toContain('variant "ultra" not found')
})

test("variant option overrides the spec and 'default' disables automatic variants", () => {
  expect(resolve({ spec: "acme/fast#low", variant: "high" }).model).toMatchObject({ variant: "high" })
  expect(resolve({ spec: "acme/fast#low", variant: "default" }).model?.variant).toBeUndefined()
  expect(resolve({ spec: "acme/fast", variant: "default" }).model?.variant).toBeUndefined()
})

test("next-prompt agent model takes precedence over the title model", () => {
  const agents = [
    { id: "title", model: { providerID: "acme", id: "lite" } },
    { id: "next-prompt", model: { providerID: "acme", id: "fast" } },
  ] as unknown as AgentInfo[]
  expect(resolve({ agents }).model).toMatchObject({ id: "fast", variant: "low", source: "agent:next-prompt" })
})

test("title model falls back to the session model with a warning", () => {
  const agents = [{ id: "title", model: { providerID: "acme", id: "missing" } }] as unknown as AgentInfo[]
  const resolution = resolve({ agents, sessionModel: { providerID: "acme", id: "fast" } })
  expect(resolution.model).toMatchObject({ id: "fast", source: "session", variant: "low" })
  expect(resolution.issue).toBeUndefined()
  expect(resolution.warning).toContain("using the session model (acme/fast)")
})

test("a next-prompt model with an invalid variant is an error rather than a fallback", () => {
  const agents = [
    { id: "next-prompt", model: { providerID: "acme", id: "fast", variant: "ultra" } },
  ] as unknown as AgentInfo[]
  expect(resolve({ agents }).issue).toContain('variant "ultra" not found')
})

test("no configuration falls back to the session model without an error", () => {
  expect(resolve({ sessionModel: { providerID: "acme", id: "fast" } }).model).toMatchObject({
    id: "fast",
    source: "session",
    variant: "low",
  })
  expect(resolve({}).model).toBeUndefined()
})

test("model lists that are not synced do not block an explicit model", () => {
  const resolution = resolve({ spec: "acme/fast", models: null })
  expect(resolution.issue).toBeUndefined()
  expect(resolution.model).toMatchObject({ providerID: "acme", id: "fast" })
})
