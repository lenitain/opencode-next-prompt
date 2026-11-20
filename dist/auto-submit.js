import { debug } from "./debug.js";
/**
 * Arms one timer per ready suggestion. User activity or a state change cancels
 * it; a fired timer is final, so a later keystroke cannot resurrect it.
 *
 * The controller deliberately knows nothing about editors or sessions: the
 * submit callback re-checks that the suggestion is still current and that the
 * prompt is actually safe to submit.
 */
export function createAutoSubmit(options) {
    let timer;
    let unsubscribe;
    const clear = (reason) => {
        if (timer === undefined)
            return;
        clearTimeout(timer);
        timer = undefined;
        debug("auto submit canceled", reason);
    };
    const onState = (state) => {
        clear("suggestion changed");
        if (state.kind !== "ready")
            return;
        const suggestion = { sessionID: state.sessionID, turnKey: state.turnKey, text: state.text };
        debug("auto submit armed", { delayMs: options.delayMs, sessionID: state.sessionID });
        timer = setTimeout(() => {
            timer = undefined;
            debug("auto submit fired", { sessionID: suggestion.sessionID, turnKey: suggestion.turnKey });
            options.submit(suggestion);
        }, options.delayMs);
    };
    return {
        start() {
            unsubscribe = options.store.subscribe(onState);
            const current = options.store.read();
            if (current.kind === "ready")
                onState(current);
        },
        /** Called on any user input; the suggestion itself stays ready. */
        cancel(reason) {
            clear(reason);
        },
        dispose() {
            clear("disposed");
            unsubscribe?.();
            unsubscribe = undefined;
        },
    };
}
