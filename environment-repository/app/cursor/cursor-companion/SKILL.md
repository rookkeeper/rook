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
card).

Cursor is Electron, and the menu bar app enables its web-content accessibility
tree on the fly — but that tree builds **asynchronously**, so the *first* read
right after the app comes to the foreground can be sparse (just chrome/menus).
If the result looks like only toolbar/menu labels, wait ~1s and read again.
For the exact contents of a large document, reading the file from disk is still
more reliable than the AX tree.

If `/window-text` stays sparse, fall back to OCR of the rendered screenshot —
request-free, reads whatever is visible (needs Screen Recording granted):

```bash
curl -s http://127.0.0.1:8765/screen-text -H "Authorization: Bearer $TOKEN"
```

## Driving Cursor (computer use, AX-driven)

When the user asks you to *click* or *operate* Cursor's UI, use the
accessibility-driven control loop — no screenshots needed, works with a
text-only model:

```bash
# 1. List actionable elements with their on-screen coordinates
curl -s http://127.0.0.1:8765/ax-elements -H "Authorization: Bearer $TOKEN"
# { "ok": true, "elements": [
#     { "id": 12, "role": "AXButton", "label": "Run", "centerX": 920, "centerY": 64, ... }, … ] }

# 2. Pick the element you want by its label/role, then click its center
curl -s -X POST http://127.0.0.1:8765/input -H "Authorization: Bearer $TOKEN" \
  -d '{"action":"click","x":920,"y":64}'

# Other actions: move, doubleClick {x,y}; type {text}; key {key,modifiers}
curl -s -X POST http://127.0.0.1:8765/input -H "Authorization: Bearer $TOKEN" \
  -d '{"action":"key","key":"return","modifiers":["cmd"]}'
```

Discipline:

- **Re-read `/ax-elements` after every action** — the UI changes; cached
  coordinates go stale.
- If `/input` returns 403 "computer control disabled", the user must flip the
  **Computer Control** toggle on in the menu bar app. Tell them; don't retry.
- Confirm destructive actions with the user before clicking.
- Cursor is Electron, so `/ax-elements` may miss editor-internal controls. For
  editing code, prefer reading/writing files directly over clicking; reserve
  control for buttons, tabs, dialogs, and menus the AX tree does expose.
