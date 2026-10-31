import { Plugin } from "@opencode/plugin/tui";
import { createSuggestionStore } from "./state.js";
import { createPredictor } from "./predict.js";
import { createPlaceholderController, isShellMode } from "./ui.js";
import { asPromptTextarea } from "./editor.js";
import { normalizeOptions } from "./options.js";
import { NEXT_PROMPT_AGENT_IDS, resolvePredictionModel } from "./model.js";
import { buildPrompt, collectConversation, lastTurnKey } from "./conversation.js";
import { debug } from "./debug.js";
import { errorMessage } from "./errors.js";
const opencodeNextPrompt = Plugin.define({
    id: "opencode-next-prompt",
    setup(context) {
        const { options, warnings } = normalizeOptions(context.options);
        for (const warning of warnings) {
            context.ui.toast.show({ variant: "warning", title: "next-prompt", message: warning, duration: 10_000 });
        }
        const store = createSuggestionStore();
        let disposed = false;
        let activeSessionID = currentSessionID();
        let reportedModelIssue;
        let reportedModelWarning;
        const placeholder = createPlaceholderController(context, store, () => currentSessionID(), options.acceptKey);
        const predictor = createPredictor(context.client, { timeoutMs: options.timeoutMs });
        function currentSessionID() {
            const route = context.ui.router.current();
            if (route.type !== "session")
                return undefined;
            if (context.ui.tabs.enabled()) {
                const active = context.ui.tabs.list().find((tab) => tab.active);
                if (active)
                    return active.sessionID;
            }
            return route.sessionID;
        }
        function focusedPrompt() {
            return asPromptTextarea(context.renderer.currentFocusedEditor);
        }
        function promptInputIsEmpty() {
            const editor = focusedPrompt();
            return editor !== null && editor.plainText === "" && !isShellMode(context);
        }
        /**
         * A prediction is valid once the turn is over and no other action is
         * already decided. Typing, focus, and shell mode are visibility concerns,
         * not conversation state: they hide the suggestion, they never destroy it.
         */
        function decisionPoint(sessionID) {
            if (context.data.session.status(sessionID) !== "idle")
                return "session not idle";
            if ((context.data.session.permission.list(sessionID)?.length ?? 0) > 0)
                return "permission pending";
            if ((context.data.session.form.list(sessionID)?.length ?? 0) > 0)
                return "form pending";
            if (context.data.session.pending.list(sessionID).length > 0)
                return "message queued";
            return undefined;
        }
        function requestPrediction() {
            if (disposed)
                return;
            void maybePredict().catch((error) => debug("prediction crashed", errorMessage(error)));
        }
        function syncActiveSession() {
            const current = currentSessionID();
            if (current !== activeSessionID) {
                activeSessionID = current;
                resetIssues();
                invalidate();
            }
            return current;
        }
        function resetIssues() {
            reportedModelIssue = undefined;
            reportedModelWarning = undefined;
        }
        function showModelNotice(message, variant) {
            const previous = variant === "error" ? reportedModelIssue : reportedModelWarning;
            if (previous === message)
                return;
            if (variant === "error")
                reportedModelIssue = message;
            else
                reportedModelWarning = message;
            context.ui.toast.show({ variant, title: "next-prompt", message, duration: 8_000 });
        }
        /** The conversation changed: the suggestion for the old turn is stale. */
        function invalidate() {
            store.discard();
            void predictor.dispose();
        }
        async function maybePredict() {
            if (disposed)
                return;
            const sessionID = syncActiveSession();
            if (!sessionID) {
                debug("skip", "no session route");
                return;
            }
            const blocker = decisionPoint(sessionID);
            if (blocker) {
                debug("skip", blocker);
                return;
            }
            const messages = context.data.session.message.list(sessionID);
            const turnKey = lastTurnKey(messages);
            if (!turnKey) {
                debug("skip", "no user message");
                return;
            }
            const current = store.read();
            if (current.kind !== "idle") {
                if (current.turnKey === turnKey) {
                    debug("skip", "turn already settled");
                    return;
                }
                invalidate();
            }
            const conversation = collectConversation(messages, options.includeToolContext);
            if (conversation.turns.at(-1)?.role !== "assistant") {
                debug("skip", "no assistant reply");
                return;
            }
            const session = context.data.session.get(sessionID);
            const location = session?.location ?? context.location;
            const resolution = resolvePredictionModel({
                spec: options.model,
                variant: options.variant,
                sessionModel: session?.model,
                context,
                location,
            });
            if (resolution.issue) {
                showModelNotice(resolution.issue, "error");
                return;
            }
            reportedModelIssue = undefined;
            if (resolution.warning)
                showModelNotice(resolution.warning, "warning");
            else
                reportedModelWarning = undefined;
            const selected = resolution.model
                ? { providerID: resolution.model.providerID, id: resolution.model.id, variant: resolution.model.variant }
                : undefined;
            const agent = (context.data.location.agent?.list(location) ?? []).find((item) => NEXT_PROMPT_AGENT_IDS.includes(item.id))?.id;
            const generation = store.beginPredict(sessionID, turnKey);
            if (generation === null) {
                debug("skip", "store busy");
                return;
            }
            try {
                debug("predicting", { sessionID, model: selected, source: resolution.model?.source, agent });
                const result = await predictor.predict({
                    sessionID,
                    prompt: buildPrompt(conversation),
                    ...(agent ? { agent } : {}),
                    ...(selected ? { model: selected } : {}),
                });
                debug("predict result", { ok: result.ok, length: result.ok ? (result.text?.length ?? 0) : -1 });
                store.settle(generation, turnKey, result.ok ? result.text : null);
            }
            catch (error) {
                debug("prediction failed", errorMessage(error));
                store.settle(generation, turnKey, null);
            }
        }
        function accept() {
            const current = store.read();
            if (current.kind !== "ready" || current.sessionID !== currentSessionID())
                return;
            const editor = focusedPrompt();
            if (!editor)
                return;
            // Same insertion path the host uses for the `tui.prompt.append` event.
            // The suggestion stays ready: deleting the text reveals it again.
            editor.insertText(current.text);
            setTimeout(() => {
                if (disposed || editor.isDestroyed)
                    return;
                editor.invalidateIntrinsicSize();
                editor.gotoBufferEnd();
                context.renderer.requestRender();
            }, 0);
        }
        // The accept command itself; registered from the app slot render below
        // (keymap layers need a live solid owner — see the slot comment).
        const acceptLayer = () => ({
            priority: 1000,
            // Keep the binding inside the prompt textarea: a ready suggestion must
            // never intercept the right arrow in dialogs, editors, or shell mode.
            target: () => {
                const editor = focusedPrompt();
                if (!editor || isShellMode(context))
                    return null;
                return editor;
            },
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
                        // Fall through so the key keeps its default cursor behavior.
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
        const unsubscribers = [];
        const watchIdle = (type) => {
            unsubscribers.push(context.data.on(type, (event) => {
                const current = syncActiveSession();
                if (!current || event.data.sessionID !== current)
                    return;
                debug(type);
                requestPrediction();
            }));
        };
        unsubscribers.push(context.data.on("session.status", (event) => {
            if (event.data.sessionID !== syncActiveSession())
                return;
            const type = event.data.status.type;
            debug("session.status event", { type });
            if (type === "busy")
                invalidate();
            else if (type === "idle")
                requestPrediction();
        }));
        unsubscribers.push(context.data.on("session.execution.started", (event) => {
            if (event.data.sessionID !== syncActiveSession())
                return;
            debug("execution started");
            // A new turn (or a regenerated reply) invalidates both the suggestion
            // and the in-flight prediction, so a late result cannot win.
            invalidate();
        }));
        for (const type of [
            "session.execution.succeeded",
            "session.execution.interrupted",
            "session.execution.failed",
            "session.compaction.ended",
        ]) {
            watchIdle(type);
        }
        watchIdle("session.idle");
        for (const type of ["session.revert.staged", "session.revert.committed"]) {
            unsubscribers.push(context.data.on(type, (event) => {
                if (event.data.sessionID === syncActiveSession())
                    invalidate();
            }));
        }
        unsubscribers.push(context.data.on("session.revert.cleared", (event) => {
            if (event.data.sessionID !== syncActiveSession())
                return;
            requestPrediction();
        }));
        unsubscribers.push(context.data.on("session.compaction.started", (event) => {
            if (event.data.sessionID === syncActiveSession())
                invalidate();
        }));
        unsubscribers.push(context.data.on("session.deleted", (event) => {
            if (event.data.sessionID === currentSessionID() || event.data.sessionID === activeSessionID)
                invalidate();
        }));
        unsubscribers.push(context.data.on("tui.session.select", () => {
            activeSessionID = currentSessionID();
            resetIssues();
            invalidate();
        }));
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
export default opencodeNextPrompt;
