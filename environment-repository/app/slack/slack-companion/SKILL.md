---
name: slack-companion
description: Perceive and drive Slack while the user has it in the foreground. Use when the user asks about their current Slack channel/conversation, wants a message drafted or sent, or wants to navigate Slack.
---

# Slack Companion

The user has **Slack** frontmost on their Mac. The Agent Station menu bar app
exposes a local, **authenticated** Mac bridge so you can perceive what they're
looking at and drive the app.

## Authenticate first

The bridge requires a per-launch bearer token, shared via a `0600` file only
your shell (not a webpage) can read. Read the port and token once:

```bash
cat ~/.agent-station/mac-bridge.json
# { "port": 8765, "token": "<hex>", "baseUrl": "http://127.0.0.1:8765" }
```

Send the token as `Authorization: Bearer <token>` on every request (all routes
except `/health` require it). Requests must target `127.0.0.1`/`localhost` and
must not carry an `Origin` header — plain `curl` satisfies both.

## Perceive: what is the user looking at?

The focused window title tells you the current channel/DM and workspace:

```bash
curl -s http://127.0.0.1:8765/context -H "Authorization: Bearer $TOKEN"
# {"frontmostApp":"Slack","bundleId":"com.tinyspeck.slackmacgap",
#  "windowTitle":"#releases (SpecStory) - Slack","environmentId":"app:slack", ...}
```

Always re-fetch `/context` before acting — the user may have switched channels.
If `windowTitle` is null, Accessibility isn't granted yet; ask the user to
click **Grant** on the Context Bridge card in the menu bar app.

To read the **messages currently on screen** (not just the channel name), pull
the focused window's visible text from the Accessibility tree:

```bash
curl -s http://127.0.0.1:8765/window-text -H "Authorization: Bearer $TOKEN"
# { "ok": true, "text": "<visible messages, sender names, timestamps, …>" }
```

Use this to summarize the conversation or draft a contextual reply. If `text`
is empty, Accessibility isn't granted yet.

## Act: navigate Slack

Open a channel or DM by deep link:

```bash
curl -s -X POST http://127.0.0.1:8765/open-url \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"url":"slack://channel?team=TXXXX&id=CXXXX"}'
```

Run AppleScript against Slack (the first such call triggers a one-time macOS
Automation consent prompt the user must approve):

```bash
curl -s -X POST http://127.0.0.1:8765/applescript \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"script":"tell application \"Slack\" to activate"}'
```

## Discipline

- **Read before you write.** Confirm the channel from `/context` and show the
  user the draft before sending anything.
- **Never send a message without explicit confirmation** in the conversation.
- Slack's AppleScript dictionary is minimal; prefer `slack://` deep links for
  navigation and the bridge for context. For reading message history or
  posting programmatically, a Slack user token + Web API is the robust path —
  ask the user to provide one if they want that.
- If a bridge call fails to connect, the menu bar app may be closed or the
  port differs (`MacBridgePort` default); tell the user rather than guessing.
