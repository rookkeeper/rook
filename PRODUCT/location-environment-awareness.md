# Location environment awareness

Status: implemented. This feature turns a settled physical arrival into available `location:` environments that Rook can review and enter.

## What it does

When the iPhone or Android client detects a settled arrival, it sends location context to the server. A pluggable provider ranks nearby businesses, and the server registers the best candidate plus relevant neighbors. The client shows a business/environment banner and can enter the environment after the normal preview and decision flow.

Location environments use the same repository/bundle model as web, app, and project environments. Their resolved content is materialized into the session workspace; skills load from `.agents/skills`, instructions enter generated `AGENTS.md`, and other capability families follow their current projection rules.

## Current assumptions and limits

- ptiles is the current US-oriented provider and is fetched on demand by HTTP Range.
- availability and recent location registration are currently in-memory and process-local.
- registration is gated by dwell/stationary signals to avoid drive-by arrivals.
- exact client and server location ids are literal; parent environments are not implicitly entered.
- the current location-context bundle is synthetic; authored location capability catalogs and a production skill suggester remain future work.
- entering an environment rebuilds the affected runtime and can interrupt an in-flight reply, although ACP session history is retained.

## Dwell tuning

The server uses a minimum dwell/stationary policy (`MIN_DWELL_SECONDS = 30`, `STATIONARY_SPEED_MPS = 1.5`) with permissive behavior when no motion signal is available. iPhone motion checks are opt-in; the server still applies its own context gate.

## Follow-up work

- authored operator/domain location bundles
- production skill suggestions
- candidate selection before auto-registration
- persistent per-user presence
- deferring runtime rebuilds until idle
- proactive but consented location-triggered prompts
- capability-gated store/website skills
