# opencode-next-prompt

Predicts your next message after the assistant replies and shows it at the prompt — accept it with a keypress (like Claude Code's "next message suggestion").

Requires OpenCode **≥ 2.0.12** (V2 plugin API).

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

Restart opencode. The package and its dependencies are installed automatically.

> In OpenCode 2.0.12+, plugins listed in `opencode.json(c)` that expose a TUI part are loaded automatically; `cli.json` remains for CLI-only plugins. `opencode plugin add` writes the package to the global `opencode.json`.

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
| `model` | unset | Fast model for predictions as `provider/model` (or `provider/model#variant`); a bare model id uses the session's provider. Falls back to `agents["next-prompt"].model`, then `agents.title.model` in `opencode.json(c)`, then the current session's model. Unknown providers/models are rejected with an error toast |
| `variant` | auto | Model variant (reasoning effort) used for predictions. By default the lowest variant the model supports is picked automatically (e.g. `none`, `minimal`, `min`, `low`); models without variants are left untouched. Set it explicitly (e.g. `"high"`) to override, or `"default"` to disable |
| `includeToolContext` | `false` | Include summarized tool calls and outputs in the prediction context (more context, more tokens) |

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

After each reply, the plugin predicts your next input from the recent conversation (the last few turns plus the original goal). It creates a temporary, tool-denied child session beneath the active session and runs `session.generate` there. The child inherits the active session's exact location — including its workspace — so project-scoped providers and models resolve, while deny-all permissions strip tools, skills, and MCP instructions from the request. `session.generate` does not write to session history, so the main conversation is never modified, and the helper session is removed after the call. The suggestion is written into the input placeholder, so what you see is exactly what gets accepted.

Each suggestion costs one extra model call. Failed or timed-out predictions are retried once. A suggestion disappears when you type, when you revert or compact the conversation, or when the session changes.

## License

MIT
