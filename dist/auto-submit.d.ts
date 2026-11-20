import type { SuggestionStore } from "./state.js";
export type AutoSubmitSuggestion = {
    sessionID: string;
    turnKey: string;
    text: string;
};
export type AutoSubmitOptions = {
    delayMs: number;
    store: SuggestionStore;
    submit: (suggestion: AutoSubmitSuggestion) => void;
};
/**
 * Arms one timer per ready suggestion. User activity or a state change cancels
 * it; a fired timer is final, so a later keystroke cannot resurrect it.
 *
 * The controller deliberately knows nothing about editors or sessions: the
 * submit callback re-checks that the suggestion is still current and that the
 * prompt is actually safe to submit.
 */
export declare function createAutoSubmit(options: AutoSubmitOptions): {
    start(): void;
    /** Called on any user input; the suggestion itself stays ready. */
    cancel(reason: string): void;
    dispose(): void;
};
export type AutoSubmitController = ReturnType<typeof createAutoSubmit>;
