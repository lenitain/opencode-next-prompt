import { Plugin } from "@opencode/plugin/tui";
import { createSuggestionStore } from "./state.js";
import { createPredictor } from "./predict.js";
import { createPlaceholderController, isShellPlaceholder } from "./ui.js";
import { asPromptTextarea } from "./editor.js";
import { debug } from "./debug.js";
const DEFAULT_OPTIONS = {
    acceptKey: "right",
    timeoutMs: 20_000,
    includeToolContext: false,
};
const RETRY_DELAY_MS = 800;
const THINK_TAG = /<\/?think>[\s\S]*?<\/think>\s*/g;
const opencodeNextPrompt = Plugin.define({
    id: "opencode-next-prompt",
    setup(context) {
        const options = { ...DEFAULT_OPTIONS, ...context.options };
        const store = createSuggestionStore();
        // The controller gates on the session the prompt is editing; the router
        // always reports the focused session (per-tab footers cannot diverge
        // from it), and predictions commit against the same source.
        const placeholder = createPlaceholderController(context, store, () => currentSessionID(), options.acceptKey);
        let disposed = false;
        const currentSessionID = () => {
            const route = context.ui.router.current();
            if (route.type !== "session")
                return undefined;
            return route.sessionID;
        };
        const promptInputIsEmpty = () => {
            const editor = asPromptTextarea(context.renderer.currentFocusedEditor);
            return editor !== null && editor.plainText === "" && !isShellPlaceholder(editor.placeholder);
        };
        const conversationTurns = (sessionID) => {
            const result = [];
            for (const message of context.data.session.message.list(sessionID)) {
                if (message.type === "user") {
                    const text = message.text.replace(THINK_TAG, "").trim();
                    if (text)
                        result.push({ id: message.id, role: "user", text });
                    continue;
                }
                if (message.type !== "assistant")
                    continue;
                const text = message.content
                    .map((part) => {
                    if (part.type === "text")
                        return part.text.replace(THINK_TAG, "");
                    return options.includeToolContext ? summarizeToolPart(part) : "";
                })
                    .join("\n")
                    .trim();
                if (text)
                    result.push({ id: message.id, role: "assistant", text });
            }
            return result;
        };
        const lastUserMessageID = (sessionID) => {
            for (const message of context.data.session.message.list(sessionID).toReversed()) {
                if (message.type === "user")
                    return message.id;
            }
            return undefined;
        };
        let activeSessionID = currentSessionID();
        let inFlightUserMessageID;
        let completedUserMessageID;
        let retriedUserMessageID;
        let reportedModelIssue;
        const predictor = createPredictor(context.client, {
            timeoutMs: options.timeoutMs,
        });
        const syncActiveSession = () => {
            const current = currentSessionID();
            if (current !== activeSessionID) {
                activeSessionID = current;
                invalidate();
            }
            return current;
        };
        const maybePredict = async () => {
            if (disposed)
                return;
            const sessionID = syncActiveSession();
            if (!sessionID) {
                debug("skip", "no session route");
                return;
            }
            const status = context.data.session.status(sessionID);
            if (status !== "idle") {
                debug("skip", { status });
                return;
            }
            const userMessageID = lastUserMessageID(sessionID);
            if (!userMessageID) {
                debug("skip", "no user message");
                return;
            }
            if (userMessageID === completedUserMessageID || userMessageID === inFlightUserMessageID) {
                debug("skip", "message already handled");
                return;
            }
            const session = context.data.session.get(sessionID);
            const location = session?.location ?? context.location;
            const modelRef = resolveModelRef(options.model, session?.model, context, location);
            const modelIssue = checkModelConfig(modelRef, context, location);
            if (modelIssue) {
                if (reportedModelIssue !== modelIssue) {
                    reportedModelIssue = modelIssue;
                    debug("prediction skipped", modelIssue);
                    context.ui.toast.show({ variant: "error", title: "next-prompt", message: modelIssue, duration: 8000 });
                }
                return;
            }
            const turns = conversationTurns(sessionID);
            if (turns.length === 0) {
                debug("skip", "no conversation turns");
                return;
            }
            const generation = store.beginPredict(sessionID);
            if (generation === null) {
                debug("skip", "store busy");
                return;
            }
            inFlightUserMessageID = userMessageID;
            const variant = resolveVariant(options.variant, modelRef);
            const selectedModel = modelRef ? { providerID: modelRef.providerID, id: modelRef.id } : session?.model;
            try {
                debug("predicting", { sessionID, model: selectedModel, variant, source: modelRef?.source });
                const result = await predictor.predict(sessionID, selectedModel, turns, variant);
                if (inFlightUserMessageID !== userMessageID)
                    return;
                debug("predict result", { ok: result.ok, length: result.ok ? (result.text?.length ?? 0) : -1 });
                if (result.ok) {
                    completedUserMessageID = userMessageID;
                    store.commit(generation, sessionID, result.text);
                }
                else {
                    store.discard();
                    scheduleRetry(userMessageID);
                }
            }
            catch (error) {
                debug("prediction failed", errorMessage(error));
                if (inFlightUserMessageID !== userMessageID)
                    return;
                store.discard();
                scheduleRetry(userMessageID);
            }
            finally {
                if (inFlightUserMessageID === userMessageID)
                    inFlightUserMessageID = undefined;
            }
        };
        const scheduleRetry = (userMessageID) => {
            if (retriedUserMessageID === userMessageID)
                return;
            retriedUserMessageID = userMessageID;
            setTimeout(() => void maybePredict(), RETRY_DELAY_MS);
        };
        const invalidate = () => {
            store.discard();
            inFlightUserMessageID = undefined;
            completedUserMessageID = undefined;
            retriedUserMessageID = undefined;
            void predictor.dispose();
        };
        const accept = () => {
            const current = store.read();
            if (current.kind !== "ready")
                return;
            const editor = asPromptTextarea(context.renderer.currentFocusedEditor);
            if (!editor)
                return;
            // Same insertion path the host uses for the `tui.prompt.append` event.
            editor.insertText(current.text);
            setTimeout(() => {
                if (editor.isDestroyed)
                    return;
                // OpenTUI 0.6+ removed getLayoutNode() in favor of invalidateIntrinsicSize();
                // fall back to getLayoutNode().markDirty() for OpenCode 2.0.x (OpenTUI 0.5).
                if (typeof editor.invalidateIntrinsicSize === "function") {
                    editor.invalidateIntrinsicSize();
                }
                else {
                    editor.getLayoutNode?.().markDirty();
                }
                editor.gotoBufferEnd();
                context.renderer.requestRender();
            }, 0);
        };
        const unsubscribers = [];
        unsubscribers.push(context.data.on("session.status", (event) => {
            if (event.data.sessionID !== syncActiveSession())
                return;
            const type = event.data.status.type;
            debug("session.status event", { type });
            if (type === "busy") {
                store.discard();
            }
            else if (type === "idle") {
                if (store.read().kind === "idle")
                    void maybePredict();
            }
        }));
        // V2 delivery guarantee: feature-plugins subscribe to execution events,
        // while session.status appears not to reach clients at all. Mirrors the
        // V1 busy/idle pair: started ≈ busy (user submitted), ended ≈ idle.
        unsubscribers.push(context.data.on("session.execution.started", (event) => {
            if (event.data.sessionID !== syncActiveSession())
                return;
            debug("execution started");
            store.discard();
        }));
        for (const type of ["session.execution.succeeded", "session.execution.interrupted"]) {
            unsubscribers.push(context.data.on(type, (event) => {
                if (event.data.sessionID !== syncActiveSession())
                    return;
                debug(type);
                if (store.read().kind === "idle")
                    void maybePredict();
            }));
        }
        // Diagnostic: what actually streams. Logs status/execution events plus a
        // capped sample of distinct event types.
        const seenEventTypes = new Set();
        unsubscribers.push(context.data.listen(({ details }) => {
            const type = details.type;
            if (/^session\.(status|execution|idle|error)/.test(type)) {
                debug("event", type);
                return;
            }
            if (seenEventTypes.size < 40 && !seenEventTypes.has(type)) {
                seenEventTypes.add(type);
                debug("event(first-seen)", type);
            }
        }));
        unsubscribers.push(context.data.on("tui.session.select", () => {
            activeSessionID = currentSessionID();
            invalidate();
        }));
        // V1's message.removed / message.part.removed: history changed under us.
        unsubscribers.push(context.data.on("session.revert.committed", (event) => {
            if (event.data.sessionID === currentSessionID())
                invalidate();
        }));
        unsubscribers.push(context.data.on("session.deleted", (event) => {
            if (event.data.sessionID === currentSessionID())
                invalidate();
        }));
        // The accept command itself; registered from the app slot render below
        // (keymap layers need a live solid owner — see the slot comment).
        const acceptLayer = () => ({
            priority: 1000,
            commands: [
                {
                    id: "opencode-next-prompt.accept",
                    title: "Accept next-prompt suggestion",
                    group: "next-prompt",
                    enabled: () => store.read().kind === "ready",
                    bind: options.acceptKey,
                    run: () => {
                        debug("accept key", { kind: store.read().kind, empty: promptInputIsEmpty() });
                        if (promptInputIsEmpty())
                            accept();
                        // Keep the default key behavior (cursor movement), like V1's fallthrough.
                        return false;
                    },
                },
            ],
        });
        placeholder.start();
        // `context.keymap.layer` resolves through useContext, so it needs an
        // active solid owner under the host's Keymap.Provider. Plugin setup runs
        // outside the component tree (an async reconciliation, owner already
        // dropped), where it would throw "Keymap.Provider is missing" — a slot
        // render runs as a component inside the tree instead. The `app` slot is
        // the mount the built-in /btw plugin uses for its layers: always mounted,
        // exactly one instance, alive for the whole TUI session — so per-tab
        // prompt footers can never duplicate the command registration, and
        // plugin deactivation (disposeSlot → unmount) releases it via the
        // component's own cleanup.
        const disposeSlot = context.ui.slot({
            append: "app",
            render: () => {
                context.keymap.layer(acceptLayer);
                debug("keymap layer registered");
                return null;
            },
        });
        return () => {
            disposed = true;
            for (const off of unsubscribers)
                off();
            placeholder.dispose();
            disposeSlot();
            store.discard();
            void predictor.dispose();
        };
    },
});
const NEXT_PROMPT_AGENT_IDS = ["next-prompt", "next_prompt"];
function findConfiguredAgentModel(context, location) {
    const agents = context.data.location.agent?.list(location);
    if (!agents)
        return undefined;
    for (const id of NEXT_PROMPT_AGENT_IDS) {
        const match = agents.find((agent) => agent.id === id && agent.model !== undefined);
        if (match?.model)
            return { model: match.model, source: "agent:next-prompt", explicit: true };
    }
    const titleAgent = agents.find((agent) => agent.id === "title" && agent.model !== undefined);
    if (titleAgent?.model)
        return { model: titleAgent.model, source: "agent:title", explicit: false };
    return undefined;
}
function parseSpec(spec) {
    const hash = spec.indexOf("#");
    const base = hash >= 0 ? spec.slice(0, hash) : spec;
    const variant = hash >= 0 && hash < spec.length - 1 ? spec.slice(hash + 1) : undefined;
    const slash = base.indexOf("/");
    if (slash > 0 && slash < base.length - 1) {
        return { providerID: base.slice(0, slash), id: base.slice(slash + 1), variant };
    }
    return { id: base, variant };
}
function resolveModelRef(spec, sessionModel, context, location) {
    if (spec) {
        const parsed = parseSpec(spec);
        const providerID = parsed.providerID ??
            sessionModel?.providerID ??
            findConfiguredAgentModel(context, location)?.model.providerID;
        if (!providerID || !parsed.id)
            return undefined;
        return {
            providerID,
            id: parsed.id,
            variant: parsed.variant,
            explicit: true,
            source: "options",
            model: findModel(context, providerID, parsed.id, location),
        };
    }
    const agentConfig = findConfiguredAgentModel(context, location);
    if (agentConfig) {
        const { providerID, id, variant } = agentConfig.model;
        return {
            providerID,
            id,
            variant,
            explicit: agentConfig.explicit,
            source: agentConfig.source,
            model: findModel(context, providerID, id, location),
        };
    }
    const providerID = sessionModel?.providerID;
    const modelID = sessionModel?.id;
    if (!providerID || !modelID)
        return undefined;
    return {
        providerID,
        id: modelID,
        explicit: false,
        source: "session",
        model: findModel(context, providerID, modelID, location),
    };
}
function findModel(context, providerID, id, location) {
    return context.data.location.model
        .list(location)
        ?.find((item) => item.providerID === providerID && (item.id ?? item.modelID) === id);
}
function checkModelConfig(ref, context, location) {
    if (!ref?.explicit)
        return undefined;
    const providers = context.data.location.provider.list(location);
    if (providers && !providers.some((item) => item.id === ref.providerID)) {
        const available = providers.map((item) => item.id).join(", ");
        return `model config error: provider "${ref.providerID}" not found${available ? ` (available providers: ${available})` : ""}`;
    }
    const models = context.data.location.model.list(location);
    if (models && !models.some((item) => item.providerID === ref.providerID && (item.id ?? item.modelID) === ref.id)) {
        const available = models
            .filter((item) => item.providerID === ref.providerID)
            .map((item) => item.id ?? item.modelID)
            .slice(0, 10)
            .join(", ");
        const count = models.filter((item) => item.providerID === ref.providerID).length;
        return `model config error: model "${ref.id}" not found on provider "${ref.providerID}"${available ? ` (available models: ${available}${count > 10 ? ", ..." : ""})` : ""}`;
    }
    return undefined;
}
const VARIANT_ORDER = ["none", "minimal", "min", "low", "medium", "high", "xhigh", "max"];
function resolveVariant(configVariant, ref) {
    if (configVariant === "default")
        return undefined;
    if (configVariant)
        return configVariant;
    if (ref?.variant)
        return ref.variant;
    const variants = ref?.model?.variants;
    if (!variants || variants.length === 0)
        return undefined;
    const names = variants.map((item) => item.id);
    return names.toSorted((a, b) => variantRank(a) - variantRank(b))[0];
}
function variantRank(name) {
    const index = VARIANT_ORDER.indexOf(name.toLowerCase());
    return index === -1 ? VARIANT_ORDER.length : index;
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
    }
    try {
        return JSON.stringify(error);
    }
    catch {
        return String(error);
    }
}
const TOOL_SUMMARY_CHARS = 150;
function summarizeToolPart(part) {
    const tool = part;
    if (tool.type !== "tool" || !tool.state || tool.state.status === "running" || tool.state.status === "streaming")
        return "";
    const input = JSON.stringify(tool.state.input ?? {});
    const output = tool.state.metadata?.output ?? "";
    const inputText = input.length > 80 ? input.slice(0, 79) + "…" : input;
    const outputText = output.length > TOOL_SUMMARY_CHARS ? output.slice(0, TOOL_SUMMARY_CHARS - 1) + "…" : output;
    return `[tool:${tool.name ?? "?"}] ${inputText} → ${outputText || tool.state.status || ""}`;
}
export default opencodeNextPrompt;
