export type SuggestionState =
  | { kind: "idle" }
  | { kind: "predicting"; sessionID: string; turnKey: string; generation: number }
  | { kind: "ready"; sessionID: string; turnKey: string; text: string; generation: number }
  | { kind: "failed"; sessionID: string; turnKey: string; generation: number }

export type SuggestionListener = (state: SuggestionState) => void

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

    beginPredict(sessionID: string, turnKey: string): number | null {
      if (state.kind !== "idle") return null
      generation += 1
      set({ kind: "predicting", sessionID, turnKey, generation })
      return generation
    },

    /**
     * Settle the attempt for `turnKey`: text becomes the turn's suggestion,
     * null marks the turn as having no suggestion. A changed turn or a newer
     * attempt makes the result stale, so it is dropped.
     */
    settle(generation: number, turnKey: string, text: string | null): void {
      if (state.kind !== "predicting" || state.generation !== generation || state.turnKey !== turnKey) return
      set(
        text
          ? { kind: "ready", sessionID: state.sessionID, turnKey, text, generation }
          : { kind: "failed", sessionID: state.sessionID, turnKey, generation },
      )
    },

    discard(): void {
      generation += 1
      set({ kind: "idle" })
    },
  }
}

export type SuggestionStore = ReturnType<typeof createSuggestionStore>
