---
name: web-reader
description: Read the web page the user is currently viewing in Google Chrome. Use when the user asks about "this page", "what I'm looking at", a product/article/feed on screen, or to summarize or extract anything from their current tab.
---

# Web Reader (Chrome)

The user has **Google Chrome** frontmost with a page already loaded in their
real, logged-in session. To read it, **read what their browser already
rendered** — never fetch the site yourself.

## Do NOT fetch the site

Do not `curl` the URL, use the Chrome DevTools Protocol, or inject JavaScript.
Those make a *fresh request* to the server, which:

- gets flagged as a bot and blocked (Amazon, X, LinkedIn, etc. are aggressive),
  and
- runs logged-out — you lose the user's session, cookies, and personalization.

The bridge reads pixels/DOM the user's browser **already** loaded: zero new
requests, fully authenticated, invisible to bot detection. This is strictly
better and always the right move.

## How to read the current page

First authenticate (token in a `0600` file your shell can read):

```bash
cat ~/.agent-station/mac-bridge.json   # { "port": 8765, "token": "<hex>", ... }
```

Then, in order:

```bash
# 1. Structured page text from the accessibility tree (fast, preserves links/
#    headings). The menu bar app enables Chromium web-content a11y on the fly,
#    but the tree builds asynchronously — if the result is just tabs/toolbar
#    chrome, wait ~1s and read again.
curl -s http://127.0.0.1:8765/window-text -H "Authorization: Bearer $TOKEN"

# 2. If /window-text stays sparse (heavy SPA, virtualized feed, canvas), fall
#    back to OCR of the rendered screenshot. Request-free, works on ANY page
#    including bot-protected and logged-in ones. Needs Screen Recording granted.
curl -s http://127.0.0.1:8765/screen-text -H "Authorization: Bearer $TOKEN"
```

`/context` tells you the current tab (title + URL) so you know what page you're
reading and can detect when the user navigates.

## Notes

- For **bot-protected sites (Amazon, X)** the bridge reads are the *only* thing
  that works — never fall back to fetching; if both reads are thin, ask the user
  to scroll the content into view (OCR/AX only see what's on screen) and read
  again, or take it from `/screen-text`.
- OCR returns visible text in reading order but no links/structure; prefer
  `/window-text` when it has the content, use `/screen-text` for coverage.
- Only on-screen content is visible — to read more of a long page, ask the user
  to scroll, then re-read.

## Canvas-based editors (Google Docs, Figma, Notion, etc.)

These render content in `<canvas>` or custom editing surfaces that **never**
appear in the AX tree. `/window-text` returns only browser chrome; you must use
`/screen-text` (OCR) for every read. `/ax-elements` shows toolbar buttons but
not the editing area itself.

For *writing* into these editors, use the **web-writer** skill — it covers
establishing focus via double-click, pasting via AppleScript, and verifying
results with OCR.
