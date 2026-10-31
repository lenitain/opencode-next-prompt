# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-10-31

### Fixed

- **Regenerated replies**: the "already predicted" guard now keys on the last exchange (user message plus the reply after it), and `session.execution.started` invalidates the previous turn, so regenerating an answer produces a fresh suggestion instead of leaving the prompt empty
- **Retry cancellation**: the 800 ms retry timer is tracked and cleared by revert, compaction, session switch, new turns, and plugin disposal; a pending retry can no longer resurrect a suggestion after the conversation changed
- **Cross-session accept**: accepting checks that the ready suggestion belongs to the currently focused session, so a router change without a `tui.session.select` event cannot insert another session's text
- **In-flight cancellation**: starting a new turn or submitting a message aborts the active model call and removes the helper session instead of letting a stale prediction run to completion
- **Event coverage**: `session.execution.failed`, `session.idle`, `session.compaction.ended`, `session.revert.staged`, `session.revert.cleared`, and `session.compaction.started` are handled; failed turns and cancelled reverts now have a prediction trigger
- **Unhandled rejections**: every async prediction entry point catches errors, including transcript building and tool summarization, instead of rejecting an unobserved promise
- **Helper cleanup**: cleanup failures are logged instead of silently dropped; helper removal is idempotent and a timeout still removes a helper created after the deadline
- **Model validation**: every explicitly configured model (including `agents.title.model`) is validated; invalid title models warn and fall back to the session model, bare model ids resolve through the session provider or a unique provider, `#variant`/`variant` values are checked against the model's variants, and model lookup matches `id`, `modelID`, or `canonical`
- **Tool context**: the V2 tool output lives in `state.content`, not `metadata.output`; summaries now include completed tool text and are bounded before serialization, so huge or old tool payloads are never stringified
- **Output hygiene**: predictions are one line, at most 170 characters, stripped of ANSI/control characters and common labels, and the prompt states the length limit; the transcript is XML-escaped and delimited as untrusted data
- **Placeholder restoration**: the host's previous placeholder is saved and restored when a suggestion is discarded or the plugin unloads, instead of leaving the input blank
- **Option validation**: invalid `acceptKey`, `timeoutMs`, `model`, `variant`, or `includeToolContext` values produce one warning toast and a safe fallback
- **Runtime crash guard**: a host older than 2.0.22 warns once at startup; the prediction path still falls back to the active session and `generate.text`
- **Retry/timeout semantics**: prediction timeouts race the client call (not only `AbortSignal`), so a transport that ignores aborts cannot leave the store stuck in "predicting"
- **Version floor**: engine/peer dependencies and the README now require OpenCode 2.0.22, the first release whose session API accepts `parentID`

### Changed

- **Prediction call**: predictions run through `session.generate` in a temporary, tool-denied child session created beneath the active session. The child inherits the session's exact location (including workspaces), so project-scoped providers and models resolve; deny-all permissions strip tools, skills, and MCP instructions; `session.generate` leaves the main conversation untouched; the helper is removed after the call. The fallback order is helper → active-session `session.generate` → global `generate.text`
- **Model config**: `model` accepts `provider/model#variant`; the prediction model falls back from `model` to `agents["next-prompt"].model`, then `agents.title.model`, then the session's model
- **Variant default**: the lowest available reasoning variant is chosen (`none`, `minimal`, `min`, `low`, ...), including variants configured with `#variant` or on an `agents` model; `"default"` disables variants
- **Shell mode**: suggestions are never written into or accepted from the shell prompt; the keymap binding is scoped to the prompt textarea
- **Source layout**: split options, model resolution, transcript/prompt construction, and errors into modules; source files are now `.ts` (no JSX), and the unused `solid-js` peer and JSX build settings are gone
- **Testing and CI**: added tests for model resolution, options, transcript parsing, regeneration, retry cancellation, cross-session acceptance, failed executions, and both OpenTUI paths; `tsc` now checks tests/tools, `dist/` is rebuilt and diffed in CI, and a dist smoke test runs before publish
- **Debug logging**: optional `NEXT_PROMPT_DEBUG_FILE` override and 1 MB log rotation

## [0.1.0] - 2026-09-22

### Changed

- **OpenCode 2.0 only**: migrated to the V2 plugin API — `@opencode/plugin@2.0.12` (`Plugin.define` + `setup` context), `@opencode/client@2.0.12`, `@opentui/*@0.5.11`; OpenCode 1.x is no longer supported (`engines.opencode >=2.0.0`, peer deps use the V2 `@opencode/*` package names)
- **Install config**: TUI plugins are now declared in `~/.config/opencode/cli.json`'s `plugins` array (successor of `tui.json`'s `plugin` array), with options under `{ "package": ..., "options": ... }`
- **Prediction call**: runs through the tool-free `generate.text` endpoint instead of creating/aborting/deleting a background session — no session churn, no permission rules, and tools can never be involved; the `disableTools` option is removed accordingly
- **Accept insertion**: fills the prompt by driving the editor directly (`insertText` + end-of-buffer), the same path OpenCode itself uses for the `tui.prompt.append` event
- **Event handling**: `message.removed` / `message.part.removed` (absent in V2) are replaced by `session.revert.committed`; compaction is covered by discarding on the busy status
- **Debug logging**: `client.app.log` (removed in V2) is replaced by an opt-in `globalThis.NEXT_PROMPT_DEBUG` console logger, off by default so the TUI is never corrupted
- **Default accept key**: `right` arrow instead of `down` arrow (README, npm description, and placeholder hint updated to match)
- **Build toolchain**: deno → bun (`bun run check` = `tsc --noEmit`, `bun run build` = `bun tools/build.ts`); `deno.json`/`deno.lock` replaced by `tsconfig.json`/`bun.lock`

## [0.0.8] - 2026-08-03

### Fixed

- **Retry after failure**: a failed or timed-out prediction no longer marks the turn as predicted — it is retried once, so a transient error does not suppress suggestions for the rest of the turn
- **Undo / message removal**: each prediction now runs in a fresh background session, so undo, edits, and compaction can never leave predictions stuck on a stale prefix
- **Real timeout cancellation**: timing out now aborts the model call (and resets the background session) instead of just dropping the result, so no tokens are burned by orphaned requests
- **Compaction / session switch cleanup**: a single `invalidate()` now clears the suggestion, the turn markers, and the background session on compaction, session switch, session deletion, and message removal
- **Symmetric prediction context**: the prompt keeps the last 8 complete turns (plus the original goal) instead of all user messages with only the last 10 assistant messages
- **Prediction voice**: removed the prompt line that called the transcript "synthetic" (it broke the "you are the user" framing) and stopped reusing a background session whose history contained earlier predictions — both were causing suggestions written from the assistant's perspective
- **Model config validation**: `model` is checked against the available providers before each prediction; an unknown provider or model now produces a clear error toast and a readable log entry instead of failing silently
- **Readable failure logs**: prediction errors are now logged with their message instead of being serialized as `{}`

### Added

- **Config options**: `model` (fast prediction model), `variant` (reasoning effort — auto-picks the lowest variant the model supports, e.g. `low`, or none when unsupported), `disableTools` (default `true`), `includeToolContext` (default `false`)
- **npm description**: now says "down arrow" to match the default accept key and README

## [0.0.7] - 2026-08-02

### Fixed

- **README intro**: no longer hardcodes the right-arrow key in the one-liner (the key is configurable, `down` by default).

## [0.0.6] - 2026-08-02

### Fixed

- **README config example**: updated to the current options (`acceptKey` only; the stale `position` example was published in 0.0.5).

## [0.0.5] - 2026-08-02

### Removed

- **`position` option and the right-side display**: the suggestion now always shows inside the input as a placeholder (left). Defaults: `acceptKey = down`, display = input placeholder.

## [0.0.4] - 2026-08-02

### Fixed

- **Rebuilt dist with the current source**: 0.0.3 was published with a stale build (old defaults and old prompt); this release ships the new code.

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
