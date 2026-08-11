# Native Apple client UI and stalls

Use this lane only after CLI/log evidence says the remaining problem is native
rendering, interaction, or a Mac main-thread hang. Logs should come before UI
automation.

## Mac launch and Codex

The Mac sessions list does **not** auto-refresh. Restart it when testing new
sessions:

```bash
./scripts/run-rook.sh mac server
```

Always provide the full app path because multiple builds can share a bundle ID:

```bash
codex exec "Use computer use. Interact with the Rook app at /Users/johnberryman/projects/github/rookkeeper/rook/.var/run-rook/build/Rook/Build/Products/Debug/Rook.app. [instruction]" 2>/dev/null
```

Useful prompts:

```text
Tell me what screen the app is on.
Click the session named 'my-test' and report what you see.
Type 'hi' into the chat input, press enter, and report what happens.
```

Always begin with `Use computer use.`, click sessions by name rather than
position, and use `2>/dev/null` to hide the Codex banner.

## Mac beachball recipe

1. Record the exact time and whether the app is responsive, hidden, or frontmost.
2. Start the broad Mac unified-log stream from [Apple client logs](apple-client-logs.md).
3. Reproduce the beachball and look for `Main-thread stall detected`.
4. Correlate `instance`, `ageMs`, `operation`, and safe context with nearby
   AXReader, Finder, bridge, environment, network, and session records.
5. While it is visible, capture a stack sample:
   ```zsh
   sample Rook 10 -file ~/Desktop/rook-sample.txt
   ```
6. Treat `sample` as evidence of where the app is blocked. The watchdog's
   operation is context, not proof of the root cause.
7. `Main-thread stall recovered` closes the episode. The watchdog normally
   reports after roughly 3 seconds and records no user content.

## Privacy and log locations

Most diagnostic interpolations are explicitly `.public`. Normal logs include
counts, IDs, paths, and summaries. `ROOK_VERBOSE_LOGGING=1` additionally logs
raw foreground window titles, document paths, and URLs:

```zsh
ROOK_VERBOSE_LOGGING=1 ./scripts/run-rook.sh server mac
```

Use verbose mode only for a short reproduction and review logs before sharing.
The Mac-managed server tail is `~/Library/Logs/Rook/server.log`; launcher
build/launch logs are separate files under the selected profile's run root.
