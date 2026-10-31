import type { SessionMessageInfo } from "@opencode/client";
export type ConversationTurn = {
    role: "user" | "assistant";
    text: string;
};
export type Conversation = {
    turns: ConversationTurn[];
    goal?: string;
};
/**
 * Build the recent part of the conversation without materializing the whole
 * history. Only the last `MAX_TURNS` user/assistant messages are normalized,
 * so huge tool payloads from older turns are never stringified.
 */
export declare function collectConversation(messages: readonly SessionMessageInfo[], includeToolContext: boolean): Conversation;
/** The identity of the latest exchange: last user message plus the reply after it. */
export declare function lastTurnKey(messages: readonly SessionMessageInfo[]): string | undefined;
export declare function buildPrompt(conversation: Conversation): string;
export declare function parsePrediction(raw: string): string | null;
