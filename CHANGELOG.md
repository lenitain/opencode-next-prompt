# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.3] - 2026-08-02

### Changed

- **Default display position**: `right` (below-right of the input) instead of `left` (input placeholder)
- **Default accept key**: `down` arrow instead of `right` arrow
- **Prediction prompt rewritten**: role-framed as the user reacting to the just-finished reply (addressed to the assistant, no self-action or meta-commentary), no scenario examples that would constrain the output, English only

## [0.0.2] - 2026-08-02

### Fixed

- **README install location**: TUI plugins must be declared in `tui.json`, not in the `opencode.jsonc` plugin array (which only feeds server plugins). Verified against the published package. The one-line install stays, just in the right file.

## [0.0.1] - 2026-08-02

### Added

- **Next-message prediction**: triggered automatically when the main session goes idle; the suggestion is generated in a separate incremental prediction session (reused across turns + prefix caching, flat latency and cost regardless of conversation size, zero pollution of the main conversation context)
- **Two display positions** (`position` option): `left` inside the input's top-left as a placeholder (gray ` [→] suggestion`); `right` in the slot below-right of the input. Both show the full text, never truncated
- **Right-arrow acceptance** (`acceptKey` option): with an empty input, → fills the suggestion exactly matching the gray part; with content, the key is not intercepted and keeps its normal cursor behavior
- **Typing hides, clearing re-shows**: `left` via native placeholder semantics, `right` via event-driven tracking (edit-buffer `content-changed` / `cursor-changed` subscriptions)
- **Accepting does not consume the suggestion**: after accepting, clearing the input re-shows it for another accept; it disappears only on a new turn, a session switch, or a new suggestion
- **Prediction-context composition**: all user messages kept (the prediction targets the user's next input); visible assistant text is kept in full, exactly as shown to the user; reasoning is excluded with defensive `<think>` stripping; tool calls and output are summarized in one line each
- **Background-session efficiency**: explicit title avoids title generation; an accumulated-size cap (80K chars) recycles the session before auto-compaction; compaction/revert tolerance (`session.compacted` rebuild + message-ID consistency check)
- **Suggestion quality**: the prompt is adapted from a community reverse-engineering of Claude Code's implementation (goal, rules, few-shot examples); the 170-char limit is stated in the prompt for the model to follow, with truncation only as a fallback
