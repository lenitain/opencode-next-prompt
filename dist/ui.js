import { asPromptTextarea } from "./editor.js";
import { debug } from "./debug.js";
const ARROW_KEYS = {
    right: "→",
    left: "←",
    up: "↑",
    down: "↓",
};
/** Shell mode edits a command, not a message, so the suggestion stays hidden. */
export function isShellMode(context) {
    return context.keymap.mode.current() === "shell";
}
function displayKey(key) {
    return ARROW_KEYS[key] ?? key;
}
/**
 * Renders the suggestion into the prompt textarea's placeholder. There is no
 * slot inside the input in V2, so the controller writes the placeholder
 * directly: it re-applies on store changes, on the renderer's `focused_editor`
 * event, and — because the TUI rewrites the placeholder from its own reactive
 * memo (session switch, resize, shell change) — on every frame while a
 * suggestion is live. `sessionID()` answers which session the prompt edits.
 *
 * The previous placeholder is saved before the first overwrite and restored
 * when the suggestion is discarded, so OpenCode's own hint is not lost.
 *
 * Deliberately free of solid-js: a plugin loaded at runtime resolves solid's
 * server build under bun's node conditions (createEffect would be a no-op)
 * and the plugin's copy of solid is not the TUI's copy anyway, so side effects
 * here must not depend on it.
 */
export function createPlaceholderController(context, store, sessionID, acceptKey) {
    const marker = ` [${displayKey(acceptKey)}] `;
    let savedPlaceholder;
    const isOurs = (value) => typeof value === "string" && value.startsWith(marker);
    const apply = () => {
        const editor = asPromptTextarea(context.renderer.currentFocusedEditor);
        const current = store.read();
        debug("apply", {
            kind: current.kind,
            want: current.kind === "ready" ? current.sessionID : undefined,
            have: sessionID(),
            editor: editor !== null,
        });
        if (!editor)
            return;
        if (isShellMode(context))
            return;
        if (current.kind === "ready" && current.sessionID === sessionID()) {
            if (!isOurs(editor.placeholder)) {
                savedPlaceholder = typeof editor.placeholder === "string" ? editor.placeholder : null;
            }
            const desired = marker + current.text;
            // Write only on real changes: the setter is idempotent, which is what
            // lets the frame reconciler below settle after restoring our marker.
            if (editor.placeholder !== desired)
                editor.placeholder = desired;
            return;
        }
        if (isOurs(editor.placeholder)) {
            editor.placeholder = savedPlaceholder ?? null;
            savedPlaceholder = undefined;
        }
    };
    // TUI overwrites trigger a render, so reconciling on the next frame
    // restores our marker within one paint; when idle there is nothing to
    // defend, and frames skip the work entirely.
    const onFrame = () => {
        if (store.read().kind === "ready")
            apply();
    };
    let unsubscribe = null;
    return {
        apply,
        start() {
            unsubscribe = store.subscribe(apply);
            context.renderer.on("focused_editor", apply);
            context.renderer.on("frame", onFrame);
        },
        dispose() {
            unsubscribe?.();
            unsubscribe = null;
            context.renderer.off("focused_editor", apply);
            context.renderer.off("frame", onFrame);
            const editor = asPromptTextarea(context.renderer.currentFocusedEditor);
            if (editor && isOurs(editor.placeholder))
                editor.placeholder = savedPlaceholder ?? null;
            savedPlaceholder = undefined;
        },
    };
}
