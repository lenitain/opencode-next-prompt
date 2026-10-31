# opencode-next-prompt

Predicts your next message after the assistant replies and shows it at the prompt — accept it with a keypress (like Claude Code's "next message suggestion").

Requires OpenCode **≥ 2.0.22** (V2 plugin API). The 2.0.22 floor is required for child sessions (`parentID`), which let the prediction inherit the project's location and resolve project-scoped models.

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

> In OpenCode 2.0.22+, plugins listed in `opencode.json(c)` that expose a TUI part are loaded automatically; `cli.json` remains for CLI-only plugins. `opencode plugin add` writes the package to the global `opencode.json`.
>
> The plugin declares `@opencode/*` and `@opentui/*` as optional peer dependencies; OpenCode provides them at runtime.

## Usage

- After each reply, a suggested next message appears at the input in gray, prefixed with the accept key
- Press the accept key (**→** by default) while the input is empty to fill it; with text in the input, the key keeps its normal cursor behavior
- Typing hides the suggestion; clearing the input brings it back. It is discarded when a new turn starts, the conversation is reverted or compacted, or the session changes
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
| `timeoutMs` | `20000` | Per-prediction timeout, 1000–300000 ms. The timed-out call is aborted and the attempt is retried once |
| `model` | unset | Fast model for predictions as `provider/model` (or `provider/model#variant`); a bare model id uses the session's provider (then a configured agent provider, or a unique matching provider). Falls back to `agents["next-prompt"].model`, then `agents.title.model` in `opencode.json(c)`, then the current session's model. Unknown providers, models, and variants are reported with an error toast instead of running a silently wrong prediction |
| `variant` | auto | Model variant (reasoning effort) used for predictions. By default the lowest variant the model supports is picked automatically (e.g. `none`, `minimal`, `min`, `low`); models without variants are left untouched. Set it explicitly (e.g. `"high"`) to override, or `"default"` to disable variants entirely |
| `includeToolContext` | `false` | Include summarized tool calls and outputs in the prediction context (more context, more tokens, and tool output is sent to the prediction provider) |

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

After each reply, the plugin predicts your next input from the recent conversation (the last few turns plus the original goal). It creates a temporary, tool-denied child session beneath the active session and runs `session.generate` there. The child inherits the active session's exact location — including its workspace — so project-scoped providers and models resolve, while deny-all permissions strip tools, skills, and MCP instructions from the request. `session.generate` does not write to session history, so the main conversation is never modified, and the helper session is removed after the call.

Failed or timed-out predictions are retried once. Starting a new turn, reverting, compacting, or switching sessions cancels the in-flight prediction and the pending retry. A failed helper creation falls back to `session.generate` on the active session, and finally to the global `generate.text`; the fallback paths do not have deny-all permissions, so upgrade to 2.0.22+ for the isolated path.

## Privacy

Each suggestion is one extra model call. The recent conversation is sent to the prediction model, which may be a different provider than the main session's model. With `includeToolContext` enabled, summarized tool calls and outputs are sent too. Use a local or trusted provider for sensitive projects. Debug logs contain session/model metadata and lengths, not transcript text.

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

- The prompt has no plugin slot for an inline hint, so the suggestion is written into the input placeholder. This relies on OpenTUI's placeholder semantics and structural editor detection; a host UI change can break it.
- Shell mode is detected through the keymap mode with an English placeholder fallback. If either changes upstream, verify that the accept key never inserts text into a shell command.
- Predictions are only generated for the focused session; switching to another tab/session starts a fresh prediction on its next turn.

## License

MIT
