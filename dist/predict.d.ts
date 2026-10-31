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
export type Predictor = {
    predict(sessionID: string, model: {
        providerID: string;
        id: string;
    } | undefined, prompt: string, variant?: string): Promise<PredictResult>;
    dispose(): Promise<void>;
};
/**
 * Prediction runs in a lightweight, tool-denied child helper session:
 * - `parentID` inherits the active session's exact `Location`, so project-scoped
 *   providers and models resolve (including workspaces).
 * - `permissions` deny every tool, stripping MCP tools, skills, and their
 *   instructions from the request context.
 * - `session.generate` writes no messages and emits no execution events.
 *
 * The helper is removed in the background. When the helper path fails (an older
 * host, a transient create error), predictions fall back to `session.generate`
 * on the active session and finally to the global `generate.text`; the timeout
 * budget is shared across attempts.
 */
export declare function createPredictor(client: OpenCodeClient, options: PredictOptions): Predictor;
