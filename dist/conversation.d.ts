import type { SessionMessageInfo } from "@opencode/client";
export type ConversationTurn = {
    role: "user" | "assistant";
    text: string;
};
export type ToolFact = {
    name: string;
    status: "completed" | "error";
    detail?: string;
};
export type Conversation = {
    turns: ConversationTurn[];
    lastTool?: ToolFact;
};
/**
 * Build the decision situation the assistant just created: the recent exchange
 * with the latest assistant reply kept at full fidelity, and the last completed
 * tool. Older assistant turns contribute only their final prose paragraph; code
 * is collapsed everywhere. No session origin anchor: the first message is often
 * a dead topic, and stale context would pull the prediction backwards.
 *
 * The invariant: the prose tail of the latest assistant reply always survives
 * the budget, because it holds the question, proposal, or result the user is
 * about to answer. Everything else is expendable.
 */
export declare function collectConversation(messages: readonly SessionMessageInfo[], includeToolContext: boolean): Conversation;
/** The identity of the latest exchange: last user message plus the reply after it. */
export declare function lastTurnKey(messages: readonly SessionMessageInfo[]): string | undefined;
export declare function buildPrompt(conversation: Conversation): string;
export declare function parsePrediction(raw: string): string | null;
