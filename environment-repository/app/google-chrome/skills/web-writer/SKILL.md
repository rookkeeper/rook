---
name: web-writer
description: Type or paste text into the web page the user is currently viewing in Google Chrome. Use when the user asks to write, type, paste, fill, or insert content into a web form, text editor, Google Doc, input field, textarea, or any editable region in their current tab. Also use when the user says "put this into the doc", "write this into the page", "fill out this form", or "paste this into" a web app.
---

# Web Writer (Chrome)

The user has **Google Chrome** frontmost with a page already loaded in their
real, logged-in session. To write into it, **send synthesized input through the
mac bridge** — never attempt to POST forms, use the Chrome DevTools Protocol, or
inject JavaScript. The bridge types/pastes into the page exactly as the user
would, preserving session, focus, and real-time validation.

## When to use this skill

Use this skill when the task requires *writing* into the current tab. For
*reading* the current tab, use the web-reader skill instead.

## Prerequisites

- **Agent Station menu bar app** running, with the mac bridge active.
- **Computer control enabled** in the menu bar app (the `/input` endpoint is
  gated behind this toggle). If `/input` returns `403` with `"computer control
  disabled"`, tell the user to enable it.
- Authenticate once per session:

```bash
TOKEN=$(cat ~/.agent-station/mac-bridge.json | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
BASE="http://127.0.0.1:8765"
```

## Available actions

All actions are POST to `$BASE/input` with `Authorization: Bearer $TOKEN` and
`Content-Type: application/json`.

### `type` — send characters one-by-one

```bash
curl -s -X POST "$BASE/input" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "type", "text": "hello world"}'
```

Sends each Unicode scalar as a key-down/key-up pair via CGEvent. Slower than
paste, but works everywhere and doesn't touch the clipboard. Use for short text
(up to ~200 chars). For longer content, prefer the clipboard + paste pattern
below.

### `key` — press a named special key

```bash
curl -s -X POST "$BASE/input" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "key", "key": "return"}'
```

Supported keys: `return`, `enter`, `tab`, `space`, `delete`, `escape`, `esc`,
`left`, `right`, `up`, `down`, `home`, `end`, `pageup`, `pagedown`,
`forwarddelete`.

The `key` action **only** supports these named keys — it does NOT support
regular characters like `"a"` or `"v"`. To send a character key with a modifier
(e.g. Cmd+V), use AppleScript instead (see below).

### `click` and `doubleclick` — mouse at screen coordinates

```bash
curl -s -X POST "$BASE/input" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "doubleclick", "x": 600, "y": 350}'
```

Coordinates are global top-left screen space. Note that NSScreen and CGEvent
coordinate systems differ (bottom-left vs top-left origin); the bridge handles
the conversion. Use `/ax-elements` to find element positions, or estimate from
the screenshot dimensions from `/screenshot`.

### `move` — move the cursor without clicking

```bash
curl -s -X POST "$BASE/input" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "move", "x": 600, "y": 350}'
```

## AppleScript for modifier-key combos

When you need Cmd+A, Cmd+V, Cmd+C, or any keystroke with modifiers, use the
`/applescript` endpoint — the `key` action can't do character keys:

```bash
curl -s -X POST "$BASE/applescript" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"script": "tell application \"System Events\"\n  tell process \"Google Chrome\"\n    set frontmost to true\n    delay 0.3\n    keystroke \"v\" using command down\n  end tell\nend tell"}'
```

Always target `process "Google Chrome"` explicitly and set `frontmost to true`
before the keystroke. Use `delay` between keystrokes — Google Docs and other
SPA editors need time to process each input.

## The clipboard + paste pattern (for large content)

Typing thousands of characters via `type` is too slow. For anything over ~200
characters, use this pattern:

```bash
# 1. Put the content on the clipboard
cat /path/to/content | pbcopy

# 2. Double-click into the editable area to establish focus
curl -s -X POST "$BASE/input" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "doubleclick", "x": 600, "y": 350}'

sleep 0.5

# 3. Select all + paste via AppleScript
curl -s -X POST "$BASE/applescript" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"script": "tell application \"System Events\"\n  tell process \"Google Chrome\"\n    set frontmost to true\n    delay 0.3\n    keystroke \"a\" using command down\n    delay 0.2\n    keystroke \"v\" using command down\n  end tell\nend tell"}'
```

## Canvas-based editors (Google Docs, Figma, etc.)

Google Docs, Figma, Notion, and similar rich editors render content in a
`<canvas>` or use custom editing surfaces that **do not appear in the
accessibility tree**. This means:

- `/window-text` returns only browser chrome (tabs, toolbar), never document
  content. Always fall back to `/screen-text` (OCR) for reading.
- `/ax-elements` shows toolbar buttons but never the editing area itself. You
  must estimate coordinates for clicks.

### Establishing focus in a canvas editor

The editor will not accept typed or pasted text until it has keyboard focus.
A single click is often not enough — Google Docs in particular requires a
**double-click** within the editable area to place a cursor and take focus.

1. **Estimate the editing area**: the toolbar occupies roughly the top 120–170
   pixels. The editable canvas starts below it. The page is typically centered
   horizontally. For a 1600px-wide window, try x=600–800, y=300–400.
2. **Double-click** to enter the document and place a cursor.
3. **Verify** with `/screen-text` — if your typed/pasted content appears in the
   OCR output, focus was established. If the document still shows its "empty
   state" placeholder, adjust coordinates and try again.
4. **Once focus is confirmed**, proceed with paste or typing.

### Verifying the result

After typing or pasting, always verify with `/screen-text` (OCR):

```bash
curl -s "$BASE/screen-text" -H "Authorization: Bearer $TOKEN"
```

The OCR output shows what's currently visible on screen. For long content, ask
the user to scroll or scroll programmatically via `key`:

```bash
# Scroll to top
curl -s -X POST "$BASE/applescript" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"script": "tell application \"System Events\"\n  tell process \"Google Chrome\"\n    set frontmost to true\n    delay 0.2\n    keystroke (ASCII character 30) using command down\n  end tell\nend tell"}'
```

## Form fields and standard inputs

For standard `<input>`, `<textarea>`, and `contenteditable` elements that *do*
appear in the AX tree, the pattern is simpler:

1. Use `/ax-elements` to find the element's center coordinates.
2. `click` (single) on the element to focus it.
3. `type` or paste the content.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `/input` returns 403 | Computer control not enabled | Ask user to enable it in Agent Station menu bar |
| Text appears in wrong place | Focus not in the editor | Double-click into the editor first |
| Paste does nothing | Google Docs / canvas editor without focus | Double-click into canvas, then AppleScript paste |
| `key` action fails for "a", "v", etc. | Only named special keys supported | Use AppleScript for character keys with modifiers |
| `/window-text` shows only browser chrome | Canvas-based editor | Use `/screen-text` (OCR) for reading, estimate coordinates for writing |
| Content cut off on screen | Scrolled to wrong position | Use Cmd+Up (scroll to top) via AppleScript, then verify |
