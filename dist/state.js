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
export function createSuggestionStore() {
    let generation = 0;
    let state = { kind: "idle" };
    const listeners = new Set();
    const set = (next) => {
        state = next;
        for (const listener of [...listeners])
            listener(state);
    };
    return {
        read() {
            return state;
        },
        /** Subscribes to state transitions; returns the unsubscribe function. */
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        beginPredict(sessionID, turnKey) {
            if (state.kind !== "idle")
                return null;
            generation += 1;
            set({ kind: "predicting", sessionID, turnKey, generation });
            return generation;
        },
        /**
         * Settle the attempt for `turnKey`: text becomes the turn's suggestion,
         * null marks the turn as having no suggestion. A changed turn or a newer
         * attempt makes the result stale, so it is dropped.
         */
        settle(generation, turnKey, text) {
            if (state.kind !== "predicting" || state.generation !== generation || state.turnKey !== turnKey)
                return;
            set(text
                ? { kind: "ready", sessionID: state.sessionID, turnKey, text, generation }
                : { kind: "failed", sessionID: state.sessionID, turnKey, generation });
        },
        discard() {
            generation += 1;
            set({ kind: "idle" });
        },
    };
}
