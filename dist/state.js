/**
 * A tiny explicit pub/sub store.
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
        beginPredict(sessionID) {
            if (state.kind !== "idle")
                return null;
            generation += 1;
            set({ kind: "predicting", sessionID, generation });
            return generation;
        },
        commit(generation, sessionID, text) {
            if (state.kind !== "predicting" || state.generation !== generation || state.sessionID !== sessionID)
                return;
            set(text ? { kind: "ready", sessionID, text, generation } : { kind: "idle" });
        },
        discard() {
            generation += 1;
            set({ kind: "idle" });
        },
    };
}
