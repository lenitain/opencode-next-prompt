/**
 * Structural (duck-typed) access to the TUI's focused prompt editor.
 *
 * `instanceof` cannot be used across the plugin/host boundary: the opencode
 * binary bundles its own copy of @opentui/core, while the plugin resolves its
 * own copy from node_modules, so class identity never matches. Instead we
 * recognise editors by the members every edit-buffer renderable exposes.
 *
 * To tell the prompt's multi-line TextareaRenderable apart from the
 * single-line InputRenderable (dialogs, forms — which must never receive the
 * suggestion), we check for the `maxLength` accessor that only
 * InputRenderable defines.
 */
export type TextareaLike = {
    readonly plainText: string;
    placeholder: string | null;
    readonly isDestroyed: boolean;
    insertText(text: string): void;
    gotoBufferEnd(options?: {
        select?: boolean;
    }): void;
    invalidateIntrinsicSize(): void;
};
/** Returns `editor` when it is a live, writable multi-line textarea; otherwise null. */
export declare function asPromptTextarea(editor: unknown): TextareaLike | null;
