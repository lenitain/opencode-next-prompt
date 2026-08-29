# opencode-next-prompt

Predicts your next message after the assistant replies and shows it at the prompt — accept it with a keypress (like Claude Code's "next message suggestion").

## Install

Add to `~/.config/opencode/tui.json`:

```json
{
  "plugin": ["opencode-next-prompt"]
}
```

Restart opencode. The package and its dependencies are installed automatically.

> TUI plugins are declared in `tui.json`; the `plugin` array in `opencode.jsonc` is for server plugins (e.g. opencode-polkit).

## Usage

- After each reply, a suggested next message appears at the input in gray
- Press the accept key (**→** by default) while the input is empty to fill it; with text in the input, the key keeps its normal cursor behavior
- Typing hides the suggestion; clearing the input re-shows it

## Config

```json
{
  "plugin": [["opencode-next-prompt", {
    "acceptKey": "right",
    "timeoutMs": 20000,
    "model": "my-provider/fast-model",
    "disableTools": true,
    "includeToolContext": false
  }]]
}
```

| Key | Default | Description |
|---|---|---|
| `acceptKey` | `right` | Key to accept the suggestion (only effective while the input is empty) |
| `timeoutMs` | `20000` | Per-prediction timeout; the timed-out call is aborted and retried once |
| `model` | unset | Fast model for predictions as `provider/model`; a bare model id uses the session's provider. Defaults to the current session's model. Unknown providers/models are rejected with an error toast and a log entry |
| `variant` | auto | Model variant (reasoning effort) used for predictions. By default the lowest variant the model supports is picked automatically (e.g. `low`); models without variants are left untouched. Set it explicitly (e.g. `"high"`) to override, or `"default"` to disable |
| `disableTools` | `true` | Denies all tools in the background predictor session (predictions never run code or search) |
| `includeToolContext` | `false` | Include summarized tool calls and outputs in the prediction context (more context, more tokens) |

## How it works

After each reply, the plugin predicts your next input in a fresh background session built from the recent conversation (the last few turns plus the original goal). The suggestion is written into the input placeholder, so what you see is exactly what gets accepted. The main conversation is never modified.

Each suggestion costs one extra model call, and the background session is created and removed per prediction, so the model never sees its own previous predictions (which would bias the next one). Failed or timed-out predictions are retried once. A suggestion disappears when you type or when the session changes.

## License

MIT
