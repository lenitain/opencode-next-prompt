import type { OpenCodeClient } from "@opencode/client";
export type PredictOptions = {
    timeoutMs: number;
};
export type PredictResult = {
    ok: true;
    text: string | null;
} | {
    ok: false;
};
export type PredictRequest = {
    sessionID: string;
    prompt: string;
    /** Agent that supplies the prediction persona, when one is configured. */
    agent?: string;
    model?: {
        providerID: string;
        id: string;
        variant?: string;
    };
};
export type Predictor = {
    predict(request: PredictRequest): Promise<PredictResult>;
    dispose(): Promise<void>;
};
/**
 * One prediction is one call, in a disposable helper session:
 *
 * - `parentID` inherits the active session's exact location, so project-scoped
 *   providers and models resolve; the explicit model is passed for the
 *   configured override.
 * - `permissions` deny every tool, stripping MCP tools, skills, and their
 *   instructions from the request context.
 * - `session.generate` writes no messages, emits no execution events, and does
 *   not touch the main conversation.
 * - A configured `next-prompt` agent supplies the prediction persona instead of
 *   the coding agent's inherited prompt.
 *
 * The helper is removed after the call, including when the request times out
 * and the create resolves late. There is no second attempt: a suggestion that
 * misses the decision point is worthless.
 */
export declare function createPredictor(client: OpenCodeClient, options: PredictOptions): Predictor;
