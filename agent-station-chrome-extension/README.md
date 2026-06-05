# Agent Station Chrome Extension

Chrome MV3 environment provider for Agent Station.

## What it does
- recognizes supported sites from `site-registry.json`
- replaces the page with the split-pane shell
- opens the localhost agent pane (`http://localhost:3000`) when the CTA is clicked
- directly registers/unregisters environment availability with Agent Station
- relays live iframe → page actions like `url_change`

## Runtime flow

Current flow:
1. content script detects a registered site
2. user clicks **Chat with YOUR agent.**
3. background worker calls Agent Station:
   - `POST /api/environments/register`
4. Agent Station offers that environment to any open sessions over websocket
5. when the tab closes or leaves the supported site, the background worker calls:
   - `POST /api/environments/unavailable`

The extension no longer injects environment availability into the localhost iframe with `postMessage`.
`postMessage` is still used for live parent/iframe interactions like `url_change`.

## Files
- `content.js` — split-pane shell, CTA, iframe wiring
- `background.js` — site registry lookup, direct Agent Station API calls, tab lifecycle cleanup
- `site-registry.json` — supported sites and their environment metadata
- `split.css` — shell styling
- `manifest.json` — MV3 permissions, content script registration, service worker

## Notes
- Current Agent Station base URL is `http://127.0.0.1:3000`
- Current supported environment is Wikipedia via `web:wikipedia`
- Environment-linked skill content now lives in the repo-level `environment-repository/`, not inside this extension
