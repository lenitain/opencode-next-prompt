# opencode-next-prompt

Predicts your next message after the assistant replies and shows it at the prompt — accept it with the right arrow (like Claude Code's "next message suggestion").

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
- Press **→** while the input is empty to accept it; with text in the input, → keeps its normal cursor behavior
- Typing hides the suggestion; clearing the input re-shows it

## Config

```json
{
  "plugin": [["opencode-next-prompt", {
    "acceptKey": "right",
    "position": "left",
    "timeoutMs": 20000
  }]]
}
```

| Key | Default | Description |
|---|---|---|
| `acceptKey` | `right` | Key to accept the suggestion (only effective while the input is empty) |
| `position` | `left` | Where the suggestion shows: `left` inside the input; `right` below-right of the input |
| `timeoutMs` | `20000` | Per-prediction timeout; the suggestion is dropped on timeout |

## How it works

After each reply, the plugin predicts your next input in a background session that reuses the conversation prefix — each prediction only processes the new content, so it stays fast regardless of conversation length. The suggestion is written into the input placeholder, so what you see is exactly what gets accepted. The main conversation is never modified.

## License

MIT
