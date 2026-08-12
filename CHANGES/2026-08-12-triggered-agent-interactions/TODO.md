# Zoom transcript callback

> This plan reflects the agreed prototype direction from the brainstorm.

## Context

Create a separate thin server in a new GitHub repository under the `rookkeeper` organization. It will receive Zoom's `recording.transcript_completed` webhook on the Mac, verify it, and asynchronously invoke the existing local `rook exec` CLI. The resulting Rook session will use configured runtime, title, environments, and prompt values and remain visible to the normal Rook clients.

## Decision details

- Run the callback server and Cloudflare Tunnel on the Mac.
- Accept that webhook events are dropped when the Mac is asleep or unavailable; do not build a durable home-server inbox for this prototype.
- Use a fixed Zoom-to-one-configured-Rook workflow. The webhook payload supplies meeting data, but cannot select arbitrary executables, runtimes, environments, prompts, or Rook servers.
- Use `rook exec` as the trigger mechanism. Launch it asynchronously; do not wait for agent completion before acknowledging Zoom.
- Create a new Rook session for each accepted callback, including duplicate deliveries for now.
- Keep transcript processing and Obsidian/Peeps behavior in the selected environment and editable prompt rather than implementing those behaviors in the callback server.
- Use Cloudflare Tunnel as the first public exposure candidate. Keep the Rook server port private and use Tailscale only for private administration if useful.
- Do not add user notifications, task UI, home-server processing, Obsidian synchronization, multi-server delegation, or a generic Rook trigger API in this slice.
- Document Zoom prerequisites, Cloudflare setup, secrets/HMAC setup, local Rook/CLI setup, callback operation, and testing.

## Work checklist

### New callback repository

- [ ] Create a new `zoom-transcript-callback` repository under the `rookkeeper` GitHub organization for the thin Zoom callback server.
- [ ] Choose the implementation language/runtime and minimal HTTP framework.
- [ ] Add local configuration for callback bind address/port, Zoom webhook secret, Rook server URL/auth token, runtime id, session title format, joined environment ids, and editable prompt template.
- [ ] Ensure secrets are loaded from environment or an ignored local configuration file and never committed.

### Zoom webhook endpoint

- [ ] Implement `endpoint.url_validation` challenge handling with HMAC-SHA256 and the required response shape.
- [ ] Implement `recording.transcript_completed` handling.
- [ ] Verify `x-zm-request-timestamp` and `x-zm-signature` against the raw request body using constant-time comparison.
- [ ] Reject stale, malformed, oversized, or unsupported requests.
- [ ] Locate and validate the completed transcript recording file and safely extract meeting metadata, download URL, and temporary download token.
- [ ] Construct a fixed prompt from local configuration plus escaped/untrusted Zoom payload data.
- [ ] Return a 2xx response within Zoom's three-second delivery requirement without waiting for agent completion.
- [ ] Log operational metadata and child-process failures without logging transcript contents or secrets.

### Rook CLI integration

- [ ] Launch `rook exec` asynchronously with configured `--runtime`, `--title`, `--server-url`, `--auth-token`, repeated `--join`, and the generated prompt.
- [ ] Confirm that the current CLI creates a session, enters environments, handles offers headlessly, sends one prompt, and exits correctly when launched by the callback process.
- [ ] Add or adjust CLI behavior only if this integration test reveals a gap; preserve the existing interactive and one-shot modes.
- [ ] Decide and test how long prompts are passed safely if they exceed command-line argument limits.
- [ ] Confirm that the resulting session is visible through `rook sessions` and native clients.

### Cloudflare Tunnel and local operation

- [ ] Document Cloudflare account/domain prerequisites, `cloudflared` installation, named tunnel creation, stable public hostname, and route to the callback's loopback port.
- [ ] Ensure the route publishes only the callback endpoint and never the Rook server port.
- [ ] Document optional Tailscale use for private administration and clearly distinguish it from public Zoom ingress.
- [ ] Document how to start and supervise the callback server and `cloudflared` on macOS.
- [ ] Document local health checks, logs, restart behavior, and the accepted limitation that sleeping Macs miss events.

### Documentation and validation

- [ ] Write setup documentation covering Zoom Marketplace app configuration, account/recording/transcription prerequisites, endpoint validation, scopes, webhook secret, and testing.
- [ ] Write callback configuration and prompt-template documentation.
- [ ] Add Zoom fixture payloads and tests for validation challenge, valid/invalid signatures, stale requests, malformed payloads, missing transcript files, and duplicate deliveries.
- [ ] Add tests for asynchronous `rook exec` launch, argument construction, secret redaction, and child-process failure handling.
- [ ] Run a local end-to-end test with a fake Rook server/runtime before connecting the real Zoom app.
- [ ] Run the actual Zoom validation flow and one real transcript callback, then verify the session appears in Rook clients.
- [ ] Update the brainstorm with implementation findings and record any scope changes before beginning implementation.
