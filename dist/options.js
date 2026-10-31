export const DEFAULT_OPTIONS = {
    acceptKey: "right",
    timeoutMs: 20_000,
    includeToolContext: false,
};
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 300_000;
const INVALID_KEYS = new Set(["", "none", "false"]);
/**
 * Plugin options come from JSON and are untyped at runtime. Reject values that
 * would break the keymap, the prediction deadline, or the tool-context switch,
 * and report each fallback instead of failing inside the TUI.
 */
export function normalizeOptions(raw) {
    const source = raw !== null && typeof raw === "object" ? raw : {};
    const warnings = [];
    let acceptKey = DEFAULT_OPTIONS.acceptKey;
    if (source.acceptKey !== undefined) {
        const value = typeof source.acceptKey === "string" ? source.acceptKey.trim() : "";
        if (value && !INVALID_KEYS.has(value.toLowerCase()))
            acceptKey = value;
        else
            warnings.push(`acceptKey must be a key name (got ${describe(source.acceptKey)}); using "${acceptKey}"`);
    }
    let timeoutMs = DEFAULT_OPTIONS.timeoutMs;
    if (source.timeoutMs !== undefined) {
        const value = source.timeoutMs;
        if (typeof value === "number" && Number.isFinite(value) && value >= MIN_TIMEOUT_MS && value <= MAX_TIMEOUT_MS) {
            timeoutMs = Math.round(value);
        }
        else {
            warnings.push(`timeoutMs must be a number between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} (got ${describe(value)}); using ${timeoutMs}`);
        }
    }
    let includeToolContext = DEFAULT_OPTIONS.includeToolContext;
    if (source.includeToolContext !== undefined) {
        if (typeof source.includeToolContext === "boolean")
            includeToolContext = source.includeToolContext;
        else
            warnings.push(`includeToolContext must be a boolean (got ${describe(source.includeToolContext)}); using ${includeToolContext}`);
    }
    return {
        options: {
            acceptKey,
            timeoutMs,
            model: readString(source.model, "model", warnings),
            variant: readString(source.variant, "variant", warnings),
            includeToolContext,
        },
        warnings,
    };
}
function readString(value, name, warnings) {
    if (value === undefined)
        return undefined;
    if (typeof value !== "string") {
        warnings.push(`${name} must be a string (got ${describe(value)}); ignoring it`);
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
}
function describe(value) {
    if (value === undefined)
        return "undefined";
    if (value === null)
        return "null";
    if (typeof value === "string")
        return JSON.stringify(value);
    return String(value);
}
