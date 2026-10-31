/** Best-effort human-readable text for an unknown thrown value. */
export function errorMessage(error) {
    if (error instanceof Error)
        return error.message;
    if (typeof error === "string")
        return error;
    if (error && typeof error === "object") {
        const candidate = error.message;
        if (typeof candidate === "string")
            return candidate;
        try {
            return JSON.stringify(error);
        }
        catch {
            return String(error);
        }
    }
    return String(error);
}
