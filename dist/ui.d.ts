import type { Context } from "@opencode/plugin/tui/context";
import type { SuggestionStore } from "./state.js";
import { type TextareaLike } from "./editor.js";
export declare function isShellPlaceholder(placeholder: unknown): boolean;
export declare function isShellMode(context: Context, editor: TextareaLike): boolean;
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
export declare function createPlaceholderController(context: Context, store: SuggestionStore, sessionID: () => string | undefined, acceptKey: string): {
    apply: () => void;
    start(): void;
    dispose(): void;
};
export type PlaceholderController = ReturnType<typeof createPlaceholderController>;
