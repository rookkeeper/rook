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
