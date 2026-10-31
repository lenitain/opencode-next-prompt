import type { LocationRef, ModelInfo, ModelRef } from "@opencode/client";
import type { Context } from "@opencode/plugin/tui/context";
export type ModelSource = "options" | "agent:next-prompt" | "agent:title" | "session";
export type ResolvedModel = {
    providerID: string;
    id: string;
    variant?: string;
    source: ModelSource;
    model?: ModelInfo;
};
export type ModelResolution = {
    model: ResolvedModel | undefined;
    /** A configuration error: predictions must not run with a guessed model. */
    issue?: string;
    /** A recoverable problem, e.g. an invalid title model falling back to the session model. */
    warning?: string;
};
export declare const NEXT_PROMPT_AGENT_IDS: readonly ["next-prompt", "next_prompt"];
type ParsedSpec = {
    providerID?: string;
    id: string;
    variant?: string;
};
/**
 * Resolve the model used for a prediction. Every configured model (options,
 * next-prompt agent, title agent) is validated before use; an invalid title
 * model falls back to the session model with a warning instead of silently
 * breaking predictions.
 */
export declare function resolvePredictionModel(input: {
    spec: string | undefined;
    variant: string | undefined;
    sessionModel: ModelRef | undefined;
    context: Context;
    location?: LocationRef;
}): ModelResolution;
export declare function parseSpec(spec: string): ParsedSpec;
export {};
