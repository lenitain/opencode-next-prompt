import { debug } from "./debug.js";
const PROMPT = `You are the user in a conversation with an AI coding assistant. The
assistant just finished replying to your latest message.

Write your next message — your natural reaction to what you just read.
Address the assistant directly: a request, a question, or an instruction
(the assistant acts; you never describe doing things yourself). React to
what was said, not to how it was said. One line, natural and brief, in
your language and tone.
Do not call any tools and do not take any actions. Reply with plain text only.

If nothing plausible remains to say, reply with exactly: NO_SUGGESTION

Conversation (oldest first):
`;
const MAX_PREDICTION_CHARS = 170;
const MAX_TURNS = 8;
const MAX_TURN_CHARS = 800;
const TITLE = "next-prompt-suggestion";
const DENY_ALL_TOOLS = [{ action: "*", resource: "*", effect: "deny" }];
const CLEANUP_TIMEOUT_MS = 5_000;
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
export function createPredictor(client, options) {
    let activeHelperSessionID;
    const removeHelperSession = async (id) => {
        if (!id)
            return;
        if (activeHelperSessionID === id)
            activeHelperSessionID = undefined;
        if (typeof client.session?.remove !== "function")
            return;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), CLEANUP_TIMEOUT_MS);
        try {
            await client.session.remove({ sessionID: id }, { signal: controller.signal }).catch(() => { });
        }
        finally {
            clearTimeout(timer);
        }
    };
    return {
        async predict(sessionID, model, turns, variant) {
            if (turns.length === 0)
                return { ok: true, text: null };
            const prompt = PROMPT + renderConversation(turns);
            const spec = model
                ? { providerID: model.providerID, id: model.id, ...(variant ? { variant } : {}) }
                : undefined;
            const deadline = Date.now() + options.timeoutMs;
            const runWithTimeout = async (call) => {
                const remaining = deadline - Date.now();
                if (remaining <= 0)
                    return { ok: false };
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), remaining);
                try {
                    const result = await call(controller.signal);
                    return { ok: true, text: parsePrediction(result.text) };
                }
                finally {
                    clearTimeout(timer);
                }
            };
            const hasSessionCreate = typeof client.session?.create === "function";
            const hasSessionGenerate = typeof client.session?.generate === "function";
            const hasGenerateText = typeof client.generate?.text === "function";
            if (hasSessionCreate && hasSessionGenerate) {
                try {
                    return await runWithTimeout(async (signal) => {
                        const created = await client.session.create({
                            parentID: sessionID,
                            title: TITLE,
                            ...(spec ? { model: spec } : {}),
                            permissions: DENY_ALL_TOOLS,
                        }, { signal });
                        activeHelperSessionID = created.id;
                        try {
                            return await client.session.generate({ sessionID: created.id, prompt }, { signal });
                        }
                        finally {
                            void removeHelperSession(created.id);
                        }
                    });
                }
                catch (error) {
                    debug("helper session.generate failed", errorMessage(error));
                    return { ok: false };
                }
            }
            if (spec && hasGenerateText) {
                try {
                    return await runWithTimeout((signal) => client.generate.text({ prompt, model: spec }, { signal }));
                }
                catch (error) {
                    if (hasSessionGenerate) {
                        debug("generate.text with model failed, falling back to session.generate", errorMessage(error));
                    }
                    else {
                        debug("generate with model failed, retrying with server default", errorMessage(error));
                    }
                }
            }
            if (hasSessionGenerate) {
                try {
                    return await runWithTimeout((signal) => client.session.generate({ sessionID, prompt }, { signal }));
                }
                catch (error) {
                    debug("session.generate failed", errorMessage(error));
                    return { ok: false };
                }
            }
            if (hasGenerateText) {
                try {
                    return await runWithTimeout((signal) => client.generate.text({ prompt }, { signal }));
                }
                catch (error) {
                    debug("generate failed", errorMessage(error));
                    return { ok: false };
                }
            }
            debug("no generation endpoint available on client");
            return { ok: false };
        },
        async dispose() {
            await removeHelperSession(activeHelperSessionID);
        },
    };
}
function errorMessage(error) {
    if (error instanceof Error)
        return error.message;
    if (typeof error === "string")
        return error;
    if (error && typeof error === "object") {
        const candidate = error.message;
        if (typeof candidate === "string")
            return candidate;
        try {
            return JSON.stringify(error);
        }
        catch {
            return String(error);
        }
    }
    return String(error);
}
function renderConversation(turns) {
    if (turns.length === 0)
        return "";
    const recent = turns.slice(-MAX_TURNS);
    const lines = recent.map((turn) => `${turn.role}: ${truncate(turn.text, MAX_TURN_CHARS)}`);
    const first = turns[0];
    if (turns.length > MAX_TURNS && first?.role === "user" && first.id !== recent[0]?.id) {
        lines.unshift(`user: [original goal] ${truncate(first.text, MAX_TURN_CHARS)}`);
    }
    return lines.join("\n");
}
function truncate(text, max) {
    return text.length > max ? text.slice(0, max - 1) + "…" : text;
}
function parsePrediction(raw) {
    const line = raw
        .replace(/<\/?think>[\s\S]*?<\/think>\s*/g, "")
        .split("\n")
        .map((item) => item.trim())
        .find((item) => item.length > 0);
    if (!line)
        return null;
    const text = line.replace(/^["'`]+|["'`]+$/g, "");
    if (!text)
        return null;
    const tag = text.toUpperCase().replace(/[\s-]+/g, "_").replace(/[^A-Z_]/g, "");
    if (tag === "NO_SUGGESTION")
        return null;
    return text.length > MAX_PREDICTION_CHARS ? text.slice(0, MAX_PREDICTION_CHARS - 3) + "..." : text;
}
