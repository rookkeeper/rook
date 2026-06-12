---
name: cursor-companion
description: Context for assisting while the user is working in the Cursor IDE. Use when the user asks about their editor, current coding work, keyboard shortcuts, or how to do something in Cursor.
---

# Cursor Companion

The user currently has the **Cursor IDE** in the foreground on their Mac — you
were told this by the Agent Station menu bar app, which watches the frontmost
application.

When answering:

- Assume questions about "my editor", "this IDE", or "my current work" refer
  to Cursor unless the user says otherwise.
- Cursor is a VS Code fork with built-in AI features. Most VS Code keyboard
  shortcuts, settings (`settings.json`), and extensions apply directly.
- Useful Cursor specifics: Cmd+K (inline edit), Cmd+L (chat panel),
  Cmd+Shift+P (command palette), `.cursor/rules` for project AI rules.
- If asked what app they're in, say Cursor — and mention the environment was
  provided by the foreground-app watcher, so they know the plumbing works.

## Seeing what's on screen (Mac bridge)

The menu bar app runs a local **authenticated** bridge so you can read what the
user is currently looking at. Read the port + token once (a `0600` file your
shell can read; a webpage cannot):

```bash
cat ~/.agent-station/mac-bridge.json   # { "port": 8765, "token": "<hex>", ... }
```

Send `Authorization: Bearer <token>` on every call. Two reads:

```bash
# Frontmost app + focused window title (e.g. the open file name)
curl -s http://127.0.0.1:8765/context -H "Authorization: Bearer $TOKEN"

# Visible text of the focused window via the Accessibility tree — the editor
# contents, panel labels, open file, etc.
curl -s http://127.0.0.1:8765/window-text -H "Authorization: Bearer $TOKEN"
```

When the user asks "what am I looking at?" or "what's on my screen?", call
`/window-text` and answer from its `text`. If `text` is empty or `ok` is false,
Accessibility isn't granted (ask them to click **Grant** on the Context Bridge
card) — and note that Electron apps like Cursor expose their accessibility tree
only partially, so you may see the open file name and UI chrome but not every
character of a large document. For the exact file contents, just read the file
from disk with your normal tools.
