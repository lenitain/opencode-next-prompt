export type SuggestionState =
  | { kind: "idle" }
  | { kind: "predicting"; sessionID: string; generation: number }
  | { kind: "ready"; sessionID: string; text: string; generation: number }

export type SuggestionListener = (state: SuggestionState) => void

/**
 * A tiny explicit pub/sub store.
 *
 * Deliberately not a solid signal: a plugin loaded at runtime resolves solid's
 * server build under bun's node conditions (createEffect would be a no-op)
 * and the plugin's copy of solid is never the TUI's copy, so reactivity must
 * not depend on it.
 */
export function createSuggestionStore() {
  let generation = 0
  let state: SuggestionState = { kind: "idle" }
  const listeners = new Set<SuggestionListener>()

  const set = (next: SuggestionState): void => {
    state = next
    for (const listener of [...listeners]) listener(state)
  }

  return {
    read(): SuggestionState {
      return state
    },

    /** Subscribes to state transitions; returns the unsubscribe function. */
    subscribe(listener: SuggestionListener): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    beginPredict(sessionID: string): number | null {
      if (state.kind !== "idle") return null
      generation += 1
      set({ kind: "predicting", sessionID, generation })
      return generation
    },

    commit(generation: number, sessionID: string, text: string | null): void {
      if (state.kind !== "predicting" || state.generation !== generation) return
      set(text ? { kind: "ready", sessionID, text, generation } : { kind: "idle" })
    },

    discard(): void {
      generation += 1
      set({ kind: "idle" })
    },
  }
}

export type SuggestionStore = ReturnType<typeof createSuggestionStore>
