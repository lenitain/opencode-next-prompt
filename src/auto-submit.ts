import type { SuggestionState, SuggestionStore } from "./state.ts"
import { debug } from "./debug.ts"

export type AutoSubmitSuggestion = {
  sessionID: string
  turnKey: string
  text: string
}

export type AutoSubmitOptions = {
  delayMs: number
  store: SuggestionStore
  submit: (suggestion: AutoSubmitSuggestion) => void
}

/**
 * Arms one timer per ready suggestion. User activity or a state change cancels
 * it; a fired timer is final, so a later keystroke cannot resurrect it.
 *
 * The controller deliberately knows nothing about editors or sessions: the
 * submit callback re-checks that the suggestion is still current and that the
 * prompt is actually safe to submit.
 */
export function createAutoSubmit(options: AutoSubmitOptions) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let unsubscribe: (() => void) | undefined

  const clear = (reason: string): void => {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
    debug("auto submit canceled", reason)
  }

  const onState = (state: SuggestionState): void => {
    clear("suggestion changed")
    if (state.kind !== "ready") return
    const suggestion = { sessionID: state.sessionID, turnKey: state.turnKey, text: state.text }
    debug("auto submit armed", { delayMs: options.delayMs, sessionID: state.sessionID })
    timer = setTimeout(() => {
      timer = undefined
      debug("auto submit fired", { sessionID: suggestion.sessionID, turnKey: suggestion.turnKey })
      options.submit(suggestion)
    }, options.delayMs)
  }

  return {
    start(): void {
      unsubscribe = options.store.subscribe(onState)
      const current = options.store.read()
      if (current.kind === "ready") onState(current)
    },

    /** Called on any user input; the suggestion itself stays ready. */
    cancel(reason: string): void {
      clear(reason)
    },

    dispose(): void {
      clear("disposed")
      unsubscribe?.()
      unsubscribe = undefined
    },
  }
}

export type AutoSubmitController = ReturnType<typeof createAutoSubmit>
