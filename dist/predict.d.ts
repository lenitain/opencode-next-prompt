import type { OpenCodeClient } from "@opencode/client";
export type ConversationTurn = {
    id: string;
    role: "user" | "assistant";
    text: string;
};
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
    } | undefined, turns: ConversationTurn[], variant?: string): Promise<PredictResult>;
    dispose(): Promise<void>;
};
/**
 * Prediction runs through a lightweight, tool-denied child helper session using
 * `session.generate` (`POST /api/session/:sessionID/generate`):
 * - `parentID` inherits the active session's exact `Location`, so project-scoped
 *   providers and models in `opencode.jsonc` resolve (including workspaces).
 * - `permissions: [{ action: "*", resource: "*", effect: "deny" }]` strips all MCP tools,
 *   skills, and MCP instructions from the request context.
 * - `model: spec` applies the resolved fast/small model (e.g. `agents["next-prompt"].model`
 *   or `agents.title.model`) and minimal/low reasoning variant.
 * - `session.generate` writes no messages and emits no execution events; the empty
 *   helper session is removed in the background after the call completes.
 */
export declare function createPredictor(client: OpenCodeClient, options: PredictOptions): Predictor;
