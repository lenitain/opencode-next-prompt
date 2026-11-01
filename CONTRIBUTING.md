# Contributing

## Setup

```sh
bun install
```

## Commands

```sh
bun run check        # tsc --noEmit (src, test, tools)
bun test             # bun:test
bun run compile      # rebuild dist/ from src/
bun run smoke        # load the built entrypoint
bun run format       # prettier
bun run format:check
```

`dist/` is committed so git installs work without a build step. CI rebuilds it and fails if the committed output differs; do not edit `dist/` by hand.

## Release

Bump `package.json` and `CHANGELOG.md`, run `bun run check && bun run format:check && bun test && bun run compile && bun run smoke`, commit the regenerated `dist/`, tag `vX.Y.Z`, then `npm publish`.

## How it works

A prediction is made when the session is idle, no permission or form dialog is waiting, and no message is queued. Typing, focus changes, and shell mode do not cancel it: they only keep the placeholder from being drawn, because they are visibility concerns, not decisions about the message. The call is aborted only when the turn changes (a new execution, revert, compaction, or session switch). Accepting only fills the input; deleting the text reveals the same suggestion again.

The context is the decision situation, not a flat transcript slice:

- the recent exchange, with the latest assistant reply kept at full fidelity — its ending (the question, proposal, or result the user is about to answer) always survives the budget
- older assistant turns reduced to their final prose paragraph; past user messages keep more detail than past assistant messages
- fenced code collapsed to a `[code: N lines, language]` fact
- the last completed tool's name and outcome, plus its input/output only when `includeToolContext` is enabled

One call runs in a disposable, tool-denied child session beneath the active session. The child inherits the active session's exact location — including its workspace — so project-scoped providers and models resolve, while deny-all permissions strip tools, skills, and MCP instructions from the request. `session.generate` does not write to session history, so the main conversation is never modified, and the helper session is removed after the call. There is no retry and no fallback path: a failed or timed-out call produces no suggestion for that turn.

## Implementation notes and risks

- The prompt has no plugin slot for an inline hint, so the suggestion is written into the input placeholder. This relies on OpenTUI's placeholder semantics and structural editor detection; a host UI change can break it.
- Shell mode is detected through the keymap mode. If that changes upstream, verify that the accept key never inserts text into a shell command.
- The keymap layer must be registered from the `app` slot render: `context.keymap.layer` resolves through `useContext`, so it needs a live solid owner inside the component tree.
- The prediction model is resolved in `src/model.ts`; every configured model is validated and reported with a toast instead of running a silently wrong prediction.
