import { createSignal } from "solid-js"

export type SuggestionState =
  | { kind: "idle" }
  | { kind: "predicting"; sessionID: string; generation: number }
  | { kind: "ready"; sessionID: string; text: string; generation: number }

export function createSuggestionStore() {
  let generation = 0
  const [state, setState] = createSignal<SuggestionState>({ kind: "idle" })

  return {
    read: state,

    beginPredict(sessionID: string): number | null {
      if (state().kind !== "idle") return null
      generation += 1
      setState({ kind: "predicting", sessionID, generation })
      return generation
    },

    commit(generation: number, sessionID: string, text: string | null): void {
      const current = state()
      if (current.kind !== "predicting" || current.generation !== generation) return
      setState(text ? { kind: "ready", sessionID, text, generation } : { kind: "idle" })
    },

    discard(): void {
      generation += 1
      setState({ kind: "idle" })
    },
  }
}

export type SuggestionStore = ReturnType<typeof createSuggestionStore>
