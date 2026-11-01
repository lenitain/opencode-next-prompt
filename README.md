# opencode-next-prompt

Predicts your next message after the assistant replies and shows it at the prompt — accept it with a keypress.

Requires OpenCode **≥ 2.1.4**.

## Install

```sh
opencode plugin add opencode-next-prompt
```

Or add the package to `~/.config/opencode/opencode.json(c)` by hand:

```json
{
  "plugins": ["opencode-next-prompt"]
}
```

Restart OpenCode afterwards. This is a TUI plugin, so it is loaded from `opencode.json(c)` — `cli.json` is only for CLI-only plugins.

## Usage

After each reply, a suggested next message appears in gray at the input, prefixed with the accept key (**→** by default).

- Press the accept key while the input is empty to fill it in. With text in the input, the key keeps its normal cursor behavior.
- The suggestion belongs to the turn: typing, opening a dialog, or switching to the shell prompt only hides it. It is dropped when a new turn starts, the conversation is reverted or compacted, or the session changes.
- Accepting fills the input without consuming the suggestion — delete the accepted text and it comes back.
- Nothing is predicted while a permission/form dialog is open or a message is queued: the next action is already decided.
- A prediction is one short line (at most 170 characters). The editor may visually truncate it, but the full text is inserted.

## Configuration

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

| Option | Default | Description |
|---|---|---|
| `acceptKey` | `right` | Key that accepts the suggestion (only effective while the input is empty). |
| `timeoutMs` | `20000` | Timeout per prediction, 1000–300000 ms. A timed-out prediction is dropped; there is no retry. |
| `model` | session model | Model used for predictions, as `provider/model` (or `provider/model#variant`). See [Prediction model](#prediction-model). |
| `variant` | auto | Reasoning effort for predictions. By default the model's lowest variant is used. Set it explicitly (e.g. `"high"`) or use `"default"` to disable variants. |
| `includeToolContext` | `false` | Also send the last completed tool's input and output to the prediction model. |

Invalid values fall back to the default and are reported with a warning toast.

### Prediction model

Every suggestion is a separate model call, so it is worth pointing it at a fast model. The prediction model is resolved in this order:

1. the `model` option
2. `agents["next-prompt"].model` in `opencode.json(c)`
3. `agents.title.model`
4. the current session's model

```jsonc
{
  "agents": {
    "title": {
      "model": "my-provider/fast-model"
    },
    "next-prompt": {
      "model": "my-provider/fast-model",
      "hidden": true
    }
  }
}
```

Free OpenCode Zen models (`opencode/*-free`) cannot be used — see [Limitations](#limitations).

### Rebinding the accept key

The accept action is registered as the command `opencode-next-prompt.accept`, so it can be rebound in `cli.json` under `keybinds`.

## Limitations

- **Free OpenCode Zen models (`opencode/*-free`) cannot power predictions.** The Zen free-tier gateway rejects the plugin's tool-free prediction request with a misleading `Free usage limit reached` error, so the turn simply shows no suggestion — the main conversation on the same model is unaffected. This is an upstream bug ([anomalyco/opencode#49723](https://github.com/anomalyco/opencode/issues/49723)); configure a non-free prediction model.
- Suggestions are only produced for the focused session; switching to another session starts a fresh prediction on its next turn.

## Privacy

Each suggestion is one extra model call that sends the recent conversation to the prediction model, which may be a different provider than the session's. With `includeToolContext` enabled, the last tool's input and output are sent too. Use a local or trusted provider for sensitive projects.

## Debugging

```sh
NEXT_PROMPT_DEBUG=1 opencode
```

Logs are written to `$TMPDIR/opencode-next-prompt.log` (1 MB, rotated to `.log.1`); set `NEXT_PROMPT_DEBUG_FILE` to use another path. Logs contain session and model metadata and lengths, never transcript text.

## Development

See [CONTRIBUTING.md](https://github.com/lenitain/opencode-next-prompt/blob/main/CONTRIBUTING.md).

## License

MIT
