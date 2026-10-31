export type SuggestionState = {
    kind: "idle";
} | {
    kind: "predicting";
    sessionID: string;
    turnKey: string;
    generation: number;
} | {
    kind: "ready";
    sessionID: string;
    turnKey: string;
    text: string;
    generation: number;
} | {
    kind: "failed";
    sessionID: string;
    turnKey: string;
    generation: number;
};
export type SuggestionListener = (state: SuggestionState) => void;
/**
 * A tiny explicit pub/sub store.
 *
 * State is keyed by the turn it belongs to, never by what the user did with it.
 * A ready suggestion stays ready when it is accepted, typed over, or hidden by
 * a dialog: the decision to show it is made from the current turn and the
 * current input, not from a memory of earlier actions.
 *
 * Deliberately not a solid signal: a plugin loaded at runtime resolves solid's
 * server build under bun's node conditions (createEffect would be a no-op)
 * and the plugin's copy of solid is never the TUI's copy, so reactivity must
 * not depend on it.
 */
export declare function createSuggestionStore(): {
    read(): SuggestionState;
    /** Subscribes to state transitions; returns the unsubscribe function. */
    subscribe(listener: SuggestionListener): () => void;
    beginPredict(sessionID: string, turnKey: string): number | null;
    /**
     * Settle the attempt for `turnKey`: text becomes the turn's suggestion,
     * null marks the turn as having no suggestion. A changed turn or a newer
     * attempt makes the result stale, so it is dropped.
     */
    settle(generation: number, turnKey: string, text: string | null): void;
    discard(): void;
};
export type SuggestionStore = ReturnType<typeof createSuggestionStore>;
