# opencode-next-prompt

Predicts your next message after the assistant replies and shows it at the prompt — accept it with a keypress (like Claude Code's "next message suggestion").

Requires OpenCode **≥ 2.1.4** (latest V2 plugin API).

Predictions need a non-free model: OpenCode Zen free models (`opencode/*-free`) are **not supported** because of an [upstream bug](#limitations).

## Install

Add to `~/.config/opencode/cli.json`:

```json
{
  "plugins": ["opencode-next-prompt"]
}
```

Or install via the OpenCode CLI:

```sh
opencode plugin add opencode-next-prompt
```

Restart opencode. The package is installed automatically; OpenCode provides the host plugin/OpenTUI packages.

> Plugins listed in `opencode.json(c)` that expose a TUI part are loaded automatically; `cli.json` remains for CLI-only plugins. `opencode plugin add` writes the package to the global `opencode.json`.
>
> The plugin declares `@opencode/*` and `@opentui/*` as optional peer dependencies; OpenCode provides them at runtime.

## Usage

- After each reply, a suggested next message appears at the input in gray, prefixed with the accept key
- Press the accept key (**→** by default) while the input is empty to fill it; with text in the input, the key keeps its normal cursor behavior
- The suggestion belongs to the turn. Typing, opening a dialog, or switching to the shell prompt only hides it; clear the input, close the dialog, or return to the prompt and it is still there. Accepting fills the input without consuming it, so deleting the accepted text reveals the same suggestion again. It is discarded when a new turn starts, the conversation is reverted or compacted, or the session changes. A pending permission/form dialog or a queued message means the next action is already decided, so no prediction is made
- Accepting inserts the suggestion text without the ` [→] ` marker. A long suggestion can be visually truncated by the editor even though the full text is inserted

## Config

```json
{
  "plugins": [
    {
      "package": "opencode-next-prompt",
      "options": {
        "acceptKey": "right",
        "timeoutMs": 20000,
        "model": "my-provider/fast-model",
        "variant": "low",
        "includeToolContext": false
      }
    }
  ]
}
```

| Key | Default | Description |
|---|---|---|
| `acceptKey` | `right` | Key to accept the suggestion (only effective while the input is empty). Invalid values fall back to the default with a warning |
| `timeoutMs` | `20000` | Per-prediction timeout, 1000–300000 ms. The timed-out call is aborted; there is no retry |
| `model` | unset | Fast model for predictions as `provider/model` (or `provider/model#variant`); a bare model id uses the session's provider (then a configured agent provider, or a unique matching provider). Falls back to `agents["next-prompt"].model`, then `agents.title.model` in `opencode.json(c)`, then the current session's model. Do not point this at an `opencode/*-free` model (see [Limitations](#limitations)). Unknown providers, models, and variants are reported with an error toast instead of running a silently wrong prediction |
| `variant` | auto | Model variant (reasoning effort) used for predictions. By default the lowest variant the model supports is picked automatically (e.g. `none`, `minimal`, `min`, `low`); models without variants are left untouched. Set it explicitly (e.g. `"high"`) to override, or `"default"` to disable variants entirely |
| `includeToolContext` | `false` | Include the last completed tool's input and output in the prediction context. The tool name and its success/failure are always included; without this option, no tool content is sent |

You can also configure the prediction model per-project or globally in `opencode.json(c)` under `agents` (or rely on `agents.title.model`, which is used automatically when `agents["next-prompt"]` is not set):

```jsonc
{
  "agents": {
    "title": {
      "model": "my-provider/fast-model"
    },
    // Optional dedicated override for next-prompt suggestions:
    "next-prompt": {
      "model": "my-provider/fast-model",
      "hidden": true
    }
  }
}
```

The accept command is registered as `opencode-next-prompt.accept`, so it can be rebound in `cli.json`'s `keybinds`.

## How it works

A prediction is made when the session is idle, no permission or form dialog is waiting, and no message is queued. Typing, focus changes, and shell mode do not cancel it: they only keep the placeholder from being drawn, because they are visibility concerns, not decisions about the message. The call is aborted only when the turn changes (a new execution, revert, compaction, or session switch). Accepting only fills the input; deleting the text reveals the same suggestion again.

The context is the decision situation, not a flat transcript slice:

- the recent exchange, with the latest assistant reply kept at full fidelity — its ending (the question, proposal, or result the user is about to answer) always survives the budget
- older assistant turns reduced to their final prose paragraph; past user messages keep more detail than past assistant messages
- fenced code collapsed to a `[code: N lines, language]` fact
- the last completed tool's name and outcome, plus its input/output only when `includeToolContext` is enabled

One call runs in a disposable, tool-denied child session beneath the active session. The child inherits the active session's exact location — including its workspace — so project-scoped providers and models resolve, while deny-all permissions strip tools, skills, and MCP instructions from the request. `session.generate` does not write to session history, so the main conversation is never modified, and the helper session is removed after the call. There is no retry and no fallback path: a failed or timed-out call produces no suggestion for that turn.

## Privacy

Each suggestion is one extra model call. The recent conversation is sent to the prediction model, which may be a different provider than the main session's model. With `includeToolContext` enabled, the last completed tool's input and output are sent too; otherwise only its name and outcome are included. Use a local or trusted provider for sensitive projects. Debug logs contain session/model metadata and lengths, not transcript text.

## Debugging

```sh
NEXT_PROMPT_DEBUG=1 opencode
```

Logs are written to `$TMPDIR/opencode-next-prompt.log` (1 MB cap; rotated to `.log.1`). Set `NEXT_PROMPT_DEBUG_FILE` to a different path. Debug logging is off by default and can be removed once the issue is diagnosed.

## Development

```sh
bun install
bun run check        # tsc --noEmit (src, test, tools)
bun test             # bun:test
bun run compile      # rebuild dist/ from src/
bun run smoke        # load the built entrypoint
bun run format       # prettier
bun run format:check
```

`dist/` is committed so git installs work without a build step. CI rebuilds it and fails if the committed output differs; do not edit `dist/` by hand.

Release steps: bump `package.json` and `CHANGELOG.md`, run `bun run check && bun run format:check && bun test && bun run compile && bun run smoke`, commit the regenerated `dist/`, tag `vX.Y.Z`, then `npm publish`.

## Limitations

- **OpenCode Zen free models (`opencode/*-free`) are not supported for predictions — this is an upstream bug.** The Zen free-tier gateway only accepts model requests that carry OpenCode's full default tool set, while a prediction deliberately strips every tool from its helper session. So each prediction on a free model is refused with a misleading `Free usage limit reached` error and that turn silently shows no suggestion; the main conversation on the same free model is unaffected. The gateway rejects a legitimate request made from inside OpenCode, which the plugin cannot work around from its side (tracked upstream as [anomalyco/opencode#49723](https://github.com/anomalyco/opencode/issues/49723)). Configure a non-free prediction model (`model`, `agents["next-prompt"].model`, or `agents.title.model`) to use the plugin.
- The prompt has no plugin slot for an inline hint, so the suggestion is written into the input placeholder. This relies on OpenTUI's placeholder semantics and structural editor detection; a host UI change can break it.
- Shell mode is detected through the keymap mode. If that changes upstream, verify that the accept key never inserts text into a shell command.
- Predictions are only generated for the focused session; switching to another tab/session starts a fresh prediction on its next turn.
- The suggestion is only drawn while the prompt is focused, empty, and not in shell mode. It is kept otherwise, so returning to the prompt reveals it.

## License

MIT
