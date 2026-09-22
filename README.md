# opencode-next-prompt

Predicts your next message after the assistant replies and shows it at the prompt — accept it with a keypress (like Claude Code's "next message suggestion").

Requires OpenCode **≥ 2.0** (V2 plugin API).

## Install

Add to `~/.config/opencode/cli.json`:

```json
{
  "plugins": ["opencode-next-prompt"]
}
```

Restart opencode. The package and its dependencies are installed automatically.

> TUI plugins are declared in `cli.json`'s `plugins` array (the successor of `tui.json`'s `plugin` array); the `plugin` array in `opencode.json` is for server plugins.

## Usage

- After each reply, a suggested next message appears at the input in gray
- Press the accept key (**→** by default) while the input is empty to fill it; with text in the input, the key keeps its normal cursor behavior
- Typing hides the suggestion; clearing the input re-shows it

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
        "includeToolContext": false
      }
    }
  ]
}
```

| Key | Default | Description |
|---|---|---|
| `acceptKey` | `right` | Key to accept the suggestion (only effective while the input is empty) |
| `timeoutMs` | `20000` | Per-prediction timeout; the timed-out call is aborted and retried once |
| `model` | unset | Fast model for predictions as `provider/model`; a bare model id uses the session's provider. Defaults to the current session's model. Unknown providers/models are rejected with an error toast |
| `variant` | auto | Model variant (reasoning effort) used for predictions. By default the lowest variant the model supports is picked automatically (e.g. `low`); models without variants are left untouched. Set it explicitly (e.g. `"high"`) to override, or `"default"` to disable |
| `includeToolContext` | `false` | Include summarized tool calls and outputs in the prediction context (more context, more tokens) |

The accept command is registered as `opencode-next-prompt.accept`, so it can be rebound in `cli.json`'s `keybinds`.

## How it works

After each reply, the plugin predicts your next input with a single tool-free text-generation call built from the recent conversation (the last few turns plus the original goal). No background session is created, no tools are ever available to the prediction, and the main conversation is never modified. The suggestion is written into the input placeholder, so what you see is exactly what gets accepted.

Each suggestion costs one extra model call. Failed or timed-out predictions are retried once. A suggestion disappears when you type, when you revert or compact the conversation, or when the session changes.

## License

MIT
