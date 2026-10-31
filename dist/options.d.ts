export type Options = {
    acceptKey: string;
    timeoutMs: number;
    model?: string;
    variant?: string;
    includeToolContext: boolean;
};
export declare const DEFAULT_OPTIONS: Options;
/**
 * Plugin options come from JSON and are untyped at runtime. Reject values that
 * would break the keymap, the prediction deadline, or the tool-context switch,
 * and report each fallback instead of failing inside the TUI.
 */
export declare function normalizeOptions(raw: unknown): {
    options: Options;
    warnings: string[];
};
