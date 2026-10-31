# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Prediction call**: predictions now run through `session.generate` in a temporary, tool-denied child session created beneath the active session. The child inherits the session's exact location (including workspaces), so project-scoped providers and models resolve; deny-all permissions strip tools, skills, and MCP instructions; `session.generate` leaves the main conversation untouched; the helper is removed after the call. This replaces the tool-free `generate.text` call used by 0.1.0
- **Model config**: `model` accepts `provider/model#variant`; the prediction model falls back from `model` to `agents["next-prompt"].model`, then `agents.title.model`, then the session's model
- **Variant default**: the lowest available reasoning variant is chosen (`none`, `minimal`, `min`, `low`, ...), including variants configured with `#variant` or on an `agents` model
- **Shell mode**: suggestions are no longer written into or accepted from the shell prompt

### Fixed

- **Bare model ids**: a bare `model` id now uses the session's provider instead of the provider from `agents.title.model`
- **Model lookup**: models are matched by their canonical `id` rather than `modelID`, so experimental modes and custom `modelID` overrides validate and resolve variants correctly
- **Helper cleanup**: helper sessions are removed without blocking the suggestion, with a bounded cleanup timeout
- **`generate.text` fallback**: on clients without session generation, a failed explicit-model call retries once with the server default, preserving the free-tier fallback
- **Package & Git installation**: moved `@opencode/plugin` to `peerDependencies`, relaxed `solid-js` peer constraint to `>=1.9.0`, and marked all host-provided `peerDependencies` as `optional: true` in `peerDependenciesMeta` to prevent `ERESOLVE` conflicts with `@opentui/solid`'s `solid-js@1.9.12` peer requirement
- **Git dependency preparation**: renamed `scripts.build` to `scripts.compile` and tracked compiled `dist/` artifacts so `pacote` does not trigger `/$bunfs/bin/npm-cli.js install` inside the compiled `opencode` binary during Git installs
- **OpenTUI 0.6+ compatibility**: updated `asPromptTextarea()` and `accept()` to support `invalidateIntrinsicSize()` (replacing `getLayoutNode().markDirty()`, which was removed in OpenTUI 0.6 / OpenCode 2.1+) while retaining a fallback for OpenCode 2.0.x

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
